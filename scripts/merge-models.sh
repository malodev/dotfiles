#!/usr/bin/env bash
#=============================================================================
# merge-models.sh — Merge shared models.json with machine-specific overrides
#
# Reads:  DOTFILES/pi/.pi/agent/models.json          (tracked, shared)
#         ~/.pi/agent/models_local.json               (untracked, per-machine)
# Writes: ~/.pi/agent/models.json                     (generated, stow-ignored)
#
# Usage:
#   ./scripts/merge-models.sh                 # merge and write
#   ./scripts/merge-models.sh --dry-run       # show what would change
#=============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOTFILES_REPO="$SCRIPT_DIR"

BASE="$DOTFILES_REPO/pi/.pi/agent/models.json"
LOCAL="$HOME/.pi/agent/models_local.json"
OUTPUT="$HOME/.pi/agent/models.json"

MODE="apply"
[[ "${1:-}" == "--dry-run" ]] && MODE="dry-run"

info()  { echo -e "  \033[1;34m•\033[0m $*"; }
ok()    { echo -e "  \033[1;32m✓\033[0m $*"; }

# ---- validate base exists ----
if [[ ! -f "$BASE" ]]; then
  echo "error: base models.json not found at $BASE" >&2
  exit 1
fi

# ---- merge ----
if [[ -f "$LOCAL" ]]; then
  # Deep merge: providers from local override/add to base providers.
  # jq: multiply (deep merge) — local keys win on conflict.
  MERGED=$(jq -s '.[0].providers * .[1].providers | {providers: .}' "$BASE" "$LOCAL" 2>/dev/null) || {
    echo "error: failed to merge $LOCAL — check JSON syntax" >&2
    exit 1
  }
  info "Merged $(jq -r '.providers | keys | length' <<< "$MERGED") providers (base + local)"
else
  MERGED=$(cat "$BASE")
  info "No local overrides — using base config ($(jq -r '.providers | keys | length' <<< "$MERGED") providers)"
fi

# ---- write ----
if [[ "$MODE" == "dry-run" ]]; then
  echo ""
  echo "Would write to $OUTPUT:"
  jq . <<< "$MERGED" | head -40
  echo "  ... ($(jq -r '.providers | keys | length' <<< "$MERGED") providers total)"
else
  mkdir -p "$(dirname "$OUTPUT")"
  echo "$MERGED" > "$OUTPUT"
  ok "Wrote $OUTPUT"
fi
