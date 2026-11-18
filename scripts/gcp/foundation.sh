#!/usr/bin/env bash
# Deploy the persistent foundation layer: Artifact Registry, Postgres backup bucket,
# workload service accounts, generated secrets, IAP access and GitHub Actions federation.
#
# Usage: scripts/gcp/foundation.sh plan|apply|output|destroy
#
# Reads PROJECT_ID, REGION, TF_STATE_BUCKET, IAP_MEMBERS and GITHUB_REPOSITORY from .env.
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/terraform.sh"

refuse_root
require_cmd gcloud terraform jq
load_env
tf_require_settings

CMD="${1:-}"
TF_DIR="${REPO_ROOT}/platform/foundation/terraform"

export TF_VAR_project_id="$PROJECT_ID"
export TF_VAR_region="$REGION"
TF_VAR_iap_members="$(csv_to_json_list "${IAP_MEMBERS:-}")"
export TF_VAR_iap_members
export TF_VAR_github_repository="${GITHUB_REPOSITORY:-}"

case "$CMD" in
  plan)
    tf_ensure_state_bucket; tf_init "$TF_DIR"
    terraform -chdir="$TF_DIR" plan -input=false
    ;;
  apply)
    tf_ensure_state_bucket; tf_init "$TF_DIR"
    terraform -chdir="$TF_DIR" apply -input=false
    log "foundation ready. Next: scripts/gke/up.sh"
    ;;
  output)
    tf_init "$TF_DIR"
    terraform -chdir="$TF_DIR" output
    ;;
  destroy)
    tf_init "$TF_DIR"
    warn "this deletes the image registry, Postgres backups, secrets and service accounts."
    warn "run scripts/gke/down.sh first; the cluster layer depends on these."
    terraform -chdir="$TF_DIR" destroy -input=false
    ;;
  *)
    die "usage: $0 plan|apply|output|destroy"
    ;;
esac
