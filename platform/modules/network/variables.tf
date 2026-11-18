variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Region for the subnet, router and NAT."
  type        = string
}

variable "name" {
  description = "Base name for the VPC and related resources."
  type        = string
}

variable "subnet_cidr" {
  description = "Primary range for nodes."
  type        = string
  default     = "10.10.0.0/20"
}

variable "pods_cidr" {
  description = "Secondary range for pods (Autopilot needs at least a /17 for room to scale)."
  type        = string
  default     = "10.20.0.0/16"
}

variable "services_cidr" {
  description = "Secondary range for Kubernetes services."
  type        = string
  default     = "10.30.0.0/20"
}
