terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 8.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.4, < 3.0"
    }
    time = {
      source  = "hashicorp/time"
      version = ">= 0.11, < 1.0"
    }
  }

  # Bucket is passed at init time: terraform init -backend-config=bucket=<state bucket>
  # (scripts/gcp/cost-guardrails.sh does this from .env).
  backend "gcs" {
    prefix = "cost-guardrails"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region

  # The Budget API is called with your user credentials (ADC); bill API quota to this project.
  user_project_override = true
  billing_project       = var.project_id
}
