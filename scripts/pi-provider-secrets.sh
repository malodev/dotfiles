#!/usr/bin/env bash
#=============================================================================
# pi-provider-secrets.sh
#
# Fills the file-backed provider secrets that ~/.pi/agent/models.json names.
#
# models.json never holds a secret: it holds the command that reads one,
#   "tokenator": "!cat ~/.config/tokenator/litellm-api-key"
# so the list of secrets a host needs is already in that file. This script
# derives it from there instead of hard-coding provider names, then installs
# only what is missing.
#
# Providers whose apiKey is a command that returns a credential at runtime
# (pi-llama, ds4 via `pi-inference credential model-api`) are skipped: they
# have no file to fill.
#
# Usage:
#   ~/dotfiles/scripts/pi-provider-secrets.sh --check            # report only
#   ~/dotfiles/scripts/pi-provider-secrets.sh                    # prompt for what is missing
#   ~/dotfiles/scripts/pi-provider-secrets.sh --provider tokenator
#   ~/dotfiles/scripts/pi-provider-secrets.sh --from-file mlx=/path/to/key
#
# Values are read without echo, written with 0600, and never printed: only
# their length is. Nothing here talks to a provider, so an unverified key is
# not detected until pi uses it.
#
# Exit: 0 when every file-backed provider has a readable secret, 1 otherwise.
#=============================================================================
set -euo pipefail

MODELS="${PI_MODELS_JSON:-$HOME/.pi/agent/models.json}"
CHECK_ONLY=0
ONLY=""
ALLOW_STDIN=0
declare -A SOURCE=()

