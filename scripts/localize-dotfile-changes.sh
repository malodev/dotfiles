#!/usr/bin/env bash
#=============================================================================
# localize-dotfile-changes.sh
#
# Detect local (machine-specific) modifications to managed dotfiles
# (bash/zsh rc, profile, env, aliases) that differ from the git-tracked
# version, and extract the machine-specific additions into:
#   ~/.bashrc_local  (for bash files)
#   ~/.zshrc_local   (for zsh files)
#
# These _local files are NOT tracked in the dotfiles repo, so each machine's
# customizations stay on that machine.
#
# Usage:
#   ./scripts/localize-dotfile-changes.sh          # Interactive: show each diff, ask
#   ./scripts/localize-dotfile-changes.sh --apply   # Non-interactive, extract all
#   ./scripts/localize-dotfile-changes.sh --dry-run # Preview only
#   ./scripts/localize-dotfile-changes.sh --restore # Restore managed files to git state
#=============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOTFILES_REPO="$SCRIPT_DIR"
HOME_DIR="$HOME"

MODE="interactive"  # interactive | apply | dry-run | restore

for arg in "$@"; do
  case "$arg" in
    --apply)     MODE="apply" ;;
    --dry-run)   MODE="dry-run" ;;
    --restore)   MODE="restore" ;;
    --help|-h)
      echo "Usage: $0 [--apply|--dry-run|--restore]"
      echo ""
      echo "  (no flag)  Interactive: show each diff and ask before extracting"
      echo "  --apply    Non-interactive: extract all diffs to _local files"
      echo "  --dry-run  Preview what would happen (no changes)"
      echo "  --restore  Restore managed files to git version (remove local overrides)"
      exit 0 ;;
  esac
done

#=============================================================================
# Pretty printing
#=============================================================================
info()   { echo -e "  \033[1;34m•\033[0m $1"; }
ok()     { echo -e "  \033[1;32m✓\033[0m $1"; }
warn()   { echo -e "  \033[1;33m⚠\033[0m $1"; }
error()  { echo -e "  \033[1;31m✗\033[0m $1" >&2; }
header() { echo -e "\n\033[1;36m$1\033[0m"; }

confirm() {
  [[ "$MODE" == "apply" ]] && return 0
  local prompt="$1"
  local answer
  echo ""
  read -p "  $prompt [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" ]]
}

# Show diff with optional truncation for large diffs
show_diff_summary() {
  local diff_text="$1"
  local line_count
  line_count=$(echo "$diff_text" | wc -l)

  if [[ "$line_count" -le 80 ]]; then
    echo "$diff_text" | sed 's/^/  /'
  else
    echo "$diff_text" | head -30 | sed 's/^/  /'
    echo "  ... ($((line_count - 60))) lines omitted ..."
    echo "$diff_text" | tail -30 | sed 's/^/  /'
  fi
}

#=============================================================================
# Managed dotfile definitions
# Format: "repo_rel_path:home_file:local_target"
#=============================================================================
MANAGED_FILES=(
  "bash/.bashrc:$HOME/.bashrc:$HOME/.bashrc_local"
  "bash/.bash_profile:$HOME/.bash_profile:$HOME/.bashrc_local"
  "bash/.bash_aliases:$HOME/.bash_aliases:$HOME/.bashrc_local"
  "zsh/.zshrc:$HOME/.zshrc:$HOME/.zshrc_local"
  "zsh/.zshenv:$HOME/.zshenv:$HOME/.zshrc_local"
  "zsh/.zprofile:$HOME/.zprofile:$HOME/.zshrc_local"
  "zsh/.zlogin:$HOME/.zlogin:$HOME/.zshrc_local"
)

any_extracted=0
any_restored=0

#=============================================================================
# Phase 1 — Detect differences
#=============================================================================
header "Detecting local changes to managed dotfiles..."

declare -a changed_entries=()

for entry in "${MANAGED_FILES[@]}"; do
  IFS=':' read -r repo_rel home_path local_file <<< "$entry"
  repo_path="$DOTFILES_REPO/$repo_rel"

  repo_content=""
  home_content=""
  [[ -f "$repo_path" ]] && repo_content=$(cat "$repo_path")
  [[ -f "$home_path" ]] && home_content=$(cat "$home_path")

  if [[ "$home_content" == "$repo_content" ]]; then
    continue
  fi
  if [[ -z "$home_content" && -z "$repo_content" ]]; then
    continue
  fi

  changed_entries+=("$entry")
  info "$(basename "$home_path") differs from git version"
done

