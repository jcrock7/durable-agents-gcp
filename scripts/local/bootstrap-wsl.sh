#!/usr/bin/env bash
# Install the local toolchain inside WSL2 (Ubuntu). Idempotent — safe to re-run.
# Run as your normal user; the script calls sudo only where needed.
#
# Usage: scripts/local/bootstrap-wsl.sh
#
# Installs: base packages, gcloud + gke-gcloud-auth-plugin + kubectl (Google apt repo),
#           terraform (HashiCorp apt repo), gh (GitHub apt repo), helm, k3d, gitleaks
#           and Node.js (pinned release binaries, checksum-verified), pnpm (corepack),
#           pre-commit + uv (pipx).
# Docker is NOT installed here: use Docker Desktop with WSL integration enabled.
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

# ---------- Pinned versions (bump deliberately) ----------
K3D_VERSION="${K3D_VERSION:-v5.7.4}"
HELM_VERSION="${HELM_VERSION:-v3.16.3}"
GITLEAKS_VERSION="${GITLEAKS_VERSION:-8.21.2}"
NODE_VERSION="${NODE_VERSION:-v24.22.2}"   # LTS; keep in step with apps/worker/Dockerfile

refuse_root
command -v apt-get >/dev/null 2>&1 || die "this script targets Ubuntu/Debian (apt) inside WSL2"

case "$(uname -m)" in
  x86_64)  ARCH=amd64; GL_ARCH=x64 ;;
  aarch64) ARCH=arm64; GL_ARCH=arm64 ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac

KEYRINGS=/usr/share/keyrings
SOURCES=/etc/apt/sources.list.d
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

sudo -v   # prompt for sudo once up front

# ---------- Base packages ----------
log "installing base packages"
sudo apt-get update -qq
sudo apt-get install -y -qq \
  apt-transport-https ca-certificates curl gnupg lsb-release \
  git jq unzip make python3 python3-venv python3-pip pipx >/dev/null

# ---------- apt repositories ----------
add_repo() {  # add_repo <name> <key-url> <deb-line> [dearmor=yes|no]
  local name="$1" key_url="$2" deb_line="$3" dearmor="${4:-yes}"
  local keyring="${KEYRINGS}/${name}.gpg" list="${SOURCES}/${name}.list"
  if [[ ! -f "$keyring" ]]; then
    log "adding apt key: ${name}"
    if [[ "$dearmor" == yes ]]; then
      curl -fsSL "$key_url" | sudo gpg --dearmor --yes -o "$keyring"
    else
      curl -fsSL "$key_url" | sudo tee "$keyring" >/dev/null
    fi
    sudo chmod 644 "$keyring"
  fi
  echo "$deb_line" | sudo tee "$list" >/dev/null
}

CODENAME="$(lsb_release -cs)"
add_repo google-cloud \
  https://packages.cloud.google.com/apt/doc/apt-key.gpg \
  "deb [signed-by=${KEYRINGS}/google-cloud.gpg] https://packages.cloud.google.com/apt cloud-sdk main"
add_repo hashicorp \
  https://apt.releases.hashicorp.com/gpg \
  "deb [arch=${ARCH} signed-by=${KEYRINGS}/hashicorp.gpg] https://apt.releases.hashicorp.com ${CODENAME} main"
add_repo githubcli \
  https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  "deb [arch=${ARCH} signed-by=${KEYRINGS}/githubcli.gpg] https://cli.github.com/packages stable main" \
  no

log "installing gcloud, gke-gcloud-auth-plugin, kubectl, terraform, gh"
sudo apt-get update -qq
sudo apt-get install -y -qq \
  google-cloud-cli google-cloud-cli-gke-gcloud-auth-plugin kubectl \
  terraform gh >/dev/null

# ---------- Pinned binaries ----------
verify_sha256() {  # verify_sha256 <file> <expected-hash>
  local actual; actual="$(sha256sum "$1" | awk '{print $1}')"
  [[ "$actual" == "$2" ]] || die "checksum mismatch for $(basename "$1")"
}

installed_version_matches() {  # installed_version_matches <cmd> <version-substring>
  command -v "$1" >/dev/null 2>&1 && "$1" version 2>/dev/null | grep -q "$2"
}

# helm
if installed_version_matches helm "$HELM_VERSION"; then
  log "helm ${HELM_VERSION} already installed"
