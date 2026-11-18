#!/usr/bin/env bash
# Deploy and operate the GCP cost guardrails (budget alerts + enforcer).
#
# Usage: scripts/gcp/cost-guardrails.sh <command>
#   plan      Show what Terraform would change
#   apply     Create/update the budget, alerts, enforcer function and TTL scheduler
#   test      Publish a fake "130% of budget" notification and show the enforcer's decision (dry_run only)
#   status    Show billing state, budgets, clusters and recent enforcer logs
#   destroy   Remove the guardrails (the budget alerts stop too)
#
# Reads PROJECT_ID, REGION, TF_STATE_BUCKET, BILLING_ACCOUNT_ID, MONTHLY_BUDGET_USD,
# BUDGET_ALERT_EMAILS and the optional BUDGET_* / CLUSTER_MAX_HOURS settings from .env.
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

refuse_root
require_cmd gcloud terraform jq
load_env

CMD="${1:-}"
[[ -n "$CMD" ]] || die "usage: $0 plan|apply|test|status|destroy"

: "${PROJECT_ID:?set PROJECT_ID in .env}"
: "${REGION:=us-central1}"
: "${TF_STATE_BUCKET:?set TF_STATE_BUCKET in .env}"

TF_DIR="${REPO_ROOT}/platform/cost-guardrails/terraform"
FN_NAME="budget-enforcer"
TOPIC="budget-alerts"

export_tf_vars() {
  : "${BILLING_ACCOUNT_ID:?set BILLING_ACCOUNT_ID in .env (gcloud billing accounts list)}"
  : "${MONTHLY_BUDGET_USD:?set MONTHLY_BUDGET_USD in .env}"
  export TF_VAR_project_id="$PROJECT_ID"
  export TF_VAR_region="$REGION"
  export TF_VAR_billing_account_id="$BILLING_ACCOUNT_ID"
  export TF_VAR_monthly_budget_usd="$MONTHLY_BUDGET_USD"
  TF_VAR_alert_emails="$(jq -cn --arg s "${BUDGET_ALERT_EMAILS:-}" \
    '$s | split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0))')"
  export TF_VAR_alert_emails
  export TF_VAR_enforcement_mode="${BUDGET_ENFORCEMENT_MODE:-dry_run}"
  [[ -n "${BUDGET_STOP_CLUSTERS_AT:-}" ]] && export TF_VAR_stop_clusters_at="$BUDGET_STOP_CLUSTERS_AT"
  [[ -n "${BUDGET_DISABLE_BILLING_AT:-}" ]] && export TF_VAR_disable_billing_at="$BUDGET_DISABLE_BILLING_AT"
  [[ -n "${CLUSTER_MAX_HOURS:-}" ]] && export TF_VAR_cluster_max_hours="$CLUSTER_MAX_HOURS"
  return 0
}

ensure_state_bucket() {
  if ! gcloud storage buckets describe "gs://${TF_STATE_BUCKET}" --project "$PROJECT_ID" >/dev/null 2>&1; then
    log "creating Terraform state bucket gs://${TF_STATE_BUCKET}"
    gcloud storage buckets create "gs://${TF_STATE_BUCKET}" --project "$PROJECT_ID" --location "$REGION" \
      --uniform-bucket-level-access --public-access-prevention
    gcloud storage buckets update "gs://${TF_STATE_BUCKET}" --versioning
  fi
}

tf_init() {
  terraform -chdir="$TF_DIR" init -input=false -reconfigure -backend-config="bucket=${TF_STATE_BUCKET}" >/dev/null
}

