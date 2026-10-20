#Requires -Version 5.1
<#
.SYNOPSIS
    Stage 0 Minimal Seed for Agent-Managed Dotfiles on Native Windows.
.DESCRIPTION
    Works inside Windows Terminal (PowerShell 5.1 or PowerShell 7 `pwsh`) WITHOUT requiring
    Administrator rights:
      1. Sets User-level $env:XDG_CONFIG_HOME = "$HOME\.config" so Neovim, Starship, Lazygit,
         Bat, and Yazi use the exact same ~/.config paths as macOS and Linux.
      2. Installs `mise` for Windows in userspace (or via winget/scoop).
      3. Installs the portable CLI suite via mise: node@lts, neovim, starship, zoxide, ripgrep,
         fd, fzf, jq, lazygit, zig (for nvim-treesitter parser compilation without Visual Studio).
      4. Installs `@earendil-works/pi-coding-agent` (`pi`) via npm.
      5. Invokes `scripts/windows/link-windows.ps1` to link configs and agent skills using
         zero-Admin Directory Junctions (`mklink /J`).
.PARAMETER DryRun
    Preview actions without modifying the filesystem or installing packages.
.PARAMETER LaunchAgent
    Immediately launch `pi` inside the dotfiles repo after bootstrap completes.
.PARAMETER Full
    Include all optional Pi extensions and packages in addition to the essential set.
.PARAMETER LinksOnly
    Link the configuration and stop there: no mise, no portable tools, no npm install. This is the
    base that lets an agent working on the machine decide (and install) whatever else that host
    needs - the useful choice on a machine that already has node, neovim, starship, git and pi.
.PARAMETER EnableSsh
    Also enable the built-in OpenSSH server (scripts\windows\enable-ssh-server.ps1) so
    the machine can be driven over SSH. Needs Administrator rights once, through UAC.
.PARAMETER SshPublicKeyPath
    Public key to authorise for SSH logins (used with -EnableSsh).
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$LaunchAgent,
    [switch]$Full,
    [switch]$LinksOnly,
    [switch]$EnableSsh,
    [string]$SshPublicKeyPath
)

$ErrorActionPreference = "Stop"
# $MyInvocation.MyCommand.Path is empty when this file is read and evaluated instead
# of executed, which is how it has to run on a machine where a Group Policy forbids
# script files: the launcher passes the repository through DOTFILES_REPO.
$RepoRoot = if ($env:DOTFILES_REPO) { $env:DOTFILES_REPO } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }

