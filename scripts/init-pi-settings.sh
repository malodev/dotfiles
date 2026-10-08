#!/usr/bin/env bash
#=============================================================================
# init-pi-settings.sh
#
# Seeds ~/.pi/agent/<name>.json from pi/.pi/agent/<name>.json.template on first
# run. Only copies when the live file doesn't exist yet — never overwrites
# customizations.
#
# The templates hold shared defaults. The live files are per host and pi writes
# fields of its own into them (lastChangelogVersion in settings.json,
# deleteToLineStart in keybindings.json), which is why neither is tracked: the
# templates are the versioned part, the live files are runtime state.
#
# Usage:
#   ./scripts/init-pi-settings.sh              # Copy each missing file
#   ./scripts/init-pi-settings.sh --force       # Overwrite both from templates
#   ./scripts/init-pi-settings.sh --dry-run     # Show what would happen
#   ./scripts/init-pi-settings.sh --diff        # Show template vs current
#=============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATES="$SCRIPT_DIR/pi/.pi/agent"
LIVE="$HOME/.pi/agent"

# Each has <name>.json.template in the repo and a live <name>.json here.
NAMES=(settings keybindings)

MODE="normal"

for arg in "$@"; do
  case "$arg" in
    --force)   MODE="force" ;;
    --dry-run) MODE="dry-run" ;;
    --diff)    MODE="diff" ;;
    --help|-h)
      echo "Usage: $0 [--force|--dry-run|--diff]"
      echo ""
      echo "  (no flag)  Copy each missing template into $LIVE"
      echo "  --force    Overwrite existing files with their templates"
      echo "  --dry-run  Preview without writing"
      echo "  --diff     Show differences between each template and current"
      exit 0 ;;
  esac
done

info()  { echo -e "  \033[1;34m•\033[0m $1"; }
ok()    { echo -e "  \033[1;32m✓\033[0m $1"; }
warn()  { echo -e "  \033[1;33m⚠\033[0m $1"; }

# Machine-specific keys worth adding by hand, printed once per seeded file.
hint_for() {
  case "$1" in
    settings)
      info "Edit it to add machine-specific keys if needed:"
      info "  \"defaultModel\"    — e.g. \"claude-sonnet-4-20250514\""
      info "  \"defaultProvider\" — e.g. \"openrouter\""
      info "  \"tools\"            — machine-specific write paths"
      info "pi works without them — it picks sensible defaults."
      ;;
    keybindings)
      info "Add machine-specific bindings here. pi records its own fields in"
      info "this file too, which is fine — it is not tracked, so nothing to commit."
      ;;
  esac
}

failed=0

for name in "${NAMES[@]}"; do
  template="$TEMPLATES/$name.json.template"
  output="$LIVE/$name.json"

  if [[ ! -f "$template" ]]; then
    warn "Template not found: $template"
    failed=1
    continue
  fi

  case "$MODE" in
    diff)
      echo "=== $name.json ==="
      if [[ ! -f "$output" ]]; then
        info "No existing $name.json — template would be copied fresh"
        continue
      fi
      diff -u "$output" "$template" 2>/dev/null && info "Identical" || true
      ;;
    dry-run)
      if [[ -f "$output" ]]; then
        info "[DRY-RUN] Would overwrite $output (use --force)"
      else
        info "[DRY-RUN] Would copy template to $output"
      fi
      ;;
    *)
      if [[ -f "$output" && "$MODE" != "force" ]]; then
        ok "$output already exists — no action needed (use --force to reset to template)"
        continue
      fi

      mkdir -p "$LIVE"
      cp "$template" "$output"

      if [[ "$MODE" == "force" ]]; then
        warn "Overwrote $output with template"
      else
        ok "Created $output from template"
        echo ""
        hint_for "$name"
      fi
      ;;
  esac
done

exit $failed
