#!/usr/bin/env bash
# Create/refresh the K8s Secret "agent-secrets" in k3d from SECRET_* vars in .env.
# Values never touch disk or stdout. Local-only: GKE uses Secret Manager.
# Usage: scripts/local/load-secrets.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

refuse_root
require_cmd kubectl
load_env

NAMESPACE="${K8S_NAMESPACE:-agents}"
CLUSTER="${K3D_CLUSTER_NAME:-agents-local}"
SECRET_NAME="agent-secrets"

ctx="$(kubectl config current-context)"
[[ "$ctx" == "k3d-${CLUSTER}" ]] || die "current context is '$ctx', expected 'k3d-${CLUSTER}' — refusing to load local secrets elsewhere"

args=()
while IFS='=' read -r name _; do
  key="${name#SECRET_}"
  args+=("--from-literal=${key}=${!name}")
done < <(env | grep -E '^SECRET_[A-Za-z0-9_]+=' || true)

[[ ${#args[@]} -gt 0 ]] || die "no SECRET_* variables found in .env"

kubectl create secret generic "$SECRET_NAME" -n "$NAMESPACE" "${args[@]}" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

log "loaded ${#args[@]} key(s) into secret/${SECRET_NAME} in namespace ${NAMESPACE}"
