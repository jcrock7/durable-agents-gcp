#!/usr/bin/env bash
# Destroy the per-session cluster layer, then check for anything still billing.
# The foundation layer (registry, secrets, backups) is kept.
#
# Usage: scripts/gke/down.sh [--yes] [--no-backup]
#   --yes        skip Terraform's confirmation prompt
#   --no-backup  skip the Postgres backup to GCS before teardown
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/terraform.sh"

refuse_root
require_cmd gcloud terraform
load_env
tf_require_settings

TF_DIR="${REPO_ROOT}/platform/cluster/terraform"

export TF_VAR_project_id="$PROJECT_ID"
export TF_VAR_region="$REGION"
export TF_VAR_state_bucket="$TF_STATE_BUCKET"
export TF_VAR_cluster_name="${CLUSTER_NAME:-agents-demo}"
export TF_VAR_app_hostname="${APP_HOSTNAME:-}"

approve=()
backup=true
for arg in "$@"; do
  case "$arg" in
    --yes) approve=(-auto-approve) ;;
    --no-backup) backup=false ;;
    *) die "unknown option '$arg' (use --yes, --no-backup)" ;;
  esac
done

if kubectl config current-context 2>/dev/null | grep -q "${TF_VAR_cluster_name}"; then
  # Base backup of Postgres to the foundation's GCS bucket (WAL is archived continuously).
  if $backup && kubectl -n agents get cluster.postgresql.cnpg.io/agents-pg >/dev/null 2>&1; then
    name="before-down-$(date -u +%Y%m%d%H%M%S)"
    log "backing up Postgres to GCS (${name}); skip with --no-backup"
    kubectl -n agents apply -f - >/dev/null <<EOF
apiVersion: postgresql.cnpg.io/v1
kind: Backup
metadata:
  name: ${name}
spec:
  cluster:
    name: agents-pg
EOF
    kubectl -n agents wait "backup.postgresql.cnpg.io/${name}" --for=jsonpath='{.status.phase}'=completed --timeout=10m \
      || warn "backup did not complete; check: kubectl -n agents describe backup ${name}"
  fi

  # Remove Gateway-created load balancers: Terraform didn't create them, so it can't delete them,
  # and they would block deleting the network.
  log "deleting Kubernetes Gateways so GKE removes their load balancers"
  kubectl delete gateway --all --all-namespaces --ignore-not-found --wait=true --timeout=5m || true
fi

tf_init "$TF_DIR"
terraform -chdir="$TF_DIR" destroy -input=false "${approve[@]}"

"$(dirname "${BASH_SOURCE[0]}")/check-orphans.sh"
