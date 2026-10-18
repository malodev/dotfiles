#Requires -Version 5.1
<#
.SYNOPSIS
    Enable an SSH server on Windows so the machine can be driven over SSH.
.DESCRIPTION
    Installs the server, sets the sshd service to start automatically, opens the
    firewall for the chosen port, points the SSH default shell at PowerShell so the
    managed profile applies to SSH sessions too, and optionally authorises a public key.

    Two install paths, because the first one can hang:
      1. The OpenSSH Server optional feature, which downloads from Windows Update. It
         is started as a background job with a timeout (-CapabilityTimeoutSeconds,
         default 180): on a machine where Windows Update is slow, blocked or pointed at
         a WSUS server it can otherwise sit there forever.
      2. If that does not produce an installed feature, the Win32-OpenSSH release zip
         from GitHub is installed into Program Files\OpenSSH with install-sshd.ps1 and
         generated host keys. No Windows Update involved.
    -SkipCapability goes straight to path 2.

    Everything here needs Administrator rights once: installing the server, the service
    and the firewall rule. Without elevation the script re-runs itself through UAC; on a
    machine where the account has no admin rights at all (a locked-down school laptop)
    it says so and lists what to ask IT for, plus the alternatives that need no admin.

    Parameters survive the elevated re-run through environment variables, so
    `-PublicKey`/`-Port` do not have to be repeated.

    Nothing here reads the repository: the script is standalone, and a no-op off Windows.

    It returns instead of exiting everywhere: under a Group Policy that forbids script
    files the callers evaluate this file inline, and an `exit` inside an evaluated block
    terminates the caller as well.
.PARAMETER DryRun
    Report what would change without installing, starting or opening anything.
.PARAMETER NoElevate
    Do not ask for Administrator rights; report what is missing instead.
.PARAMETER PublicKey
    Public key to authorise, as a single line ("ssh-ed25519 AAAA... user@host").
.PARAMETER PublicKeyPath
    File to read the public key from. Defaults to ~\.ssh\id_ed25519.pub when it exists.
.PARAMETER Port
    Port for the firewall rule. The service itself listens on 22; a container or a
    port forward may expose it on something else (the Windows VM publishes 22 on 2222).
.PARAMETER SkipFirewall
    Leave Windows Firewall alone (use when the port is only reached through a VPN such
    as Tailscale, which brings its own rules).
.PARAMETER KeepDefaultShell
    Do not touch HKLM:\SOFTWARE\OpenSSH DefaultShell.
.PARAMETER SkipCapability
    Skip the Windows Update feature and install from the Win32-OpenSSH zip.
.PARAMETER CapabilityTimeoutSeconds
    How long to let the Windows Update feature install run before falling back.
.PARAMETER OpenSshZipUrl
    Release zip used by the fallback path.
.EXAMPLE
    .\enable-ssh-server.ps1 -PublicKeyPath "$HOME\.ssh\id_ed25519.pub"
.EXAMPLE
    .\enable-ssh-server.ps1 -SkipCapability -PublicKey "ssh-ed25519 AAAA... me@host"
.EXAMPLE
    .\enable-ssh-server.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$NoElevate,
    [string]$PublicKey,
    [string]$PublicKeyPath,
    [int]$Port = 22,
    [switch]$SkipFirewall,
    [switch]$KeepDefaultShell,
    [switch]$SkipCapability,
    [int]$CapabilityTimeoutSeconds = 180,
    [string]$OpenSshZipUrl = "https://github.com/PowerShell/Win32-OpenSSH/releases/download/10.0.0.0p2-Preview/OpenSSH-Win64.zip"
)

$ErrorActionPreference = "Stop"

function Write-Info($msg) { Write-Host "  * $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }

if ($env:OS -ne "Windows_NT") {
    Write-Info "Not a Windows host: nothing to enable"
    return
}

# Values carried over from an unelevated run.
if ($env:DOTFILES_SSH_PORT) { $Port = [int]$env:DOTFILES_SSH_PORT }
if ($env:DOTFILES_SSH_PUBKEY) { $PublicKey = $env:DOTFILES_SSH_PUBKEY }
if ($env:DOTFILES_SSH_DRYRUN -eq "1") { $DryRun = $true }
if ($env:DOTFILES_SSH_SKIPCAP -eq "1") { $SkipCapability = $true }

$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $IsAdmin) {
    if ($DryRun -or $NoElevate) {
        Write-Warn "Administrator rights are needed to install the SSH server, start the"
        Write-Warn "sshd service and open the firewall. Not elevating."
        Write-Info "Alternatives without admin rights:"
        Write-Info "  1. Ask IT to install the 'OpenSSH Server' optional feature and start sshd"
        Write-Info "  2. Tailscale SSH: 'tailscale up --ssh' reaches this machine over the tailnet"
        return
    }

    Write-Info "Asking for Administrator rights (UAC)..."
    $env:DOTFILES_SSH_PORT = "$Port"
    if ($PublicKey) { $env:DOTFILES_SSH_PUBKEY = $PublicKey }
    if ($SkipCapability) { $env:DOTFILES_SSH_SKIPCAP = "1" }

    # Re-run this same file elevated. The command is passed base64-encoded so the
    # quoting survives, and the file is read and evaluated rather than run as a script:
    # an execution policy managed by Group Policy would refuse -File.
    $inner = "iex ((Get-Content -Raw '" + $PSCommandPath + "') -replace '(?m)^#Requires.*$','')"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
    try {
        Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -ArgumentList "-NoProfile -EncodedCommand $encoded"
    } catch {
        Write-Warn "Elevation was refused or unavailable: $($_.Exception.Message)"
        Write-Warn "Run this from an Administrator PowerShell, or ask IT (see the alternatives above)."
        return
    }
    Write-Info "Elevated run finished."
    return
}

