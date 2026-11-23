#!/usr/bin/env bash
# Set up, check or update this WSL workstation: every tool and shell setting in
# docs/Windows Development Environment Setup.md. Safe to re-run: it only changes what is
# missing or not at the pinned version, and prints one status line per item.
#
# Usage: scripts/dev-env/setup-wsl.sh [options]
#   (no option)       install or fix anything missing or not at the pinned version
#   --check           change nothing; show installed, pinned and latest version of each tool
#   --bump [tool...]  write the latest versions into versions.env, then install them
#                     (all tools if none named; major-version jumps only when the tool is named)
#   --no-sudo         skip the apt packages instead of asking for sudo
#   --refresh         also re-run the installers of self-updating tools (Herdr, Claude Code)
#
# Pinned versions: scripts/dev-env/versions.env. User-level tools go in ~/.local/bin (no sudo).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSIONS="$HERE/versions.env"
BLOCK="$HERE/managed_block.py"
BIN="$HOME/.local/bin"
export FNM_DIR="$HOME/.local/share/fnm"
export PATH="$BIN:$FNM_DIR:$FNM_DIR/aliases/default/bin:$PATH"
HASHICORP_FPR=C874011F0AB405110D02105534365D9472D7468F

MODE=install; NO_SUDO=0; REFRESH=0; BUMP_TOOLS=()
while (($#)); do
  case "$1" in
    --check) MODE=check ;;
    --bump) MODE=bump; shift
            while (($#)) && [[ $1 != --* ]]; do BUMP_TOOLS+=("$1"); shift; done
            continue ;;
    --no-sudo) NO_SUDO=1 ;;
    --refresh) REFRESH=1 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

[[ $EUID -ne 0 ]] || { echo "Run as your normal user, not with sudo." >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo "Only x86_64 is supported." >&2; exit 1; }

# ---------- Status output ----------
N_OK=0; N_CHANGED=0; N_TODO=0; N_WARN=0; N_FAIL=0
_row()    { printf '  \033[%sm%-8s\033[0m %-28s %s\n' "$1" "$2" "$3" "${4:-}"; }
ok()      { _row '1;32' OK      "$@"; N_OK=$((N_OK + 1)); }
changed() { _row '1;36' CHANGED "$@"; N_CHANGED=$((N_CHANGED + 1)); }
todo()    { _row '1;33' TODO    "$@"; N_TODO=$((N_TODO + 1)); }
warn()    { _row '1;33' WARN    "$@"; N_WARN=$((N_WARN + 1)); }
fail()    { _row '1;31' FAIL    "$@"; N_FAIL=$((N_FAIL + 1)); }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }
have()    { command -v "$1" >/dev/null 2>&1; }
semver()  { grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1; }

# ---------- Versions ----------
declare -A PIN
while IFS='=' read -r k v; do
  [[ $k =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
  v=${v//$'\r'/}; PIN[$k]=${v//[[:space:]]/}
done < "$VERSIONS"

TOOLS=(omp fnm node pnpm kubectl k9s k3d helm terraform gitleaks uv pre-commit)
pin_key() { case $1 in omp) echo OMP_VERSION ;; pre-commit) echo PRE_COMMIT_VERSION ;; *) echo "${1^^}_VERSION" ;; esac; }

installed_version() {
  hash -r
  case $1 in
    omp)        have oh-my-posh && oh-my-posh version ;;
    fnm)        [[ -x $FNM_DIR/fnm ]] && "$FNM_DIR/fnm" --version ;;
    node)       [[ -x $FNM_DIR/aliases/default/bin/node ]] && "$FNM_DIR/aliases/default/bin/node" --version ;;
    pnpm)       [[ -x $FNM_DIR/aliases/default/bin/pnpm ]] && (cd "$HOME" && "$FNM_DIR/aliases/default/bin/pnpm" --version) ;;
    kubectl)    have kubectl && kubectl version --client ;;
    k9s)        have k9s && k9s version --short ;;
    k3d)        have k3d && k3d version ;;
    helm)       have helm && helm version --short ;;
    terraform)  have terraform && terraform version ;;
    gitleaks)   have gitleaks && gitleaks version ;;
    uv)         have uv && uv --version ;;
    pre-commit) have pre-commit && pre-commit --version ;;
  esac 2>/dev/null | semver
}

