variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Region for the registry, buckets and secrets."
  type        = string
  default     = "us-central1"
}

variable "artifact_repo_id" {
  description = "Artifact Registry repository for container images."
  type        = string
  default     = "agents"
}

variable "keep_image_versions" {
  description = "Most recent versions of each image to keep; older ones are deleted after 7 days (Free Tier covers 0.5 GB)."
  type        = number
  default     = 2
}

variable "backup_retention_days" {
  description = "Delete Postgres backup objects older than this many days."
  type        = number
  default     = 30
}

variable "namespace" {
  description = "Kubernetes namespace the workloads run in (used to name Workload Identity bindings)."
  type        = string
  default     = "agents"
}

variable "iap_members" {
  description = "Who may open the app through Identity-Aware Proxy, e.g. [\"user:you@example.com\", \"group:team@example.com\"]."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for m in var.iap_members : can(regex("^(user|group|serviceAccount|domain):", m))])
    error_message = "Each IAP member must start with user:, group:, serviceAccount: or domain:."
  }
}

variable "github_repository" {
  description = "GitHub repository (owner/name) allowed to authenticate from GitHub Actions. Empty skips CI federation."
  type        = string
  default     = ""
}