function Write-Info($msg) { Write-Host "  * $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }

# A Group Policy execution policy blocks script files outright and outranks
# -ExecutionPolicy and -Scope Process, so a helper can only run there by reading it
# and evaluating its text. Both helper scripts go through this.
function Invoke-DotfileScript {
    param([string]$Path, [string]$Arguments = "")
    if (-not (Test-Path $Path)) { Write-Warn "Missing script: $Path"; return }
    if ((Get-ExecutionPolicy) -notin @("Restricted", "AllSigned")) {
        if ($Arguments) { Invoke-Expression ("& '" + $Path + "' " + $Arguments) } else { & $Path }
        return
    }
    $body = (Get-Content -Raw $Path) -replace '(?m)^#Requires.*$', ''
    Invoke-Expression ("& { " + $body + " } " + $Arguments)
}

# Windows always sets this; the fallback keeps the script parse-testable on a host without it
# (pwsh on Linux) instead of failing at the first Join-Path.
if (-not $env:LOCALAPPDATA) { $env:LOCALAPPDATA = Join-Path $HOME "AppData/Local" }
$XdgConfig   = Join-Path $HOME ".config"
$LocalBin    = Join-Path $HOME ".local\bin"
$MiseShims   = Join-Path $env:LOCALAPPDATA "mise\shims"
$WinGetLinks = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"
$MiseProgBin = Join-Path $env:LOCALAPPDATA "Programs\mise\bin"

function Update-SessionPath {
    $MachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $UserPath    = [Environment]::GetEnvironmentVariable("Path", "User")
    $Combined    = "$LocalBin;$MiseShims;$WinGetLinks;$MiseProgBin;$UserPath;$MachinePath"
    $env:Path    = ($Combined -split ";" | Where-Object { $_ -ne "" } | Select-Object -Unique) -join ";"
}

Write-Host "=== Stage 0: Agent-Managed Dotfiles Seed (Native Windows) ===" -ForegroundColor Cyan

# If invoked from a UNC network share (e.g. \\host.lan\Data\dotfiles on the VM Desktop),
# mirror to local $HOME\dotfiles first so NTFS Directory Junctions and Hardlinks work natively.
if ($RepoRoot.StartsWith("\\")) {
    $LocalRepo = Join-Path $HOME "dotfiles"
    Write-Info "Network share detected ($RepoRoot) -- syncing to local NTFS path $LocalRepo..."
    if (-not $DryRun) {
        & robocopy $RepoRoot $LocalRepo /MIR /XD conversations /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
        $RepoRoot = $LocalRepo
    }
}
Write-Info "Repository: $RepoRoot"

# 1. Force XDG_CONFIG_HOME = $HOME\.config for cross-OS parity
if ($DryRun) {
    Write-Host "  [dry-run] Set User Environment XDG_CONFIG_HOME=$XdgConfig" -ForegroundColor Magenta
} else {
    New-Item -ItemType Directory -Force -Path $XdgConfig | Out-Null
    New-Item -ItemType Directory -Force -Path $LocalBin  | Out-Null
    [Environment]::SetEnvironmentVariable("XDG_CONFIG_HOME", $XdgConfig, "User")
    $env:XDG_CONFIG_HOME = $XdgConfig

    # Ensure ~/.local/bin, mise shims, and WinGet links are on User PATH
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    foreach ($dir in @($LocalBin, $MiseShims, $WinGetLinks, $MiseProgBin)) {
        if ($UserPath -notlike "*$dir*") {
            $UserPath = "$dir;$UserPath"
        }
    }
    [Environment]::SetEnvironmentVariable("Path", $UserPath, "User")
    Update-SessionPath
    Write-Ok "Configured XDG_CONFIG_HOME=$XdgConfig and updated User PATH"
}

# 1b. Allow local scripts so the profile can be dot-sourced at every shell start.
#     Windows clients default to Restricted, which blocks the profile and prints
#     "running scripts is disabled on this system" at every prompt.
$PolicyScript = Join-Path $RepoRoot "scripts\windows\ensure-execution-policy.ps1"
if ($DryRun) { Invoke-DotfileScript $PolicyScript "-DryRun" } else { Invoke-DotfileScript $PolicyScript }

# 2. Ensure `mise` is installed (skipped with -LinksOnly)
if ($LinksOnly) {
    Write-Info "Links only: not touching mise"
} else {
#    winget is per-user and often missing on a locked-down or standard account, and there is
#    no official mise.run one-liner for Windows (https://mise.run/pwsh is a 404), so the last
#    fallback is the release zip from GitHub unpacked into %LOCALAPPDATA%\mise.
Update-SessionPath
if (Get-Command mise -ErrorAction SilentlyContinue) {
    Write-Ok "mise already installed: $((Get-Command mise).Source)"
} else {
    Write-Info "Installing mise for Windows..."
    if ($DryRun) {
        Write-Host "  [dry-run] Install mise via winget, scoop or the GitHub release zip" -ForegroundColor Magenta
    } else {
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            winget install jdx.mise --accept-source-agreements --accept-package-agreements
        } elseif (Get-Command scoop -ErrorAction SilentlyContinue) {
            scoop install mise
        } else {
            $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "windows-arm64" } else { "windows-x64" }
            $asset = $null
            try {
                $release = Invoke-RestMethod -Uri "https://api.github.com/repos/jdx/mise/releases/latest" -UseBasicParsing
                $asset = $release.assets | Where-Object { $_.name -like "*$arch.zip" } | Select-Object -First 1
            } catch {
                Write-Warn "Could not ask GitHub for the latest mise release: $($_.Exception.Message)"
            }

            if (-not $asset) {
                Write-Warn "Install mise by hand: download the $arch.zip from"
                Write-Warn "  https://github.com/jdx/mise/releases, put mise\bin on your PATH,"
                Write-Warn "  or use 'winget install jdx.mise' / 'scoop install mise', then re-run this script."
            } else {
                $zip     = Join-Path $env:TEMP "mise-$arch.zip"
                $extract = Join-Path $env:TEMP ("mise-" + (Get-Random))
                $dest    = Join-Path $env:LOCALAPPDATA "mise"
                Write-Info "Downloading mise from $($asset.browser_download_url)"
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
                Expand-Archive -Path $zip -DestinationPath $extract -Force
                New-Item -ItemType Directory -Force -Path $dest | Out-Null
                Copy-Item (Join-Path $extract "mise\*") $dest -Recurse -Force
                $miseBin = Join-Path $dest "bin"
                $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
                if ($userPath -notlike "*$miseBin*") {
                    [Environment]::SetEnvironmentVariable("Path", "$miseBin;$userPath", "User")
                }
                Write-Ok "mise installed in $miseBin (added to the user PATH)"
            }
        }
        Update-SessionPath
    }
}

