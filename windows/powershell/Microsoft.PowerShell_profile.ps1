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

# Activate mise if available. Its chpwd hook (switching tool versions when the directory
# changes) needs PowerShell 7, and on Windows PowerShell 5.1 mise prints a warning at every
# single shell start: silence it there only, so a pwsh 7 session keeps the feature.
if (Get-Command mise -ErrorAction SilentlyContinue) {
    if ($PSVersionTable.PSVersion.Major -lt 7) { $env:MISE_PWSH_CHPWD_WARNING = "0" }
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
        "nvim" {
            $mode = if ($rest.Count -gt 0) { $rest[0] } else { "status" }
            $liteSrc = Join-Path $DotRepo "nvim-lite\.config\nvim-lite"
            $maloSrc = Join-Path $DotRepo "nvim-malo\.config\nvim-malo"
            $xdgNvim = Join-Path $HOME ".config\nvim"
            $appNvim = Join-Path $env:LOCALAPPDATA "nvim"
            if ($mode -in @("lite", "minimal")) {
                foreach ($t in @($xdgNvim, $appNvim)) {
                    if (Test-Path $t) { cmd /c rmdir "$t" 2>$null }
                    New-Item -ItemType Junction -Path $t -Target $liteSrc | Out-Null
                }
                Write-Host "  [OK] Default Neovim config set to nvim-lite" -ForegroundColor Green
            } elseif ($mode -in @("malo", "full")) {
                foreach ($t in @($xdgNvim, $appNvim)) {
                    if (Test-Path $t) { cmd /c rmdir "$t" 2>$null }
                    New-Item -ItemType Junction -Path $t -Target $maloSrc | Out-Null
                }
                Write-Host "  [OK] Default Neovim config set to nvim-malo" -ForegroundColor Green
            } else {
                $item = Get-Item $xdgNvim -Force -ErrorAction SilentlyContinue
                Write-Host "  Current ~/.config/nvim -> $($item.Target) (use 'dot nvim lite' or 'dot nvim malo')" -ForegroundColor Cyan
            }
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

# Machine-local overrides. Read and evaluate instead of dot-sourcing: `.` needs an
# execution policy that allows local script files, which a Group Policy machine does
# not have, and this is the last thing that would fail at startup there.
$LocalProfile = Join-Path (Split-Path -Parent $PROFILE) "Microsoft.PowerShell_profile_local.ps1"
if (Test-Path $LocalProfile) {
    Invoke-Expression (Get-Content -Raw $LocalProfile)
}
# >>> END MANAGED CONFIG <<<