gh_latest() { curl -fsSI "https://github.com/$1/releases/latest" | tr -d '\r' | awk -F/ 'tolower($0) ~ /^location:/ {print $NF}' | semver; }
latest_version() {
  case $1 in
    omp)        gh_latest JanDeDobbeleer/oh-my-posh ;;
    fnm)        gh_latest Schniz/fnm ;;
    node)       curl -fsSL https://nodejs.org/dist/index.json | jq -r '[.[] | select(.lts != false)][0].version' | semver ;;
    pnpm)       curl -fsSL https://registry.npmjs.org/pnpm/latest | jq -r .version | semver ;;
    kubectl)    curl -fsSL https://dl.k8s.io/release/stable.txt | semver ;;
    k9s)        gh_latest derailed/k9s ;;
    k3d)        gh_latest k3d-io/k3d ;;
    helm)       gh_latest helm/helm ;;
    terraform)  curl -fsS https://checkpoint-api.hashicorp.com/v1/check/terraform | jq -r .current_version | semver ;;
    gitleaks)   gh_latest gitleaks/gitleaks ;;
    uv)         gh_latest astral-sh/uv ;;
    pre-commit) gh_latest pre-commit/pre-commit ;;
  esac 2>/dev/null
}

# ---------- Downloads, always checksum-verified ----------
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fetch()   { curl -fsSL --retry 3 -o "$2" "$1"; }
verify()  { [[ -n $2 && "$(sha256sum "$1" | awk '{print $1}')" == "$2" ]]; }
# Hash for <asset> from a checksums file, or the only hash in a single-hash file.
sum_from() { curl -fsSL --retry 3 "$1" | tr -d '\r' | awk -v n="$2" 'NF==1 {print $1; exit} {f=$2; sub(/^\*/,"",f); sub(/^.*\//,"",f); if (f==n) {print $1; exit}}'; }
# SHA-256 that GitHub records for a release asset (for projects without a checksums file).
gh_digest() { curl -fsSL "https://api.github.com/repos/$1/releases/tags/$2" | jq -r --arg n "$3" '.assets[] | select(.name==$n) | .digest // empty' | sed 's/^sha256://'; }

install_terraform() {
  local v=$1 d=$2 b="https://releases.hashicorp.com/terraform/$1" z="terraform_${1}_linux_amd64.zip" g="$2/gnupg" sig
  fetch "$b/$z" "$d/$z" && fetch "$b/terraform_${v}_SHA256SUMS" "$d/sums" &&
    fetch "$b/terraform_${v}_SHA256SUMS.sig" "$d/sums.sig" &&
    fetch https://www.hashicorp.com/.well-known/pgp-key.txt "$d/key.asc" || return 1
  mkdir -m 700 "$g"
  GNUPGHOME="$g" gpg -q --import "$d/key.asc" 2>/dev/null
  sig=$(GNUPGHOME="$g" gpg --status-fd 1 --verify "$d/sums.sig" "$d/sums" 2>/dev/null)
  GNUPGHOME="$g" gpgconf --kill gpg-agent 2>/dev/null
  grep -q "VALIDSIG .*$HASHICORP_FPR" <<<"$sig" || return 1
  verify "$d/$z" "$(sum_from "file://$d/sums" "$z")" &&
    python3 -I -m zipfile -e "$d/$z" "$d/x" && install -m 755 "$d/x/terraform" "$BIN/terraform"
}

