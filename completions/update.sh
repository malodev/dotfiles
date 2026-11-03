#!/usr/bin/env bash
#=============================================================================
# update.sh — regenerate the generated completions in this package
#
# herdr ships its own generator (`herdr completion zsh|bash`), so its two files
# are output, not source: they encode the subcommand tree of the installed
# version. Re-run this after `herdr update`.
#
# pi ships no generator at all — `pi completion zsh` is taken as a prompt and
# starts a session — so `_pi` and the bash `pi` file are hand-written from
# `pi --help` and the subcommand help. This script cannot regenerate them; it
# reports the options `pi --help` knows that they do not, which is the drift
# worth fixing by hand after a pi upgrade.
#
# Usage:
#   ./update.sh           regenerate the herdr files, report pi drift
#   ./update.sh --check   change nothing; exit 1 on a stale file or missing spec
#=============================================================================
set -uo pipefail

PKG_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ZSH_DIR="$PKG_DIR/.zsh/completions"
BASH_DIR="$PKG_DIR/.local/share/bash-completion/completions"
CHECK=0

for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "update.sh: unknown option: $arg" >&2; exit 2 ;;
  esac
done

fail=0
info() { printf '  %s\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }

# --- herdr: generated ------------------------------------------------------
echo "── herdr ──"
if ! command -v herdr >/dev/null 2>&1; then
  warn "herdr is not on PATH: nothing to regenerate"
else
  version="$(herdr --version 2>/dev/null | awk '{print $2}')"
  info "installed: herdr ${version:-unknown}"

  regenerate() {
    local shell="$1" target="$2" tmp
    tmp="$(mktemp)"
    if ! herdr completion "$shell" >"$tmp" 2>/dev/null || [[ ! -s $tmp ]]; then
      warn "herdr completion $shell produced nothing"
      rm -f "$tmp"
      fail=1
      return
    fi
    if [[ -f $target ]] && cmp -s "$tmp" "$target"; then
      ok "$(basename "$target") is current ($(wc -l <"$target" | tr -d ' ') lines)"
      rm -f "$tmp"
      return
    fi
    if (( CHECK )); then
      warn "$(basename "$target") is stale: run ./update.sh"
      rm -f "$tmp"
      fail=1
      return
    fi
    mv -f "$tmp" "$target"
    ok "$(basename "$target") regenerated ($(wc -l <"$target" | tr -d ' ') lines)"
  }

  regenerate zsh "$ZSH_DIR/_herdr"
  regenerate bash "$BASH_DIR/herdr"
fi

# --- pi: hand-written ------------------------------------------------------
echo "── pi ──"
if ! command -v pi >/dev/null 2>&1; then
  warn "pi is not on PATH: cannot compare the hand-written specs"
else
  info "installed: pi $(pi --version 2>/dev/null | head -1)"

  help_options() {
    pi --help 2>/dev/null |
      grep -E '^  -' |
      grep -oE -e '--[a-z][a-z0-9-]*' |
      grep -vx -e '--' |
      sort -u
  }

  written_options() {
    grep -ohE -e '--[a-z][a-z0-9-]*' "$@" 2>/dev/null | sort -u
  }

  missing_zsh="$(comm -23 <(help_options) <(written_options "$ZSH_DIR/_pi"))"
  missing_bash="$(comm -23 <(help_options) <(written_options "$BASH_DIR/pi"))"

  if [[ -z $missing_zsh && -z $missing_bash ]]; then
    ok "every --option in 'pi --help' is covered by both files"
  else
    [[ -n $missing_zsh ]] && warn "_pi does not complete: $(tr '\n' ' ' <<<"$missing_zsh")"
    [[ -n $missing_bash ]] && warn "bash pi does not complete: $(tr '\n' ' ' <<<"$missing_bash")"
    fail=1
  fi

  # Syntax only: sourcing a completion needs a live zsh completion system.
  zsh -n "$ZSH_DIR/_pi" 2>/dev/null && ok "_pi parses" || { warn "_pi has a syntax error"; fail=1; }
  bash -n "$BASH_DIR/pi" 2>/dev/null && ok "bash pi parses" || { warn "bash pi has a syntax error"; fail=1; }
fi

if (( fail )); then
  echo "── result: needs attention ──" >&2
  exit 1
fi
echo "── result: up to date ──"
