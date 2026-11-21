#!/usr/bin/env bash
# Build an app image (apps/<app>/Dockerfile) and push it to Artifact Registry, then record the
# image in platform/k8s/overlays/gke/images.env (gitignored) for apply-k8s.sh.
#
# Usage: scripts/gke/build-push.sh [app]     (default: worker)
# The registry keeps the 2 newest versions of each image (foundation cleanup policy).
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/images.sh"

refuse_root
require_cmd docker git gcloud
load_env
: "${PROJECT_ID:?set PROJECT_ID in .env}"
: "${REGION:?set REGION in .env}"

APP="${1:-worker}"
HOST="${REGION}-docker.pkg.dev"
REF="${HOST}/${PROJECT_ID}/${AR_REPO:-agents}/${APP}:$(image_tag)"

# Lets docker push with your gcloud sign-in (adds a credential helper for this host only).
gcloud auth configure-docker "$HOST" --quiet >/dev/null 2>&1

build_image "$APP" "$REF"
log "pushing ${REF}"
docker push -q "$REF" >/dev/null

# Deploy by digest, not by tag: a tag can be pointed at different content later, a digest cannot.
# The tag stays in the reference for readability; Kubernetes pulls by the digest.
digest="$(gcloud artifacts docker images describe "$REF" --project "$PROJECT_ID" --format='value(image_summary.digest)')"
[[ "$digest" == sha256:* ]] || die "could not read the digest of ${REF}"
record_image gke "$APP" "${REF}@${digest}"
