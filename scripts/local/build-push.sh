#!/usr/bin/env bash
# Build an app image (apps/<app>/Dockerfile) and push it to the local k3d registry, then record
# the image in platform/k8s/overlays/local/images.env (gitignored) for apply-k8s.sh.
#
# Usage: scripts/local/build-push.sh [app]     (default: worker)
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/images.sh"

refuse_root
require_cmd docker git k3d jq
load_env

APP="${1:-worker}"
REG_PORT="${K3D_REGISTRY_PORT:-5000}"
TAG="$(image_tag)"

# Pushed through the host port; pulled by the cluster through the registry's in-cluster name.
build_image "$APP" "localhost:${REG_PORT}/${APP}:${TAG}"
log "pushing localhost:${REG_PORT}/${APP}:${TAG}"
docker push -q "localhost:${REG_PORT}/${APP}:${TAG}" >/dev/null
record_image local "$APP" "$(k3d_registry_name):${REG_PORT}/${APP}:${TAG}"
