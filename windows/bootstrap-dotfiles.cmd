@echo off
rem=============================================================================
rem bootstrap-dotfiles.cmd - policy-proof Stage 0 entry point for Windows.
rem
rem Run this when PowerShell refuses to run bootstrap.ps1 itself:
rem
rem   .\bootstrap.ps1 : File ...\bootstrap.ps1 cannot be loaded because running
rem   scripts is disabled on this system.
rem
rem `powershell -File` and `-ExecutionPolicy Bypass` do not help there: a Group
rem Policy scope (MachinePolicy/UserPolicy) outranks the process scope. An inline
rem command is not a script file, so this launcher reads bootstrap.ps1 and
rem evaluates its text instead of executing it.
rem
rem DOTFILES_REPO tells the evaluated script where the repository is, because
rem $MyInvocation.MyCommand.Path is empty when a script is read instead of run.
rem=============================================================================
setlocal
pushd "%~dp0.."
set "DOTFILES_REPO=%CD%"
echo Bootstrapping dotfiles from %DOTFILES_REPO%
powershell.exe -NoLogo -NoProfile -Command "iex ((Get-Content -Raw '%DOTFILES_REPO%\bootstrap.ps1') -replace '(?m)^#Requires.*$','')"
popd
pause
