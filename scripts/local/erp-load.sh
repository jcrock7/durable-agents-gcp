#!/usr/bin/env bash
# Reload the synthetic ERP behind the Invoice Exception Resolver's MCP servers: drop schema erp
# and load it again from the seed in the deployed docs MCP server image. Every resolution and
# outbox message the agent wrote is lost, so demos start from the same state each time.
# apply-k8s.sh loads it once on its own; run this to reset.
#
# Usage: scripts/local/erp-load.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/k8s.sh"

refuse_root
require_cmd kubectl

load_erp force
