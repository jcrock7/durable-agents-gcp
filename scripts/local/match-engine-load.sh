#!/usr/bin/env bash
# HPA demo: run a 3-minute load test against match-engine inside the cluster and watch the
# HorizontalPodAutoscaler add replicas (1 → up to 10), then scale back down after the load stops.
# The load test is a Job using the match-engine image (node dist/load-test.js), so it needs the
# image that apply-k8s.sh deployed.
#
# Usage: scripts/local/match-engine-load.sh [duration-seconds] [concurrency]   (default 180, 24)
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/k8s.sh"

refuse_root
require_cmd kubectl

DURATION="${1:-180}"
CONCURRENCY="${2:-24}"
JOB="${REPO_ROOT}/platform/mcp/match-engine/load-test-job.yaml"
image="$(kubectl -n "$NS" get deployment mcp-match-engine -o jsonpath='{.spec.template.spec.containers[0].image}')"
[[ -n "$image" ]] || die "mcp-match-engine is not deployed: run scripts/local/apply-k8s.sh"

kubectl -n "$NS" delete job match-engine-load-test --ignore-not-found >/dev/null
sed -e "s|image: MCP_MATCH_ENGINE_IMAGE|image: ${image}|" \
    -e "s|value: \"24\"|value: \"${CONCURRENCY}\"|" \
    -e "s|value: \"180\"|value: \"${DURATION}\"|" "$JOB" | kubectl -n "$NS" apply -f - >/dev/null
log "load test started: ${CONCURRENCY} concurrent sessions for ${DURATION}s. HPA every 15s:"

end=$(( $(date +%s) + DURATION + 150 ))
while (( $(date +%s) < end )); do
  printf '%s  ' "$(date +%H:%M:%S)"
  kubectl -n "$NS" get hpa mcp-match-engine --no-headers \
    -o custom-columns='CPU:.status.currentMetrics[0].resource.current.averageUtilization,TARGET:.spec.metrics[0].resource.target.averageUtilization,REPLICAS:.status.currentReplicas,DESIRED:.status.desiredReplicas' \
    | awk '{printf "cpu %s%% (target %s%%)  replicas %s → %s\n", $1, $2, $3, $4}'
  sleep 15
done
log "load test output:"
kubectl -n "$NS" logs job/match-engine-load-test --tail=30
