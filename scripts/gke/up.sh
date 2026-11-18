#!/usr/bin/env bash
# Create the per-session cluster layer: VPC + NAT, GKE Autopilot, Workload Identity bindings,
# gateway IP and certificate. Then point kubectl at the cluster.
#
# Usage: scripts/gke/up.sh [plan]
#
# Reads PROJECT_ID, REGION, TF_STATE_BUCKET, CLUSTER_NAME, CLUSTER_AUTHORIZED_NETWORKS and
# APP_HOSTNAME from .env. Takes about 10 minutes. The cost guardrails delete clusters older
# than CLUSTER_MAX_HOURS, so run scripts/gke/down.sh when you're done anyway.
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/terraform.sh"

refuse_root
require_cmd gcloud terraform jq kubectl
load_env
tf_require_settings

TF_DIR="${REPO_ROOT}/platform/cluster/terraform"
FOUNDATION_DIR="${REPO_ROOT}/platform/foundation/terraform"

export TF_VAR_project_id="$PROJECT_ID"
export TF_VAR_region="$REGION"
export TF_VAR_state_bucket="$TF_STATE_BUCKET"
export TF_VAR_cluster_name="${CLUSTER_NAME:-agents-demo}"
export TF_VAR_app_hostname="${APP_HOSTNAME:-}"
if [[ -n "${CLUSTER_AUTHORIZED_NETWORKS:-}" ]]; then
  TF_VAR_authorized_networks="$(csv_to_json_list "$CLUSTER_AUTHORIZED_NETWORKS" | jq -c 'map({cidr: ., name: ("net-" + (. | gsub("[./]"; "-")))})')"
  export TF_VAR_authorized_networks
fi

# The cluster layer reads the foundation layer's outputs, so foundation must exist first.
tf_init "$FOUNDATION_DIR"
terraform -chdir="$FOUNDATION_DIR" output -raw namespace >/dev/null 2>&1 \
  || die "foundation layer not found. Run scripts/gcp/foundation.sh apply first."

tf_init "$TF_DIR"

if [[ "${1:-}" == "plan" ]]; then
  terraform -chdir="$TF_DIR" plan -input=false
  exit 0
fi

terraform -chdir="$TF_DIR" apply -input=false

log "pointing kubectl at the cluster"
eval "$(terraform -chdir="$TF_DIR" output -raw get_credentials_command)"
ns="$(terraform -chdir="$TF_DIR" output -raw namespace)"
kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

log "cluster ready:"
log "  context:   $(kubectl config current-context)"
log "  namespace: $ns"
log "  app URL:   https://$(terraform -chdir="$TF_DIR" output -raw app_hostname) (certificate goes ACTIVE 15-60 min after the Gateway is deployed)"
warn "clusters older than ${CLUSTER_MAX_HOURS:-8}h are deleted automatically. Run scripts/gke/down.sh when you're done."
