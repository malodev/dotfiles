#!/usr/bin/env bash
#=============================================================================
# init-pi-settings.sh
#
# Initializes ~/.pi/agent/settings.json from the template on first run.
# Only copies if the file doesn't exist yet — never overwrites user customizations.
#
# The template contains shared defaults (packages, theme, shortcuts).
# Machine-specific settings (model, provider) are configured by the user
# directly in ~/.pi/agent/settings.json after first copy, and pi itself
# auto-updates lastChangelogVersion and similar fields.
#
# Usage:
#   ./scripts/init-pi-settings.sh              # Copy if missing
#   ./scripts/init-pi-settings.sh --force       # Overwrite existing
#   ./scripts/init-pi-settings.sh --dry-run     # Show what would happen
#   ./scripts/init-pi-settings.sh --diff        # Show diff between template and current
#=============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$SCRIPT_DIR/pi/.pi/agent/settings.json.template"
OUTPUT="$HOME/.pi/agent/settings.json"

MODE="normal"

for arg in "$@"; do
  case "$arg" in
    --force)   MODE="force" ;;
    --dry-run) MODE="dry-run" ;;
    --diff)    MODE="diff" ;;
    --help|-h)
      echo "Usage: $0 [--force|--dry-run|--diff]"
      echo ""
      echo "  (no flag)  Copy template to ~/.pi/agent/settings.json if missing"
      echo "  --force    Overwrite existing settings.json with template"
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

if [[ "$MODE" == "diff" ]]; then
  if [[ ! -f "$OUTPUT" ]]; then
    info "No existing settings.json — template would be copied fresh"
    exit 0
  fi
  diff -u "$OUTPUT" "$TEMPLATE" 2>/dev/null && info "Identical" || true
  exit 0
fi

if [[ "$MODE" == "dry-run" ]]; then
  if [[ -f "$OUTPUT" ]]; then
    info "[DRY-RUN] Would overwrite $OUTPUT (use --force)"
  else
    info "[DRY-RUN] Would copy template to $OUTPUT"
  fi
  exit 0
fi

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
  info "Edit it to add machine-specific keys if needed:"
  info "  \"defaultModel\"    — e.g. \"claude-sonnet-4-20250514\""
  info "  \"defaultProvider\" — e.g. \"openrouter\""
  info "  \"tools\"            — machine-specific write paths"
  info "pi works without them — it picks sensible defaults."
fi
