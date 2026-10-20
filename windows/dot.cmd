@echo off
rem=============================================================================
rem dot.cmd - run `dot` from cmd.exe.
rem
rem `dot` is a PowerShell function in $PROFILE, and cmd.exe never loads a
rem profile: `dot doctor` looks for a program named dot on PATH and finds
rem nothing. This forwards every argument to dot.ps1, which loads the profile
rem the same policy-proof way windows\dotfiles-shell.cmd does.
rem
rem Installed to %USERPROFILE%\.local\bin by
rem scripts\windows\ensure-execution-policy.ps1, which is how it ends up on PATH.
rem=============================================================================
setlocal
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0dot.ps1" %*
exit /b %ERRORLEVEL%
