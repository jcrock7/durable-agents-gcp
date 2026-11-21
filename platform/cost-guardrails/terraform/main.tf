# Cost guardrails, part 1: the budget and its alerts.
# See docs/adr/0015-cost-guardrails.md for the design.

data "google_project" "this" {
  project_id = var.project_id
}

locals {
  apis = [
    "billingbudgets.googleapis.com",
    "cloudbilling.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudfunctions.googleapis.com",
    "cloudscheduler.googleapis.com",
    "compute.googleapis.com", # orphaned load balancer sweep
    "container.googleapis.com",
    "eventarc.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudresourcemanager.googleapis.com", # project IAM bindings
    "iam.googleapis.com",                  # service accounts
    "monitoring.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "storage.googleapis.com", # function source bucket
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_monitoring_notification_channel" "email" {
  for_each     = toset(var.alert_emails)
  project      = var.project_id
  display_name = "Budget alerts (${each.value})"
  type         = "email"
  labels = {
    email_address = each.value
  }

  depends_on = [google_project_service.apis]
}

# Every budget evaluation (several times a day) is published here; the enforcer subscribes.
resource "google_pubsub_topic" "budget" {
  project = var.project_id
  name    = "budget-alerts"

  depends_on = [google_project_service.apis]
}

resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account_id
  display_name    = "${var.project_id} monthly budget"

  budget_filter {
    projects        = ["projects/${data.google_project.this.number}"]
    calendar_period = "MONTH"
    # Subtract Free Tier usage and usage discounts (they never become a bill), but NOT
    # promotional credits such as the $300 trial: those would hide real spend and the
    # guardrails would never fire while the trial lasts.
    credit_types_treatment = "INCLUDE_SPECIFIED_CREDITS"
    credit_types           = var.counted_credit_types
  }

  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(var.monthly_budget_usd)
    }
  }

  # Rule order matters: the Budgets API returns actual-spend rules first, then forecast ones, each
  # ascending. Declaring them in that order (and keeping the threshold lists ascending) keeps
  # `plan` from showing the same rules reordered on every run.

  # "We have spent X% already": alerts on actual month-to-date spend.
  dynamic "threshold_rules" {
    for_each = var.actual_alert_thresholds
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }

  # "We expect to exceed the budget": alerts on forecasted month-end spend.
  dynamic "threshold_rules" {
    for_each = var.forecast_alert_thresholds
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "FORECASTED_SPEND"
    }
  }

  all_updates_rule {
    pubsub_topic                     = google_pubsub_topic.budget.id
    schema_version                   = "1.0"
    monitoring_notification_channels = [for c in google_monitoring_notification_channel.email : c.id]
    disable_default_iam_recipients   = false
  }

  depends_on = [google_project_service.apis]
}
