#!/usr/bin/env bash
#=============================================================================
# authorize-ssh-key.sh — install this machine's public key on a Windows host,
# prompting only for the password.
#
# ssh-copy-id cannot do this: it runs POSIX commands (umask, cat >>) on the remote
# shell, which on Windows is PowerShell, and it always writes ~/.ssh/authorized_keys
# while sshd reads %ProgramData%\ssh\administrators_authorized_keys for an
# administrator. This sends one base64-encoded PowerShell command that picks the
# right file, appends only when the key is missing, and sets the ACLs sshd insists
# on - which is what makes the difference between "the key is there" and "the key
# works" on Windows.
#
# Usage:
#   scripts/windows/authorize-ssh-key.sh <user@host> [--port N] [--key FILE] [--print]
#
#   --port N     ssh port (default 22)
#   --key FILE   public key to install (default ~/.ssh/id_ed25519.pub)
#   --print      print the ssh command instead of running it
#=============================================================================
set -eo pipefail

PORT=22
KEY="$HOME/.ssh/id_ed25519.pub"
PRINT=0
DEST=""

usage() { sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
die() { echo "authorize-ssh-key: $1" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)  PORT="$2"; shift 2 ;;
    --key)   KEY="$2"; shift 2 ;;
    --print) PRINT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *)  DEST="$1"; shift ;;
  esac
done

[[ -n "$DEST" ]] || { usage >&2; exit 1; }
[[ -f "$KEY" ]] || die "no such public key: $KEY"
PUB="$(tr -d '\r\n' < "$KEY")"
[[ -n "$PUB" ]] || die "empty public key: $KEY"

# The command is base64-encoded because the SSH session's own PowerShell would interpolate
# $env:..., $HOME and friends before the child ever sees them.
PS_CMD="$(cat <<PS
\$k = '$PUB'
\$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
\$f = if (\$admin) { Join-Path \$env:ProgramData 'ssh\administrators_authorized_keys' } else { Join-Path \$HOME '.ssh\authorized_keys' }
New-Item -ItemType Directory -Force -Path (Split-Path \$f) | Out-Null
if (-not (Test-Path \$f)) { New-Item -ItemType File -Path \$f | Out-Null }
if (Select-String -Path \$f -SimpleMatch (\$k -split ' ')[1] -Quiet) { "key already present in \$f" } else { Add-Content -Path \$f -Value \$k -Encoding Ascii; "key added to \$f" }
if (\$admin) {
    icacls \$f /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
} else {
    icacls \$f /inheritance:r /grant "\$(\$env:USERNAME):F" /grant 'SYSTEM:R' /grant 'Administrators:R' | Out-Null
}
PS
)"

ENCODED="$(printf '%s' "$PS_CMD" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')"

SSH_CMD=(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -p "$PORT" "$DEST"
         "powershell -NoLogo -NoProfile -EncodedCommand $ENCODED")

if [[ "$PRINT" == "1" ]]; then
  printf '%q ' "${SSH_CMD[@]}"
  printf '\n'
  exit 0
fi

echo "== installing $(basename "$KEY") on $DEST (port $PORT)"
echo "   the password prompt is ssh's: it is not stored anywhere."
# A nested PowerShell serialises its progress and error streams as CLIXML, which buries the one
# useful line; stderr is kept for the failure path, where it is the diagnostic.
ERR_FILE="$(mktemp)"
if ! "${SSH_CMD[@]}" 2>"$ERR_FILE"; then
  [[ -s "$ERR_FILE" ]] && head -20 "$ERR_FILE" | sed 's/^/   /' >&2
  rm -f "$ERR_FILE"
  echo "" >&2
  echo "authorize-ssh-key: that did not work. Usual causes:" >&2
  echo "  - wrong username: on a domain machine try the short form, or DOMAIN\\\\user" >&2
  echo "  - password authentication disabled on that sshd (then use the PowerShell" >&2
  echo "    one-liner on the machine itself, or windows\\bootstrap-dotfiles.cmd)" >&2
  exit 1
fi
rm -f "$ERR_FILE"

echo ""
echo "Next, from this machine:"
echo "  dot doctor --host ${DEST%@*}@${DEST#*@} --ssh-port $PORT"
echo "  dot deploy --to $DEST --ssh-port $PORT --dry-run"
