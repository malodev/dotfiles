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
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$LaunchAgent,
    [switch]$Full
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Info($msg) { Write-Host "  * $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }

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
if (Test-Path $PolicyScript) {
    if ($DryRun) { & $PolicyScript -DryRun } else { & $PolicyScript }
}

# 2. Ensure `mise` is installed
Update-SessionPath
if (Get-Command mise -ErrorAction SilentlyContinue) {
    Write-Ok "mise already installed: $((Get-Command mise).Source)"
} else {
    Write-Info "Installing mise for Windows..."
    if ($DryRun) {
        Write-Host "  [dry-run] Install mise via winget or https://mise.run/pwsh" -ForegroundColor Magenta
    } else {
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            winget install jdx.mise --accept-source-agreements --accept-package-agreements
        } elseif (Get-Command scoop -ErrorAction SilentlyContinue) {
            scoop install mise
        } else {
            Invoke-RestMethod https://mise.run/pwsh | Invoke-Expression
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

# 5. Link configs & agent skills via zero-Admin Junctions
$LinkScript = Join-Path $RepoRoot "scripts\windows\link-windows.ps1"
if (Test-Path $LinkScript) {
    $LinkArgs = @{}
    if ($DryRun) { $LinkArgs["DryRun"] = $true }
    if ($Full)   { $LinkArgs["Full"]   = $true }
    & $LinkScript @LinkArgs
}

Write-Host ""
Write-Ok "Stage 0 Windows bootstrap complete!"
Write-Info "Open a new Windows Terminal tab and run 'dot doctor' to inspect your environment."

if ($LaunchAgent -and (-not $DryRun) -and (Get-Command pi -ErrorAction SilentlyContinue)) {
    Set-Location $RepoRoot
    pi "Inspect this Windows machine using scripts/windows/doctor.ps1 -Json and help me complete any remaining setup."
}
