output "name" {
  value = google_container_cluster.this.name
}

output "location" {
  value = google_container_cluster.this.location
}

output "workload_pool" {
  description = "Workload Identity pool used to bind Kubernetes service accounts to Google service accounts."
  value       = "${var.project_id}.svc.id.goog"
  # The pool only exists once the project's first Workload Identity cluster does, so anything
  # that binds to it (IAM members) must wait for the cluster.
  depends_on = [google_container_cluster.this]
}
