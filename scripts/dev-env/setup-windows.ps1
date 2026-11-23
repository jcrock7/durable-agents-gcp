<#
.SYNOPSIS
  Set up, check or update this Windows workstation, then the WSL side, as described in
  docs/Windows Development Environment Setup.md.

.DESCRIPTION
  Safe to re-run: it only changes what is missing or out of date, and prints one status line
  per item (OK, CHANGED, TODO, WARN, FAIL) with a summary at the end.
  Windows apps come from winget and are upgraded with -Upgrade. pnpm is pinned in versions.env.
  At the end it runs setup-wsl.sh inside the WSL distro (skip with -SkipWsl).

.EXAMPLE
  .\scripts\dev-env\setup-windows.ps1              # install or fix anything missing
.EXAMPLE
  .\scripts\dev-env\setup-windows.ps1 -Check       # change nothing; report status and available updates
.EXAMPLE
  .\scripts\dev-env\setup-windows.ps1 -Upgrade     # also upgrade winget apps to their latest versions
.EXAMPLE
  .\scripts\dev-env\setup-windows.ps1 -SyncKubeconfig   # replace %USERPROFILE%\.kube\config with the k3d cluster's from WSL
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Upgrade,
    [switch]$SyncKubeconfig,
    [switch]$SkipWsl,
    [string]$Distro = 'Ubuntu-26.04',
    [string]$K3dContext = 'k3d-gke-prep-cluster',
    [string[]]$WslArgs = @()
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Mode = if ($Check) { 'check' } elseif ($Upgrade) { 'upgrade' } else { 'install' }

