#Requires -Version 5.1
<#
.SYNOPSIS
    Zero-Admin Native Windows Dotfiles & Agent Skill Linker.
.DESCRIPTION
    Replaces GNU Stow and link-pi-agent-entries.sh on native Windows:
      - Uses Windows Directory Junctions (`New-Item -ItemType Junction` / `mklink /J`),
        which require ZERO Administrator privileges or Developer Mode, for directories:
          * nvim-malo/.config/nvim-malo -> ~/.config/nvim, ~/.config/nvim-malo, %LOCALAPPDATA%\nvim
          * nushell/.config/nushell     -> ~/.config/nushell, %APPDATA%\nushell
          * pi/.pi/agent/extensions     -> ~/.pi/agent/extensions
          * pi/.pi/agent/skills/*       -> ~/.agents/skills/*, ~/.claude/skills/*, ~/.pi/agent/skills/*
      - Uses Hardlinks (or copies with backup) for standalone files:
          * starship/.config/starship.toml
          * windows/powershell/Microsoft.PowerShell_profile.ps1 -> $PROFILE
          * pi/.pi/agent/*.json.template -> ~/.pi/agent/*.json (seed-only, never overwrites live state)
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Force,
    [switch]$Full
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..\..")).Path

$LocalOnlyEntries = @(
    "skills/diagnose-crash",
    "skills/omarchy",
    "skills/omarchy-app",
    "extensions/mlxmon.ts",
    "extensions/vllm-mlx.ts"
)

$PiOnlySkills = @(
    "init-three-agent-team",
    "pi-skill-creator",
    "team-amend-contracts",
    "team-from-plan"
)

$OptionalExtensions = @(
    "foreman",
    "herdr-agent-state.ts",
    "herdr-subagent-state.ts",
    "omarchy-system-theme.ts",
    "task-forge",
    "three-agent-team"
)

function Write-Info($msg) { Write-Host "  * $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }

function Set-DirectoryJunction {
    param([string]$Source, [string]$Target)
    if (-not (Test-Path $Source)) {
        Write-Warn "Source missing, skipping: $Source"
        return
    }
    $ParentDir = Split-Path -Parent $Target
    if (-not $DryRun -and -not (Test-Path $ParentDir)) {
        New-Item -ItemType Directory -Force -Path $ParentDir | Out-Null
    }

    if (Test-Path $Target) {
        $item = Get-Item $Target -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            if ($DryRun) {
                Write-Host "  [dry-run] relink junction $Target -> $Source" -ForegroundColor Magenta
                return
            }
            # Safe to remove existing junction/symlink without deleting target contents
            cmd /c rmdir "$Target" | Out-Null
        } elseif ($Force) {
            $bak = "$Target.bak-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
            if ($DryRun) {
                Write-Host "  [dry-run] backup $Target -> $bak" -ForegroundColor Magenta
            } else {
                Move-Item -Path $Target -Destination $bak
                Write-Warn "Backed up existing directory to $bak"
            }
        } else {
            Write-Info "keep     $Target (real directory exists; pass -Force to backup & replace)"
            return
        }
    }

    if ($DryRun) {
        Write-Host "  [dry-run] junction $Target -> $Source" -ForegroundColor Magenta
    } else {
        New-Item -ItemType Junction -Path $Target -Target $Source | Out-Null
        Write-Ok "linked   $Target -> $Source"
    }
}

function Set-FileLinkOrCopy {
    param([string]$Source, [string]$Target, [switch]$SeedOnly)
    if (-not (Test-Path $Source)) { return }
    $ParentDir = Split-Path -Parent $Target
    if (-not $DryRun -and -not (Test-Path $ParentDir)) {
        New-Item -ItemType Directory -Force -Path $ParentDir | Out-Null
    }

    if (Test-Path $Target) {
        if ($SeedOnly -and (-not $Force)) {
            Write-Info "seed-ok  $Target (already exists)"
            return
        }
    }

    if ($DryRun) {
        Write-Host "  [dry-run] file-sync $Target <- $Source" -ForegroundColor Magenta
        return
    }

    if ($SeedOnly) {
        Copy-Item -Path $Source -Destination $Target -Force
        Write-Ok "seeded   $Target"
    } else {
        # Prefer hardlink when on the same volume so repo edits reflect live without Admin rights
        try {
            if (Test-Path $Target) { Remove-Item $Target -Force }
            New-Item -ItemType HardLink -Path $Target -Target $Source -ErrorAction Stop | Out-Null
            Write-Ok "hardlink $Target -> $Source"
        } catch {
            Copy-Item -Path $Source -Destination $Target -Force
            Write-Ok "copied   $Target <- $Source"
        }
    }
}

Write-Host "=== Windows Dotfiles & Agent Skill Linker ===" -ForegroundColor Cyan

# 1. Core Editor & Shell Directory Junctions
#    Default to lightweight `nvim-lite` for fast zero-compile startup; use `nvim-malo` when -Full is passed.
$NvimLiteSrc    = Join-Path $RepoRoot "nvim-lite\.config\nvim-lite"
$NvimMaloSrc    = Join-Path $RepoRoot "nvim-malo\.config\nvim-malo"
$DefaultNvimSrc = if ($Full) { $NvimMaloSrc } else { $NvimLiteSrc }

Set-DirectoryJunction -Source $NvimLiteSrc    -Target (Join-Path $HOME ".config\nvim-lite")
Set-DirectoryJunction -Source $NvimMaloSrc    -Target (Join-Path $HOME ".config\nvim-malo")
Set-DirectoryJunction -Source $DefaultNvimSrc -Target (Join-Path $HOME ".config\nvim")
if ($env:LOCALAPPDATA) {
    Set-DirectoryJunction -Source $DefaultNvimSrc -Target (Join-Path $env:LOCALAPPDATA "nvim")
}

$NushellSrc = Join-Path $RepoRoot "nushell\.config\nushell"
Set-DirectoryJunction -Source $NushellSrc -Target (Join-Path $HOME ".config\nushell")
if ($env:APPDATA) {
    Set-DirectoryJunction -Source $NushellSrc -Target (Join-Path $env:APPDATA "nushell")
}

# 2. Starship, Pi Configs, & PowerShell Profile
Set-FileLinkOrCopy -Source (Join-Path $RepoRoot "starship\.config\starship.toml") -Target (Join-Path $HOME ".config\starship.toml")
Set-FileLinkOrCopy -Source (Join-Path $RepoRoot "pi\.pi\agent\AGENTS.md") -Target (Join-Path $HOME ".pi\agent\AGENTS.md")
Set-FileLinkOrCopy -Source (Join-Path $RepoRoot "pi\.pi\agent\pi-sub-bar-settings.json") -Target (Join-Path $HOME ".pi\agent\pi-sub-bar-settings.json")
Set-FileLinkOrCopy -Source (Join-Path $RepoRoot "pi\.config\pi-three-agent-team\config.json") -Target (Join-Path $HOME ".config\pi-three-agent-team\config.json")
Set-FileLinkOrCopy -Source (Join-Path $RepoRoot "pi\.config\pi-inference\client.json") -Target (Join-Path $HOME ".config\pi-inference\client.json")
Set-FileLinkOrCopy -Source (Join-Path $RepoRoot "pi\.config\pi\web-search.json") -Target (Join-Path $HOME ".config\pi\web-search.json")

# The profile is dot-sourced at every shell start, so the execution policy has to
# allow local unsigned scripts or Windows PowerShell reports "running scripts is
# disabled on this system" before any of this config is read.
$PolicyScript = Join-Path $RepoRoot "scripts\windows\ensure-execution-policy.ps1"
if (Test-Path $PolicyScript) {
    if ($DryRun) { & $PolicyScript -DryRun } else { & $PolicyScript }
}

$PwshProfileSrc = Join-Path $RepoRoot "windows\powershell\Microsoft.PowerShell_profile.ps1"
if ($PROFILE) {
    Set-FileLinkOrCopy -Source $PwshProfileSrc -Target $PROFILE
}
# Also ensure PowerShell 7 profile path is linked even if invoked from Windows PowerShell 5.1
$DocsDir = [Environment]::GetFolderPath("MyDocuments")
if ($DocsDir) {
    Set-FileLinkOrCopy -Source $PwshProfileSrc -Target (Join-Path $DocsDir "PowerShell\Microsoft.PowerShell_profile.ps1")
}

# 3. Seed Pi Agent JSON templates (settings, keybindings, models, mcp)
$SettingsTemplate = if ($Full) { "settings-full.json.template" } else { "settings.json.template" }
Set-FileLinkOrCopy -Source (Join-Path $RepoRoot "pi\.pi\agent\$SettingsTemplate") -Target (Join-Path $HOME ".pi\agent\settings.json") -SeedOnly
foreach ($tpl in @("keybindings", "models", "mcp")) {
    $src = Join-Path $RepoRoot "pi\.pi\agent\$tpl.json.template"
    $dst = Join-Path $HOME ".pi\agent\$tpl.json"
    Set-FileLinkOrCopy -Source $src -Target $dst -SeedOnly
}

# 4. Link Pi Extensions (essential by default; optional with -Full)
$ExtSrcDir = Join-Path $RepoRoot "pi\.pi\agent\extensions"
$ExtDstDir = Join-Path $HOME ".pi\agent\extensions"
if (Test-Path $ExtSrcDir) {
    Get-ChildItem -Path $ExtSrcDir | ForEach-Object {
        $extName = $_.Name
        if ($extName -eq ".DS_Store") { return }
        $rel = "extensions/$extName"
        if ($LocalOnlyEntries -contains $rel) { return }
        if ((-not $Full) -and ($OptionalExtensions -contains $extName)) {
            Write-Info "skip     $rel (optional extension; pass -Full to include)"
            return
        }
        $dst = Join-Path $ExtDstDir $extName
        if ($_.PSIsContainer) {
            Set-DirectoryJunction -Source $_.FullName -Target $dst
        } else {
            Set-FileLinkOrCopy -Source $_.FullName -Target $dst
        }
    }
}

# 5. Link Agent Skills across ~/.agents/skills, ~/.claude/skills, and ~/.pi/agent/skills
$SkillsSrcDir  = Join-Path $RepoRoot "pi\.pi\agent\skills"
$SharedSkills  = Join-Path $HOME ".agents\skills"
$ClaudeSkills  = Join-Path $HOME ".claude\skills"
$PiSkills      = Join-Path $HOME ".pi\agent\skills"

if (Test-Path $SkillsSrcDir) {
    Get-ChildItem -Path $SkillsSrcDir -Directory | ForEach-Object {
        $skillName = $_.Name
        $rel = "skills/$skillName"
        if ($LocalOnlyEntries -contains $rel) {
            Write-Info "skip     $rel (Unix/Omarchy local-only)"
            return
        }
        if ($PiOnlySkills -contains $skillName) {
            Set-DirectoryJunction -Source $_.FullName -Target (Join-Path $PiSkills $skillName)
        } else {
            Set-DirectoryJunction -Source $_.FullName -Target (Join-Path $SharedSkills $skillName)
            Set-DirectoryJunction -Source $_.FullName -Target (Join-Path $ClaudeSkills $skillName)
        }
    }
}

# 6. Link Matt Pocock skills if submodule is present
$MattSkillsDir = Join-Path $RepoRoot "pi\mattpocock-skills"
if (Test-Path $MattSkillsDir) {
    Get-ChildItem -Path $MattSkillsDir -Directory | Where-Object {
        $_.Name -notin @(".git", ".github", "scripts") -and (Test-Path (Join-Path $_.FullName "SKILL.md"))
    } | ForEach-Object {
        $skillName = $_.Name
        Set-DirectoryJunction -Source $_.FullName -Target (Join-Path $SharedSkills $skillName)
        Set-DirectoryJunction -Source $_.FullName -Target (Join-Path $ClaudeSkills $skillName)
    }
}

# 7. Seed Windows Terminal settings.json if Windows Terminal is installed and user requests or doesn't have one
$WtTemplate = Join-Path $RepoRoot "windows\windows-terminal\settings.json.template"
if ($env:LOCALAPPDATA -and (Test-Path $WtTemplate)) {
    $WtPkgs = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Packages") -Filter "Microsoft.WindowsTerminal*" -Directory -ErrorAction SilentlyContinue
    foreach ($pkg in $WtPkgs) {
        $WtSettings = Join-Path $pkg.FullName "LocalState\settings.json"
        Set-FileLinkOrCopy -Source $WtTemplate -Target $WtSettings -SeedOnly
    }
}
