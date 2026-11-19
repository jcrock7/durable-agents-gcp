#!/usr/bin/env bash
# Check the MCP servers in the cluster end to end through the agent's own allow-listed client:
# port-forward erp-read, erp-write and docs, then run the agent's verify script (lists each
# server's tools, makes one read call per server, and checks that write tools stay hidden from
# the model). Changes no data.
#
# Usage: scripts/local/mcp-verify.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/k8s.sh"

refuse_root
require_cmd kubectl node pnpm

AGENT="${REPO_ROOT}/agents/general/invoice-exception-resolver"
log "building the agent package"
(cd "$REPO_ROOT" && pnpm install --frozen-lockfile >/dev/null && pnpm exec tsc -b "$AGENT")

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

forward() { # forward <service> <local-port>
  kubectl -n "$NS" port-forward "svc/$1" "$2:8080" >/dev/null 2>&1 &
  pids+=("$!")
}
forward mcp-erp-read 18081
forward mcp-erp-write 18082
forward mcp-docs 18083

for port in 18081 18082 18083; do
  for _ in $(seq 1 30); do
    (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null && break
    sleep 0.5
  done
done

MCP_ERP_READ_URL=http://localhost:18081/mcp \
MCP_ERP_WRITE_URL=http://localhost:18082/mcp \
MCP_DOCS_URL=http://localhost:18083/mcp \
  node "${AGENT}/dist/verify-mcp.js"