info() { printf '  \033[1;34m•\033[0m %s\n' "$1"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[1;33m⚠\033[0m %s\n' "$1"; }
err()  { printf '  \033[1;31m✗\033[0m %s\n' "$1" >&2; }

usage() {
  cat <<'USAGE'
pi-provider-secrets.sh — fill the file-backed secrets models.json names

  --check                 report only, change nothing (exit 1 if incomplete)
  --provider NAME         limit to one provider
  --from-file NAME=PATH   read the secret from a private (0600) file
  --stdin                 accept the secret from a pipe instead of a TTY
                          (the value may land in the shell history: prefer
                          --from-file or an interactive terminal)
  -h, --help              this text

Secrets are derived from ~/.pi/agent/models.json: every provider whose apiKey
starts with "!cat" points at a file this script can fill. Providers that fetch
a credential at runtime (pi-inference) are skipped.
USAGE
}

# Emit "provider<TAB>path" for every file-backed provider.
file_providers() {
  python3 - "$MODELS" <<'PY'
import json, os, sys, pathlib
path = pathlib.Path(sys.argv[1])
if not path.exists():
    sys.exit(f"models.json assente: {path}")
data = json.loads(path.read_text())
for name, cfg in data.get("providers", {}).items():
    key = str(cfg.get("apiKey", ""))
    if key.startswith("!cat "):
        print(f"{name}\t{os.path.expanduser(key.split('cat ', 1)[1].strip())}")
PY
}

is_private() {
  local f="$1" mode
  [[ -f "$f" ]] || return 1
  mode="$(stat -c '%a' "$f" 2>/dev/null || stat -f '%Lp' "$f")"
  [[ "$mode" == "600" ]]
}

read_secret() {   # read_secret <label> -> prints value on stdout, fails if no input source
  local label="$1" value=""
  # 1. The controlling terminal, if we can really open it. A pane under a
  #    multiplexer has stdin redirected but a usable /dev/tty, which is why
  #    testing -t 0 alone reported "not a terminal" and refused a working run.
  if { printf '  %s: ' "$label" >/dev/tty; } 2>/dev/null &&
     { IFS= read -rs value </dev/tty; } 2>/dev/null; then
    printf '\n' >/dev/tty 2>/dev/null || true
    printf '%s' "$value"
    return 0
  fi
  # 2. An ordinary interactive shell.
  if [[ -t 0 ]]; then
    printf '  %s: ' "$label" >&2
    IFS= read -rs value || true
    printf '\n' >&2
    printf '%s' "$value"
    return 0
  fi
  # 3. A pipe, only when explicitly allowed.
  if [[ "$ALLOW_STDIN" == "1" ]]; then
    IFS= read -rs value || true
    printf '%s' "$value"
    return 0
  fi
  return 1
}

install_one() {   # install_one <provider> <path>
  local name="$1" dest="$2" src="${SOURCE[$1]:-}" value dir

  if is_private "$dest"; then
    ok "$name: già presente ($(wc -c <"$dest" | tr -d ' ') byte)"
    return 0
  fi
  [[ -f "$dest" ]] && warn "$name: presente ma i permessi non sono 600 ($dest)"

  dir="$(dirname "$dest")"
  mkdir -p "$dir"
  chmod 700 "$dir" 2>/dev/null || true

  if [[ -n "$src" ]]; then
    if ! is_private "$src"; then
      err "$name: la sorgente deve essere un file privato (chmod 600): $src"
      return 1
    fi
    value="$(tr -d '\n' <"$src")"
  else
    if ! value="$(read_secret "$name")"; then
      err "$name: nessun terminale disponibile e nessuna --from-file."
      err "  Opzioni: esegui in un terminale interattivo (foot, kitty), oppure"
      err "    ~/dotfiles/scripts/pi-provider-secrets.sh --provider $name --from-file $name=/percorso/key"
      err "  Dalla clipboard (Wayland), senza scriverla nella history:"
      err "    umask 077; wl-paste --no-newline > /tmp/k && ~/dotfiles/scripts/pi-provider-secrets.sh --provider $name --from-file $name=/tmp/k && rm -f /tmp/k"
      err "  Se sai cosa stai facendo, --stdin accetta un pipe."
      return 1
    fi
  fi

  if [[ -z "$value" ]]; then
    err "$name: valore vuoto, niente scritto"
    return 1
  fi

  ( umask 077; printf '%s' "$value" >"$dest" )
  chmod 600 "$dest"
  ok "$name: installata in $dest (${#value} caratteri, valore non mostrato)"
}

report_one() {   # report_one <provider> <path>
  local name="$1" dest="$2"
  if is_private "$dest"; then
    ok "$name: $(wc -c <"$dest" | tr -d ' ') byte in $dest"
  elif [[ -f "$dest" ]]; then
    warn "$name: presente ma permessi non 600 ($dest)"
  else
    warn "$name: ASSENTE ($dest)"
    return 1
  fi
}

main() {
  local arg pair name dest rc=0 failed=0
  while [[ $# -gt 0 ]]; do
    arg="$1"; shift
    case "$arg" in
      --check)       CHECK_ONLY=1 ;;
      --stdin)       ALLOW_STDIN=1 ;;
      --provider)    ONLY="${1:-}"; shift || true ;;
      --provider=*)  ONLY="${arg#--provider=}" ;;
      --from-file)   pair="${1:-}"; shift || true; SOURCE["${pair%%=*}"]="${pair#*=}" ;;
      --from-file=*) pair="${arg#--from-file=}"; SOURCE["${pair%%=*}"]="${pair#*=}" ;;
      -h|--help)     usage; exit 0 ;;
      *) err "argomento sconosciuto: $arg"; usage; exit 2 ;;
    esac
  done

  local providers
  providers="$(file_providers)" || exit 1
  [[ -n "$providers" ]] || { info "nessun provider basato su file in $MODELS"; exit 0; }

  info "segreti dichiarati in $MODELS"
  while IFS=$'\t' read -r name dest; do
    [[ -n "$ONLY" && "$name" != "$ONLY" ]] && continue
    if [[ "$CHECK_ONLY" == "1" ]]; then
      report_one "$name" "$dest" || rc=1
    else
      install_one "$name" "$dest" || failed=1
    fi
  done <<<"$providers"

  if [[ -n "$ONLY" ]] && ! cut -f1 <<<"$providers" | grep -qx "$ONLY"; then
    err "provider '$ONLY' non è basato su file (o non esiste)"
    exit 2
  fi

  if [[ "$CHECK_ONLY" == "1" ]]; then
    [[ "$rc" == "0" ]] && ok "tutti i segreti sono a posto" || err "manca qualcosa: vedi sopra"
    return "$rc"
  fi
  [[ "$failed" == "0" ]] && ok "fatto — pi userà i nuovi valori al prossimo avvio" || err "qualcosa non è stato scritto: vedi sopra"
  return "$failed"
}

main "$@"
