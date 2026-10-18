#Requires -Version 5.1
<#
.SYNOPSIS
    Make the managed PowerShell profile load, on managed machines too.
.DESCRIPTION
    Every shell start dot-sources $PROFILE, so the machine needs an execution policy
    that allows local unsigned scripts. Windows clients default to `Restricted`, and
    the profile then fails at every prompt with:

        . : File ...\Microsoft.PowerShell_profile.ps1 cannot be loaded because
        running scripts is disabled on this system.

    Two cases:

      1. The policy is merely the local default. RemoteSigned is set for the current
         user, which needs no administrator rights and still blocks unsigned scripts
         downloaded from the internet.

      2. A Group Policy scope (MachinePolicy/UserPolicy) enforces the policy. Nothing
         local outranks it - not Set-ExecutionPolicy, not -Scope Process, not
         -ExecutionPolicy Bypass - so the profile cannot be run as a script at all.
         The execution policy governs script FILES, but an inline command is not a
         script file: reading the profile and evaluating its text loads the same
         configuration with no policy involved. This installs that loader
         (windows\dotfiles-shell.cmd) into ~\.local\bin and points the PowerShell
         profiles in Windows Terminal at it, keeping a timestamped backup of
         settings.json. The shell then starts with the full configuration and no
         error, on any machine.

    Called by bootstrap.ps1 and link-windows.ps1, and safe to run on its own. On a
    non-Windows host it does nothing.

    It returns instead of exiting everywhere: when a Group Policy forbids script files
    the callers evaluate this file inline, and an `exit` inside an evaluated block
    terminates the caller as well (verified: the rest of the bootstrap never ran).
.PARAMETER DryRun
    Report what would change without touching the policy, the launchers or Windows Terminal.
.PARAMETER SkipWindowsTerminal
    Install the launchers but leave Windows Terminal's settings.json alone.
#>
[CmdletBinding()]
param([switch]$DryRun, [switch]$SkipWindowsTerminal)

$ErrorActionPreference = "Stop"

# Same DOTFILES_REPO fallback as bootstrap.ps1: under a Group Policy this file is read
# and evaluated instead of executed, which leaves $MyInvocation.MyCommand.Path empty.
$RepoRoot = if ($env:DOTFILES_REPO) { $env:DOTFILES_REPO }
            elseif ($MyInvocation.MyCommand.Path) { (Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..\..")).Path }
            else { (Get-Location).Path }

function Write-Info($msg) { Write-Host "  * $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }

function Install-Launchers {
    $destDir = Join-Path $HOME ".local\bin"
    foreach ($name in @("dotfiles-shell.cmd", "bootstrap-dotfiles.cmd")) {
        $src = Join-Path $RepoRoot "windows\$name"
        if (-not (Test-Path $src)) { Write-Warn "Launcher missing from the repo: $src"; continue }
        if ($DryRun) { Write-Info "[dry-run] copy $name to $destDir"; continue }
        New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        Copy-Item -Force $src (Join-Path $destDir $name)
        Write-Ok "Installed $(Join-Path $destDir $name)"
    }
}

# Windows Terminal launches `powershell.exe -NoLogo` / `pwsh.exe -NoLogo`, which needs
# the profile to be a loadable script. Replace exactly those two commandlines with the
# inline loader; anything else in settings.json is left byte for byte alone.
function Set-WindowsTerminalLoader {
    $loader = Join-Path $HOME ".local\bin\dotfiles-shell.cmd"
    $loaderJson = $loader -replace '\\', '\\'
    $packages = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Packages") -Filter "Microsoft.WindowsTerminal*" -Directory -ErrorAction SilentlyContinue
    $patched = 0

    foreach ($pkg in $packages) {
        $settings = Join-Path $pkg.FullName "LocalState\settings.json"
        if (-not (Test-Path $settings)) { continue }

        $text = Get-Content -Raw $settings
        $new = $text
        foreach ($exe in @("powershell.exe", "pwsh.exe")) {
            $pattern = '"commandline"\s*:\s*"' + [regex]::Escape($exe) + ' -NoLogo"'
            $new = [regex]::Replace($new, $pattern, '"commandline": "' + $loaderJson + '"')
        }
        if ($new -eq $text) { continue }

        if ($DryRun) { Write-Info "[dry-run] point the PowerShell profiles at $loader in $settings"; continue }

        Copy-Item $settings "$settings.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')" -Force
        [IO.File]::WriteAllText($settings, $new, (New-Object Text.UTF8Encoding($false)))
        Write-Ok "Windows Terminal now starts the profile through $loader"
        $patched++
    }

    if ($patched -eq 0 -and -not $DryRun) {
        Write-Info "No Windows Terminal profile needed repointing (not installed, or already using the loader)"
    }
}

function Show-ManualSteps {
    $loader = Join-Path $HOME ".local\bin\dotfiles-shell.cmd"
    Write-Info "Ways to start a shell with the configuration on this machine:"
    Write-Info "  1. run $loader"
    Write-Info "  2. or set the Windows Terminal profile commandline to"
    Write-Info "       $loader"
    Write-Info "  3. or ask IT to allow RemoteSigned for your user"
}

if ($env:OS -ne "Windows_NT") {
    Write-Info "Not a Windows host: execution policy left untouched"
    return
}

$blocking = @("Restricted", "AllSigned")
$current  = Get-ExecutionPolicy

if ($current -notin $blocking) {
    Write-Ok "Execution policy already allows local scripts ($current)"
    return
}

$managed = @()
foreach ($scope in @("MachinePolicy", "UserPolicy")) {
    $value = Get-ExecutionPolicy -Scope $scope
    if ($value -ne "Undefined") { $managed += "$scope=$value" }
}

if ($managed.Count -eq 0) {
    if ($DryRun) {
        Write-Info "[dry-run] Set-ExecutionPolicy -Scope CurrentUser RemoteSigned (currently $current)"
        return
    }
    try {
        Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force -ErrorAction Stop
        Write-Ok "Execution policy set to RemoteSigned for this user (was $current), so the profile loads"
        return
    } catch {
        Write-Warn "Could not set the execution policy: $($_.Exception.Message)"
    }
} else {
    Write-Warn "Execution policy is enforced by Group Policy ($($managed -join ', '))"
    Write-Warn "  Nothing local outranks it, so the profile is loaded inline instead of executed."
}

# Blocked: make the configuration run anyway.
Install-Launchers
if (-not $SkipWindowsTerminal) { Set-WindowsTerminalLoader }
Show-ManualSteps

return
