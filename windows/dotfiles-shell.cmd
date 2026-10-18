@echo off
rem=============================================================================
rem dotfiles-shell.cmd - Windows Terminal entry point that always works.
rem
rem A default Windows client (and every machine where a Group Policy sets the
rem execution policy) refuses to load $PROFILE:
rem
rem   . : File ...\Microsoft.PowerShell_profile.ps1 cannot be loaded because
rem   running scripts is disabled on this system.
rem
rem The execution policy governs script FILES. An inline command is not a script
rem file, so reading the profile and evaluating its text loads the same
rem configuration with no policy involved - and it behaves identically on
rem machines where scripts are allowed.
rem
rem Point the PowerShell profiles in Windows Terminal at this file, or run it
rem directly. Launcher installed to %USERPROFILE%\.local\bin by
rem scripts\windows\ensure-execution-policy.ps1.
rem=============================================================================
setlocal
where pwsh.exe >nul 2>nul
if %ERRORLEVEL%==0 goto use_pwsh
powershell.exe -NoLogo -NoProfile -NoExit -Command "iex (Get-Content -Raw $PROFILE)"
goto :eof

:use_pwsh
pwsh.exe -NoLogo -NoProfile -NoExit -Command "iex (Get-Content -Raw $PROFILE)"
