#=============================================================================
# Microsoft.PowerShell_profile.ps1
#
# Managed PowerShell profile for Windows Terminal.
# Forces XDG_CONFIG_HOME=$HOME\.config so Neovim, Starship, Lazygit, Bat, and
# Yazi share the exact same configuration paths as macOS and Linux.
#=============================================================================

$env:XDG_CONFIG_HOME = Join-Path $HOME ".config"
$LocalBin    = Join-Path $HOME ".local\bin"
$MiseShims   = Join-Path $env:LOCALAPPDATA "mise\shims"
$WinGetLinks = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"
$MiseProgBin = Join-Path $env:LOCALAPPDATA "Programs\mise\bin"

foreach ($p in @($LocalBin, $MiseShims, $WinGetLinks, $MiseProgBin)) {
    if ((Test-Path $p) -and ($env:Path -notlike "*$p*")) {
        $env:Path = "$p;$env:Path"
    }
}

# Activate mise if available
if (Get-Command mise -ErrorAction SilentlyContinue) {
    mise activate pwsh | Out-String | Invoke-Expression
}

# Initialize Starship prompt
if (Get-Command starship -ErrorAction SilentlyContinue) {
    Invoke-Expression (&starship init powershell)
}

# Initialize zoxide if available
if (Get-Command zoxide -ErrorAction SilentlyContinue) {
    Invoke-Expression (& { (zoxide init powershell | Out-String) })
}

# PSReadLine ergonomic defaults
if (Get-Module -ListAvailable -Name PSReadLine) {
    Set-PSReadLineOption -EditMode Vi -BellStyle None
    Set-PSReadLineKeyHandler -Key UpArrow -Function HistorySearchBackward
    Set-PSReadLineKeyHandler -Key DownArrow -Function HistorySearchForward
    Set-PSReadLineKeyHandler -Key Tab -Function MenuComplete
}

# Neovim & navigation aliases matching Unix dotfiles
if (Get-Command nvim -ErrorAction SilentlyContinue) {
    Set-Alias -Name v -Value nvim
    Set-Alias -Name vi -Value nvim
    Set-Alias -Name vim -Value nvim
    $env:EDITOR = "nvim"
    $env:VISUAL = "nvim"
}
if (Get-Command lazygit -ErrorAction SilentlyContinue) {
    Set-Alias -Name lg -Value lazygit
}

# Universal `dot` CLI entrypoint for Windows PowerShell
function dot {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ArgsList)
    $DotRepo = if ($env:DOTFILES_REPO -and (Test-Path $env:DOTFILES_REPO)) {
        $env:DOTFILES_REPO
    } elseif (Test-Path (Join-Path $HOME "dotfiles")) {
        Join-Path $HOME "dotfiles"
    } else {
        Join-Path $HOME ".dotfiles"
    }

    $cmd = if ($ArgsList.Count -gt 0) { $ArgsList[0] } else { "doctor" }
    $rest = if ($ArgsList.Count -gt 1) { $ArgsList[1..($ArgsList.Count - 1)] } else { @() }

    switch ($cmd) {
        "doctor" {
            if ($rest -contains "--json" -or $rest -contains "-Json") {
                & (Join-Path $DotRepo "scripts\windows\doctor.ps1") -Json
            } else {
                & (Join-Path $DotRepo "scripts\windows\doctor.ps1")
            }
        }
        "bootstrap" {
            & (Join-Path $DotRepo "bootstrap.ps1") @rest
        }
        { $_ -in @("link", "sync") } {
            & (Join-Path $DotRepo "scripts\windows\link-windows.ps1") @rest
        }
        "status" {
            git -C $DotRepo status @rest
        }
        "cd" {
            Set-Location $DotRepo
        }
        "agent" {
            Push-Location $DotRepo
            try {
                $docJson = & (Join-Path $DotRepo "scripts\windows\doctor.ps1") -Json | Out-String
                $prompt = ($rest -join " ")
                if (Get-Command pi -ErrorAction SilentlyContinue) {
                    if ($prompt) {
                        pi "Current Windows machine state from 'dot doctor --json': $docJson. Task: $prompt"
                    } else {
                        pi
                    }
                } elseif (Get-Command claude -ErrorAction SilentlyContinue) {
                    if ($prompt) {
                        claude "Current Windows machine state from 'dot doctor --json': $docJson. Task: $prompt"
                    } else {
                        claude
                    }
                } else {
                    Write-Warning "No agent CLI (pi, claude) found on PATH. Run 'dot bootstrap' first."
                }
            } finally {
                Pop-Location
            }
        }
        default {
            dot agent $cmd @rest
        }
    }
}

# Source machine-local PowerShell overrides if present
$LocalProfile = Join-Path (Split-Path -Parent $PROFILE) "Microsoft.PowerShell_profile_local.ps1"
if (Test-Path $LocalProfile) {
    . $LocalProfile
}
# >>> END MANAGED CONFIG <<<