else
  log "installing helm ${HELM_VERSION}"
  tarball="helm-${HELM_VERSION}-linux-${ARCH}.tar.gz"
  curl -fsSL -o "${TMP}/${tarball}" "https://get.helm.sh/${tarball}"
  expected="$(curl -fsSL "https://get.helm.sh/${tarball}.sha256sum" | awk '{print $1}')"
  verify_sha256 "${TMP}/${tarball}" "$expected"
  tar -xzf "${TMP}/${tarball}" -C "$TMP"
  sudo install -m 0755 "${TMP}/linux-${ARCH}/helm" /usr/local/bin/helm
fi

# k3d
if installed_version_matches k3d "$K3D_VERSION"; then
  log "k3d ${K3D_VERSION} already installed"
else
  log "installing k3d ${K3D_VERSION}"
  base="https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}"
  curl -fsSL -o "${TMP}/k3d" "${base}/k3d-linux-${ARCH}"
  if curl -fsSL -o "${TMP}/k3d-sums.txt" "${base}/checksums.txt" 2>/dev/null; then
    expected="$(grep " k3d-linux-${ARCH}\$" "${TMP}/k3d-sums.txt" | awk '{print $1}')"
    [[ -n "$expected" ]] && verify_sha256 "${TMP}/k3d" "$expected"
  else
    warn "k3d checksums not published for ${K3D_VERSION}; skipped verification"
  fi
  sudo install -m 0755 "${TMP}/k3d" /usr/local/bin/k3d
fi

# gitleaks
if installed_version_matches gitleaks "$GITLEAKS_VERSION"; then
  log "gitleaks ${GITLEAKS_VERSION} already installed"
else
  log "installing gitleaks ${GITLEAKS_VERSION}"
  base="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}"
  tarball="gitleaks_${GITLEAKS_VERSION}_linux_${GL_ARCH}.tar.gz"
  curl -fsSL -o "${TMP}/${tarball}" "${base}/${tarball}"
  expected="$(curl -fsSL "${base}/gitleaks_${GITLEAKS_VERSION}_checksums.txt" | grep " ${tarball}\$" | awk '{print $1}')"
  verify_sha256 "${TMP}/${tarball}" "$expected"
  tar -xzf "${TMP}/${tarball}" -C "$TMP" gitleaks
  sudo install -m 0755 "${TMP}/gitleaks" /usr/local/bin/gitleaks
fi

# Node.js (official tarball, checksum-verified) + pnpm via corepack. pnpm's version comes from
# "packageManager" in package.json, so every machine uses the same one.
if command -v node >/dev/null 2>&1 && [[ "$(node --version)" == "$NODE_VERSION" ]]; then
  log "node ${NODE_VERSION} already installed"
else
  log "installing node ${NODE_VERSION}"
  NODE_ARCH="$([[ "$ARCH" == amd64 ]] && echo x64 || echo arm64)"
  tarball="node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
  curl -fsSL -o "${TMP}/${tarball}" "https://nodejs.org/dist/${NODE_VERSION}/${tarball}"
  expected="$(curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" | grep " ${tarball}\$" | awk '{print $1}')"
  verify_sha256 "${TMP}/${tarball}" "$expected"
  sudo tar -xJf "${TMP}/${tarball}" -C /usr/local --strip-components=1 \
    --exclude CHANGELOG.md --exclude LICENSE --exclude README.md
fi
sudo corepack enable pnpm

# ---------- Python tools (user-level, via pipx) ----------
pipx ensurepath >/dev/null
export PATH="$HOME/.local/bin:$PATH"
for pkg in pre-commit uv; do
  if command -v "$pkg" >/dev/null 2>&1; then
    log "${pkg} already installed"
  else
    log "installing ${pkg} (pipx)"
    pipx install "$pkg" >/dev/null
  fi
done

# ---------- Git defaults for a Windows/WSL repo ----------
git config --global core.autocrlf input
git config --global init.defaultBranch main

# ---------- Docker check (provided by Docker Desktop) ----------
if ! docker info >/dev/null 2>&1; then
  warn "docker not reachable in WSL — install Docker Desktop and enable Settings > Resources > WSL integration for this distro"
fi

log "done. Open a new shell (for PATH), then run: scripts/local/verify-tools.sh"
