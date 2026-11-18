#!/usr/bin/env bash
# Create the local k3d cluster that mimics a small GKE cluster.
# Usage: scripts/local/k3d-up.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/images.sh"

refuse_root
require_cmd docker k3d kubectl jq
load_env

CLUSTER="${K3D_CLUSTER_NAME:-agents-local}"
REGISTRY="${K3D_REGISTRY_NAME:-gke-registry.localhost}"
REG_PORT="${K3D_REGISTRY_PORT:-5000}"
NAMESPACE="${K8S_NAMESPACE:-agents}"

docker info >/dev/null 2>&1 || die "Docker is not reachable — start Docker Desktop and enable WSL integration"

if k3d cluster get "$CLUSTER" >/dev/null 2>&1; then
  log "cluster '${CLUSTER}' already exists — starting it"
  k3d cluster start "$CLUSTER"
else
  log "creating cluster '${CLUSTER}'"
  k3d cluster create "$CLUSTER" \
    --servers 1 \
    --agents 2 \
    --api-port 6550 \
    -p "80:80@loadbalancer" \
    -p "443:443@loadbalancer" \
    --registry-create "${REGISTRY}:${REG_PORT}" \
    --wait
fi

kubectl config use-context "k3d-${CLUSTER}" >/dev/null
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

log "nodes:"
kubectl get nodes -o wide
log "registry:"
k3d registry list
log "push images to: localhost:${REG_PORT}  (in-cluster name: $(k3d_registry_name):${REG_PORT})"
