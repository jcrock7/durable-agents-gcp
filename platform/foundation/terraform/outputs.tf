# The cluster layer reads these through terraform_remote_state.

output "artifact_registry_url" {
  description = "Push images here, e.g. <url>/api:<tag>."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "workload_service_accounts" {
  description = "Workload name => Google service account email and the Kubernetes service account it binds to."
  value = {
    for name, w in local.workloads : name => {
      email = google_service_account.workload[name].email
      ksa   = w.ksa
    }
  }
}

output "namespace" {
  description = "Kubernetes namespace for the workloads."
  value       = var.namespace
}

output "secret_ids" {
  description = "Secret Manager secret IDs (values are never output)."
  value       = [for s in google_secret_manager_secret.secret : s.secret_id]
}

output "pg_backup_bucket" {
  value = google_storage_bucket.pg_backups.name
}

output "github_workload_identity_provider" {
  description = "Use as workload_identity_provider in google-github-actions/auth."
  value       = local.ci_enabled ? google_iam_workload_identity_pool_provider.github[0].name : null
}

output "github_ci_service_account" {
  value = local.ci_enabled ? google_service_account.github_ci[0].email : null
}
