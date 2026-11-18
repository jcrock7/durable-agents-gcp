variable "project_id" {
  description = "GCP project the guardrails protect."
  type        = string
}

variable "region" {
  description = "Region for the enforcer function, Pub/Sub trigger and scheduler."
  type        = string
  default     = "us-central1"
}

variable "billing_account_id" {
  description = "Billing account ID (XXXXXX-XXXXXX-XXXXXX). Keep it out of git: set it in .env."
  type        = string
  sensitive   = true
}

variable "monthly_budget_usd" {
  description = "Monthly budget, in whole units of the billing account's currency."
  type        = number

  validation {
    condition     = var.monthly_budget_usd >= 1 && floor(var.monthly_budget_usd) == var.monthly_budget_usd
    error_message = "monthly_budget_usd must be a whole number of at least 1."
  }
}

variable "budget_currency" {
  description = "Must match the billing account's currency."
  type        = string
  default     = "USD"
}

variable "counted_credit_types" {
  description = "Credit types subtracted from cost before comparing with the budget. PROMOTION (trial and promo credits) is deliberately left out."
  type        = list(string)
  default = [
    "FREE_TIER",
    "SUSTAINED_USAGE_DISCOUNT",
    "COMMITTED_USAGE_DISCOUNT",
    "COMMITTED_USAGE_DISCOUNT_DOLLAR_BASE",
    "DISCOUNT",
  ]

  validation {
    condition     = !contains(var.counted_credit_types, "PROMOTION")
    error_message = "Don't subtract PROMOTION credits: trial credit would hide real spend from the guardrails."
  }
}

variable "alert_emails" {
  description = "Email addresses for budget alerts (max 5). Billing account admins are emailed as well."
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.alert_emails) <= 5
    error_message = "A budget supports at most 5 notification channels."
  }
}

variable "forecast_alert_thresholds" {
  description = "Alert when FORECASTED month-end spend reaches these fractions of the budget."
  type        = list(number)
  default     = [0.8, 1.0]
}

variable "actual_alert_thresholds" {
  description = "Alert when ACTUAL month-to-date spend reaches these fractions of the budget."
  type        = list(number)
  default     = [0.5, 0.9, 1.0]
}

variable "enforcement_mode" {
  description = "dry_run logs what the enforcer would do; enforce deletes clusters and can disable billing."
  type        = string
  default     = "dry_run"

  validation {
    condition     = contains(["dry_run", "enforce"], var.enforcement_mode)
    error_message = "enforcement_mode must be dry_run or enforce."
  }
}

variable "stop_clusters_at" {
  description = "Delete all GKE clusters when actual spend reaches this fraction of the budget. 0 turns it off."
  type        = number
  default     = 1.0
}

variable "disable_billing_at" {
  description = "Hard cap: disable billing on the project when actual spend reaches this fraction of the budget. 0 turns it off."
  type        = number
  default     = 1.2
}

variable "cluster_max_hours" {
  description = "Delete any GKE cluster older than this many hours (catches a forgotten teardown). 0 turns it off."
  type        = number
  default     = 8
}
