#!/usr/bin/env bash
# Apply the platform to the local k3d cluster (platform/k8s/overlays/local):
# CloudNativePG operator, secrets, namespace and policies, Postgres, Temporal, LiteLLM,
# the agent worker (built from this checkout), and the placeholder API behind Traefik.
#
# Usage: scripts/local/apply-k8s.sh [diff]
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/k8s.sh"

refuse_root
require_cmd kubectl jq docker
load_env

CLUSTER="${K3D_CLUSTER_NAME:-agents-local}"
OVERLAY="${REPO_ROOT}/platform/k8s/overlays/local"
ADC_FILE="${HOME}/.config/gcloud/application_default_credentials.json"

ctx="$(kubectl config current-context 2>/dev/null || true)"
[[ "$ctx" == "k3d-${CLUSTER}" ]] || die "kubectl context is '${ctx}', expected 'k3d-${CLUSTER}'. Run scripts/local/k3d-up.sh"

# Values for the overlay (gitignored).
[[ -n "${PROJECT_ID:-}" && "$PROJECT_ID" != "your-project-id" ]] \
  || warn "PROJECT_ID not set in .env: LiteLLM won't be able to call Vertex AI"
case "${LOCAL_MODELS:=flash-lite}" in
  flash-lite) fast=vertex_ai/gemini-3.5-flash-lite; smart=vertex_ai/gemini-3.5-flash-lite ;;
  full)       fast=vertex_ai/gemini-3.5-flash-lite; smart=vertex_ai/gemini-3.5-flash ;;
  mock)       fast=mock/fast;                       smart=mock/smart ;;
  *) die "LOCAL_MODELS must be flash-lite, full or mock (got '${LOCAL_MODELS}')" ;;
esac
{
  printf 'VERTEX_PROJECT=%s\n' "${PROJECT_ID:-unset}"
  printf 'LITELLM_FAST_MODEL=%s\nLITELLM_SMART_MODEL=%s\n' "$fast" "$smart"
  printf 'MOCK_LATENCY_SECONDS=%s\nMOCK_FAILURE_RATE=%s\n' "${MOCK_LATENCY_SECONDS:-2}" "${MOCK_FAILURE_RATE:-0}"
} > "${OVERLAY}/local.env"
log "models (LOCAL_MODELS=${LOCAL_MODELS}): fast=${fast}, smart=${smart}"

# Build the worker image from this checkout and push it to the k3d registry (writes images.env).
"${REPO_ROOT}/scripts/local/build-push.sh" worker

if [[ "${1:-}" == "diff" ]]; then
  kubectl diff -k "$OVERLAY" || true
  exit 0
fi

install_cnpg_operator
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
ensure_platform_secrets local

if [[ -f "$ADC_FILE" ]]; then
  kubectl -n "$NS" create secret generic gcp-adc --from-file=adc.json="$ADC_FILE" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
else
  warn "no Application Default Credentials at $ADC_FILE: run 'gcloud auth application-default login' for LiteLLM to reach Vertex AI"
fi

kubectl apply -k "$OVERLAY"
kubectl -n "$NS" rollout status deployment/api --timeout=2m
wait_for_services
ensure_litellm_ui_admin
ensure_litellm_agent_keys
wait_for_worker

log "ready:"
log "  app:          curl http://localhost/"
log "  Temporal UI:  kubectl -n $NS port-forward svc/temporal 8233:8233  ->  http://localhost:8233"
log "  LiteLLM:      kubectl -n $NS port-forward svc/litellm 4000:4000  (key: kubectl -n $NS get secret litellm -o jsonpath='{.data.master-key}' | base64 -d)"
log "  Run an agent: agents/general/research-summarize/README.md"
