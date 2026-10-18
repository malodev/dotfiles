#Requires -Version 5.1
<#
.SYNOPSIS
    Make the PowerShell profile loadable on a default Windows client.
.DESCRIPTION
    Every shell start dot-sources $PROFILE, so the machine needs an execution policy
    that allows local unsigned scripts. Windows clients default to `Restricted`, and
    the profile then fails at every prompt with:

        . : File ...\Microsoft.PowerShell_profile.ps1 cannot be loaded because
        running scripts is disabled on this system.

    This sets RemoteSigned for the current user, which needs no administrator rights
    and still blocks unsigned scripts downloaded from the internet. A Group Policy
    scope (MachinePolicy/UserPolicy) outranks it, so that case only warns: the shell
    has to be started with -ExecutionPolicy Bypass, or IT has to lift the policy.

    Called by bootstrap.ps1 and link-windows.ps1, and safe to run on its own. On a
    non-Windows host it does nothing.
.PARAMETER DryRun
    Report what would change without touching the policy.
#>
[CmdletBinding()]
param([switch]$DryRun)

$ErrorActionPreference = "Stop"

function Write-Info($msg) { Write-Host "  * $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }

if ($env:OS -ne "Windows_NT") {
    Write-Info "Not a Windows host: execution policy left untouched"
    exit 0
}

$blocking = @("Restricted", "AllSigned")
$current  = Get-ExecutionPolicy

if ($current -notin $blocking) {
    Write-Ok "Execution policy already allows local scripts ($current)"
    exit 0
}

$managed = @()
foreach ($scope in @("MachinePolicy", "UserPolicy")) {
    $value = Get-ExecutionPolicy -Scope $scope
    if ($value -ne "Undefined") { $managed += "$scope=$value" }
}

if ($managed.Count -gt 0) {
    Write-Warn "Execution policy is managed by Group Policy ($($managed -join ', '))"
    Write-Warn "  The profile cannot load. Ask IT, or start the shell with -ExecutionPolicy Bypass."
    exit 1
}

if ($DryRun) {
    Write-Info "[dry-run] Set-ExecutionPolicy -Scope CurrentUser RemoteSigned (currently $current)"
    exit 0
}

try {
    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force -ErrorAction Stop
    Write-Ok "Execution policy set to RemoteSigned for this user (was $current), so the profile loads"
} catch {
    Write-Warn "Could not set the execution policy: $($_.Exception.Message)"
    Write-Warn "  Run it by hand: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned"
    exit 1
}

exit 0
