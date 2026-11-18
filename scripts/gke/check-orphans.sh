#!/usr/bin/env bash
# List resources that keep billing after a teardown: clusters, load balancer forwarding rules,
# reserved IPs, unattached disks and Cloud NAT gateways.
#
# Usage: scripts/gke/check-orphans.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

require_cmd gcloud
load_env
: "${PROJECT_ID:?set PROJECT_ID in .env}"

found=0
check() { # check <label> <gcloud args...>
  local label="$1"; shift
  local out
  out="$(gcloud "$@" --project "$PROJECT_ID" 2>/dev/null || true)"
  if [[ -n "$out" ]]; then
    warn "$label:"
    echo "$out" | sed 's/^/    /'
    found=1
  fi
}

check "GKE clusters"            container clusters list --format="value(name,location,status)"
check "Forwarding rules (LBs)"  compute forwarding-rules list --format="value(name,region,IPAddress)"
check "Reserved IP addresses"   compute addresses list --format="value(name,region,address,status)"
check "Unattached disks"        compute disks list --filter="-users:*" --format="value(name,zone,sizeGb)"
check "Cloud Routers (NAT)"     compute routers list --format="value(name,region)"

if [[ $found -eq 0 ]]; then
  log "no billable leftovers found"
else
  warn "the resources above are still billing. Delete them, or run scripts/gke/down.sh again."
fi
