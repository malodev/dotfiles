#!/usr/bin/env bash
#=============================================================================
# generate-pi-settings.sh
#
# Generates ~/.pi/agent/settings.json by merging:
#   1. The repo default template  (pi/.pi/agent/settings.default.json)
#   2. The machine-local overrides (pi/.pi/agent/settings.local.json — gitignored)
#
# The local file overrides matching keys in the default. Keys only in the
# default are preserved; keys only in local are added.
#
# Usage:
#   ./scripts/generate-pi-settings.sh              # Generate (interactive if local missing)
#   ./scripts/generate-pi-settings.sh --force       # Generate, overwrite existing
#   ./scripts/generate-pi-settings.sh --dry-run     # Preview only
#   ./scripts/generate-pi-settings.sh --init-local  # Create local from template
#=============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_FILE="$SCRIPT_DIR/pi/.pi/agent/settings.default.json"
LOCAL_TEMPLATE="$SCRIPT_DIR/pi/.pi/agent/settings.local.template.json"
LOCAL_FILE="$SCRIPT_DIR/pi/.pi/agent/settings.local.json"
OUTPUT_FILE="$HOME/.pi/agent/settings.json"

MODE="normal"  # normal | force | dry-run | init-local

for arg in "$@"; do
  case "$arg" in
    --force)     MODE="force" ;;
    --dry-run)   MODE="dry-run" ;;
    --init-local) MODE="init-local" ;;
    --help|-h)
      echo "Usage: $0 [--force|--dry-run|--init-local]"
      echo ""
      echo "  (no flag)    Generate settings.json (prompts if local file missing)"
      echo "  --force       Generate, overwriting existing settings.json"
      echo "  --dry-run     Preview the merged result without writing"
      echo "  --init-local  Create settings.local.json from template"
      exit 0 ;;
  esac
done

#=============================================================================
# Helpers
#=============================================================================
info()  { echo -e "  \033[1;34m•\033[0m $1"; }
ok()    { echo -e "  \033[1;32m✓\033[0m $1"; }
warn()  { echo -e "  \033[1;33m⚠\033[0m $1"; }
error() { echo -e "  \033[1;31m✗\033[0m $1" >&2; }
header(){ echo -e "\n\033[1;36m$1\033[0m"; }

#=============================================================================
# Checks
#=============================================================================
if ! command -v jq &>/dev/null; then
  error "jq is required for JSON merging. Install it and try again."
  exit 1
fi

if [[ ! -f "$DEFAULT_FILE" ]]; then
  error "Default template not found: $DEFAULT_FILE"
  exit 1
fi

header "Pi Settings Generator"

#=============================================================================
# Init-local mode
#=============================================================================
if [[ "$MODE" == "init-local" ]]; then
  if [[ -f "$LOCAL_FILE" ]]; then
    warn "$LOCAL_FILE already exists."
    read -p "  Overwrite? [y/N] " answer
    [[ "$answer" != "y" && "$answer" != "Y" ]] && exit 0
  fi

  cp "$LOCAL_TEMPLATE" "$LOCAL_FILE"
  info "Created $LOCAL_FILE from template."
  info "Edit it to set your default model, provider, and machine paths:"
  echo "    $LOCAL_FILE"
  exit 0
fi

#=============================================================================
# Ensure local file exists (or init from template)
#=============================================================================
if [[ ! -f "$LOCAL_FILE" ]]; then
  if [[ "$MODE" == "dry-run" ]]; then
    warn "[DRY-RUN] Local override not found: $LOCAL_FILE"
    info "[DRY-RUN] Would prompt to create it from template"
    exit 0
  fi

  echo ""
  warn "No local settings file found at $LOCAL_FILE"
  echo ""
  echo "  This file holds machine-specific settings (model, provider, paths)."
  echo "  It is gitignored — each machine has its own."
  echo ""
  read -p "  Create it from template now? [Y/n] " answer
  if [[ "$answer" != "n" && "$answer" != "N" ]]; then
    cp "$LOCAL_TEMPLATE" "$LOCAL_FILE"
    ok "Created $LOCAL_FILE"
    echo ""
    info "Open it and replace the __ placeholders with your values:"
    echo "    $LOCAL_FILE"
    echo ""
    info "Then re-run this script to generate settings.json."
    exit 0
  else
    info "Skipping. To create later: $0 --init-local"
    exit 0
  fi
fi

#=============================================================================
# Merge and generate
#=============================================================================
if [[ "$MODE" == "dry-run" ]]; then
  info "[DRY-RUN] Merging:"
  echo "    Default: $DEFAULT_FILE"
  echo "    Local:   $LOCAL_FILE"
  echo "    Output:  $OUTPUT_FILE"
  echo ""
  echo "  Merged result:"
  jq -s '.[0] * .[1]' "$DEFAULT_FILE" "$LOCAL_FILE"
  exit 0
fi

if [[ -f "$OUTPUT_FILE" && "$MODE" != "force" ]]; then
  warn "$OUTPUT_FILE already exists."
  read -p "  Overwrite? [y/N] " answer
  [[ "$answer" != "y" && "$answer" != "Y" ]] && exit 0
fi

mkdir -p "$(dirname "$OUTPUT_FILE")"

jq -s '.[0] * .[1]' "$DEFAULT_FILE" "$LOCAL_FILE" > "$OUTPUT_FILE"
ok "Generated $OUTPUT_FILE"
echo ""
info "  Default keys:   $(jq keys "$DEFAULT_FILE" | jq -r '.[]' | tr '\n' ', ' | sed 's/,$//')"
info "  Local overrides: $(jq keys "$LOCAL_FILE" | jq -r '.[]' | tr '\n' ', ' | sed 's/,$//')"
echo ""
info "To update local settings:  $EDITOR $LOCAL_FILE"
info "To regenerate:             $0 --force"
