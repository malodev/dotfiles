#!/usr/bin/env bash
set -euo pipefail

# Copies all skills from the mattpocock-skills repository into the pi stow
# source directory (~/dotfiles/pi/.pi/agent/skills), so they can be picked
# up by pi after stowing. Existing skill directories are overwritten.
#
# Usage:
#   ./scripts/copy-pi-skills.sh [MATTPOCOCK_SKILLS_REPO]
#
#   MATTPOCOCK_SKILLS_REPO defaults to ~/dotfiles/pi/mattpocock-skills.
#   You can also set the MATTPOCOCK_SKILLS_REPO environment variable.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOTFILES="$(cd "$SCRIPT_DIR/.." && pwd)"

MATTPOCOCK="${1:-${MATTPOCOCK_SKILLS_REPO:-$DOTFILES/mattpocock-skills}}"

if [ ! -d "$MATTPOCOCK/skills" ]; then
  echo "error: mattpocock-skills not found at $MATTPOCOCK" >&2
  echo "" >&2
  echo "Clone it first:" >&2
  echo "  git clone https://github.com/mattpocock/mattpocock-skills.git $DOTFILES/mattpocock-skills" >&2
  exit 1
fi

DEST="$DOTFILES/.pi/agent/skills"

# If the skills dir is a symlink that resolves into the mattpocock repo, bail
# out instead of polluting the working copy.
if [ -L "$DEST" ]; then
  resolved="$(readlink -f "$DEST")"
  case "$resolved" in
    "$MATTPOCOCK"|"$MATTPOCOCK"/*)
      echo "error: $DEST is a symlink into $MATTPOCOCK ($resolved)." >&2
      echo "Remove it (rm \"$DEST\") and re-run; the script will recreate it as a real dir." >&2
      exit 1
      ;;
  esac
fi

mkdir -p "$DEST"

count=0
while IFS= read -r -d '' skill_md; do
  src="$(dirname "$skill_md")"
  name="$(basename "$src")"
  target="$DEST/$name"

  if [ -e "$target" ] || [ -L "$target" ]; then
    rm -rf "$target"
  fi

  cp -R "$src" "$target"
  echo "copied $name"
  count=$((count + 1))
done < <(find "$MATTPOCOCK/skills" -name SKILL.md \
  -not -path '*/node_modules/*' \
  -not -path '*/deprecated/*' \
  -print0)

echo ""
echo "Done. $count skills copied to $DEST/"
