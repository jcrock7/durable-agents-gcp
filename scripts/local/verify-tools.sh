#!/usr/bin/env bash
# Check that every tool the project needs is installed and reachable.
# Exits non-zero if anything required is missing.
# Usage: scripts/local/verify-tools.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
set +e   # keep going after failures so we report everything

fails=0
pass() { printf '  \033[1;32m✓\033[0m %-24s %s\n' "$1" "$2"; }
fail() { printf '  \033[1;31m✗\033[0m %-24s %s\n' "$1" "$2"; fails=$((fails + 1)); }
note() { printf '  \033[1;33m!\033[0m %-24s %s\n' "$1" "$2"; }

check() {  # check <name> <version command...>
  local name="$1"; shift
  if command -v "$1" >/dev/null 2>&1; then
    pass "$name" "$("$@" 2>&1 | head -n1)"
  else
    fail "$name" "not found"
  fi
}

echo "Environment"
if [[ $EUID -eq 0 ]]; then fail "user" "running as root — re-run without sudo"; else pass "user" "$(whoami)"; fi
if grep -qi microsoft /proc/version 2>/dev/null; then pass "WSL" "$(uname -r)"; else note "WSL" "not detected (fine on native Linux)"; fi
case "$(pwd)" in
  /mnt/*) note "repo location" "on Windows drive ($(pwd)) — clone under ~ for much faster Docker/git I/O" ;;
  *)      pass "repo location" "$REPO_ROOT" ;;
esac

echo
echo "Core CLIs"
check git            git --version
check gh             gh --version
check curl           curl --version
check jq             jq --version
check python3        python3 --version
check pipx           pipx --version
check uv             uv --version
check pre-commit     pre-commit --version
check gitleaks       gitleaks version

echo
echo "Node.js (agents, worker)"
check node           node --version
check pnpm           pnpm --version

echo
echo "Containers & Kubernetes"
check docker         docker --version
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then pass "docker daemon" "reachable"; else fail "docker daemon" "not reachable — start Docker Desktop / enable WSL integration"; fi
fi
check kubectl        kubectl version --client
check k3d            k3d version
check helm           helm version --short

echo
echo "Google Cloud & IaC"
check gcloud         gcloud --version
check gke-gcloud-auth-plugin gke-gcloud-auth-plugin --version
check terraform      terraform version

echo
echo "Auth (informational)"
if command -v gcloud >/dev/null 2>&1; then
  acct="$(gcloud config get-value account 2>/dev/null)"
  if [[ -n "$acct" ]]; then pass "gcloud login" "signed in"; else note "gcloud login" "run: gcloud auth login"; fi
  if gcloud auth application-default print-access-token >/dev/null 2>&1; then pass "gcloud ADC" "configured"; else note "gcloud ADC" "run: gcloud auth application-default login"; fi
fi
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then pass "gh login" "signed in"; else note "gh login" "run: gh auth login"; fi
fi
if [[ -f "${REPO_ROOT}/.git/hooks/pre-commit" ]]; then pass "git hooks" "installed"; else note "git hooks" "run: scripts/local/install-git-hooks.sh"; fi
if [[ -f "${REPO_ROOT}/.env" ]]; then pass ".env" "present"; else note ".env" "run: cp .env.example .env"; fi

echo
if [[ $fails -eq 0 ]]; then
  log "all required tools present"
else
  die "${fails} check(s) failed — run scripts/local/bootstrap-wsl.sh"
fi
