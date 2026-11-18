# Foundation layer: everything that persists between sessions and costs cents per month.
# Apply once; the cluster layer reads this layer's outputs.

locals {
  apis = [
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",
    "certificatemanager.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudtrace.googleapis.com",
    "compute.googleapis.com",
    "container.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "iap.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# --- Container images -------------------------------------------------------

resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_repo_id
  format        = "DOCKER"
  description   = "Images for the durable agents platform"

  cleanup_policy_dry_run = false

  # KEEP rules win over DELETE rules: keep the newest N versions, delete the rest after 7 days.
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = var.keep_image_versions
    }
  }

  cleanup_policies {
    id     = "delete-older-than-7-days"
    action = "DELETE"
    condition {
      older_than = "604800s"
    }
  }

  depends_on = [google_project_service.apis]
}

# --- Postgres backups -------------------------------------------------------

resource "google_storage_bucket" "pg_backups" {
  project                     = var.project_id
  name                        = "${var.project_id}-pg-backups"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  lifecycle_rule {
    condition {
      age = var.backup_retention_days
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.apis]
}

# --- App access through Identity-Aware Proxy ---------------------------------

resource "google_project_iam_member" "iap_access" {
  for_each = toset(var.iap_members)
  project  = var.project_id
  role     = "roles/iap.httpsResourceAccessor"
  member   = each.value
}