# ---------- Status output ----------
$script:Counts = @{ OK = 0; CHANGED = 0; TODO = 0; WARN = 0; FAIL = 0 }
function Write-Row([string]$Tag, [string]$Name, [string]$Detail = '') {
    $colors = @{ OK = 'Green'; CHANGED = 'Cyan'; TODO = 'Yellow'; WARN = 'Yellow'; FAIL = 'Red' }
    Write-Host ('  {0,-8} ' -f $Tag) -ForegroundColor $colors[$Tag] -NoNewline
    Write-Host ('{0,-28} {1}' -f $Name, $Detail)
    $script:Counts[$Tag]++
}
function Write-Section([string]$Title) { Write-Host ''; Write-Host $Title -ForegroundColor White }
function Test-Command([string]$Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }
function Update-SessionPath {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# ---------- Pinned versions (shared with setup-wsl.sh) ----------
$Pin = @{}
foreach ($line in Get-Content (Join-Path $Here 'versions.env')) {
    if ($line -match '^([A-Z][A-Z0-9_]*)=(\S*)\s*$') { $Pin[$Matches[1]] = $Matches[2] }
}

# ---------- Managed text blocks (same markers as managed_block.py) ----------
function Set-ManagedBlock([string]$Path, [string]$Name, [string]$Content, [string]$Label = $Name) {
    $label = $Label
    $text = if (Test-Path $Path) { [IO.File]::ReadAllText($Path) } else { '' }
    $nl = "`r`n"   # Windows files are written with CRLF
    $t = $text -replace "`r`n", "`n"
    $c = ($Content -replace "`r`n", "`n").Trim("`n")
    $begin = "# >>> dev-env: $Name >>>"; $end = "# <<< dev-env: $Name <<<"
    $block = "$begin`n$c`n$end"
    $rx = [regex]::new([regex]::Escape($begin) + '.*?' + [regex]::Escape($end), 'Singleline')
    $m = $rx.Match($t)
    if ($m.Success) {
        if ($m.Value -eq $block) { Write-Row OK $label; return }
        $new = $t.Substring(0, $m.Index) + $block + $t.Substring($m.Index + $m.Length); $what = 'block updated'
    } elseif ($t.Contains($c)) {
        $i = $t.IndexOf($c); $new = $t.Substring(0, $i) + $block + $t.Substring($i + $c.Length); $what = 'existing lines marked as managed'
    } else {
        $sep = if ($t -eq '' -or $t.EndsWith("`n`n")) { '' } elseif ($t.EndsWith("`n")) { "`n" } else { "`n`n" }
        $new = "$t$sep$block`n"; $what = 'block added'
    }
    if ($Mode -eq 'check') { Write-Row TODO $label $what; return }
    if ((Test-Path $Path) -and -not (Test-Path "$Path.bak-devenv")) { Copy-Item $Path "$Path.bak-devenv" }
    New-Item -ItemType Directory -Force (Split-Path -Parent $Path) | Out-Null
    [IO.File]::WriteAllText($Path, ($new -replace "`n", $nl), [Text.UTF8Encoding]::new($true))
    Write-Row CHANGED $label $what
}

Write-Host "Windows workstation setup  mode: $Mode" -ForegroundColor White

# ---------- winget apps ----------
Write-Section 'Apps (winget; updated with -Upgrade, not pinned)'
$Apps = @(
    @{ Id = 'Git.Git';                    Name = 'Git' }
    @{ Id = 'GitHub.cli';                 Name = 'GitHub CLI' }
    @{ Id = 'OpenJS.NodeJS.LTS';          Name = 'Node.js LTS' }
    @{ Id = 'Microsoft.VisualStudioCode'; Name = 'VS Code';        Scope = 'user' }
    @{ Id = 'Docker.DockerDesktop';       Name = 'Docker Desktop' }
    @{ Id = 'Google.Chrome';              Name = 'Chrome';         Path = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" }
    @{ Id = 'JanDeDobbeleer.OhMyPosh';    Name = 'Oh My Posh';     Scope = 'user' }
    @{ Id = 'Derailed.k9s';               Name = 'k9s' }
    @{ Id = 'Google.CloudSDK';            Name = 'Google Cloud CLI' }
)
if (-not (Test-Command winget)) {
    Write-Row FAIL 'winget' 'not found: install App Installer from the Microsoft Store'
} else {
    $listing = winget list --source winget --accept-source-agreements --disable-interactivity 2>$null | Out-String
    foreach ($app in $Apps) {
        $m = [regex]::Match($listing, '(?m)\s' + [regex]::Escape($app.Id) + '\s+(\S+)(?:[ \t]+(\d\S*))?[ \t]*\r?$')
        $installed = $m.Success -or ($app.Path -and (Test-Path $app.Path))
        $ver = if ($m.Success) { $m.Groups[1].Value } else { 'installed (not tracked by winget)' }
        $avail = if ($m.Success -and $m.Groups[2].Success) { $m.Groups[2].Value } else { '' }
        $common = @('--id', $app.Id, '--exact', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity', '--silent')
        if (-not $installed) {
            if ($Mode -eq 'check') { Write-Row TODO $app.Name "not installed (winget $($app.Id))"; continue }
            $scope = if ($app.Scope) { @('--scope', $app.Scope) } else { @() }
            winget install @common @scope | Out-Null
            if ($LASTEXITCODE -eq 0) { Write-Row CHANGED $app.Name 'installed' } else { Write-Row FAIL $app.Name "winget install $($app.Id) failed (exit $LASTEXITCODE)" }
        } elseif ($app.Id -eq 'Google.CloudSDK') {
            # The Cloud SDK installer doesn't report its version to winget; gcloud updates itself.
            $gv = if (Test-Command gcloud.cmd) { (gcloud.cmd version --format='value(core)' 2>$null) | Select-Object -First 1 } else { '' }
            if ($Mode -eq 'upgrade' -and (Test-Command gcloud.cmd)) {
                gcloud.cmd components update --quiet 2>$null | Out-Null
                $nv = (gcloud.cmd version --format='value(core)' 2>$null) | Select-Object -First 1
                if ($nv -ne $gv) { Write-Row CHANGED $app.Name "$gv -> $nv" } else { Write-Row OK $app.Name "$gv (up to date)" }
            } else { Write-Row OK $app.Name "$gv (updates: -Upgrade runs gcloud components update)" }
        } elseif ($avail) {
            if ($Mode -eq 'upgrade') {
                winget upgrade @common | Out-Null
                if ($LASTEXITCODE -eq 0) { Write-Row CHANGED $app.Name "$ver -> $avail" } else { Write-Row FAIL $app.Name "winget upgrade $($app.Id) failed (exit $LASTEXITCODE)" }
            } else { Write-Row OK $app.Name "$ver (update $avail available: -Upgrade)" }
        } else { Write-Row OK $app.Name $ver }
    }
    Update-SessionPath
}

# ---------- Oh My Posh: font, themes, POSH_THEMES_PATH ----------
Write-Section 'Oh My Posh'
$fonts = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts' -ErrorAction SilentlyContinue
if ($fonts -and ($fonts.PSObject.Properties.Name -match '^MesloLGM Nerd Font')) { Write-Row OK 'Meslo Nerd Font' 'installed' }
elseif ($Mode -eq 'check') { Write-Row TODO 'Meslo Nerd Font' 'not installed' }
elseif (Test-Command oh-my-posh) {
    oh-my-posh font install meslo | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Row CHANGED 'Meslo Nerd Font' 'installed' } else { Write-Row FAIL 'Meslo Nerd Font' 'oh-my-posh font install meslo failed' }
} else { Write-Row FAIL 'Meslo Nerd Font' 'oh-my-posh not found' }

$themes = "$HOME\.oh-my-posh\themes"
$pkg = Get-AppxPackage ohmyposh.cli -ErrorAction SilentlyContinue
if ($pkg) {
    $src = Join-Path $pkg.InstallLocation 'themes'
    $stale = @(Get-ChildItem "$src\*.omp.*" | Where-Object {
        $d = Join-Path $themes $_.Name
        -not (Test-Path $d) -or (Get-FileHash $_.FullName).Hash -ne (Get-FileHash $d).Hash })
    if ($stale.Count -eq 0) { Write-Row OK 'themes' $themes }
    elseif ($Mode -eq 'check') { Write-Row TODO 'themes' "$($stale.Count) to copy to $themes" }
    else {
        New-Item -ItemType Directory -Force $themes | Out-Null
        $stale | Copy-Item -Destination $themes -Force
        Write-Row CHANGED 'themes' "$($stale.Count) copied to $themes"
    }
} else { Write-Row WARN 'themes' 'Oh My Posh app package not found' }

if ([Environment]::GetEnvironmentVariable('POSH_THEMES_PATH', 'User') -eq $themes) { Write-Row OK 'POSH_THEMES_PATH' $themes }
elseif ($Mode -eq 'check') { Write-Row TODO 'POSH_THEMES_PATH' "set to $themes" }
else { [Environment]::SetEnvironmentVariable('POSH_THEMES_PATH', $themes, 'User'); $env:POSH_THEMES_PATH = $themes; Write-Row CHANGED 'POSH_THEMES_PATH' $themes }

# ---------- PowerShell profile ----------
Write-Section 'PowerShell profile'
$profilePath = $PROFILE.CurrentUserCurrentHost
Write-Host "  $profilePath"
Set-ManagedBlock $profilePath 'oh-my-posh' -Label 'profile: oh-my-posh' -Content @'
if (-not $env:POSH_THEMES_PATH) { $env:POSH_THEMES_PATH = "$HOME\.oh-my-posh\themes" }
oh-my-posh init powershell --config "$env:POSH_THEMES_PATH\cobalt2.omp.json" | Invoke-Expression
'@
Set-ManagedBlock $profilePath 'kubernetes' -Label 'profile: kubernetes' -Content @'
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
'@

# ---------- VS Code ----------
Write-Section 'VS Code'
$settingsPath = "$env:APPDATA\Code\User\settings.json"
$wanted = [ordered]@{
    'terminal.integrated.defaultLocation' = @{ Value = '"editor"';             Test = '"editor"' }
    'terminal.integrated.fontFamily'      = @{ Value = '"MesloLGM Nerd Font"'; Test = '"MesloLGM Nerd Font"' }
    'workbench.editorAssociations'        = @{ Value = "{`n        `"*.md`": `"vscode.markdown.preview.editor`"`n    }"; Test = '\{[^}]*"\*\.md"\s*:\s*"vscode\.markdown\.preview\.editor"' }
    'terminal.integrated.initialHint'     = @{ Value = 'false';                Test = 'false' }
}
$json = if (Test-Path $settingsPath) { [IO.File]::ReadAllText($settingsPath) } else { "{`n}`n" }
$insert = @()
foreach ($key in $wanted.Keys) {
    $k = [regex]::Escape("`"$key`"")
    if ($json -match "$k\s*:\s*$($wanted[$key].Test)") { Write-Row OK $key; continue }
    if ($json -match "$k\s*:") { Write-Row WARN $key "set to another value in settings.json; left alone (want $($wanted[$key].Value -replace '\s+',' '))"; continue }
    $insert += "    `"$key`": $($wanted[$key].Value)"
    if ($Mode -eq 'check') { Write-Row TODO $key 'missing from settings.json' }
}
if ($insert.Count -and $Mode -ne 'check') {
    # VS Code's settings.json allows comments and trailing commas, so add the keys before the last '}'.
    $close = $json.LastIndexOf('}')
    $before = $json.Substring(0, $close).TrimEnd()
    if (-not ($before.EndsWith('{') -or $before.EndsWith(','))) { $before += ',' }
    $new = $before + "`n" + ($insert -join ",`n") + "`n" + $json.Substring($close)
    if ((Test-Path $settingsPath) -and -not (Test-Path "$settingsPath.bak-devenv")) { Copy-Item $settingsPath "$settingsPath.bak-devenv" }
    New-Item -ItemType Directory -Force (Split-Path -Parent $settingsPath) | Out-Null
    [IO.File]::WriteAllText($settingsPath, $new, [Text.UTF8Encoding]::new($false))
    Write-Row CHANGED 'settings.json' "added $($insert.Count) setting(s)"
}
if (Test-Command code) {
    $ext = 'ms-vscode-remote.remote-wsl'
    if ((code --list-extensions 2>$null) -contains $ext) { Write-Row OK $ext }
    elseif ($Mode -eq 'check') { Write-Row TODO $ext 'not installed' }
    else {
        code --install-extension $ext --force 2>$null | Out-Null
        if ((code --list-extensions 2>$null) -contains $ext) { Write-Row CHANGED $ext 'installed' } else { Write-Row FAIL $ext 'install failed' }
    }
} else { Write-Row WARN 'code' 'not on PATH yet; open a new terminal and re-run' }

# ---------- Node.js tools ----------
Write-Section 'Node.js tools (pinned in versions.env)'
$want = $Pin['PNPM_VERSION']
if (-not (Test-Command npm.cmd)) { Write-Row FAIL 'pnpm' 'npm not found (Node.js not installed?)' }
else {
    Push-Location $HOME
    try {
        $have = if (Test-Command pnpm.cmd) { (pnpm.cmd --version 2>$null | Select-Object -Last 1) } else { '' }
        if ($have -eq $want) { Write-Row OK 'pnpm' $have }
        elseif ($Mode -eq 'check') { Write-Row TODO 'pnpm' "$(if ($have) { "$have installed" } else { 'not installed' }), pinned $want" }
        else {
            npm.cmd install -g "pnpm@$want" --allow-scripts=pnpm 2>$null | Out-Null
            $now = pnpm.cmd --version 2>$null | Select-Object -Last 1
            if ($now -eq $want) { Write-Row CHANGED 'pnpm' "$(if ($have) { $have } else { 'not installed' }) -> $want" } else { Write-Row FAIL 'pnpm' "npm install -g pnpm@$want failed" }
        }
    } finally { Pop-Location }
}

# ---------- Kubernetes and gcloud ----------
Write-Section 'Kubernetes and Google Cloud'
if (Test-Command kubectl) { Write-Row OK 'kubectl' ((Get-Command kubectl).Source) } else { Write-Row WARN 'kubectl' 'not found: it comes with Docker Desktop (resources\bin)' }

if (Test-Command gcloud.cmd) {
    $components = gcloud.cmd components list --only-local-state --format='value(id)' 2>$null
    if ($components -contains 'gke-gcloud-auth-plugin') { Write-Row OK 'gke-gcloud-auth-plugin' 'gcloud component' }
    elseif ($Mode -eq 'check') { Write-Row TODO 'gke-gcloud-auth-plugin' 'not installed' }
    else {
        # gcloud can't update the Python it runs from, so run the install from a temporary copy.
        $env:CLOUDSDK_PYTHON = gcloud.cmd components copy-bundled-python 2>$null
        gcloud.cmd components install gke-gcloud-auth-plugin --quiet 2>$null | Out-Null
        Remove-Item Env:CLOUDSDK_PYTHON -ErrorAction SilentlyContinue
        if ((gcloud.cmd components list --only-local-state --format='value(id)' 2>$null) -contains 'gke-gcloud-auth-plugin') { Write-Row CHANGED 'gke-gcloud-auth-plugin' 'installed' }
        else { Write-Row FAIL 'gke-gcloud-auth-plugin' 'gcloud components install failed' }
    }
} else { Write-Row WARN 'gcloud' 'not on PATH yet; open a new terminal and re-run' }

if ((git config --get core.autocrlf) -eq 'true') { Write-Row OK 'git core.autocrlf' 'true' }
else { Write-Row WARN 'git core.autocrlf' "is '$(git config --get core.autocrlf)'; Git for Windows default is true" }

# ---------- WSL ----------
Write-Section 'WSL'
$distros = @((wsl.exe -l -q 2>$null) | ForEach-Object { ($_ -replace "`0", '').Trim() } | Where-Object { $_ })
$haveDistro = $distros -contains $Distro
if ($haveDistro) { Write-Row OK 'WSL distro' $Distro }
else { Write-Row TODO 'WSL distro' "$Distro not installed: run 'wsl --install -d $Distro' as admin, restart, then re-run" }

$kube = "$HOME\.kube\config"
if ($haveDistro) {
    $cfg = wsl.exe -d $Distro --cd ~ -e kubectl config view --minify --flatten --context $K3dContext 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $cfg) { Write-Row WARN 'kubeconfig' "no '$K3dContext' context in WSL (is the k3d cluster created?)" }
    else {
        $desired = (($cfg -join "`n") -replace 'https://0\.0\.0\.0:', 'https://127.0.0.1:') + "`n"
        $current = if (Test-Path $kube) { ([IO.File]::ReadAllText($kube)) -replace "`r`n", "`n" } else { $null }
        if ($current -eq $desired) { Write-Row OK 'kubeconfig' "$kube matches WSL's $K3dContext" }
        elseif ($Mode -eq 'check') { Write-Row TODO 'kubeconfig' $(if ($current) { 'differs from WSL (cluster recreated?): run with -SyncKubeconfig' } else { 'missing' }) }
        elseif ($null -ne $current -and -not $SyncKubeconfig) { Write-Row WARN 'kubeconfig' 'differs from WSL (cluster recreated?): re-run with -SyncKubeconfig to replace it (a backup is kept)' }
        else {
            New-Item -ItemType Directory -Force "$HOME\.kube" | Out-Null
            if ($current) { Copy-Item $kube "$kube.bak-devenv" -Force }
            [IO.File]::WriteAllText($kube, $desired, [Text.ASCIIEncoding]::new())
            Write-Row CHANGED 'kubeconfig' "$kube written from WSL's $K3dContext"
        }
    }
}

# ---------- Summary, then the WSL side ----------
Write-Section 'Summary (Windows)'
$c = $script:Counts
Write-Host ("  {0} ok, {1} changed, {2} to do, {3} warnings, {4} failed" -f $c.OK, $c.CHANGED, $c.TODO, $c.WARN, $c.FAIL)
if ($Mode -eq 'check' -and $c.TODO) { Write-Host '  Run without -Check to apply the items marked TODO.' }
if ($c.CHANGED) { Write-Host '  Open a new terminal to pick up PATH and profile changes.' }
$failed = $c.FAIL -gt 0

if (-not $SkipWsl -and $haveDistro) {
    Write-Host ''
    $wslScript = (wsl.exe -d $Distro -e wslpath -u ((Join-Path $Here 'setup-wsl.sh') -replace '\\', '/')) -join ''
    $args2 = @($WslArgs)
    if ($Mode -eq 'check') { $args2 = @('--check') + $args2 }
    Write-Host "Running setup-wsl.sh in $Distro $($args2 -join ' ')" -ForegroundColor White
    wsl.exe -d $Distro --cd ~ -e bash $wslScript @args2
    if ($LASTEXITCODE -ne 0) { $failed = $true }
}
if ($failed) { exit 1 } else { exit 0 }
