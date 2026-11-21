#!/usr/bin/env bash
# Destroy the per-session cluster layer, then check for anything still billing.
# The foundation layer (registry, secrets, backups) is kept.
# The workloads' namespace is deleted first, so the endpoint groups and disks GKE created for it
# go with it rather than outliving the cluster.
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

  # Delete the workloads while the cluster can still clean up after them. Deleting the cluster
  # alone leaves behind what GKE created outside it: the Services' network endpoint groups (which
  # then block deleting the network) and the volume claims' disks (which keep billing).
  log "deleting namespace agents so GKE removes its endpoint groups and disks"
  kubectl delete namespace agents --ignore-not-found --wait=true --timeout=10m \
    || warn "namespace agents not fully deleted; leftovers are listed at the end"
  kubectl wait --for=delete persistentvolume --all --timeout=5m >/dev/null 2>&1 \
    || warn "some disks are still being released; leftovers are listed at the end"
fi

# Network endpoint groups on the cluster's network: GKE removes them a minute or two after their
# Services go. Wait for that, then delete any that remain (also covers a cluster that was already
# deleted, for example by the cost guardrails), because one leftover blocks deleting the network.
vpc="${TF_VAR_cluster_name}-vpc"
list_negs() {
  gcloud compute network-endpoint-groups list --project "$PROJECT_ID" \
    --filter="network~/${vpc}\$" --format='value(name,zone.basename())' 2>/dev/null
}
for _ in $(seq 1 18); do
  [[ -z "$(list_negs)" ]] && break
  sleep 10
done
while read -r neg zone; do
  [[ -n "$neg" ]] || continue
  log "deleting leftover network endpoint group ${neg} (${zone})"
  gcloud compute network-endpoint-groups delete "$neg" --zone "$zone" --project "$PROJECT_ID" --quiet >/dev/null 2>&1 \
    || warn "could not delete ${neg} in ${zone}; the network delete below will fail until it is gone"
done < <(list_negs)

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
