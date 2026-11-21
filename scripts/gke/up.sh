#!/usr/bin/env bash
# Create the per-session cluster layer: VPC + NAT, GKE Autopilot, Workload Identity bindings,
# gateway IP and certificate. Then point kubectl at the cluster.
#
# Usage: scripts/gke/up.sh [plan]
#
# Reads PROJECT_ID, REGION, TF_STATE_BUCKET, CLUSTER_NAME, CLUSTER_AUTHORIZED_NETWORKS and
# APP_HOSTNAME from .env. With APP_HOSTNAME set it also points that name at the gateway IP in
# Cloudflare (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID; see scripts/lib/dns.sh). Takes about 10 minutes. The cost guardrails delete clusters older
# than CLUSTER_MAX_HOURS, so run scripts/gke/down.sh when you're done anyway.
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/terraform.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/dns.sh"

refuse_root
require_cmd gcloud terraform jq kubectl curl
load_env
tf_require_settings
dns_require_settings

TF_DIR="${REPO_ROOT}/platform/cluster/terraform"
FOUNDATION_DIR="${REPO_ROOT}/platform/foundation/terraform"

export TF_VAR_project_id="$PROJECT_ID"
export TF_VAR_region="$REGION"
export TF_VAR_state_bucket="$TF_STATE_BUCKET"
export TF_VAR_cluster_name="${CLUSTER_NAME:-agents-demo}"
export TF_VAR_app_hostname="${APP_HOSTNAME:-}"
# The Kubernetes API is never opened to the whole internet by default: name the networks.
[[ -n "${CLUSTER_AUTHORIZED_NETWORKS:-}" ]] \
  || die "set CLUSTER_AUTHORIZED_NETWORKS in .env to the CIDRs allowed to reach the Kubernetes API (your IP: curl -s ifconfig.me, then append /32)"
TF_VAR_authorized_networks="$(csv_to_json_list "$CLUSTER_AUTHORIZED_NETWORKS" | jq -c 'map({cidr: ., name: ("net-" + (. | gsub("[./]"; "-")))})')"
export TF_VAR_authorized_networks

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

# Point the app hostname at this session's gateway IP (down.sh removes the record again).
if dns_managed; then
  dns_upsert "$APP_HOSTNAME" "$(terraform -chdir="$TF_DIR" output -raw gateway_ip)"
fi

log "pointing kubectl at the cluster"
eval "$(terraform -chdir="$TF_DIR" output -raw get_credentials_command)"
ns="$(terraform -chdir="$TF_DIR" output -raw namespace)"
kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

log "cluster ready:"
log "  context:   $(kubectl config current-context)"
log "  namespace: $ns"
log "  app URL:   https://$(terraform -chdir="$TF_DIR" output -raw app_hostname) (certificate goes ACTIVE 15-60 min after the Gateway is deployed)"
warn "clusters older than ${CLUSTER_MAX_HOURS:-8}h are deleted automatically. Run scripts/gke/down.sh when you're done."
