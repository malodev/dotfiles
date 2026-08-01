#!/usr/bin/env bash
#=============================================================================
# extract-local-overrides.sh
#
# Ensure managed dotfiles end with a sentinel line. If they don't, the file
# has machine-specific additions — extract those into a `_local` file (which
# is NOT tracked by git) and restore the managed file from the repo.
#
# Once migrated, the script is idempotent: every file with the sentinel is
# skipped cleanly. Machine-specific settings then live only in `_local` files.
#
# Usage:
#   ./scripts/extract-local-overrides.sh                 # interactive
#   ./scripts/extract-local-overrides.sh --apply          # non-interactive
#   ./scripts/extract-local-overrides.sh --dry-run        # preview only
#=============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOTFILES_REPO="$SCRIPT_DIR"

SENTINEL="# >>> END MANAGED CONFIG <<<"

MODE="interactive"
for arg in "$@"; do
  case "$arg" in
    --apply)   MODE="apply" ;;
    --dry-run) MODE="dry-run" ;;
    --help|-h) sed -n '2,/^$/p' "$0" | tail -n +2; exit 0 ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

info()  { echo -e "  \033[1;34m•\033[0m $*"; }
ok()    { echo -e "  \033[1;32m✓\033[0m $*"; }
warn()  { echo -e "  \033[1;33m⚠\033[0m $*"; }
header(){ echo -e "\n\033[1;36m$*\033[0m"; }

confirm() {
  [[ "$MODE" == "apply" ]] && return 0
  local ans
  read -rp "  $* [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

# Format: "repo_relative_path|home_path|local_override_path"
MANAGED_FILES=(
  "zsh/.zshenv|$HOME/.zshenv|$HOME/.zshenv_local"
  "zsh/.zprofile|$HOME/.zprofile|$HOME/.zprofile_local"
  "zsh/.zlogin|$HOME/.zlogin|$HOME/.zlogin_local"
  "zsh/.zshrc|$HOME/.zshrc|$HOME/.zshrc_local"
  "bash/.bashrc|$HOME/.bashrc|$HOME/.bashrc_local"
  "bash/.bash_profile|$HOME/.bash_profile|$HOME/.bash_profile_local"
  "bash/.bash_aliases|$HOME/.bash_aliases|$HOME/.bash_aliases_local"
  "git/.gitconfig|$HOME/.gitconfig|$HOME/.gitconfig_local"
  "hyprland/.config/hypr/hyprland.conf|$HOME/.config/hypr/hyprland.conf|$HOME/.config/hypr/hyprland_local.conf"
  "hyprland/.config/hypr/monitors.conf|$HOME/.config/hypr/monitors.conf|$HOME/.config/hypr/monitors_local.conf"
)

#-------------------------------------------------------------------------
# Phase 1 — check each file
#-------------------------------------------------------------------------
header "Checking managed dotfiles for sentinel..."

clean=0
migrated=0
declare -a to_migrate=()

for entry in "${MANAGED_FILES[@]}"; do
  IFS='|' read -r repo_rel home_path local_path <<< "$entry"
  repo_path="$DOTFILES_REPO/$repo_rel"
  name="$(basename "$home_path")"
  local_name="$(basename "$local_path")"

  [[ ! -f "$home_path" ]] && continue
  [[ ! -f "$repo_path" ]] && { warn "$repo_rel missing from repo — skipping"; continue; }

  last_line="$(tail -n 1 "$home_path" 2>/dev/null || true)"

  if [[ "$last_line" == "$SENTINEL" ]]; then
    clean=$((clean + 1))
    continue
  fi

  to_migrate+=("$entry")
  info "$name — sentinel missing (needs migration)"
done

if [[ $clean -eq ${#MANAGED_FILES[@]} ]]; then
  ok "All files have sentinel — nothing to do."
  exit 0
fi

if [[ ${#to_migrate[@]} -eq 0 ]]; then
  exit 0
fi

#-------------------------------------------------------------------------
# Phase 2 — migrate files missing sentinel
#-------------------------------------------------------------------------
if [[ "$MODE" == "dry-run" ]]; then
  header "DRY RUN — would migrate these files:"
  for entry in "${to_migrate[@]}"; do
    IFS='|' read -r _ home_path _ <<< "$entry"
    info "$(basename "$home_path")"
  done
  exit 0
fi

header "Migrating files..."

for entry in "${to_migrate[@]}"; do
  IFS='|' read -r repo_rel home_path local_path <<< "$entry"
  repo_path="$DOTFILES_REPO/$repo_rel"
  name="$(basename "$home_path")"
  local_name="$(basename "$local_path")"

  echo ""
  echo "━━━ $name ━━━"

  # --- Find additions: diff + added lines ---
  diff_out="$(diff -u "$repo_path" "$home_path" 2>/dev/null || true)"
  added="$(echo "$diff_out" | sed -n '/^+++/d; /^+/ s/^+//p' || true)"

  if [[ -z "$added" ]]; then
    warn "No added lines — file may have been modified inline (edits, not appends)."
    info "Restoring from repo (inline edits will be lost)."
  else
    echo "  Lines to move to $local_name:"
    echo "$added" | sed 's/^/    │ /'
    echo ""

    if [[ "$MODE" != "apply" ]]; then
      confirm "Extract these to $local_name and restore $name?" || { info "Skipped."; continue; }
    fi

    # --- Append to _local file ---
    mkdir -p "$(dirname "$local_path")"
    if [[ -f "$local_path" && -s "$local_path" ]]; then
      echo "" >> "$local_path"
    fi
    {
      echo "# >>> extracted from $name on $(date +%Y-%m-%d)"
      echo "$added"
      echo "# <<< end $name"
    } >> "$local_path"
    ok "Appended to $local_name"
  fi

  # --- Restore from repo ---
  cp "$repo_path" "$home_path"
  ok "Restored $name from repo (now has sentinel)"
  migrated=$((migrated + 1))
done

#-------------------------------------------------------------------------
# Phase 3 — summary
#-------------------------------------------------------------------------
echo ""
header "Done"
if [[ $migrated -gt 0 ]]; then
  ok "Migrated $migrated file(s). Machine-specific lines are in:"
  for entry in "${to_migrate[@]}"; do
    IFS='|' read -r _ _ local_path <<< "$entry"
    [[ -f "$local_path" ]] && echo "    • $local_path"
  done
  echo ""
  info "To apply changes: exec zsh  (or: exec bash)"
else
  info "No files migrated."
fi
