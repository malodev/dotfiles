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
# deleteToLineStart in keybindings.json), which is why none of them is tracked:
# the templates are the versioned part, the live files are runtime state.
#
# models.json and mcp.json also hold host endpoints and paths, so --force
# leaves them alone unless --force-host says otherwise.
#
# Usage:
#   ./scripts/init-pi-settings.sh                # Copy each missing file
#   ./scripts/init-pi-settings.sh --force         # Overwrite from templates
#   ./scripts/init-pi-settings.sh --force-host    # --force, host files included
#   ./scripts/init-pi-settings.sh --dry-run       # Show what would happen
#   ./scripts/init-pi-settings.sh --diff          # Show template vs current
#=============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATES="$SCRIPT_DIR/pi/.pi/agent"
LIVE="$HOME/.pi/agent"

# Each has <name>.json.template in the repo and a live <name>.json here.
NAMES=(settings keybindings models mcp)

# These carry host endpoints and paths, so resetting them from the template
# silently repoints this machine. --force skips them unless --force-host.
HOST_NAMES=(models mcp)

is_host_name() {
  local name="$1" entry
  for entry in "${HOST_NAMES[@]}"; do
    [[ "$entry" == "$name" ]] && return 0
  done
  return 1
}

MODE="normal"
FORCE_HOST=0
SETTINGS_PROFILE="essential"

for arg in "$@"; do
  case "$arg" in
    --force)      MODE="force" ;;
    --force-host) MODE="force"; FORCE_HOST=1 ;;
    --full)       SETTINGS_PROFILE="full" ;;
    --essential)  SETTINGS_PROFILE="essential" ;;
    --dry-run)    MODE="dry-run" ;;
    --diff)       MODE="diff" ;;
    --help|-h)
      echo "Usage: $0 [--force|--force-host|--full|--essential|--dry-run|--diff]"
      echo ""
      echo "  (no flag)    Copy each missing template into $LIVE (uses essential settings)"
      echo "  --full       Use settings-full.json.template (all optional Pi packages)"
      echo "  --essential  Use settings.json.template (essential bootstrap Pi packages)"
      echo "  --force      Overwrite existing files with their templates"
      echo "  --force-host --force for models.json and mcp-adapter.json as well"
      echo "  --dry-run    Preview without writing"
      echo "  --diff       Show differences between each template and current"
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
    models)
      info "Point the providers at this host and keep the key commands here:"
      info "  baseUrl  http://127.0.0.1:8000/v1                 — local mlx server"
      info "  apiKey   !cat ~/.config/tokenator/litellm-api-key"
      info "pi records the last used model in this file as well."
      ;;
    mcp)
      info "Native pi MCP servers. Point the local ones at this host's build:"
      info "  args      ~/.local/src/mcp-gam/dist/index.js"
      info "  GAM_PATH  \${HOME}/bin/gam7/gam"
      ;;
  esac
}

failed=0

for name in "${NAMES[@]}"; do
  template="$TEMPLATES/$name.json.template"
  if [[ "$name" == "settings" && "$SETTINGS_PROFILE" == "full" && -f "$TEMPLATES/settings-full.json.template" ]]; then
    template="$TEMPLATES/settings-full.json.template"
  fi
  output="$LIVE/$name.json"

  if [[ ! -f "$template" ]]; then
    warn "Template not found: $template"
    failed=1
    continue
  fi

  if [[ "$MODE" == "force" ]] && is_host_name "$name" && [[ "$FORCE_HOST" != "1" ]]; then
    warn "$name.json holds host endpoints — left alone (--force-host to reset it)"
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

# The search settings live in the XDG directory rather than .pi/agent, and hold the same
# credential commands, so they get the same treatment: tracked template, live file, and --force
# leaves the live one alone unless --force-host says otherwise.
search_template="$SCRIPT_DIR/pi/.config/pi/web-search.json.template"
search_live="${XDG_CONFIG_HOME:-$HOME/.config}/pi/web-search.json"

if [[ -f "$search_template" ]]; then
  case "$MODE" in
    diff)
      echo "=== web-search.json ==="
      if [[ ! -f "$search_live" ]]; then
        info "No existing web-search.json — template would be copied fresh"
      else
        diff -u "$search_live" "$search_template" 2>/dev/null && info "Identical" || true
      fi
      ;;
    dry-run)
      info "[DRY-RUN] web-search.json: $([[ -f "$search_live" ]] && echo "exists, --force would reset it" || echo "would be created")"
      ;;
    force)
      if [[ "$FORCE_HOST" != "1" ]]; then
        warn "web-search.json holds credential commands — left alone (--force-host to reset it)"
      else
        mkdir -p "$(dirname "$search_live")"
        cp "$search_template" "$search_live"
        warn "Overwrote $search_live with template"
      fi
      ;;
    *)
      if [[ -f "$search_live" ]]; then
        ok "$search_live already exists — no action needed (use --force to reset to template)"
      else
        mkdir -p "$(dirname "$search_live")"
        cp "$search_template" "$search_live"
        ok "Created $search_live from template"
        info "Add this host's provider keys here: \"braveApiKey\": \"!cat ~/.config/pi-secrets/brave\", ..."
      fi
      ;;
  esac
fi

exit $failed
