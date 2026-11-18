#!/usr/bin/env bash
# Install pre-commit + gitleaks hooks and run them once over the repo.
# Usage: scripts/local/install-git-hooks.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

cd "$REPO_ROOT"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git repo — run 'git init' first"

if ! command -v pre-commit >/dev/null 2>&1; then
  if command -v pipx >/dev/null 2>&1; then
    log "installing pre-commit via pipx"
    pipx install pre-commit
  else
    die "install pre-commit first: sudo apt install -y pipx && pipx ensurepath && pipx install pre-commit"
  fi
fi

pre-commit install
log "running all hooks once (first run downloads hook environments)"
pre-commit run --all-files || warn "hooks reported issues — review, fix, re-run 'pre-commit run --all-files'"
