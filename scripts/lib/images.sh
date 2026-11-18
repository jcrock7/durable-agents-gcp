#!/usr/bin/env bash
# Image helpers shared by scripts/local/build-push.sh and scripts/gke/build-push.sh.
# Source after common.sh.

# Tag: the commit, plus a timestamp when there are uncommitted changes, so every build that
# differs from a commit gets its own tag (Kubernetes only pulls when the tag changes).
image_tag() {
  local tag
  tag="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain -- apps agents packages pnpm-lock.yaml)" ]]; then
    tag="${tag}-dirty-$(date -u +%Y%m%d%H%M%S)"
  fi
  echo "$tag"
}

# The local registry's actual name, which is also its in-cluster host name. Some k3d versions
# prefix it with "k3d-" and some don't, so ask k3d rather than guessing.
k3d_registry_name() {
  local wanted="${K3D_REGISTRY_NAME:-gke-registry.localhost}" name
  name="$(k3d registry list -o json 2>/dev/null \
    | jq -r --arg w "$wanted" '[.[].name | select(. == $w or . == "k3d-" + $w)][0] // empty')"
  echo "${name:-$wanted}"
}

# build_image <app> <image-ref>   (build context is the repo root; see .dockerignore)
build_image() {
  local app="$1" ref="$2"
  [[ -f "${REPO_ROOT}/apps/${app}/Dockerfile" ]] || die "no Dockerfile at apps/${app}/"
  docker info >/dev/null 2>&1 || die "Docker is not reachable: start Docker Desktop"
  log "building ${ref}"
  DOCKER_BUILDKIT=1 docker build -q -f "${REPO_ROOT}/apps/${app}/Dockerfile" -t "$ref" "$REPO_ROOT" >/dev/null
}

# record_image <local|gke> <app> <image-ref>: write <APP>_IMAGE into the overlay's images.env.
record_image() {
  local overlay="${REPO_ROOT}/platform/k8s/overlays/$1" key ref="$3"
  key="$(tr '[:lower:]-' '[:upper:]_' <<<"$2")_IMAGE"
  touch "${overlay}/images.env"
  grep -v "^${key}=" "${overlay}/images.env" > "${overlay}/images.env.tmp" || true
  echo "${key}=${ref}" >> "${overlay}/images.env.tmp"
  mv "${overlay}/images.env.tmp" "${overlay}/images.env"
  log "recorded ${key}=${ref} in ${overlay#"$REPO_ROOT"/}/images.env"
}
