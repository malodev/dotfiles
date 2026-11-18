#!/usr/bin/env bash
#=============================================================================
# pi-inference-credentials.sh
#
# Installs the two bearer credentials the Pi inference client needs — and
# nothing else. No stow, no models.json writes, no switching the shared
# inference host between modes.
#
# Why the split: scripts/pi-inference-client-setup also deploys files and
# verifies the host by flipping its mode to smoke-test every managed model,
# then restoring it. Rotating a key must not require touching a host other
# people may be using. This script only fills:
#
#   ~/.pi-inference/credentials/control-api-token   control plane
#   ~/.pi-inference/credentials/model-api-key       model endpoints
#
# Both are read by ~/.config/pi-inference/client.json (tracked in this repo),
# and models.json reaches them through:
#   "pi-llama": "!~/.local/bin/pi-inference credential model-api"
#
# Secrets never pass through the shell history: --install reads stdin, and
# --from-file takes a private (mode 0600) file.
#
# Usage:
#   ./scripts/pi-inference-credentials.sh --check          # report only
#   ./scripts/pi-inference-credentials.sh                  # install what is missing
#   ./scripts/pi-inference-credentials.sh --replace        # rotate both
#   ./scripts/pi-inference-credentials.sh --from-file control-api=/p/token \
#                                         --from-file model-api=/p/key
#
# Exit: 0 when every requested credential is in place, 1 otherwise.
#=============================================================================
set -euo pipefail

CRED_DIR="$HOME/.pi-inference/credentials"
CHECK_ONLY=0
REPLACE=0
declare -A SOURCE=()

