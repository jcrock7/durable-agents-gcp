# Windows Development Environment Setup

How this Windows 11 laptop's dev environment is configured: VS Code, PowerShell, WSL (Ubuntu-26.04), and Kubernetes tooling. Each section lists what was done and the commands to reproduce it on a fresh machine.

| Area | Windows | WSL (Ubuntu-26.04) |
|---|---|---|
| Shell | Windows PowerShell 5.1 | bash |
| Prompt | Oh My Posh 33.0.0, cobalt2 theme | Oh My Posh 33.0.0, cobalt2 theme |
| kubectl | v1.36.1 (bundled with Docker Desktop) | v1.36.1 (`/usr/local/bin`) |
| k9s | v0.51.0 (winget) | v0.51.0 (`~/.local/bin`) |
| Aliases | `k`, `kctx` | `k`, `kctx` |
| Herdr | — | 0.9.5 (`~/.local/bin`) |
| gcloud | 594.0.0 (user installer, `%LOCALAPPDATA%\Google\Cloud SDK`) | 594.0.0 (`google-cloud-cli` apt package) |
| GKE auth plugin | gcloud component | apt package |
| Node.js | v26 (`C:\Program Files\nodejs`) | v26.13.1 LTS via fnm 1.39.0 |
| pnpm | 10.28.0 (npm global) | 12.21.0 (npm global under fnm's Node) |
| Terraform | — | 1.17.2 (`~/.local/bin`) |
| Cluster | k3d `gke-prep-cluster` at `127.0.0.1:6550` | k3d `gke-prep-cluster` at `0.0.0.0:6550` |

---

## 1. VS Code user settings

File: `%APPDATA%\Code\User\settings.json`

```jsonc
{
    // Open new terminals as editor tabs
    "terminal.integrated.defaultLocation": "editor",

    // Nerd Font so Oh My Posh icons render
    "terminal.integrated.fontFamily": "MesloLGM Nerd Font",

    // Open Markdown files in preview by default
    "workbench.editorAssociations": {
        "*.md": "vscode.markdown.preview.editor"
    },
    "terminal.integrated.initialHint": false
}
```

- To edit a Markdown file instead of previewing it: right-click the tab, choose **Reopen Editor With…**, then **Text Editor**.

## 2. Oh My Posh on Windows

### Install Oh My Posh and a Nerd Font

```powershell
winget install JanDeDobbeleer.OhMyPosh --source winget --scope user
oh-my-posh font install meslo
```

- The winget package installs as an MSIX app. It runs as `oh-my-posh` through the app alias in `%LOCALAPPDATA%\Microsoft\WindowsApps`.
- This install does **not** set `POSH_THEMES_PATH`, and its own themes folder includes the version number, so it moves on every upgrade.

### Copy themes to a stable folder

```powershell
$src = Join-Path (Get-AppxPackage ohmyposh.cli).InstallLocation 'themes'
$dst = "$HOME\.oh-my-posh\themes"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item "$src\*" $dst -Force
[Environment]::SetEnvironmentVariable('POSH_THEMES_PATH', $dst, 'User')
```

Rerun this after upgrading Oh My Posh to pick up new or updated themes.

### Preview themes

Run this in a VS Code terminal to print a sample prompt for every theme:

```powershell
Get-ChildItem "$env:POSH_THEMES_PATH\*.omp.json" | ForEach-Object { Write-Host "`n$($_.BaseName -replace '\.omp$')" -ForegroundColor Yellow; oh-my-posh print primary --config $_.FullName; Write-Host }
```

There's also a screenshot gallery at https://ohmyposh.dev/docs/themes.

## 3. PowerShell profile

File: `$PROFILE` (`C:\Users\Admin\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`)

```powershell
if (-not $env:POSH_THEMES_PATH) { $env:POSH_THEMES_PATH = "$HOME\.oh-my-posh\themes" }
oh-my-posh init powershell --config "$env:POSH_THEMES_PATH\cobalt2.omp.json" | Invoke-Expression

# Kubernetes shortcuts
Set-Alias -Name k -Value kubectl
function kctx { param([string]$Context) kubectl config use-context $Context }

# Tab completion for k, and context names for kctx
if (Get-Command kubectl -ErrorAction SilentlyContinue) {
    kubectl completion powershell | Out-String | Invoke-Expression
    Register-ArgumentCompleter -CommandName k -ScriptBlock $__kubectlCompleterBlock
    Register-ArgumentCompleter -CommandName kctx -ParameterName Context -ScriptBlock {
        param($commandName, $parameterName, $wordToComplete)
        kubectl config get-contexts -o name | Where-Object { $_ -like "$wordToComplete*" }
    }
}
```

- Backup from before the Kubernetes lines were added: `Microsoft.PowerShell_profile.ps1.bak-k8s`.
- Reload an open terminal with `. $PROFILE`.

## 4. Kubernetes on Windows

### kubectl

Already on PATH from Docker Desktop: `%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\kubectl.exe` (v1.36.1). Nothing to install.

### k9s

```powershell
winget install Derailed.k9s --source winget
```

Restart the terminal so it picks up the new PATH. In k9s, type `:ctx` to switch clusters.

### Connect to the k3d cluster

`%USERPROFILE%\.kube\config` holds only the k3d cluster's settings, copied from WSL with the server address changed from `0.0.0.0` to `127.0.0.1`:

```powershell
New-Item -ItemType Directory -Force "$HOME\.kube" | Out-Null
$cfg = wsl.exe -d Ubuntu-26.04 --cd ~ -e kubectl config view --minify --flatten --context k3d-gke-prep-cluster
($cfg -join "`n") -replace 'https://0\.0\.0\.0:6550','https://127.0.0.1:6550' | Set-Content "$HOME\.kube\config" -Encoding ascii
kubectl get nodes
```

The Windows and WSL configs are separate copies. **Rerun this whenever the k3d cluster is recreated**, since its certificates change.

---

## 5. WSL: Oh My Posh

The usual install script needs `unzip`, which isn't installed in this Ubuntu and needs sudo to add. Instead, the Linux binary comes straight from GitHub releases, and the themes are copied from Windows:

```bash
mkdir -p ~/.local/bin ~/.oh-my-posh/themes
curl -fsSL https://github.com/JanDeDobbeleer/oh-my-posh/releases/download/v33.0.0/posh-linux-amd64 -o ~/.local/bin/oh-my-posh
chmod +x ~/.local/bin/oh-my-posh
cp /mnt/c/Users/Admin/.oh-my-posh/themes/*.omp.* ~/.oh-my-posh/themes/
```

Added to the end of `~/.bashrc` (backup: `~/.bashrc.bak-omp`):

```bash
# Oh My Posh prompt (cobalt2)
export PATH="$HOME/.local/bin:$PATH"
export POSH_THEMES_PATH="$HOME/.oh-my-posh/themes"
eval "$(oh-my-posh init bash --config "$POSH_THEMES_PATH/cobalt2.omp.json")"
```

VS Code's terminal font setting also covers WSL terminals, so the icons render.

### Fix: prompt drawn over command output

When a command's output doesn't end with a newline (for example `curl` printing JSON), bash draws the prompt at the end of that output. The next redraw then paints the prompt over the start of the line. This hook, added right after the `oh-my-posh init` line in `~/.bashrc` (backup: `~/.bashrc.bak-promptsp`), works like zsh: if the cursor isn't at the start of a line, it leaves a dim `%` marker and starts the prompt on a new line.

```bash
# Start the prompt on a fresh line when the last output had no trailing newline
# (like zsh PROMPT_SP). Runs after _omp_hook so the exit status is unaffected.
_prompt_sp() { local c=${COLUMNS:-$(tput cols 2>/dev/null || echo 80)}; printf "\e[2m%%\e[0m%*s\r" "$((c - 1))" ""; }
PROMPT_COMMAND+=(_prompt_sp)
```

It must come **after** the Oh My Posh line. Oh My Posh records the last command's exit status in the first `PROMPT_COMMAND` hook, and this `printf` would reset it.

## 6. WSL: easy access to Windows repos

| Path | Points to | Use for |
|---|---|---|
| `~/winrepos` | `/mnt/c/Users/Admin/repos` (symlink) | Repos you also work on from Windows |
| `~/repos` | Linux folder | Repos cloned inside Linux (much faster for git, npm and builds) |

```bash
ln -s /mnt/c/Users/Admin/repos ~/winrepos
```

### Line endings for repos under /mnt/c

Git for Windows uses `core.autocrlf=true`, so files on the Windows side have Windows (CRLF) line endings. WSL's git had no such setting and reported nearly every file as changed (for example 705 files in `search-hq`). The fix applies the Windows setting **only** to repos under `/mnt/c/`:

`~/.gitconfig`:

```ini
[includeIf "gitdir:/mnt/c/"]
	path = ~/.gitconfig-windows
```

`~/.gitconfig-windows`:

```ini
[core]
	autocrlf = true
```

```bash
git config --global includeIf."gitdir:/mnt/c/".path "~/.gitconfig-windows"
printf "[core]\n\tautocrlf = true\n" > ~/.gitconfig-windows
```

Afterward, every repo showed the same changes from WSL as from Windows, and Linux-native clones in `~/repos` keep normal Linux line endings.

**Working across both sides:**
- Don't run git on the same repo from Windows and WSL at once. They can fight over git's lock files.
- Git worktrees created from Windows don't work from WSL: their `.git` file points to a Windows path.
- Add a `.gitattributes` with `*.sh text eol=lf` to repos with shell scripts, so they always run in Linux.
- Opening a `/mnt/c` folder from WSL in VS Code works, but it's smoother to open it from Windows. Use the WSL mode for `~/repos`.

## 7. WSL: open links in Windows Chrome

The standard tool for this is `wslu` (`wslview`), which needs sudo to install. Instead, a small script opens links in Chrome:

`~/.local/bin/chrome-open`:

```bash
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
```

```bash
chmod +x ~/.local/bin/chrome-open
ln -sf chrome-open ~/.local/bin/xdg-open
```

Added to the end of `~/.bashrc` (backup: `~/.bashrc.bak-browser`):

```bash
# Open links in Windows Chrome (used by gh, gcloud, python webbrowser, etc.)
export BROWSER="$HOME/.local/bin/chrome-open"
```

- Clicking a link inside a VS Code terminal is handled by VS Code and opens the Windows default browser.
- To use the standard tool instead: `sudo apt install wslu`, then set `BROWSER=wslview`.

## 8. WSL: Kubernetes

These were already installed before this setup:

| Tool | Location | Version |
|---|---|---|
| kubectl | `/usr/local/bin/kubectl` | v1.36.1 |
| k9s | `~/.local/bin/k9s` | v0.51.0 |
| k3d | `/usr/local/bin/k3d` | — |
| docker | `/usr/bin/docker` (Docker Desktop) | 29.9.3 |

kubectl contexts in `~/.kube/config`:

| Context | Cluster |
|---|---|
| `k3d-gke-prep-cluster` (current) | k3d cluster: 1 server and 2 agents at `https://0.0.0.0:6550` |
| `default` | Separate single-node k3s cluster (`ranchlaptop`) at `https://127.0.0.1:6443` |

### Aliases

File: `~/.bash_aliases` (already loaded by `~/.bashrc`)

```bash
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
```

Reload an open terminal with `source ~/.bashrc`.

## 9. Google Cloud CLI (gcloud)

Both sides run Google Cloud CLI 594.0.0, installed and signed in separately. Each has its own configuration, so `gcloud auth login` and `gcloud config set project …` must be done on each side.

### Windows

Installed per user with Google's Cloud SDK installer to `%LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk`. The installer adds `…\google-cloud-sdk\bin` to the **user** PATH, and winget recognizes it as `Google.CloudSDK`.

```powershell
winget install Google.CloudSDK --source winget
# open a new terminal so PATH updates, then:
gcloud init
gcloud components list --only-local-state
```

Installed components: `core`, `bq`, `gsutil`, `gcloud-crc32c`. Add more with `gcloud components install <id>` and update with `gcloud components update`.

### WSL (Ubuntu)

Installed from Google's apt repository as the `google-cloud-cli` package. gcloud lives in `/usr/lib/google-cloud-sdk`, with `/usr/bin/gcloud` pointing to it.

```bash
sudo apt-get install -y apt-transport-https ca-certificates gnupg curl
curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
  | sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list
sudo apt-get update && sudo apt-get install -y google-cloud-cli
gcloud init
```

- Installed components: `core`, `bq`, `gsutil`, `gcloud-crc32c`, `alpha`, `beta`, `preview`, `bundled-python3-unix`.
- With an apt install, `gcloud components install` is disabled. Extras are separate apt packages, and updates come through `sudo apt-get update && sudo apt-get upgrade`.
- Sign-in links open in Windows Chrome through the `BROWSER` setting from section 7.

### GKE auth plugin

`kubectl` needs `gke-gcloud-auth-plugin` to connect to GKE clusters (local k3d doesn't need it). Installed on both sides.

**Windows:** installed as a gcloud component to `…\google-cloud-sdk\bin\gke-gcloud-auth-plugin.exe`, which is already on PATH.

```powershell
gcloud components install gke-gcloud-auth-plugin
gke-gcloud-auth-plugin --version
```

If gcloud stops and prints a `FOR /F … copy-bundled-python` message, it can't update the Python it's running from. In PowerShell, point it at a temporary copy and rerun the install:

```powershell
$env:CLOUDSDK_PYTHON = gcloud components copy-bundled-python
gcloud components install gke-gcloud-auth-plugin
Remove-Item Env:CLOUDSDK_PYTHON
```

**WSL:** the `google-cloud-cli-gke-gcloud-auth-plugin` apt package.

```bash
sudo apt-get install -y google-cloud-cli-gke-gcloud-auth-plugin
gke-gcloud-auth-plugin --version
```

**Connecting to a GKE cluster:** fetch credentials on each side. kubectl then uses the plugin automatically.

```bash
gcloud container clusters get-credentials <cluster> --region <region> --project <project>
kubectl get nodes
```

## 10. WSL: Node.js (fnm)

Node is installed inside Linux with [fnm](https://github.com/Schniz/fnm), a Node version manager, in the home folder with no sudo. Before this, WSL had no Node: `npm` and `npx` were the Windows copies, reached through the Windows PATH, which are slow on Linux files and can behave oddly there.

### Install fnm and Node LTS

fnm's install script needs `unzip`, which this Ubuntu doesn't have, so the release zip is unpacked with Python instead:

```bash
FNM_DIR=~/.local/share/fnm
mkdir -p "$FNM_DIR"
t=$(mktemp -d)
curl -fsSL https://github.com/Schniz/fnm/releases/latest/download/fnm-linux.zip -o "$t/fnm.zip"
python3 -I -m zipfile -e "$t/fnm.zip" "$t/x"
install -m 755 "$t/x/fnm" "$FNM_DIR/fnm"
rm -rf "$t"

"$FNM_DIR/fnm" install --lts
"$FNM_DIR/fnm" default lts-latest
```

### Shell setup

Two pieces, so that both terminals and non-interactive tools (scripts, agents, `bash -lc …`) find Linux Node ahead of the Windows copy.

End of `~/.profile` (backup: `~/.profile.bak-fnm`), for login shells, including non-interactive ones:

```bash
# Node.js via fnm: put fnm and the default Node on PATH for all login shells
# (scripts, tools). Interactive shells get per-project switching from ~/.bashrc.
export FNM_DIR="$HOME/.local/share/fnm"
if [ -d "$FNM_DIR" ] && [ -z "$FNM_MULTISHELL_PATH" ]; then
  PATH="$FNM_DIR:$FNM_DIR/aliases/default/bin:$PATH"
fi
```

End of `~/.bashrc` (backup: `~/.bashrc.bak-fnm`), for terminals:

```bash
# Node.js via fnm: switch Node version on cd when a .nvmrc/.node-version exists
export FNM_DIR="$HOME/.local/share/fnm"
if [ -x "$FNM_DIR/fnm" ]; then
  export PATH="$FNM_DIR:$PATH"
  eval "$(fnm env --use-on-cd --version-file-strategy=recursive --shell bash)"
fi
```

- The `FNM_MULTISHELL_PATH` check in `~/.profile` stops the default version from overriding the per-project switching that `~/.bashrc` already set up in login terminals.
- Linux paths come before the Windows ones, which WSL adds at the end of PATH, so `node`, `npm` and `npx` resolve to Linux.

### Everyday use

```bash
fnm list                 # installed versions
fnm install 24           # add another version
fnm default 24           # change the default
echo 24 > .node-version  # pin a project; terminals switch on cd
```

### pnpm

Installed as a global npm package with WSL's own Node, so it comes ahead of the Windows copy (`/mnt/c/Users/Admin/AppData/Roaming/npm/pnpm`) in every shell:

```bash
npm install -g pnpm
pnpm --version   # 12.21.0
```

- Global npm packages live inside each fnm Node version. After `fnm install` of a new version, rerun `npm install -g pnpm` for it.
- Projects that pin `"packageManager": "pnpm@x.y.z"` in `package.json` (this repo pins `pnpm@12.17.0`) are handled automatically: WSL pnpm downloads and switches to the pinned version (`pnpm --version` in the repo prints `12.17.0`).
- Windows pnpm 10.28.0 currently **fails** in this repo with `Failed to switch pnpm to v12.17.0 … CLI is missing at "%LOCALAPPDATA%\pnpm\.tools\pnpm\12.17.0\bin"` (its cache of the pinned version is incomplete).

## 11. WSL: Terraform

HashiCorp's apt repository needs sudo, so Terraform is installed from the official release zip into `~/.local/bin`. The checksum file's GPG signature and the zip's SHA-256 are both verified first:

```bash
V=1.17.2   # latest: curl -fsS https://checkpoint-api.hashicorp.com/v1/check/terraform
B=https://releases.hashicorp.com/terraform/$V
t=$(mktemp -d) && cd "$t"
curl -fsSLO "$B/terraform_${V}_linux_amd64.zip"
curl -fsSLO "$B/terraform_${V}_SHA256SUMS"
curl -fsSLO "$B/terraform_${V}_SHA256SUMS.sig"
curl -fsSL https://www.hashicorp.com/.well-known/pgp-key.txt -o hashicorp.asc

export GNUPGHOME="$t/gnupg" && mkdir -m 700 "$GNUPGHOME"
gpg -q --import hashicorp.asc
gpg --verify "terraform_${V}_SHA256SUMS.sig" "terraform_${V}_SHA256SUMS"   # expect "Good signature"
grep linux_amd64.zip "terraform_${V}_SHA256SUMS" | sha256sum -c -           # expect "OK"

python3 -I -m zipfile -e "terraform_${V}_linux_amd64.zip" x
install -m 755 x/terraform ~/.local/bin/terraform
cd ~ && rm -rf "$t" && unset GNUPGHOME
terraform version
```

- HashiCorp's release key fingerprint is `C874 011F 0AB4 0511 0D02 1055 3436 5D94 72D7 468F`. A temporary `GNUPGHOME` keeps the key out of your personal keyring.
- Tab completion, added to `~/.bash_aliases`:

  ```bash
  # Terraform tab completion
  complete -C "$HOME/.local/bin/terraform" terraform
  ```

- To upgrade, rerun the block with a new `V`.
- Windows doesn't have Terraform installed.

## 12. WSL: Herdr

[Herdr](https://herdr.dev/docs/install/) is a terminal app for running AI coding agents. Its official installer puts the binary in `~/.local/bin` and checks the download's checksum. It doesn't use sudo or edit shell files.

```bash
curl -fsSL https://herdr.dev/install.sh | sh
herdr --version
```

**Status:** installed: herdr 0.9.5 at `~/.local/bin/herdr`, on the stable release channel (switch with `herdr channel set preview` or `herdr channel set stable`). To update, rerun the install command.