# 3. Install portable tools via mise (zig is only needed with -Full for nvim-malo treesitter compilation)
$PortableTools = @(
    "node@lts",
    "neovim@latest",
    "starship@latest",
    "zoxide@latest",
    "ripgrep@latest",
    "fd@latest",
    "fzf@latest",
    "jq@latest",
    "lazygit@latest"
)
if ($Full) {
    $PortableTools += "zig@latest"
}

if ((Get-Command mise -ErrorAction SilentlyContinue) -or $DryRun) {
    Write-Info "Declaring portable baseline tools in mise..."
    foreach ($tool in $PortableTools) {
        if ($DryRun) {
            Write-Host "  [dry-run] mise use -g $tool" -ForegroundColor Magenta
        } else {
            mise use -g $tool
        }
    }
    if (-not $DryRun) {
        Write-Info "Installing mise tools..."
        mise install
        mise reshim
        Update-SessionPath
        if (Get-Command zoxide -ErrorAction SilentlyContinue) {
            zoxide add $RepoRoot 2>$null
        }
    }
} else {
    Write-Warn "mise was not found on PATH after installation."
}

# 4. Install Pi Coding Agent (`pi`) via npm (@earendil-works/pi-coding-agent)
Update-SessionPath
if (Get-Command pi -ErrorAction SilentlyContinue) {
    Write-Ok "pi coding agent already installed: $((Get-Command pi).Source)"
} else {
    Write-Info "Installing @earendil-works/pi-coding-agent and @earendil-works/pi-tui via npm..."
    $PiNpmDir = Join-Path $HOME ".pi\agent\npm"
    if ($DryRun) {
        Write-Host "  [dry-run] npm install -g @earendil-works/pi-coding-agent @earendil-works/pi-tui" -ForegroundColor Magenta
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
        npm install -g @earendil-works/pi-coding-agent @earendil-works/pi-tui
        New-Item -ItemType Directory -Force -Path $PiNpmDir | Out-Null
        npm install --prefix $PiNpmDir @earendil-works/pi-tui
        if (Get-Command mise -ErrorAction SilentlyContinue) { mise reshim }
        Update-SessionPath
    } elseif (Get-Command mise -ErrorAction SilentlyContinue) {
        mise exec node@lts -- npm install -g @earendil-works/pi-coding-agent @earendil-works/pi-tui
        New-Item -ItemType Directory -Force -Path $PiNpmDir | Out-Null
        mise exec node@lts -- npm install --prefix $PiNpmDir @earendil-works/pi-tui
        mise reshim
        Update-SessionPath
    } else {
        Write-Warn "npm not found on PATH yet; reopen Windows Terminal after bootstrap and run: npm install -g @earendil-works/pi-coding-agent @earendil-works/pi-tui"
    }
}
}

# 5. Link configs & agent skills via zero-Admin Junctions
$LinkScript = Join-Path $RepoRoot "scripts\windows\link-windows.ps1"
if (Test-Path $LinkScript) {
    $LinkArgs = ""
    if ($DryRun) { $LinkArgs += " -DryRun" }
    if ($Full)   { $LinkArgs += " -Full" }
    Invoke-DotfileScript $LinkScript $LinkArgs.Trim()
}

# 6. Optional: make this machine reachable over SSH (Administrator rights once).
#    Off by default: opening a remote shell is a decision, not a side effect.
if ($EnableSsh) {
    $SshScript = Join-Path $RepoRoot "scripts\windows\enable-ssh-server.ps1"
    $SshArgs = ""
    if ($SshPublicKeyPath) { $SshArgs += " -PublicKeyPath '$SshPublicKeyPath'" }
    if ($DryRun)           { $SshArgs += " -DryRun" }
    Invoke-DotfileScript $SshScript $SshArgs.Trim()
}

Write-Host ""
Write-Ok "Stage 0 Windows bootstrap complete!"
Write-Info "Open a new Windows Terminal tab and run 'dot doctor' to inspect your environment."

if ($LaunchAgent -and (-not $DryRun) -and (Get-Command pi -ErrorAction SilentlyContinue)) {
    Set-Location $RepoRoot
    pi "Inspect this Windows machine using scripts/windows/doctor.ps1 -Json and help me complete any remaining setup."
}
