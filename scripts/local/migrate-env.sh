#!/usr/bin/env bash
# Rebuild .env on the current .env.example layout, keeping every value you already set.
#
# Usage: scripts/local/migrate-env.sh [old-env]      (default: .env in the repo root)
#
# - Each KEY in .env.example takes its value from the old file when the old file has it
#   (the last one wins if a key appears twice, as when the shell sources it); otherwise the
#   example's default is kept.
# - GITHUB_REPOSITORY and IAP_MEMBERS, when missing, are filled from the git remote and the
#   active gcloud account.
# - Keys in the old file that .env.example doesn't have are kept at the end.
# - The old file is saved as .env.bak-<timestamp> (gitignored). Values are never printed.
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

refuse_root
EXAMPLE="${REPO_ROOT}/.env.example"
OLD="${1:-${REPO_ROOT}/.env}"
TARGET="${REPO_ROOT}/.env"
[[ -f "$EXAMPLE" ]] || die "missing ${EXAMPLE}"
[[ -f "$OLD" ]] || die "no old env file at ${OLD} (to start fresh: cp .env.example .env)"

# Values worked out from this machine, used only when the old file lacks the key.
derived=""
remote="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"
if [[ "$remote" =~ github\.com[:/]([^/]+/[^/.]+)(\.git)?$ ]]; then
  derived+="GITHUB_REPOSITORY=${BASH_REMATCH[1]}"$'\n'
fi
account="$(gcloud config get-value account 2>/dev/null || true)"
if [[ -n "$account" && "$account" != *gserviceaccount.com ]]; then
  derived+="IAP_MEMBERS=user:${account}"$'\n'
fi

tmp="$(mktemp "${TARGET}.new.XXXXXX")"
chmod 600 "$tmp"
trap 'rm -f "$tmp"' EXIT

# awk reads the old file first (FNR == NR), then the example; derived values come in as a variable.
# Report lines go to stderr as "STATUS KEY" with no values.
tr -d '\r' <"$OLD" | awk -v derived="$derived" '
  function key_of(line) { sub(/^[ \t]*export[ \t]+/, "", line); return substr(line, 1, index(line, "=") - 1) }
  FNR == NR {
    if ($0 ~ /^[ \t]*(export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*=/) {
      line = $0; sub(/^[ \t]*export[ \t]+/, "", line)
      k = key_of(line); old[k] = substr(line, length(k) + 2)
      if (!(k in seen)) { order[++n] = k; seen[k] = 1 }
    }
    next
  }
  BEGIN {
    split(derived, d, "\n")
    for (i in d) if (d[i] != "") { k = substr(d[i], 1, index(d[i], "=") - 1); auto[k] = substr(d[i], length(k) + 2) }
  }
  {
    if ($0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/) {
      k = key_of($0)
      inexample[k] = 1
      if (k in old)       { print k "=" old[k];  print "kept " k > "/dev/stderr" }
      else if (k in auto) { print k "=" auto[k]; print "filled " k > "/dev/stderr" }
      else                { print;               print "default " k > "/dev/stderr" }
    } else print
  }
  END {
    extra = 0
    for (i = 1; i <= n; i++) if (!(order[i] in inexample)) {
      if (!extra++) { print ""; print "# ---------- Kept from the previous .env (not in .env.example) ----------" }
      print order[i] "=" old[order[i]]; print "extra " order[i] > "/dev/stderr"
    }
  }
' /dev/stdin "$EXAMPLE" >"$tmp" 2>"${tmp}.report"

report="$(cat "${tmp}.report")"; rm -f "${tmp}.report"
list() { grep "^$1 " <<<"$report" | cut -d' ' -f2 | tr '\n' ' '; }

if [[ -f "$TARGET" ]]; then
  backup="${TARGET}.bak-$(date +%Y%m%d-%H%M%S)"
  cp -p "$TARGET" "$backup"
  chmod 600 "$backup"
  log "saved the old .env as ${backup#"$REPO_ROOT"/}"
fi
mv "$tmp" "$TARGET"
trap - EXIT
chmod 600 "$TARGET"

log "wrote .env on the current .env.example layout"
log "kept your values:  $(list kept)"
[[ -n "$(list filled)" ]] && log "filled from git/gcloud (check them):  $(list filled)"
[[ -n "$(list default)" ]] && warn "new keys at the example default (fill in as needed):  $(list default)"
[[ -n "$(list extra)" ]] && log "kept, not in .env.example:  $(list extra)"
# Placeholders that the scripts would reject or misuse.
placeholders="$(grep -nE '=(your-|you@example\.com|000000-000000-000000)' "$TARGET" | cut -d= -f1 | cut -d: -f2 | tr '\n' ' ' || true)"
[[ -z "$placeholders" ]] || warn "still placeholders:  ${placeholders}"
