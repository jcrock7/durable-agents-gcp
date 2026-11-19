#!/usr/bin/env bash
# Apply the platform to the GKE cluster (platform/k8s/overlays/gke): CloudNativePG operator,
# secrets from Secret Manager, namespace and policies, Postgres (with GCS backups), Temporal,
# LiteLLM and the agent worker (on Spot), Gateway + HTTPS + IAP, and (until the real API exists)
# a placeholder API.
#
# Usage: scripts/gke/apply-k8s.sh [diff]
#
# Needs: scripts/gke/up.sh done, and IAP_OAUTH_CLIENT_ID / IAP_OAUTH_CLIENT_SECRET in .env
# (see platform/k8s/README.md for creating the OAuth client).
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/terraform.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/k8s.sh"

refuse_root
require_cmd gcloud terraform jq kubectl docker
load_env
tf_require_settings

: "${IAP_OAUTH_CLIENT_ID:?set IAP_OAUTH_CLIENT_ID in .env (platform/k8s/README.md explains how to create it)}"
: "${IAP_OAUTH_CLIENT_SECRET:?set IAP_OAUTH_CLIENT_SECRET in .env}"

CLUSTER_DIR="${REPO_ROOT}/platform/cluster/terraform"
FOUNDATION_DIR="${REPO_ROOT}/platform/foundation/terraform"
OVERLAY="${REPO_ROOT}/platform/k8s/overlays/gke"

# 1. Read Terraform outputs.
tf_init "$CLUSTER_DIR"
cluster="$(terraform -chdir="$CLUSTER_DIR" output -raw cluster_name 2>/dev/null)" \
  || die "cluster layer not found. Run scripts/gke/up.sh first."
ns="$(terraform -chdir="$CLUSTER_DIR" output -raw namespace)"
tf_init "$FOUNDATION_DIR"
gsas="$(terraform -chdir="$FOUNDATION_DIR" output -json workload_service_accounts)"

# 2. Make sure kubectl points at this cluster, not k3d or another project.
ctx="$(kubectl config current-context 2>/dev/null || true)"
[[ "$ctx" == *"_${PROJECT_ID}_"*"_${cluster}" ]] \
  || die "kubectl context is '${ctx}', expected the GKE cluster '${cluster}'. Run: $(terraform -chdir="$CLUSTER_DIR" output -raw get_credentials_command)"

# 3. Write the overlay's environment values (gitignored).
# Postgres backups go to a per-cluster folder named after the cluster's creation time, so a new
# session never collides with an earlier session's WAL archive.
created="$(gcloud container clusters describe "$cluster" --region "$REGION" --project "$PROJECT_ID" --format='value(createTime)')"
server_name="agents-pg-$(tr -dc '0-9' <<<"$created" | head -c 12)"
backup_bucket="$(terraform -chdir="$FOUNDATION_DIR" output -raw pg_backup_bucket)"

cat > "${OVERLAY}/cluster.env" <<EOF
PROJECT_ID=${PROJECT_ID}
POSTGRES_GSA=$(jq -r '.postgres.email' <<<"$gsas")
PG_BACKUP_DESTINATION=gs://${backup_bucket}/agents-pg
PG_BACKUP_SERVER_NAME=${server_name}
GATEWAY_IP_NAME=$(terraform -chdir="$CLUSTER_DIR" output -raw gateway_ip_name)
SSL_CERT_NAME=$(terraform -chdir="$CLUSTER_DIR" output -raw ssl_certificate_name)
APP_HOSTNAME=$(terraform -chdir="$CLUSTER_DIR" output -raw app_hostname)
IAP_OAUTH_CLIENT_ID=${IAP_OAUTH_CLIENT_ID}
API_GSA=$(jq -r '.api.email' <<<"$gsas")
WORKER_GSA=$(jq -r '.worker.email' <<<"$gsas")
LITELLM_GSA=$(jq -r '.litellm.email' <<<"$gsas")
EOF
log "wrote ${OVERLAY#"$REPO_ROOT"/}/cluster.env"

# Build the worker image from this checkout and push it to Artifact Registry (writes images.env).
"${REPO_ROOT}/scripts/gke/build-push.sh" worker
"${REPO_ROOT}/scripts/gke/build-push.sh" mcp-docs
"${REPO_ROOT}/scripts/gke/build-push.sh" mcp-match-engine

if [[ "${1:-}" == "diff" ]]; then
  kubectl diff -k "$OVERLAY" || true
  exit 0
fi

# 4. Operator, namespace and secrets first, then everything else.
NS="$ns"
install_cnpg_operator
kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
apply_secret iap-oauth-client Opaque "key=${IAP_OAUTH_CLIENT_SECRET}"
ensure_platform_secrets gsm
ensure_erp_secrets
kubectl apply -k "$OVERLAY"
wait_for_services
wait_for_mcp
load_erp
ensure_litellm_ui_admin
ensure_litellm_agent_keys
wait_for_worker

# 5. Report.
host="$(terraform -chdir="$CLUSTER_DIR" output -raw app_hostname)"
log "waiting for the Gateway to be programmed (the load balancer takes a few minutes)"
kubectl -n "$ns" wait gateway/external --for=condition=Programmed --timeout=10m \
  || warn "Gateway not programmed yet; check: kubectl -n $ns describe gateway external"
log "certificate status (PROVISIONING -> ACTIVE takes 15-60 min after the load balancer exists):"
gcloud compute ssl-certificates describe "$(terraform -chdir="$CLUSTER_DIR" output -raw ssl_certificate_name)" \
  --project "$PROJECT_ID" --format="value(managed.status,managed.domainStatus)" || true
log "app URL: https://${host}  (Google sign-in required; allowed users come from IAP_MEMBERS)"
