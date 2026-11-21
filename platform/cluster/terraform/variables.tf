variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Region for the cluster and network."
  type        = string
  default     = "us-central1"
}

variable "state_bucket" {
  description = "Terraform state bucket, used to read the foundation layer's outputs."
  type        = string
}

variable "cluster_name" {
  description = "GKE cluster name; also prefixes the network, gateway IP and certificate."
  type        = string
  default     = "agents-demo"
}

variable "authorized_networks" {
  description = "CIDR blocks allowed to reach the Kubernetes API, e.g. your own IP as a /32. Required, and never the whole internet."
  type = list(object({
    cidr = string
    name = string
  }))

  validation {
    condition     = length(var.authorized_networks) > 0 && alltrue([for n in var.authorized_networks : !endswith(n.cidr, "/0")])
    error_message = "Name at least one network, and none may be a /0 (the whole internet)."
  }
}

variable "app_hostname" {
  description = "Hostname for the app. Empty uses <gateway-ip>.sslip.io, which needs no DNS setup."
  type        = string
  default     = ""
}
