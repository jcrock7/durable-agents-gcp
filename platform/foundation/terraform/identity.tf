# Workload identities and secrets.
# Each workload gets its own Google service account with only the roles it needs.
# The cluster layer binds each one to its Kubernetes service account (Workload Identity),
# because those bindings need the cluster's identity pool to exist.

locals {
  telemetry_roles = [
    "roles/cloudtrace.agent",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ]

  # name => Kubernetes service account and project roles
  workloads = {
    api      = { ksa = "api", roles = local.telemetry_roles }
    worker   = { ksa = "worker", roles = local.telemetry_roles }
    litellm  = { ksa = "litellm", roles = concat(["roles/aiplatform.user"], local.telemetry_roles) } # only identity that can call models
    postgres = { ksa = "agents-pg", roles = [] }                                                     # CloudNativePG cluster "agents-pg"
  }

  workload_roles = flatten([
    for name, w in local.workloads : [
      for role in w.roles : { key = "${name}:${role}", name = name, role = role }
    ]
  ])

  # secret id => generated length
  secrets = {
    "litellm-master-key"        = 48
    "postgres-app-password"     = 32
    "postgres-litellm-password" = 32
  }

  # Which workload may read which secret
  secret_access = [
    { workload = "litellm", secret = "litellm-master-key" },
    { workload = "litellm", secret = "postgres-litellm-password" },
    { workload = "api", secret = "postgres-app-password" },
    { workload = "worker", secret = "postgres-app-password" },
  ]
}

resource "google_service_account" "workload" {
  for_each     = local.workloads
  project      = var.project_id
  account_id   = "wl-${each.key}"
  display_name = "Workload: ${each.key}"

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "workload" {
  for_each = { for r in local.workload_roles : r.key => r }
  project  = var.project_id
  role     = each.value.role
  member   = "serviceAccount:${google_service_account.workload[each.value.name].email}"
}

resource "google_storage_bucket_iam_member" "pg_backups" {
  bucket = google_storage_bucket.pg_backups.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.workload["postgres"].email}"
}

# --- Secrets ----------------------------------------------------------------
# Values are generated here and stored in Secret Manager. They also sit in Terraform state,
# which is why the state bucket is private, versioned and never committed.

resource "random_password" "secret" {
  for_each = local.secrets
  length   = each.value
  special  = false
}

resource "google_secret_manager_secret" "secret" {
  for_each  = local.secrets
  project   = var.project_id
  secret_id = each.key

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "secret" {
  for_each = local.secrets
  secret   = google_secret_manager_secret.secret[each.key].id
  # LiteLLM requires its master key to start with "sk-".
  secret_data = each.key == "litellm-master-key" ? "sk-${random_password.secret[each.key].result}" : random_password.secret[each.key].result
}

resource "google_secret_manager_secret_iam_member" "access" {
  for_each  = { for a in local.secret_access : "${a.workload}/${a.secret}" => a }
  project   = var.project_id
  secret_id = google_secret_manager_secret.secret[each.value.secret].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload[each.value.workload].email}"
}

# --- GKE node identity --------------------------------------------------------
# Nodes run as this account instead of the Compute Engine default one, which holds the Editor
# role on the whole project. It can write logs and metrics and pull this project's images, and
# nothing else. Workloads never use it: they act through Workload Identity (above).

resource "google_service_account" "gke_nodes" {
  project      = var.project_id
  account_id   = "gke-nodes"
  display_name = "GKE nodes (least privilege)"

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "gke_nodes" {
  project = var.project_id
  role    = "roles/container.defaultNodeServiceAccount"
  member  = "serviceAccount:${google_service_account.gke_nodes.email}"
}

resource "google_artifact_registry_repository_iam_member" "gke_nodes_pull" {
  project    = var.project_id
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.gke_nodes.email}"
}