if [[ ${#changed_entries[@]} -eq 0 ]]; then
  ok "All managed dotfiles are in sync with git. No changes to extract."
  exit 0
fi

#=============================================================================
# Phase 2 — Handle --restore
#=============================================================================
if [[ "$MODE" == "restore" ]]; then
  header "Restoring all managed files to git version..."

  for entry in "${changed_entries[@]}"; do
    IFS=':' read -r repo_rel home_path local_file <<< "$entry"
    repo_path="$DOTFILES_REPO/$repo_rel"
    name=$(basename "$home_path")

    cat "$repo_path" > "$home_path" 2>/dev/null || error "Could not write $home_path"
    ok "Restored $name from git version"
    any_restored=1
  done

  echo ""
  if [[ "$any_restored" == "1" ]]; then
    ok "All managed files restored. Machine-specific changes are lost (check ~/.bashrc_local / ~/.zshrc_local for backups)."
  fi
  exit 0
fi

#=============================================================================
# Phase 3 — Extract machine-specific lines for each changed file
#=============================================================================
if [[ "$MODE" == "dry-run" ]]; then
  header "DRY RUN: Would check and optionally extract changes"
else
  header "Extracting machine-specific lines to _local files..."
fi

for entry in "${changed_entries[@]}"; do
  IFS=':' read -r repo_rel home_path local_file <<< "$entry"
  repo_path="$DOTFILES_REPO/$repo_rel"
  name=$(basename "$home_path")
  local_name=$(basename "$local_file")

  echo ""
  echo "━━━ $name ━━━"
  echo "  Repo: $repo_rel"
  echo "  Home: $home_path → $local_name"

  # Generate the diff (capture to avoid pipefail issues)
  diff_output=$(diff -u "$repo_path" "$home_path" 2>/dev/null || true)

  show_diff_summary "$diff_output"

  # Extract added lines (starting with +, excluding +++ header)
  # sed: print only '+' lines, then strip leading '+', but skip '+++' header
  added_lines=$(echo "$diff_output" | sed -n '/^+++/d; /^+/ s/^+//p' || true)

  if [[ -z "$added_lines" ]]; then
    warn "No added lines found — changes appear to be deletions or edits only."
    info "Machine-specific lines must be added (not just modified in place) to be extractable."
    continue
  fi

  echo ""
  info "Lines that would move to $local_name:"
  line_count=$(echo "$added_lines" | wc -l)
  if [[ "$line_count" -gt 30 ]]; then
    echo "$added_lines" | head -15 | sed 's/^/    │ /'
    echo "    │ ... ($((line_count - 30))) more lines ..."
    echo "$added_lines" | tail -15 | sed 's/^/    │ /'
  else
    echo "$added_lines" | sed 's/^/    │ /'
  fi

  if [[ "$MODE" == "dry-run" ]]; then
    info "[DRY-RUN] Would prompt to extract these to $local_name"
    continue
  fi

  if ! confirm "Extract these additions to $local_name and restore $name to git version?"; then
    info "Skipped $name"
    continue
  fi

  # --- Append to _local file ---
  if [[ ! -f "$local_file" ]]; then
    touch "$local_file"
  fi
  if [[ -s "$local_file" ]]; then
    lastchar=$(tail -c 1 "$local_file" | od -A n -t x1 | tr -d ' ')
    if [[ -n "$lastchar" && "$lastchar" != "0a" ]]; then
      echo "" >> "$local_file"
    fi
    echo "" >> "$local_file"
  fi

  {
    echo "# >>> extracted from $name on $(date +%Y-%m-%d)"
    echo "$added_lines"
    echo "# <<< end $name extraction"
  } >> "$local_file"

  ok "Appended additions to $local_name"

  # --- Restore the managed file from git ---
  cat "$repo_path" > "$home_path" 2>/dev/null || error "Could not restore $name"
  ok "Restored $name from git version"

  any_extracted=1
done

#=============================================================================
# Phase 4 — Summary
#=============================================================================
echo ""
if [[ "$MODE" == "dry-run" ]]; then
  header "Dry-run complete"
  info "Run without --dry-run to apply, or use --restore to wipe local changes."
elif [[ "$any_extracted" == "1" ]]; then
  header "Summary"
  echo ""
  ok "Machine-specific lines extracted to _local files."
  echo ""
  for lf in "$HOME/.bashrc_local" "$HOME/.zshrc_local"; do
    [[ -f "$lf" ]] && echo "    • $lf ($(wc -l < "$lf") lines)"
  done
  echo ""
  info "The managed dotfiles already source _local files:"
  echo "    ~/.bashrc → sources ~/.bashrc_local"
  echo "    ~/.zshrc  → sources ~/.zshrc_local"
  echo ""
  info "To apply changes to your current shell:"
  echo "    exec bash   # or: exec zsh"
else
  info "No changes were extracted."
fi
