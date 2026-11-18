# GitHub Actions → Google Cloud without stored keys (Workload Identity Federation).
# Only workflows in var.github_repository can impersonate the github-ci account.
# Skipped when github_repository is empty.
#
# Note: deleted identity pools are kept for 30 days, so after a destroy the same pool ID
# can't be recreated until then.

locals {
  ci_enabled = var.github_repository != ""
}

resource "google_iam_workload_identity_pool" "github" {
  count                     = local.ci_enabled ? 1 : 0
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"

  depends_on = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  count                              = local.ci_enabled ? 1 : 0
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[0].workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  attribute_condition = "assertion.repository == \"${var.github_repository}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "github_ci" {
  count        = local.ci_enabled ? 1 : 0
  project      = var.project_id
  account_id   = "github-ci"
  display_name = "GitHub Actions CI"

  depends_on = [google_project_service.apis]
}

resource "google_service_account_iam_member" "github_ci_federation" {
  count              = local.ci_enabled ? 1 : 0
  service_account_id = google_service_account.github_ci[0].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github[0].name}/attribute.repository/${var.github_repository}"
}

resource "google_artifact_registry_repository_iam_member" "github_ci_push" {
  count      = local.ci_enabled ? 1 : 0
  project    = var.project_id
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.github_ci[0].email}"
}
