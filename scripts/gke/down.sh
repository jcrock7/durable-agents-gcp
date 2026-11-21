#!/usr/bin/env bash
# Destroy the per-session cluster layer, then check for anything still billing.
# The foundation layer (registry, secrets, backups) is kept.
# With APP_HOSTNAME set, its Cloudflare DNS record is deleted first, so the name never points at
# an IP this project no longer holds (scripts/lib/dns.sh).
#
# Usage: scripts/gke/down.sh [--yes] [--no-backup]
#   --yes        skip Terraform's confirmation prompt
#   --no-backup  skip the Postgres backup to GCS before teardown
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/terraform.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/dns.sh"

refuse_root
require_cmd gcloud terraform jq curl
load_env
tf_require_settings

TF_DIR="${REPO_ROOT}/platform/cluster/terraform"

export TF_VAR_project_id="$PROJECT_ID"
export TF_VAR_region="$REGION"
export TF_VAR_state_bucket="$TF_STATE_BUCKET"
export TF_VAR_cluster_name="${CLUSTER_NAME:-agents-demo}"
export TF_VAR_app_hostname="${APP_HOSTNAME:-}"
# Terraform wants every variable even to destroy. This one has no default (the Kubernetes API is
# never open to the internet by default), so pass the same value up.sh used; a placeholder from the
# documentation range stands in when it is unset, since a destroy never applies it.
TF_VAR_authorized_networks="$(csv_to_json_list "${CLUSTER_AUTHORIZED_NETWORKS:-192.0.2.1/32}" | jq -c 'map({cidr: ., name: ("net-" + (. | gsub("[./]"; "-")))})')"
export TF_VAR_authorized_networks

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
  # A backup can only finish while WAL archiving works; if it doesn't, say so and move on rather
  # than wait 10 minutes for a backup that will never complete.
  archiving="$(kubectl -n agents get cluster.postgresql.cnpg.io/agents-pg \
    -o jsonpath='{.status.conditions[?(@.type=="ContinuousArchiving")].status}' 2>/dev/null || true)"
  if $backup && [[ "$archiving" == "False" ]]; then
    warn "Postgres WAL archiving is failing, so no backup can be taken. Continuing without one."
    warn "Cause: kubectl -n agents get cluster agents-pg -o jsonpath='{.status.conditions}'"
    backup=false
  fi
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

# Remove the DNS record before the IP it points at is released.
if dns_managed; then
  dns_delete "$APP_HOSTNAME" \
    || die "could not delete the DNS record for ${APP_HOSTNAME}. The gateway IP is still reserved, so nothing is exposed; fix the Cloudflare settings and run this again."
elif [[ -n "${APP_HOSTNAME:-}" ]]; then
  warn "APP_HOSTNAME=${APP_HOSTNAME} but CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID are not set."
  warn "Delete its DNS record by hand now: after this teardown the IP can be given to someone else."
fi

tf_init "$TF_DIR"
terraform -chdir="$TF_DIR" destroy -input=false "${approve[@]}"

"$(dirname "${BASH_SOURCE[0]}")/check-orphans.sh"
