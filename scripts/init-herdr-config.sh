#!/usr/bin/env bash
#=============================================================================
# init-herdr-config.sh
#
# Seeds ~/.config/herdr/config.toml from herdr/.config/herdr/config.toml.template
# on first run. Only copies when the live file doesn't exist — never overwrites
# customizations.
#
# The template holds the shared defaults. The live file is per host because the
# theme is a machine preference: this box pins tokyo-night while Omarchy is on
# Ayaka, and `"terminal"` in the template would follow Omarchy instead. herdr
# has no include or config.local layer — HERDR_CONFIG_PATH swaps the whole file —
# so the split has to happen here.
#
# Standalone on purpose: scripts/init-pi-settings.sh covers ~/.pi/agent and is
# being worked on in parallel.
#
# Usage:
#   ./scripts/init-herdr-config.sh            # Copy the template if missing
#   ./scripts/init-herdr-config.sh --force    # Overwrite with the template
#   ./scripts/init-herdr-config.sh --dry-run  # Show what would happen
#   ./scripts/init-herdr-config.sh --diff     # Show template vs current
#=============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$SCRIPT_DIR/herdr/.config/herdr/config.toml.template"
OUTPUT="$HOME/.config/herdr/config.toml"

MODE="normal"

for arg in "$@"; do
  case "$arg" in
    --force)   MODE="force" ;;
    --dry-run) MODE="dry-run" ;;
    --diff)    MODE="diff" ;;
    --help|-h)
      echo "Usage: $0 [--force|--dry-run|--diff]"
      echo ""
      echo "  (no flag)  Copy the template to $OUTPUT if missing"
      echo "  --force    Overwrite the live config with the template"
      echo "  --dry-run  Preview without writing"
      echo "  --diff     Show differences between template and current"
      exit 0 ;;
  esac
done

info()  { echo -e "  \033[1;34m•\033[0m $1"; }
ok()    { echo -e "  \033[1;32m✓\033[0m $1"; }
warn()  { echo -e "  \033[1;33m⚠\033[0m $1"; }

if [[ ! -f "$TEMPLATE" ]]; then
  warn "Template not found: $TEMPLATE"
  exit 1
fi

case "$MODE" in
  diff)
    if [[ ! -f "$OUTPUT" ]]; then
      info "No existing config.toml — template would be copied fresh"
      exit 0
    fi
    diff -u "$OUTPUT" "$TEMPLATE" 2>/dev/null && info "Identical" || true
    ;;
  dry-run)
    if [[ -f "$OUTPUT" ]]; then
      info "[DRY-RUN] Would overwrite $OUTPUT (use --force)"
    else
      info "[DRY-RUN] Would copy template to $OUTPUT"
    fi
    ;;
  *)
    if [[ -f "$OUTPUT" && "$MODE" != "force" ]]; then
      ok "$OUTPUT already exists — no action needed (use --force to reset to template)"
      exit 0
    fi

    mkdir -p "$(dirname "$OUTPUT")"
    cp "$TEMPLATE" "$OUTPUT"

    if [[ "$MODE" == "force" ]]; then
      warn "Overwrote $OUTPUT with template"
    else
      ok "Created $OUTPUT from template"
      echo ""
      info "Set this machine's theme in it:"
      info "  [theme]"
      info "  name = \"tokyo-night\"   # or \"terminal\" to follow Omarchy's palette"
    fi
    ;;
esac
