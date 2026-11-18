output "cluster_name" {
  value = module.gke.name
}

output "cluster_location" {
  value = module.gke.location
}

output "get_credentials_command" {
  description = "Point kubectl at the cluster."
  value       = "gcloud container clusters get-credentials ${module.gke.name} --region ${module.gke.location} --project ${var.project_id}"
}

output "namespace" {
  value = local.foundation.namespace
}

output "gateway_ip_name" {
  description = "Reference from the Gateway manifest (networking.gke.io/addresses)."
  value       = google_compute_global_address.gateway.name
}

output "gateway_ip" {
  value = google_compute_global_address.gateway.address
}

output "app_hostname" {
  value = local.hostname
}

output "ssl_certificate_name" {
  description = "Reference from the Gateway manifest (networking.gke.io/pre-shared-certs)."
  value       = google_compute_managed_ssl_certificate.gateway.name
}

output "artifact_registry_url" {
  value = local.foundation.artifact_registry_url
}
