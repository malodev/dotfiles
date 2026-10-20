# dot.ps1 - run `dot` (a function in $PROFILE) from a process that loaded no profile.
#
# dot.cmd calls this with -File, so cmd.exe gets `dot doctor` and `dot deploy ...` too.
# -NoProfile is deliberate there, so the profile is loaded here, on purpose.
if (Test-Path $PROFILE) {
    # A script file cannot be dot-sourced when the execution policy is Restricted, so read the
    # text and evaluate it: the same policy-proof trick as windows\dotfiles-shell.cmd.
    if ((Get-ExecutionPolicy) -notin @('Restricted', 'AllSigned')) {
        . $PROFILE
    } else {
        Invoke-Expression ((Get-Content -Raw $PROFILE) -replace '(?m)^#Requires.*$', '')
    }
}
if (-not (Get-Command dot -ErrorAction SilentlyContinue)) {
    Write-Warning "No 'dot' function after loading $PROFILE; run scripts\windows\link-windows.ps1 -DryRun."
    exit 1
}
dot @args
exit $LASTEXITCODE
