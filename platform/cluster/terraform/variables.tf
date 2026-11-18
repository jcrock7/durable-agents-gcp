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
  description = "CIDR blocks allowed to reach the Kubernetes API. Narrow this to your own IP when you can."
  type = list(object({
    cidr = string
    name = string
  }))
  default = [{ cidr = "0.0.0.0/0", name = "anywhere" }]
}

variable "app_hostname" {
  description = "Hostname for the app. Empty uses <gateway-ip>.sslip.io, which needs no DNS setup."
  type        = string
  default     = ""
}
