#!/usr/bin/env bash
#=============================================================================
# seed-agent-instructions.sh
#
# Seed the two agent-instruction layers this repository owns:
#
#   1. the shared rules file, ~/.agents/AGENTS.md, from the tracked copy
#      pi/.pi/agent/AGENTS.md;
#   2. the per-machine overlay, ~/Work/AGENTS.md, from
#      pi/.pi/agent/Work-AGENTS.md.template.
#
# Why layer 1 exists: Omarchy owns the canonical path. `omarchy agent
# instructions` links ~/.agents/AGENTS.md into every harness it finds (Claude,
# Codex, Pi, Gemini/agy, OpenCode, Grok, Copilot, Qwen, Kilo, ...), and it
# treats a file that holds nothing but its own explanatory header as "no rules
# yet". So the repository must not fight that command: it only fills the slot
# when it is empty, and hands the per-harness linking back to Omarchy.
#
# Layer 2 is this repository's own convention, not an Omarchy path: the shared
# rules tell an agent to read ~/Work/AGENTS.md for facts that are true only on
# this host (paths, services, hardware, what not to touch). It is untracked and
# created once from the template; a file that already exists is never rewritten.
#
# What is never touched:
#   - a real AGENTS.md with content someone else wrote (Omarchy's seeded copy
#     that the user has since edited, or another tool's file)
#   - a symlink that does not resolve into this repository
#   - an existing ~/Work/AGENTS.md, whatever it says
#
# Usage:
#   scripts/seed-agent-instructions.sh            # seed whatever is empty
#   scripts/seed-agent-instructions.sh --dry-run  # show what would happen
#   scripts/seed-agent-instructions.sh --check    # exit 1 when seeding is due
#=============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$REPO/pi/.pi/agent/AGENTS.md"
CANONICAL="$HOME/.agents/AGENTS.md"
# Omarchy's placeholder: a single HTML comment it writes on first use.
PLACEHOLDER_PREFIX='<!-- Your instructions for every coding agent.'

MODE="apply"
for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE="dry-run" ;;
    --check)   MODE="check" ;;
    --help|-h) awk 'NR>=3 && /^#=====/{exit} NR>=3' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

info() { printf '  %s\n' "$*"; }
say()  { [[ "$MODE" == "dry-run" ]] && printf '  [dry-run] %s\n' "$*" || info "$*"; }

[[ -f "$SOURCE" ]] || { echo "error: missing $SOURCE" >&2; exit 1; }

# Resolve a symlink chain without requiring the final target to exist.
resolved=""
if [[ -L "$CANONICAL" ]]; then
  resolved="$(readlink -f "$CANONICAL" 2>/dev/null || true)"
fi

# is_ours: the link resolves into this repository.
is_ours() {
  [[ -n "$resolved" ]] || return 1
  case "$resolved" in
    "$REPO"|"$REPO"/*) return 0 ;;
  esac
  return 1
}

# is_empty_slot: missing, blank, or carrying nothing but Omarchy's header.
is_empty_slot() {
  [[ -e "$CANONICAL" || -L "$CANONICAL" ]] || return 0
  [[ -f "$CANONICAL" ]] || return 1
  local stripped
  stripped="$(tr -d '[:space:]' <"$CANONICAL" 2>/dev/null || true)"
  [[ -z "$stripped" ]] && return 0
  local first
  first="$(head -n 1 "$CANONICAL" 2>/dev/null || true)"
  [[ "$first" == "$PLACEHOLDER_PREFIX"* ]] && [[ $(wc -l <"$CANONICAL") -le 1 ]] && return 0
  return 1
}

shared_state="kept"
if is_ours; then
  shared_state="ok"
elif is_empty_slot; then
  shared_state="due"
fi

OVERLAY="$HOME/Work/AGENTS.md"
OVERLAY_TEMPLATE="$REPO/pi/.pi/agent/Work-AGENTS.md.template"
overlay_state="ok"
[[ -e "$OVERLAY" || -L "$OVERLAY" ]] || overlay_state="due"

if [[ "$MODE" == "check" ]]; then
  [[ "$shared_state" == "due" || "$overlay_state" == "due" ]] || exit 0
  [[ "$shared_state" == "due" ]] && echo "seeding due: $CANONICAL is empty"
  [[ "$overlay_state" == "due" ]] && echo "seeding due: $OVERLAY is missing"
  exit 1
fi

case "$shared_state" in
  ok)   info "shared rules: already linked to $SOURCE" ;;
  kept) info "shared rules: $CANONICAL exists with its own content, left untouched" ;;
  due)
    say "link $CANONICAL -> $SOURCE"
    if [[ "$MODE" != "dry-run" ]]; then
      mkdir -p "$(dirname "$CANONICAL")"
      # Build beside the target and rename, so an interrupted run never leaves
      # a half-written file where every harness reads its rules.
      tmp="$CANONICAL.tmp.$$"
      ln -sfn "$SOURCE" "$tmp"
      mv -Tf "$tmp" "$CANONICAL"
    fi
    if command -v omarchy >/dev/null 2>&1; then
      info "per-harness links are Omarchy's: run 'omarchy agent instructions' to create them"
    else
      info "no omarchy CLI here: link each harness file to $CANONICAL by hand"
    fi
    ;;
esac

case "$overlay_state" in
  ok) info "machine overlay: $OVERLAY exists, left untouched" ;;
  due)
    say "seed $OVERLAY from $OVERLAY_TEMPLATE"
    if [[ "$MODE" != "dry-run" ]]; then
      mkdir -p "$(dirname "$OVERLAY")"
      sed "s/<hostname>/$(hostname)/" "$OVERLAY_TEMPLATE" >"$OVERLAY.tmp.$$"
      mv -Tf "$OVERLAY.tmp.$$" "$OVERLAY"
    fi
    ;;
esac
