#!/usr/bin/env bash
# Shared helpers. Source from other scripts:
#   source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export REPO_ROOT

log()  { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

# Load .env (if present) without echoing values.
load_env() {
  local env_file="${REPO_ROOT}/.env"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  else
    warn ".env not found — using defaults. Create one with: cp .env.example .env"
  fi
}

require_cmd() {
  local missing=0
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || { warn "missing command: $cmd"; missing=1; }
  done
  [[ $missing -eq 0 ]] || die "install missing tools (scripts/local/bootstrap-wsl.sh)"
}

refuse_root() {
  [[ $EUID -ne 0 ]] || die "do not run this with sudo — kubeconfig would be written to /root"
}
