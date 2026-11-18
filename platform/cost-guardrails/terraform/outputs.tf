output "budget_name" {
  description = "Resource name of the monthly budget."
  value       = google_billing_budget.monthly.name
}

output "budget_topic" {
  description = "Pub/Sub topic that receives budget notifications and cluster-TTL ticks."
  value       = google_pubsub_topic.budget.name
}

output "enforcer_function" {
  description = "Name of the budget enforcer function."
  value       = google_cloudfunctions2_function.enforcer.name
}

output "enforcement_mode" {
  description = "dry_run or enforce."
  value       = var.enforcement_mode
}

output "thresholds" {
  description = "Effective guardrail thresholds."
  value = {
    monthly_budget     = var.monthly_budget_usd
    forecast_alerts    = var.forecast_alert_thresholds
    actual_alerts      = var.actual_alert_thresholds
    stop_clusters_at   = var.stop_clusters_at
    disable_billing_at = var.disable_billing_at
    cluster_max_hours  = var.cluster_max_hours
  }
}
