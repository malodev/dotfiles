#Requires -Version 5.1
<#
.SYNOPSIS
    Native Windows Doctor & Capability Sensor for Agent-Managed Dotfiles.
.PARAMETER Json
    Output structured JSON for LLM agents.
#>
[CmdletBinding()]
param([switch]$Json)

$RepoRoot = (Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..\..")).Path
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

$CoreTools = @("git", "mise", "nvim", "starship", "zoxide", "rg", "fd", "fzf", "jq", "lazygit", "nu", "pwsh", "zig")
$AgentTools = @("pi", "claude", "agy", "llm")

$ToolState = [ordered]@{}
foreach ($t in $CoreTools) {
    $ToolState[$t] = [bool](Get-Command $t -ErrorAction SilentlyContinue)
}

$AgentState = [ordered]@{}
foreach ($a in $AgentTools) {
    $cmd = Get-Command $a -ErrorAction SilentlyContinue
    $AgentState[$a] = if ($cmd) { $cmd.Source } else { $null }
}

function Get-LinkStatus([string]$Path) {
    if (-not (Test-Path $Path)) { return "absent" }
    $item = Get-Item $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { return "linked" }
    return "real-file-or-dir"
}

$IsWindowsHost = ($env:OS -eq "Windows_NT")
# .ToString() matters: ConvertTo-Json turns the ExecutionPolicy enum into its number
# (RemoteSigned would show up as 1).
$EffectivePolicy = if ($IsWindowsHost) { (Get-ExecutionPolicy).ToString() } else { "n/a" }
# Whether the profile can load depends on the persistent scopes, not on the effective
# policy of this process: a shell started with -ExecutionPolicy Bypass reports Bypass
# while every new shell is still Restricted.
$PersistentPolicy = if (-not $IsWindowsHost) { "n/a" } else {
    $p = Get-ExecutionPolicy -Scope CurrentUser
    if ($p -eq "Undefined") { (Get-ExecutionPolicy -Scope LocalMachine).ToString() } else { $p.ToString() }
}
$PolicyScopes = [ordered]@{}
if ($IsWindowsHost) {
    foreach ($scope in @("MachinePolicy", "UserPolicy", "CurrentUser", "LocalMachine", "Process")) {
        $PolicyScopes[$scope.ToLower()] = (Get-ExecutionPolicy -Scope $scope).ToString()
    }
}

$ProfileCanLoad = if (-not $IsWindowsHost) { $true } else {
    # Group Policy wins over the local scopes, so a RemoteSigned CurrentUser does not make
    # the profile loadable on a managed machine.
    $gpoBlocks = ((@($PolicyScopes['machinepolicy'], $PolicyScopes['userpolicy']) |
        Where-Object { $_ -ne 'Undefined' }) -join ' ') -match '=(Restricted|AllSigned)'
    if ($gpoBlocks) { $false } else { $PersistentPolicy -notin @("Restricted", "AllSigned", "Undefined") }
}

$Report = [ordered]@{
    repo = $RepoRoot
    platform = [ordered]@{
        os = "windows"
        distro = "windows"
        arch = $env:PROCESSOR_ARCHITECTURE
        is_wsl = $false
        is_ssh = [bool]$env:SSH_CONNECTION
        has_gui = $true
        sudo = if ($IsAdmin) { "true" } else { "false" }
        xdg_config_home = $env:XDG_CONFIG_HOME
        recommended_profile = "workstation-windows"
    }
    tools = $ToolState
    agents = $AgentState
    links = [ordered]@{
        nvim_xdg = Get-LinkStatus (Join-Path $HOME ".config\nvim")
        nvim_appdata = if ($env:LOCALAPPDATA) { Get-LinkStatus (Join-Path $env:LOCALAPPDATA "nvim") } else { "absent" }
        starship = Get-LinkStatus (Join-Path $HOME ".config\starship.toml")
        nushell = Get-LinkStatus (Join-Path $HOME ".config\nushell")
        pwsh_profile = if ($PROFILE) { Get-LinkStatus $PROFILE } else { "absent" }
    }
    execution_policy = [ordered]@{
        effective = $EffectivePolicy
        persistent = $PersistentPolicy
        profile_can_load = $ProfileCanLoad
        scopes = $PolicyScopes
    }
}

if ($Json) {
    $Report | ConvertTo-Json -Depth 5
    exit 0
}

Write-Host "=== Dotfiles Doctor (Windows) ===" -ForegroundColor Cyan
Write-Host "  Repository:      $RepoRoot"
Write-Host "  XDG_CONFIG_HOME: $($env:XDG_CONFIG_HOME)"
Write-Host "  Admin Rights:    $IsAdmin"
Write-Host ""
Write-Host "=== Toolchain ===" -ForegroundColor Cyan
foreach ($k in $ToolState.Keys) {
    $mark = if ($ToolState[$k]) { "[OK]" } else { "[!]" }
    Write-Host ("  {0,-4} {1,-12} {2}" -f $mark, $k, $ToolState[$k])
}
Write-Host ""
Write-Host "=== Links ===" -ForegroundColor Cyan
foreach ($k in $Report.links.Keys) {
    Write-Host ("  {0,-16} {1}" -f $k, $Report.links[$k])
}
Write-Host ""
Write-Host "=== Execution Policy ===" -ForegroundColor Cyan
Write-Host ("  Effective:       {0} (this process)" -f $EffectivePolicy)
Write-Host ("  For new shells:  {0}" -f $PersistentPolicy)
Write-Host ("  Profile loads:   {0}" -f $ProfileCanLoad)
if (-not $ProfileCanLoad) {
    Write-Host "  [!] The PowerShell profile cannot load. Run" -ForegroundColor Yellow
    Write-Host "      scripts\windows\ensure-execution-policy.ps1, or: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned" -ForegroundColor Yellow
}