info() { printf '  \033[1;34m•\033[0m %s\n' "$1"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[1;33m⚠\033[0m %s\n' "$1"; }
err()  { printf '  \033[1;31m✗\033[0m %s\n' "$1" >&2; }

usage() {
  cat <<'USAGE'
pi-inference-credentials.sh — install the two Pi inference bearer credentials

  --check                     report only, change nothing (exit 1 if incomplete)
  --replace                   rotate a credential that already exists
  --from-file NAME=PATH       read the secret from a private (0600) file
                              NAME is control-api or model-api
  -h, --help                  this text

Installs only:
  ~/.pi-inference/credentials/control-api-token
  ~/.pi-inference/credentials/model-api-key

No stow, no models.json writes, no switching the shared inference host.
For the host/mode smoke test use scripts/pi-inference-client-setup --apply --verify.
USAGE
}

client_path() {
  local p="$HOME/.local/bin/pi-inference"
  [[ -x "$p" ]] || return 1
  printf '%s' "$p"
}

is_private() {
  local f="$1" mode
  [[ -f "$f" ]] || return 1
  mode="$(stat -c '%a' "$f" 2>/dev/null || stat -f '%Lp' "$f")"
  [[ "$mode" == "600" ]]
}

install_one() {
  local name="$1" dest="$2" src="${SOURCE[$1]:-}" client flags=()

  if [[ -f "$dest" && "$REPLACE" == "0" ]]; then
    ok "$name: già installata ($(wc -c <"$dest" | tr -d ' ') byte) — usa --replace per ruotarla"
    return 0
  fi
  [[ "$REPLACE" == "1" ]] && flags+=(--replace)

  client="$(client_path)" || { err "client assente: ~/.local/bin/pi-inference (linka i file del repo)"; return 1; }

  if [[ -n "$src" ]]; then
    if ! is_private "$src"; then
      err "$name: la sorgente deve essere un file privato (chmod 600): $src"
      return 1
    fi
    if "$client" credential --install "${flags[@]}" "$name" <"$src"; then
      ok "$name: installata da $src"
      return 0
    fi
    err "$name: install from file failed"
    return 1
  fi

  # A pane under a multiplexer has stdin redirected but a usable controlling
  # terminal, so hand that terminal to the client instead of refusing.
  if { printf '  %s credential: ' "$name" >/dev/tty; } 2>/dev/null &&
     "$client" credential --install "${flags[@]}" "$name" </dev/tty; then
    ok "$name: installata dal terminale"
    return 0
  fi
  if [[ -t 0 ]]; then
    "$client" credential --install "${flags[@]}" "$name" && ok "$name: installata da stdin"
    return 0
  fi
  err "$name: nessun terminale e nessuna --from-file"
  err "  da un terminale interattivo, oppure:"
  err "    ./scripts/pi-inference-credentials.sh --from-file $name=/percorso/file"
  return 1
}

report_one() {
  local name="$1" dest="$2" value
  if [[ ! -f "$dest" ]]; then
    warn "$name: ASSENTE ($dest)"
    return 1
  fi
  if ! is_private "$dest"; then
    warn "$name: presente ma i permessi non sono 600 ($dest)"
  fi
  value="$("$(client_path)" credential "$name" 2>/dev/null || true)"
  if [[ -n "$value" ]]; then
    ok "$name: ${#value} caratteri (valore non mostrato)"
  else
    warn "$name: il client non riesce a leggerla"
    return 1
  fi
}

report_providers() {
  python3 - "$HOME/.pi/agent/models.json" <<'PY'
import json, os, subprocess, sys, pathlib
path = pathlib.Path(sys.argv[1])
if not path.exists():
    print("  ⚠ ~/.pi/agent/models.json assente (seminalo con scripts/init-pi-settings.sh)")
    sys.exit(0)
data = json.loads(path.read_text())
for name, cfg in data.get("providers", {}).items():
    key = str(cfg.get("apiKey", ""))
    if key.startswith("!cat "):
        target = pathlib.Path(os.path.expanduser(key.split("cat ", 1)[1].strip()))
        mark = "✓" if target.exists() else "✗"
        extra = "" if target.exists() else f" (manca {target})"
    elif key.startswith("!"):
        cmd = os.path.expanduser(key[1:].strip())
        try:
            out = subprocess.run(cmd.split(), capture_output=True, text=True, timeout=20)
            good = out.returncode == 0 and out.stdout.strip()
            mark = "✓" if good else "✗"
            extra = "" if good else " (il comando non restituisce una credenziale)"
        except Exception:
            mark, extra = "✗", " (comando non eseguibile)"
    else:
        mark, extra = "•", " (nessun segreto esterno)"
    print(f"  {mark} {name}{extra}")
PY
}

main() {
  local arg pair
  while [[ $# -gt 0 ]]; do
    arg="$1"; shift
    case "$arg" in
      --check)    CHECK_ONLY=1 ;;
      --replace)  REPLACE=1 ;;
      --from-file)  pair="${1:-}"; shift || true; SOURCE["${pair%%=*}"]="${pair#*=}" ;;
      --from-file=*) pair="${arg#--from-file=}"; SOURCE["${pair%%=*}"]="${pair#*=}" ;;
      -h|--help)  usage; exit 0 ;;
      *) err "argomento sconosciuto: $arg"; usage; exit 2 ;;
    esac
  done

  local name
  for name in "${!SOURCE[@]}"; do
    case "$name" in
      control-api|model-api) ;;
      *) err "--from-file: nome non valido '$name' (control-api|model-api)"; exit 2 ;;
    esac
  done

  mkdir -p "$CRED_DIR"
  chmod 700 "$CRED_DIR"
  [[ -d "$(dirname "$CRED_DIR")" ]] && chmod 700 "$(dirname "$CRED_DIR")"

  info "credenziali in $CRED_DIR"
  if [[ "$CHECK_ONLY" == "1" ]]; then
    local rc=0
    report_one control-api "$CRED_DIR/control-api-token" || rc=1
    report_one model-api   "$CRED_DIR/model-api-key"     || rc=1
    info "provider in ~/.pi/agent/models.json"
    report_providers
    exit "$rc"
  fi

  local failed=0
  install_one control-api "$CRED_DIR/control-api-token" || failed=1
  install_one model-api   "$CRED_DIR/model-api-key"     || failed=1

  info "verifica di lettura"
  report_one control-api "$CRED_DIR/control-api-token" || failed=1
  report_one model-api   "$CRED_DIR/model-api-key"     || failed=1
  info "provider in ~/.pi/agent/models.json"
  report_providers

  [[ "$failed" == "0" ]] && ok "credenziali a posto" || err "manca qualcosa: vedi sopra"
  return "$failed"
}

main "$@"
