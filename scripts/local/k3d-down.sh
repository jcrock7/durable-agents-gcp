#!/usr/bin/env bash
# Delete the local k3d cluster (and its registry).
# Usage: scripts/local/k3d-down.sh [--stop]   (--stop pauses instead of deleting)
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/images.sh"

refuse_root
require_cmd k3d jq
load_env

CLUSTER="${K3D_CLUSTER_NAME:-agents-local}"

if [[ "${1:-}" == "--stop" ]]; then
  log "stopping cluster '${CLUSTER}' (state preserved)"
  k3d cluster stop "$CLUSTER"
  exit 0
fi

log "deleting cluster '${CLUSTER}'"
k3d cluster delete "$CLUSTER"

registry="$(k3d_registry_name)"
if k3d registry get "$registry" >/dev/null 2>&1; then
  log "deleting registry '${registry}'"
  k3d registry delete "$registry"
fi