case "$CMD" in
  plan)
    export_tf_vars; ensure_state_bucket; tf_init
    terraform -chdir="$TF_DIR" plan -input=false
    ;;

  apply)
    export_tf_vars; ensure_state_bucket; tf_init
    terraform -chdir="$TF_DIR" apply -input=false
    log "mode: $(terraform -chdir="$TF_DIR" output -raw enforcement_mode). Next: $0 test"
    ;;

  test)
    export_tf_vars; tf_init
    mode="$(terraform -chdir="$TF_DIR" output -raw enforcement_mode)"
    [[ "$mode" == "dry_run" ]] || die "refusing to test in '$mode' mode: it would really delete clusters and disable billing. Set BUDGET_ENFORCEMENT_MODE=dry_run and apply first."
    amount="$MONTHLY_BUDGET_USD"
    cost="$(jq -n --argjson b "$amount" '$b * 1.3')"
    payload="$(jq -cn --argjson cost "$cost" --argjson budget "$amount" \
      '{budgetDisplayName:"guardrail test", costAmount:$cost, budgetAmount:$budget, currencyCode:"USD", alertThresholdExceeded:1.0, costIntervalStart:"test"}')"
    since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    log "publishing a fake notification: spend ${cost} of ${amount} (130%)"
    gcloud pubsub topics publish "$TOPIC" --project "$PROJECT_ID" --message "$payload" >/dev/null

    base_filter="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${FN_NAME}\" AND timestamp>=\"${since}\""
    decision=""
    for attempt in 1 2 3 4 5 6 7 8 9; do
      log "waiting for the enforcer's decision (${attempt}/9)"
      sleep 10
      decision="$(gcloud logging read "${base_filter} AND jsonPayload.message=\"Budget guardrail triggered\"" \
        --project "$PROJECT_ID" --limit 5 --format=json 2>/dev/null \
        | jq -c --argjson cost "$cost" '[.[] | select(.jsonPayload.costAmount == $cost)][0].jsonPayload // empty')"
      [[ -n "$decision" ]] && break
    done

    if [[ -z "$decision" ]]; then
      warn "no decision logged within 90s. Recent warnings and errors from the enforcer:"
      gcloud logging read "${base_filter} AND severity>=WARNING" --project "$PROJECT_ID" --limit 5 \
        --format="value(timestamp, severity, jsonPayload.message, textPayload)" || true
      die "test inconclusive. A 'run.routes.invoke' warning right after apply usually means IAM is still propagating: wait 5 minutes and rerun."
    fi

    echo "$decision" | jq '{mode, spendRatio, costAmount, budgetAmount, deleteClusters, disableBilling, reasons}'
    if echo "$decision" | jq -e '.mode == "dry_run" and .disableBilling == true and .spendRatio >= 1.2' >/dev/null; then
      log "PASS: the enforcer would disable billing at 130% of budget and made no changes (dry run)."
      log "to turn on enforcement, set BUDGET_ENFORCEMENT_MODE=enforce in .env and run: $0 apply"
    else
      die "FAIL: the decision above is not what a 130% notification should produce. Check BUDGET_* thresholds in .env."
    fi
    ;;

  status)
    log "billing on project:"
    gcloud billing projects describe "$PROJECT_ID" --format="value(billingEnabled,billingAccountName)"
    if [[ -n "${BILLING_ACCOUNT_ID:-}" ]]; then
      log "budgets:"
      gcloud billing budgets list --billing-account "$BILLING_ACCOUNT_ID" \
        --format="table(displayName,amount.specifiedAmount.units,thresholdRules)" || true
    fi
    log "GKE clusters:"
    gcloud container clusters list --project "$PROJECT_ID" --format="table(name,location,status,createTime)" || true
    log "recent enforcer decisions:"
    gcloud functions logs read "$FN_NAME" --project "$PROJECT_ID" --region "$REGION" --gen2 --limit 10 || true
    ;;

  destroy)
    export_tf_vars; tf_init
    warn "this removes the budget, alerts and enforcer. Spend will no longer be capped."
    terraform -chdir="$TF_DIR" destroy -input=false
    ;;

  *)
    die "unknown command '$CMD' — use plan|apply|test|status|destroy"
    ;;
esac