Write-Ok "Running with Administrator rights"

# The Win32-OpenSSH release ships .ps1 helpers, and a Group Policy execution policy
# would refuse to run them as files: read and evaluate them instead.
function Invoke-LocalScript {
    param([string]$Path, [string]$Arguments = "")
    if ((Get-ExecutionPolicy) -notin @("Restricted", "AllSigned")) {
        if ($Arguments) { Invoke-Expression ("& '" + $Path + "' " + $Arguments) } else { & $Path }
        return
    }
    $body = (Get-Content -Raw $Path) -replace '(?m)^#Requires.*$', ''
    Invoke-Expression ("& { " + $body + " } " + $Arguments)
}

# 1. Install the server: Windows Update feature first, Win32-OpenSSH release as fallback.
$installed = $false

if ($SkipCapability) {
    Write-Info "Skipping the Windows Update feature (-SkipCapability)"
} else {
    $capability = Get-WindowsCapability -Online -Name "OpenSSH.Server*" | Select-Object -First 1
    if (-not $capability) {
        Write-Warn "This Windows build does not offer the OpenSSH.Server capability"
    } elseif ($capability.State -eq "Installed") {
        Write-Ok "OpenSSH Server feature already installed"
        $installed = $true
    } elseif ($DryRun) {
        Write-Info "[dry-run] Add-WindowsCapability -Online -Name $($capability.Name) (state: $($capability.State))"
        $installed = $true
    } else {
        Write-Info "Installing the OpenSSH Server feature (Windows Update, up to $CapabilityTimeoutSeconds s)..."
        $capabilityName = $capability.Name
        $job = Start-Job -ScriptBlock { param($n) Add-WindowsCapability -Online -Name $n } -ArgumentList $capabilityName
        if (Wait-Job $job -Timeout $CapabilityTimeoutSeconds) {
            Receive-Job $job -ErrorAction SilentlyContinue | Out-Null
            $state = (Get-WindowsCapability -Online -Name $capabilityName).State
            if ($state -eq "Installed") {
                Write-Ok "OpenSSH Server feature installed"
                $installed = $true
            } else {
                Write-Warn "The feature is still '$state' after the install returned"
            }
        } else {
            Write-Warn "Windows Update did not finish within $CapabilityTimeoutSeconds s - stopping it"
            Stop-Job $job -ErrorAction SilentlyContinue
        }
        Remove-Job $job -Force -ErrorAction SilentlyContinue
    }
}

if (-not $installed -and $DryRun) {
    Write-Info "[dry-run] download $OpenSshZipUrl and install it into $env:ProgramFiles\OpenSSH"
    $installed = $true
}

if (-not $installed) {
    Write-Info "Falling back to the Win32-OpenSSH release (no Windows Update needed)..."
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $zip     = Join-Path $env:TEMP "OpenSSH-Win64.zip"
        $extract = Join-Path $env:TEMP ("openssh-" + (Get-Random))
        $target  = Join-Path $env:ProgramFiles "OpenSSH"
        Invoke-WebRequest -Uri $OpenSshZipUrl -OutFile $zip -UseBasicParsing
        Expand-Archive -Path $zip -DestinationPath $extract -Force
        New-Item -ItemType Directory -Force -Path $target | Out-Null
        Copy-Item (Join-Path $extract "OpenSSH-Win64\*") $target -Recurse -Force
        & (Join-Path $target "ssh-keygen.exe") -A | Out-Null
        Invoke-LocalScript (Join-Path $target "install-sshd.ps1")
        $fixPerms = Join-Path $target "FixHostFilePermissions.ps1"
        if (Test-Path $fixPerms) { Invoke-LocalScript $fixPerms "-Confirm:`$false" }
        Write-Ok "Win32-OpenSSH installed in $target (host keys generated)"
        $installed = $true
    } catch {
        Write-Warn "Could not install from $OpenSshZipUrl : $($_.Exception.Message)"
        Write-Warn "Ask IT to install the 'OpenSSH Server' optional feature, or use"
        Write-Warn "Tailscale SSH ('tailscale up --ssh'), which needs no feature at all."
        return
    }
}

