#!/usr/bin/env bash
#=============================================================================
# import-pi-settings.sh
#
# Shows new keys found in ~/.pi/agent/settings.json that are NOT in the
# template (pi/.pi/agent/settings.json.template), and asks one by one
# whether to import them into the template so they're shared across machines.
#
# Usage:
#   ./scripts/import-pi-settings.sh                     # Interactive: review each new key
#   ./scripts/import-pi-settings.sh --dry-run           # Just show what differs
#   ./scripts/import-pi-settings.sh --import-all         # Import everything non-interactively
#=============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$SCRIPT_DIR/pi/.pi/agent/settings.json.template"
ACTIVE="$HOME/.pi/agent/settings.json"
TMPFILE=""

MODE="interactive"
for arg in "$@"; do
  case "$arg" in
    --dry-run)    MODE="dry-run" ;;
    --import-all) MODE="import-all" ;;
    --help|-h)
      echo "Usage: $0 [--dry-run|--import-all]"
      echo ""
      echo "  (no flag)    Interactive: show each new key from active settings"
      echo "               and ask whether to import it into the template"
      echo "  --dry-run    Just list what keys exist only in active settings"
      echo "  --import-all  Import all new keys without asking"
      exit 0 ;;
  esac
done

info()  { echo -e "  \033[1;34m•\033[0m $1"; }
ok()    { echo -e "  \033[1;32m✓\033[0m $1"; }
warn()  { echo -e "  \033[1;33m⚠\033[0m $1"; }

if ! command -v jq &>/dev/null; then
  echo "jq is required. Install it first."
  exit 1
fi

if [[ ! -f "$TEMPLATE" ]]; then
  warn "Template not found: $TEMPLATE"
  exit 1
fi
if [[ ! -f "$ACTIVE" ]]; then
  warn "Active settings not found: $ACTIVE"
  exit 1
fi

echo ""
echo "Checking for settings in $ACTIVE"
echo "that are not in $TEMPLATE"
echo ""

# Collect keys present in active but NOT in template
active_keys=$(jq -r 'keys[]' "$ACTIVE" | sort)
template_keys=$(jq -r 'keys[]' "$TEMPLATE" | sort)
new_only=$(comm -23 <(echo "$active_keys") <(echo "$template_keys"))

if [[ -z "$new_only" ]]; then
  ok "Active settings have no new keys. Nothing to import."
  exit 0
fi

echo "New keys found (in active, not in template):"
for key in $new_only; do
  val=$(jq -r --arg k "$key" '.[$k]' "$ACTIVE")
  val_preview=$(echo "$val" | head -5)
  echo ""
  echo "  ── $key ──"
  echo "    $val_preview"
  if [[ $(echo "$val" | wc -l) -gt 5 ]]; then
    echo "    ... ($(echo "$val" | wc -l) total lines)"
  fi
done

if [[ "$MODE" == "dry-run" ]]; then
  echo ""
  info "Dry-run: no changes made. Run without --dry-run to import."
  exit 0
fi

echo ""

# Track what we imported
imported=0

for key in $new_only; do
  val=$(jq --arg k "$key" '.[$k]' "$ACTIVE")

  if [[ "$MODE" == "import-all" ]]; then
    answer="y"
  else
    echo ""
    read -p "  Import '$key' into template? [y/N/skip] " answer
  fi

  case "$answer" in
    y|Y|yes)
      if [[ -z "$TMPFILE" ]]; then
        TMPFILE=$(mktemp)
        cp "$TEMPLATE" "$TMPFILE"
      fi
      jq --arg k "$key" --argjson v "$val" '.[$k] = $v' "$TMPFILE" > "${TMPFILE}.out" \
        && mv "${TMPFILE}.out" "$TMPFILE"
      ok "Imported $key"
      imported=1
      ;;
    skip|s)
      info "Skipped $key"
      continue
      ;;
    *)
      info "Skipped $key"
      ;;
  esac
done

if [[ "$imported" == "1" ]]; then
  cp "$TMPFILE" "$TEMPLATE"
  rm -f "$TMPFILE" "${TMPFILE}.out"
  echo ""
  ok "Template updated: $TEMPLATE"
  echo ""
  info "Review and commit:  git diff pi/.pi/agent/settings.json.template"
else
  rm -f "$TMPFILE" "${TMPFILE}.out"
  echo ""
  info "Nothing imported."
fi
