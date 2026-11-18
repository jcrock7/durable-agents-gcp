variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Region for the (regional) Autopilot cluster."
  type        = string
}

variable "name" {
  description = "Cluster name."
  type        = string
}

variable "network" {
  description = "VPC network ID."
  type        = string
}

variable "subnetwork" {
  description = "Subnet ID."
  type        = string
}

variable "pods_range_name" {
  description = "Name of the subnet's secondary range for pods."
  type        = string
}

variable "services_range_name" {
  description = "Name of the subnet's secondary range for services."
  type        = string
}

variable "authorized_networks" {
  description = "CIDR blocks allowed to reach the Kubernetes API endpoint."
  type = list(object({
    cidr = string
    name = string
  }))
}

variable "release_channel" {
  description = "GKE release channel."
  type        = string
  default     = "REGULAR"
}

variable "labels" {
  description = "Labels applied to the cluster (they also flow into billing reports)."
  type        = map(string)
  default     = {}
}