# 2. Service
if ($DryRun) {
    Write-Info "[dry-run] Set-Service sshd -StartupType Automatic; Start-Service sshd"
} else {
    try {
        Set-Service -Name sshd -StartupType Automatic -ErrorAction Stop
        if ((Get-Service sshd).Status -ne "Running") { Start-Service sshd }
        $svc = Get-Service sshd
        Write-Ok "sshd service is $($svc.Status) and starts automatically"
    } catch {
        Write-Warn "Could not start the sshd service: $($_.Exception.Message)"
        Write-Warn "Run '$env:ProgramFiles\OpenSSH\install-sshd.ps1' by hand and check the service."
        return
    }
}

# 3. Firewall
if (-not $SkipFirewall) {
    $ruleName = "OpenSSH-Server-In-TCP-$Port"
    if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) {
        Write-Ok "Firewall rule for port $Port already exists"
    } elseif ($DryRun) {
        Write-Info "[dry-run] New-NetFirewallRule -Name $ruleName -LocalPort $Port (inbound TCP allow)"
    } else {
        New-NetFirewallRule -Name $ruleName -DisplayName "OpenSSH Server (sshd, port $Port)" `
            -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort $Port | Out-Null
        Write-Ok "Firewall opened for inbound TCP $Port"
    }
} else {
    Write-Info "Firewall left alone (-SkipFirewall)"
}

# 4. Default shell: PowerShell, so SSH sessions get the managed profile (XDG_CONFIG_HOME,
#    PATH, mise, starship) exactly like an interactive Windows Terminal tab.
if (-not $KeepDefaultShell) {
    $pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
    $shell = if ($pwsh) { $pwsh.Source } else { (Get-Command powershell.exe).Source }
    $current = (Get-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell -ErrorAction SilentlyContinue).DefaultShell
    if ($current -eq $shell) {
        Write-Ok "SSH default shell already $shell"
    } elseif ($DryRun) {
        Write-Info "[dry-run] set HKLM:\SOFTWARE\OpenSSH DefaultShell = $shell"
    } else {
        New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell -Value $shell -PropertyType String -Force | Out-Null
        Write-Ok "SSH default shell set to $shell (was $($current -replace '^$','cmd.exe'))"
    }
} else {
    Write-Info "Default shell left alone (-KeepDefaultShell)"
}

# 5. Authorised key. Windows uses a different file for administrators, and both need an
#    ACL that only the account (or Administrators/SYSTEM) can write.
if (-not $PublicKey -and -not $PublicKeyPath) {
    $defaultKey = Join-Path $HOME ".ssh\id_ed25519.pub"
    if (Test-Path $defaultKey) { $PublicKeyPath = $defaultKey }
}

if ($PublicKeyPath -and -not $PublicKey) {
    if (-not (Test-Path $PublicKeyPath)) {
        Write-Warn "Public key not found: $PublicKeyPath"
    } else {
        # First usable line only: a .pub file can hold several keys or comments.
        $PublicKey = (Get-Content $PublicKeyPath | Where-Object { $_ -match '^\s*(ssh-|ecdsa-|sk-)' } | Select-Object -First 1)
    }
}

# A key pasted from a wrapped line arrives with newlines inside it, and sshd then sees a
# line that is only the key type and rejects the login. Collapse all whitespace.
if ($PublicKey) { $PublicKey = ($PublicKey -replace '\s+', ' ').Trim() }

if ($PublicKey) {
    $isAdminUser = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($isAdminUser) {
        $keyFile = Join-Path $env:ProgramData "ssh\administrators_authorized_keys"
    } else {
        $keyFile = Join-Path $HOME ".ssh\authorized_keys"
    }

    $existing = if (Test-Path $keyFile) { Get-Content -Raw $keyFile } else { "" }
    if ($existing -match [regex]::Escape(($PublicKey -split ' ')[1])) {
        Write-Ok "Key already authorised in $keyFile"
    } elseif ($DryRun) {
        Write-Info "[dry-run] append key to $keyFile and lock its ACL"
    } else {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $keyFile) | Out-Null
        $text = ($existing.TrimEnd() + "`n" + $PublicKey + "`n").TrimStart("`n")
        [IO.File]::WriteAllText($keyFile, $text, (New-Object Text.UTF8Encoding($false)))
        if ($isAdminUser) {
            & icacls.exe $keyFile /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" | Out-Null
        } else {
            & icacls.exe $keyFile /inheritance:r /grant "$($env:USERNAME):F" | Out-Null
        }
        Write-Ok "Authorised key in $keyFile (ACL locked to the account)"
    }
} else {
    Write-Info "No public key given: password login stays in use"
    Write-Info "  add one later with -PublicKeyPath <file>, or copy it to $HOME\.ssh\authorized_keys"
}

Write-Host ""
Write-Ok "SSH server ready"
Write-Info "Connect with: ssh -p $Port $env:USERNAME@$env:COMPUTERNAME"
Write-Info "  a container or port forward may expose port 22 elsewhere:"
Write-Info "  the Windows VM publishes it as 2222 on its host."