install_tool() {
  local t=$1 v=$2 d="$TMP/$1" gh=https://github.com
  rm -rf "$d"; mkdir -p "$d" "$BIN"
  case $t in
    omp)
      local b="$gh/JanDeDobbeleer/oh-my-posh/releases/download/v$v"
      fetch "$b/posh-linux-amd64" "$d/omp" && verify "$d/omp" "$(sum_from "$b/checksums.txt" posh-linux-amd64)" &&
        install -m 755 "$d/omp" "$BIN/oh-my-posh" ;;
    fnm)
      fetch "$gh/Schniz/fnm/releases/download/v$v/fnm-linux.zip" "$d/fnm.zip" &&
        verify "$d/fnm.zip" "$(gh_digest Schniz/fnm "v$v" fnm-linux.zip)" &&
        python3 -I -m zipfile -e "$d/fnm.zip" "$d/x" && mkdir -p "$FNM_DIR" && install -m 755 "$d/x/fnm" "$FNM_DIR/fnm" ;;
    node)
      "$FNM_DIR/fnm" install "$v" >/dev/null 2>&1 && "$FNM_DIR/fnm" default "$v" >/dev/null ;;
    pnpm)
      (cd "$HOME" && "$FNM_DIR/aliases/default/bin/npm" install -g "pnpm@$v" --allow-scripts=pnpm >/dev/null 2>&1) ;;
    kubectl)
      local b="https://dl.k8s.io/release/v$v/bin/linux/amd64"
      fetch "$b/kubectl" "$d/kubectl" && verify "$d/kubectl" "$(sum_from "$b/kubectl.sha256" kubectl)" &&
        install -m 755 "$d/kubectl" "$BIN/kubectl" ;;
    k9s)
      local b="$gh/derailed/k9s/releases/download/v$v" f=k9s_Linux_amd64.tar.gz
      fetch "$b/$f" "$d/$f" && verify "$d/$f" "$(sum_from "$b/checksums.sha256" "$f")" &&
        tar -xzf "$d/$f" -C "$d" k9s && rm -f "$BIN/k9s" && install -m 755 "$d/k9s" "$BIN/k9s" ;;
    k3d)
      local b="$gh/k3d-io/k3d/releases/download/v$v"
      fetch "$b/k3d-linux-amd64" "$d/k3d" && verify "$d/k3d" "$(sum_from "$b/checksums.txt" k3d-linux-amd64)" &&
        install -m 755 "$d/k3d" "$BIN/k3d" ;;
    helm)
      local f="helm-v$v-linux-amd64.tar.gz"
      fetch "https://get.helm.sh/$f" "$d/$f" && verify "$d/$f" "$(sum_from "https://get.helm.sh/$f.sha256sum" "$f")" &&
        tar -xzf "$d/$f" -C "$d" linux-amd64/helm && install -m 755 "$d/linux-amd64/helm" "$BIN/helm" ;;
    terraform)
      install_terraform "$v" "$d" ;;
    gitleaks)
      local b="$gh/gitleaks/gitleaks/releases/download/v$v" f="gitleaks_${v}_linux_x64.tar.gz"
      fetch "$b/$f" "$d/$f" && verify "$d/$f" "$(sum_from "$b/gitleaks_${v}_checksums.txt" "$f")" &&
        tar -xzf "$d/$f" -C "$d" gitleaks && install -m 755 "$d/gitleaks" "$BIN/gitleaks" ;;
    uv)
      local b="$gh/astral-sh/uv/releases/download/$v" f=uv-x86_64-unknown-linux-gnu.tar.gz
      fetch "$b/$f" "$d/$f" && verify "$d/$f" "$(sum_from "$b/$f.sha256" "$f")" &&
        tar -xzf "$d/$f" -C "$d" && install -m 755 "$d/uv-x86_64-unknown-linux-gnu/uv" "$d/uv-x86_64-unknown-linux-gnu/uvx" "$BIN/" ;;
    pre-commit)
      uv tool install --force "pre-commit==$v" >/dev/null 2>&1 ;;
  esac
}

ensure_tool() {
  local t=$1 key want have latest note=""
  key=$(pin_key "$t"); want=${PIN[$key]:-}
  [[ -n $want ]] || { fail "$t" "no $key in versions.env"; return; }
  have=$(installed_version "$t")
  if [[ $MODE == check ]]; then
    latest=$(latest_version "$t")
    if [[ -z $latest ]]; then note="  (latest: lookup failed)"
    elif [[ $latest != "$want" ]]; then note="  (latest $latest: --bump $t)"
    else note="  (latest)"; fi
    if [[ $have == "$want" ]]; then ok "$t" "$have$note"
    elif [[ -z $have ]]; then todo "$t" "not installed, pinned $want$note"
    else todo "$t" "$have installed, pinned $want$note"; fi
    return
  fi
  if [[ $have == "$want" ]]; then ok "$t" "$have"; return; fi
  if install_tool "$t" "$want" && [[ $(installed_version "$t") == "$want" ]]; then
    changed "$t" "${have:-not installed} -> $want"
  else
    fail "$t" "could not install $want (download, checksum or install step failed)"
  fi
}

# ---------- Files and dotfile blocks ----------
# ensure_file <label> <path> <mode>  (content on stdin)
ensure_file() {
  local label=$1 path=$2 mode=$3 new="$TMP/file.$$"
  cat >"$new"
  if [[ -f $path ]] && cmp -s "$new" "$path"; then ok "$label" "$path"; return; fi
  if [[ $MODE == check ]]; then todo "$label" "$path $([[ -f $path ]] && echo differs || echo missing)"; return; fi
  [[ -f $path && ! -f $path.bak-devenv ]] && cp -p "$path" "$path.bak-devenv"
  mkdir -p "$(dirname "$path")" && install -m "$mode" "$new" "$path" && changed "$label" "$path" || fail "$label" "could not write $path"
}

