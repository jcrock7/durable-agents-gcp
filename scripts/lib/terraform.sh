#!/usr/bin/env bash
# Terraform helpers shared by the layer scripts. Source after common.sh:
#   source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
#   source "$(dirname "${BASH_SOURCE[0]}")/../lib/terraform.sh"

# Fail early on missing or placeholder settings.
tf_require_settings() {
  : "${PROJECT_ID:?set PROJECT_ID in .env}"
  : "${REGION:=us-central1}"
  : "${TF_STATE_BUCKET:=${PROJECT_ID}-tfstate}"
  export REGION TF_STATE_BUCKET
  [[ "$PROJECT_ID" != "your-project-id" ]] || die "PROJECT_ID in .env is still the placeholder"
  [[ "$TF_STATE_BUCKET" != your-project-id* ]] || die "TF_STATE_BUCKET in .env is still the placeholder"
}

# Create the shared state bucket once (private, versioned).
tf_ensure_state_bucket() {
  if ! gcloud storage buckets describe "gs://${TF_STATE_BUCKET}" --project "$PROJECT_ID" >/dev/null 2>&1; then
    log "creating Terraform state bucket gs://${TF_STATE_BUCKET}"
    gcloud storage buckets create "gs://${TF_STATE_BUCKET}" --project "$PROJECT_ID" --location "$REGION" \
      --uniform-bucket-level-access --public-access-prevention
    gcloud storage buckets update "gs://${TF_STATE_BUCKET}" --versioning
  fi
}

# tf_init <dir>: connect a layer to its state (the prefix is set in the layer's versions.tf).
tf_init() {
  terraform -chdir="$1" init -input=false -reconfigure -backend-config="bucket=${TF_STATE_BUCKET}" >/dev/null
}

# csv_to_json_list "a, b,c" -> ["a","b","c"]
csv_to_json_list() {
  jq -cn --arg s "${1:-}" '$s | split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0))'
}
