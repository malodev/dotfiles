#!/usr/bin/env bash
#=============================================================================
# unstow-as-real.sh
#
# Converts stow symlinks into real files, then removes the dotfiles repo.
# Use case: bootstrap a shared machine with your configs, then delete
# your personal repo while keeping the functional configs in place.
#
# Usage:
#   ./scripts/unstow-as-real.sh              # Bake everything, then remove repo
#   ./scripts/unstow-as-real.sh --keep-repo  # Bake everything, keep the repo
#   ./scripts/unstow-as-real.sh --dry-run     # Show what would happen
#   ./scripts/unstow-as-real.sh bash zsh     # Bake only specific packages
#=============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="$HOME"
REMOVE_REPO=1
DRY_RUN=0
PACKAGES=()

info()  { echo -e "  \033[1;34m•\033[0m $1"; }
ok()    { echo -e "  \033[1;32m✓\033[0m $1"; }
warn()  { echo -e "  \033[1;33m⚠\033[0m $1"; }

for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=1 ;;
    --keep-repo)  REMOVE_REPO=0 ;;
    --help|-h)
      echo "Usage: $0 [--dry-run|--keep-repo] [packages...]"
      echo ""
      echo "  (no args)      Convert all stow'd packages to real files, remove repo"
      echo "  --keep-repo     Convert but don't delete the dotfiles repo"
      echo "  --dry-run       Preview only"
      echo "  bash zsh ...    Convert only specific packages"
      exit 0 ;;
    *) PACKAGES+=("$arg") ;;
  esac
done

if ! command -v stow &>/dev/null; then
  warn "stow is not installed. Nothing to do."
  exit 0
fi

# If no packages specified, find all stow'd packages
if [[ ${#PACKAGES[@]} -eq 0 ]]; then
  while IFS= read -r dir; do
    dir="${dir%/}"
    [[ -d "$SCRIPT_DIR/$dir" ]] && PACKAGES+=("$dir")
  done < <(ls "$SCRIPT_DIR")
fi

echo ""
header="Baking stow symlinks into real files"
[[ "$DRY_RUN" == "1" ]] && header+=" (DRY RUN)"
echo -e "  \033[1;36m$header\033[0m"
echo ""

converted=0
for pkg in "${PACKAGES[@]}"; do
  pkg_dir="$SCRIPT_DIR/$pkg"
  [[ ! -d "$pkg_dir" ]] && continue

  # Find all files in the package directory
  while IFS= read -r -d '' repo_file; do
    rel="${repo_file#$pkg_dir/}"
    target="$HOME_DIR/$rel"

    # Only act if target is a symlink pointing into our dotfiles
    if [[ ! -L "$target" ]]; then
      continue
    fi
    link_target=$(readlink "$target")
    if [[ "$link_target" != *"dotfiles/$pkg/"* && "$link_target" != *"$pkg/$rel"* ]]; then
      continue
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
      info "[DRY-RUN] $rel → would copy to real file"
      continue
    fi

    # Copy the content from the symlink target, preserving mode
    cp --remove-destination "$target" "$target.tmp" 2>/dev/null \
      && mv "$target.tmp" "$target"
    [[ -f "$target" && ! -L "$target" ]] && ok "$rel → real file"
    converted=1
  done < <(find "$pkg_dir" -type f -print0 2>/dev/null)
done

if [[ "$DRY_RUN" == "1" ]]; then
  echo ""
  info "Dry-run complete. Run without --dry-run to apply."
  exit 0
fi

if [[ "$converted" == "0" ]]; then
  info "No stow symlinks found to convert."
  exit 0
fi

echo ""
ok "All stow symlinks converted to real files."

# Remove the dotfiles repo
if [[ "$REMOVE_REPO" == "1" ]]; then
  echo ""
  warn "Removing dotfiles repo at $SCRIPT_DIR"
  rm -rf "$SCRIPT_DIR"
  ok "Dotfiles repo removed. Configs remain as real files."
else
  info "Dotfiles repo kept at $SCRIPT_DIR (--keep-repo)"
fi
