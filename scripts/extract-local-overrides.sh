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
#   ./scripts/extract-local-overrides.sh --list           # list tracked files
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
    --merge)   MODE="merge" ;;
    --list)    MODE="list" ;;
    --help|-h) MODE="help" ;;
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
# Format:
#   sentinel-based: "repo_rel|home_path|local_override_path"
#   merge-based:    "repo_rel|home_path|local_override_path|merge_command"
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
  "pi/.pi/agent/models.json|$HOME/.pi/agent/models.json|$HOME/.pi/agent/models_local.json|$SCRIPT_DIR/scripts/merge-models.sh"
)

#-------------------------------------------------------------------------
# --list: print tracked files
#-------------------------------------------------------------------------
if [[ "$MODE" == "list" ]]; then
  printf '%-45s → %s\n' "TRACKED (repo)" "LOCAL OVERRIDE (untracked)"
  printf '%-45s   %s\n' "━━━━━━━━━━━━━━━━━━━━━━━━" "━━━━━━━━━━━━━━━━━━━━━━━━━━"
  for entry in "${MANAGED_FILES[@]}"; do
    IFS='|' read -r repo_rel home_path local_path merge_cmd <<< "$entry"
    printf '%-45s → %s\n' "$repo_rel" "$local_path"
  done
  exit 0
fi

#-------------------------------------------------------------------------
# --help
#-------------------------------------------------------------------------
if [[ "$MODE" == "help" ]]; then
  echo "Usage: extract-local-overrides.sh [--apply|--merge|--dry-run|--list|--help]"
  echo ""
  echo "  (no flag)  Show status of all managed files"
  echo "  --apply    Extract sentinel-based diffs to _local files"
  echo "  --merge    Run merge scripts for merge-based files (e.g. models.json)"
  echo "  --dry-run  Preview what would be extracted"
  echo "  --list     List tracked files and their local overrides"
  echo "  --help     Show this help"
  exit 0
fi

if [[ "$MODE" == "merge" ]]; then
  header "Running merge for merge-based files..."
  any_merged=0
  for entry in "${MANAGED_FILES[@]}"; do
    IFS='|' read -r repo_rel home_path local_path merge_cmd <<< "$entry"
    [[ -z "$merge_cmd" ]] && continue
    name="$(basename "$home_path")"
    if [[ -x "$merge_cmd" ]]; then
      info "$name → $merge_cmd"
      "$merge_cmd"
      any_merged=$((any_merged + 1))
    else
      warn "$name: merge script not found: $merge_cmd"
    fi
  done
  echo ""
  if [[ $any_merged -gt 0 ]]; then
    ok "Ran $any_merged merge script(s)."
  else
    info "No merge-based files configured."
  fi
  exit 0
fi

#-------------------------------------------------------------------------
# Phase 1 — check each file
#-------------------------------------------------------------------------
if [[ "$MODE" == "interactive" ]]; then
  printf '%-40s %s\n' "FILE" "STATUS"
  printf '%-40s %s\n' "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "━━━━━━━━"
else
  header "Checking managed dotfiles for sentinel..."
fi

clean=0
migrated=0
declare -a to_migrate=()

for entry in "${MANAGED_FILES[@]}"; do
  IFS='|' read -r repo_rel home_path local_path merge_cmd <<< "$entry"
  repo_path="$DOTFILES_REPO/$repo_rel"
  name="$(basename "$home_path")"
  local_name="$(basename "$local_path")"

  [[ ! -f "$home_path" ]] && continue
  [[ ! -f "$repo_path" ]] && { warn "$repo_rel missing from repo — skipping"; continue; }

  # models.json uses merge-models.sh instead of sentinel
  if [[ "$name" == "models.json" ]]; then
    if [[ "$MODE" == "interactive" ]]; then
      printf '%-40s \033[1;36mmerge-based\033[0m\n' "$name"
    fi
    continue
  fi

  last_line="$(tail -n 1 "$home_path" 2>/dev/null || true)"

  if [[ "$last_line" == "$SENTINEL" ]]; then
    clean=$((clean + 1))
    if [[ "$MODE" == "interactive" ]]; then
      printf '%-40s \033[1;32m✓ clean\033[0m\n' "$name"
    fi
    continue
  fi

  to_migrate+=("$entry")
  if [[ "$MODE" == "interactive" ]]; then
    printf '%-40s \033[1;33m✗ needs migration\033[0m\n' "$name"
  else
    info "$name — sentinel missing (needs migration)"
  fi
done

if [[ $clean -eq ${#MANAGED_FILES[@]} && "$MODE" != "interactive" ]]; then
  ok "All files have sentinel — nothing to do."
  exit 0
fi

if [[ "$MODE" == "interactive" ]]; then
  echo ""
  if [[ ${#to_migrate[@]} -eq 0 ]]; then
    ok "All files clean."
    exit 0
  fi
  info "${#to_migrate[@]} file(s) need migration. Run with --dry-run to preview or --apply to migrate."
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
  IFS='|' read -r repo_rel home_path local_path merge_cmd <<< "$entry"
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
