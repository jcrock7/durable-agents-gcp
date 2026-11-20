#!/usr/bin/env bash
# Run the Invoice Exception Resolver evals (promptfoo, ADR-0009) against the agent deployed on k3d:
# port-forward Temporal, run every labelled exception end to end, write
# agents/general/invoice-exception-resolver/evals/RESULTS.md, then reset the synthetic ERP
# (cases the rules let through post resolutions to it).
#
# Costs money with real models (about $0.005 per case on Flash-Lite), billed to the agent's own
# LiteLLM key and budget. With LOCAL_MODELS=mock it is free and measures only the plumbing.
#
# Usage: scripts/local/invoice-evals.sh [models label]
#   EVAL_SCENARIOS=price_overcharge,wrong_po  only these scenarios
#   EVAL_LIMIT=10                              only the first 10 cases
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/k8s.sh"

refuse_root
require_cmd kubectl node pnpm

PROMPTFOO_VERSION=0.125.1
AGENT="${REPO_ROOT}/agents/general/invoice-exception-resolver"
models="${1:-$(kubectl -n "$NS" get deploy litellm -o jsonpath='{.spec.template.spec.containers[0].envFrom[*].configMapRef.name}' | tr ' ' '\n' | grep litellm-env | xargs -I{} kubectl -n "$NS" get configmap {} -o jsonpath='{.data.LITELLM_FAST_MODEL} / {.data.LITELLM_SMART_MODEL}')}"

(cd "$REPO_ROOT" && pnpm install --frozen-lockfile >/dev/null && pnpm exec tsc -b "$AGENT")

kubectl -n "$NS" port-forward svc/temporal 7233:7233 >/dev/null 2>&1 &
pf=$!
trap 'kill $pf 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do (exec 3<>/dev/tcp/127.0.0.1/7233) 2>/dev/null && break; sleep 0.5; done

log "running the evals (models: ${models})"
out="$(mktemp -d)/results.json"
(cd "${AGENT}/evals" && \
  PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1 PROMPTFOO_DISABLE_SHARING=1 \
  EVAL_RUN="$(date -u +%m%d%H%M)" TEMPORAL_ADDRESS=localhost:7233 \
  npx -y "promptfoo@${PROMPTFOO_VERSION}" eval -c promptfooconfig.yaml -o "$out" --no-progress-bar) || true

node "${AGENT}/evals/report.mjs" "$out" "${AGENT}/evals/RESULTS.md" "$models"
load_erp force
