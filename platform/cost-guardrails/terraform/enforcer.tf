# Cost guardrails, part 2: the enforcer.
# A Cloud Run function (gen2) on the budget topic deletes GKE clusters at the stop threshold,
# deletes clusters older than cluster_max_hours, and disables billing at the hard cap.

# --- Identities -------------------------------------------------------------

resource "google_service_account" "enforcer" {
  project      = var.project_id
  account_id   = "budget-enforcer"
  display_name = "Budget enforcer (runtime and trigger)"

  depends_on = [google_project_service.apis]
}

resource "google_service_account" "builder" {
  project      = var.project_id
  account_id   = "budget-enforcer-build"
  display_name = "Budget enforcer (Cloud Build)"

  depends_on = [google_project_service.apis]
}

locals {
  enforcer_roles = [
    "roles/container.clusterAdmin",            # list and delete GKE clusters
    "roles/compute.loadBalancerAdmin",         # list and delete orphaned Gateway load balancer parts
    "roles/billing.projectManager",            # read and remove the project's billing link
    "roles/browser",                           # read project metadata for billing info
    "roles/eventarc.eventReceiver",            # receive Pub/Sub events through Eventarc
    "roles/serviceusage.serviceUsageConsumer", # Eventarc trigger validation checks serviceusage.services.use
  ]
  builder_roles = [
    "roles/logging.logWriter",
    "roles/artifactregistry.writer",
    "roles/storage.objectViewer",
  ]
}

resource "google_project_iam_member" "enforcer" {
  for_each = toset(local.enforcer_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.enforcer.email}"
}

resource "google_project_iam_member" "builder" {
  for_each = toset(local.builder_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.builder.email}"
}

# New IAM grants and Google-managed service agents take a minute or two to propagate.
# Without this pause, a first apply on a fresh project fails Eventarc trigger validation.
resource "time_sleep" "iam_propagation" {
  create_duration = "90s"

  triggers = {
    enforcer_roles = join(",", local.enforcer_roles)
    builder_roles  = join(",", local.builder_roles)
  }

  depends_on = [
    google_project_service.apis,
    google_project_iam_member.enforcer,
    google_project_iam_member.builder,
  ]
}

# --- Function source --------------------------------------------------------

resource "google_storage_bucket" "fn_source" {
  project                     = var.project_id
  name                        = "${var.project_id}-budget-enforcer-src"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true

  depends_on = [google_project_service.apis]
}

data "archive_file" "fn" {
  type        = "zip"
  source_dir  = "${path.module}/../enforcer"
  output_path = "${path.module}/.build/budget-enforcer.zip"
  excludes    = ["node_modules", "decide.test.js"]
}

resource "google_storage_bucket_object" "fn" {
  name   = "budget-enforcer-${data.archive_file.fn.output_md5}.zip"
  bucket = google_storage_bucket.fn_source.name
  source = data.archive_file.fn.output_path
}

# --- Function ---------------------------------------------------------------

resource "google_cloudfunctions2_function" "enforcer" {
  project  = var.project_id
  name     = "budget-enforcer"
  location = var.region

  build_config {
    runtime         = "nodejs22"
    entry_point     = "enforceBudget"
    service_account = google_service_account.builder.id
    source {
      storage_source {
        bucket = google_storage_bucket.fn_source.name
        object = google_storage_bucket_object.fn.name
      }
    }
  }

  service_config {
    max_instance_count             = 1
    available_memory               = "512M" # @google-cloud/compute (load balancer sweep) needs ~300 MiB at startup
    timeout_seconds                = 300 # load balancer deletes are waited on one by one
    ingress_settings               = "ALLOW_INTERNAL_ONLY"
    all_traffic_on_latest_revision = true
    service_account_email          = google_service_account.enforcer.email
    environment_variables = {
      PROJECT_ID         = var.project_id
      ENFORCEMENT_MODE   = var.enforcement_mode
      STOP_CLUSTERS_AT   = tostring(var.stop_clusters_at)
      DISABLE_BILLING_AT = tostring(var.disable_billing_at)
      CLUSTER_MAX_HOURS  = tostring(var.cluster_max_hours)
      SWEEP_ORPHAN_LBS   = tostring(var.sweep_orphan_lbs)
    }
  }

  event_trigger {
    trigger_region        = var.region
    event_type            = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic          = google_pubsub_topic.budget.id
    retry_policy          = "RETRY_POLICY_DO_NOT_RETRY"
    service_account_email = google_service_account.enforcer.email
  }

  depends_on = [time_sleep.iam_propagation]
}

# The Eventarc trigger invokes the function's Cloud Run service as the enforcer account.
resource "google_cloud_run_v2_service_iam_member" "invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.enforcer.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.enforcer.email}"
}

# --- Cluster time-to-live tick ------------------------------------------------

# Budget data can lag by hours, so a forgotten cluster is caught by age as well as by spend.
resource "google_cloud_scheduler_job" "cluster_ttl" {
  project     = var.project_id
  region      = var.region
  name        = "cluster-ttl-check"
  description = "Hourly: ask the budget enforcer to delete GKE clusters older than ${var.cluster_max_hours}h."
  schedule    = "0 * * * *"
  time_zone   = "Etc/UTC"

  pubsub_target {
    topic_name = google_pubsub_topic.budget.id
    data       = base64encode(jsonencode({ kind = "cluster-ttl" }))
  }

  depends_on = [google_project_service.apis]
}