# ensure_link <label> <link> <target>
ensure_link() {
  local label=$1 link=$2 target=$3
  if [[ -L $link && $(readlink "$link") == "$target" ]]; then ok "$label" "$link -> $target"; return; fi
  if [[ -e $link && ! -L $link ]]; then warn "$label" "$link exists and is not a link; left alone"; return; fi
  if [[ $MODE == check ]]; then todo "$label" "$link -> $target"; return; fi
  ln -sfn "$target" "$link" && changed "$label" "$link -> $target" || fail "$label" "could not link $link"
}

# ensure_block <file> <name>  (content on stdin)
ensure_block() {
  local file=$1 name=$2 content="$TMP/block.$$" r label
  label="$(basename "$file"): $name"
  cat >"$content"
  r=$(python3 -I "$BLOCK" "$file" "$name" "$content" $([[ $MODE == check ]] && echo --check)) || { fail "$label" "could not update $file"; return; }
  local what
  case ${r#would-} in
    adopted) what="existing lines marked as managed" ;;
    updated) what="block updated" ;;
    added)   what="block added" ;;
  esac
  case $r in
    ok) ok "$label" ;;
    would-*) todo "$label" "$what" ;;
    *) changed "$label" "$what" ;;
  esac
}

win_home() {
  [[ -n ${WIN_HOME:-} ]] && { echo "$WIN_HOME"; return; }
  local p; p=$(cd /mnt/c 2>/dev/null && /mnt/c/Windows/System32/cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')
  [[ -n $p ]] && wslpath -u "$p"
}

# =====================================================================
printf '\033[1mWSL workstation setup\033[0m  mode: %s  (versions: %s)\n' "$MODE" "$VERSIONS"

section "Prerequisites"
for c in curl jq python3 gpg git tar sha256sum; do
  if have "$c"; then ok "$c" "$(command -v "$c")"; else fail "$c" "missing: sudo apt-get install -y $c"; fi
done
if docker info >/dev/null 2>&1; then ok "docker" "Docker Desktop reachable"
else warn "docker" "not reachable: start Docker Desktop and enable Settings > Resources > WSL integration"; fi
WIN=$(win_home)
if [[ -n $WIN && -d $WIN ]]; then ok "Windows home" "$WIN"; else warn "Windows home" "not found (set WIN_HOME=/mnt/c/Users/<you>)"; WIN=""; fi
((N_FAIL)) && { echo; echo "Install the missing prerequisites first." >&2; exit 1; }

if [[ $MODE == bump ]]; then
  section "Bump versions.env to the latest releases"
  if ((${#BUMP_TOOLS[@]})); then SEL=("${BUMP_TOOLS[@]}"); else SEL=("${TOOLS[@]}"); fi
  for t in "${SEL[@]}"; do
    key=$(pin_key "$t")
    [[ -n ${PIN[$key]+x} ]] || { fail "$t" "unknown tool (one of: ${TOOLS[*]})"; continue; }
    latest=$(latest_version "$t"); cur=${PIN[$key]}
    if [[ -z $latest ]]; then warn "$t" "could not look up the latest version; kept $cur"
    elif [[ $latest == "$cur" ]]; then ok "$t" "$cur is the latest"
    elif [[ ${latest%%.*} != "${cur%%.*}" && ${#BUMP_TOOLS[@]} -eq 0 ]]; then
      warn "$t" "major update $cur -> $latest skipped; run --bump $t to take it"
    else
      sed -i "s/^$key=.*/$key=$latest/" "$VERSIONS"; PIN[$key]=$latest; changed "$t" "$cur -> $latest"
    fi
  done
  MODE=install
fi

section "Tools (pinned in scripts/dev-env/versions.env)"
for t in "${TOOLS[@]}"; do ensure_tool "$t"; done

section "apt packages (updated by apt, not pinned)"
APT_PKGS=(google-cloud-cli google-cloud-cli-gke-gcloud-auth-plugin gh)
MISSING=()
for p in "${APT_PKGS[@]}"; do
  st=$(dpkg-query -W -f='${Status} ${Version}' "$p" 2>/dev/null)
  if [[ $st == "install ok installed "* ]]; then
    inst=${st##* }; cand=$(apt-cache policy "$p" 2>/dev/null | awk '/Candidate:/ {print $2}')
    if [[ -n $cand && $cand != "(none)" && $cand != "$inst" ]]; then ok "$p" "$inst (apt has $cand: sudo apt-get upgrade)"
    else ok "$p" "$inst"; fi
  else
    MISSING+=("$p")
  fi
done
if ((${#MISSING[@]})); then
  if [[ $MODE == check ]]; then for p in "${MISSING[@]}"; do todo "$p" "not installed"; done
  elif ((NO_SUDO)); then for p in "${MISSING[@]}"; do todo "$p" "skipped (--no-sudo)"; done
  else
    echo "  sudo is needed to install: ${MISSING[*]}"
    if ! grep -rqs packages.cloud.google.com /etc/apt/sources.list /etc/apt/sources.list.d/; then
      curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo gpg --dearmor --yes -o /usr/share/keyrings/cloud.google.gpg &&
        echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" |
        sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list >/dev/null
    fi
    sudo apt-get update -qq && sudo apt-get install -y -qq "${MISSING[@]}" >/dev/null
    for p in "${MISSING[@]}"; do
      if dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed'; then changed "$p" "installed"
      else fail "$p" "apt install failed"; fi
    done
  fi
fi

section "Self-updating tools (not pinned)"
ensure_installer() {  # <cmd> <installer-url> <shell>
  local c=$1 url=$2 sh=$3
  if have "$c" && ! ((REFRESH)); then ok "$c" "$("$c" --version 2>/dev/null | head -n1)"; return; fi
  if [[ $MODE == check ]]; then todo "$c" "$(have "$c" && echo "would re-run installer" || echo "not installed")"; return; fi
  if curl -fsSL "$url" | "$sh" >/dev/null 2>&1 && hash -r && have "$c"; then changed "$c" "$("$c" --version 2>/dev/null | head -n1)"
  else fail "$c" "installer failed: curl -fsSL $url | $sh"; fi
}
ensure_installer herdr https://herdr.dev/install.sh sh
ensure_installer claude https://claude.ai/install.sh bash

section "Oh My Posh themes"
THEMES="$HOME/.oh-my-posh/themes"
if [[ -n $WIN && -d $WIN/.oh-my-posh/themes ]]; then
  if [[ $MODE == check ]]; then
    n=$(cd "$WIN/.oh-my-posh/themes" && for f in *.omp.*; do cmp -s "$f" "$THEMES/$f" || echo "$f"; done | wc -l)
    if ((n)); then todo "themes" "$n to copy from $WIN/.oh-my-posh/themes"; else ok "themes" "$THEMES matches Windows"; fi
  else
    mkdir -p "$THEMES"
    n=$(cp -uv "$WIN"/.oh-my-posh/themes/*.omp.* "$THEMES/" | wc -l)
    if ((n)); then changed "themes" "$n copied from Windows"; else ok "themes" "$THEMES matches Windows"; fi
  fi
elif [[ -f $THEMES/cobalt2.omp.json ]]; then ok "themes" "$THEMES (Windows copy not found)"
elif [[ $MODE == check ]]; then todo "themes" "cobalt2 missing"
else
  mkdir -p "$THEMES" && fetch "https://raw.githubusercontent.com/JanDeDobbeleer/oh-my-posh/v${PIN[OMP_VERSION]}/themes/cobalt2.omp.json" "$THEMES/cobalt2.omp.json" &&
    changed "themes" "cobalt2 downloaded" || fail "themes" "could not download cobalt2"
fi

section "Open links in Windows Chrome"
ensure_file "chrome-open" "$BIN/chrome-open" 755 <<'EOF'
#!/usr/bin/env bash
# Open URLs or files from WSL in Windows Chrome.
chrome="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
args=()
for a in "$@"; do
  if [[ "$a" =~ ^[a-zA-Z][a-zA-Z0-9+.-]*: ]]; then
    args+=("$a")                      # URL (http:, https:, file:, ...)
  elif [[ -e "$a" ]]; then
    args+=("$(wslpath -w "$a")")      # local path -> Windows path
  else
    args+=("$a")
  fi
done
"$chrome" "${args[@]}" >/dev/null 2>&1 &
disown
EOF
ensure_link "xdg-open" "$BIN/xdg-open" chrome-open
[[ -x "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" ]] || warn "Chrome" "not installed on Windows (setup-windows.ps1 installs it)"

section "Windows repos and line endings"
if [[ -n $WIN ]]; then ensure_link "winrepos" "$HOME/winrepos" "$WIN/repos"; fi
mkdir -p "$HOME/repos"
if [[ $(git config --global --get 'includeIf.gitdir:/mnt/c/.path') == "~/.gitconfig-windows" ]]; then ok "git includeIf /mnt/c/"
elif [[ $MODE == check ]]; then todo "git includeIf /mnt/c/"
else git config --global 'includeIf.gitdir:/mnt/c/.path' '~/.gitconfig-windows' && changed "git includeIf /mnt/c/"; fi
ensure_file "gitconfig-windows" "$HOME/.gitconfig-windows" 644 <<'EOF'
[core]
	autocrlf = true
EOF
if [[ -n $(git config --global --get core.autocrlf) ]]; then
  warn "git core.autocrlf" "set globally to $(git config --global --get core.autocrlf); it can override the /mnt/c rule: git config --global --unset core.autocrlf"
fi

section "Shell configuration"
ensure_block "$HOME/.bashrc" oh-my-posh <<'EOF'
# Oh My Posh prompt (cobalt2)
export PATH="$HOME/.local/bin:$PATH"
export POSH_THEMES_PATH="$HOME/.oh-my-posh/themes"
eval "$(oh-my-posh init bash --config "$POSH_THEMES_PATH/cobalt2.omp.json")"
EOF
ensure_block "$HOME/.bashrc" prompt-sp <<'EOF'
# Start the prompt on a fresh line when the last output had no trailing newline
# (like zsh PROMPT_SP). Runs after _omp_hook so the exit status is unaffected.
_prompt_sp() { local c=${COLUMNS:-$(tput cols 2>/dev/null || echo 80)}; printf "\e[2m%%\e[0m%*s\r" "$((c - 1))" ""; }
PROMPT_COMMAND+=(_prompt_sp)
EOF
ensure_block "$HOME/.bashrc" browser <<'EOF'
# Open links in Windows Chrome (used by gh, gcloud, python webbrowser, etc.)
export BROWSER="$HOME/.local/bin/chrome-open"
EOF
ensure_block "$HOME/.bashrc" fnm <<'EOF'
# Node.js via fnm: switch Node version on cd when a .nvmrc/.node-version exists
export FNM_DIR="$HOME/.local/share/fnm"
if [ -x "$FNM_DIR/fnm" ]; then
  export PATH="$FNM_DIR:$PATH"
  eval "$(fnm env --use-on-cd --version-file-strategy=recursive --shell bash)"
fi
EOF
ensure_block "$HOME/.profile" fnm <<'EOF'
# Node.js via fnm: put fnm and the default Node on PATH for all login shells
# (scripts, tools). Interactive shells get per-project switching from ~/.bashrc.
export FNM_DIR="$HOME/.local/share/fnm"
if [ -d "$FNM_DIR" ] && [ -z "$FNM_MULTISHELL_PATH" ]; then
  PATH="$FNM_DIR:$FNM_DIR/aliases/default/bin:$PATH"
fi
EOF
ensure_block "$HOME/.bash_aliases" kubernetes <<'EOF'
# Kubernetes shortcuts
alias k=kubectl
alias kctx="kubectl config use-context"

# Tab completion for k, and context names for kctx
if command -v kubectl >/dev/null 2>&1; then
  source <(kubectl completion bash)
  complete -o default -F __start_kubectl k
  _kctx_complete() { COMPREPLY=($(compgen -W "$(kubectl config get-contexts -o name 2>/dev/null)" -- "${COMP_WORDS[COMP_CWORD]}")); }
  complete -F _kctx_complete kctx
fi
EOF
ensure_block "$HOME/.bash_aliases" terraform <<'EOF'
# Terraform tab completion
complete -C "$HOME/.local/bin/terraform" terraform
EOF
grep -qs '\.local/bin' "$HOME/.profile" || warn ".profile" "doesn't put ~/.local/bin on PATH (Ubuntu's default ~/.profile does); scripts may not find these tools"
grep -qs bash_aliases "$HOME/.bashrc" || warn ".bash_aliases" "not loaded by ~/.bashrc; add: [ -f ~/.bash_aliases ] && . ~/.bash_aliases"

section "Summary"
printf '  %d ok, %d changed, %d to do, %d warnings, %d failed\n' "$N_OK" "$N_CHANGED" "$N_TODO" "$N_WARN" "$N_FAIL"
[[ $MODE == check ]] && ((N_TODO)) && echo "  Run without --check to apply the items marked TODO."
((N_CHANGED)) && echo "  Open a new terminal (or run: source ~/.bashrc) to pick up the changes."
((N_FAIL)) && exit 1
exit 0
