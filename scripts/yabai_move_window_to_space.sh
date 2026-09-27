#!/usr/bin/env bash
# Move the focused window to macOS Space N and follow it there.
#
# Called from Karabiner-Elements (see the "Option+Shift+N" complex modification
# in ~/.config/karabiner/karabiner.json) rather than from skhd, because skhd is a
# CGEventTap and macOS Secure Event Input blinds event taps session-wide, while
# Karabiner grabs the keyboard at the HID layer and is unaffected (it advertises
# "Secure Keyboard Entry Support"). macOS itself has no native "move window to
# desktop N" hotkey -- symbolichotkeys only has "Switch to Desktop 1..10"
# (ids 118..127) -- so a yabai call is the only way to do the move.
#
# Usage: yabai_move_window_to_space.sh <space-index>

set -uo pipefail

# Karabiner's shell_command runs with a very limited environment; yabai derives
# its socket path from $USER, so make sure the basics are set.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export USER="${USER:-$(id -un)}"
export HOME="${HOME:-/Users/$USER}"

space="${1:-}"
if [[ ! "$space" =~ ^[0-9]+$ ]]; then
  echo "yabai_move_window_to_space: need a numeric space index, got '${1:-}'" >&2
  exit 64
fi

if ! out="$(/opt/homebrew/bin/yabai -m window --space "$space" --focus 2>&1)"; then
  # Log failures only, so the log cannot grow without bound.
  printf '%s: space %s failed: %s\n' "$(date '+%F %T')" "$space" "$out" \
    >>"${TMPDIR:-/tmp}/move_window_to_space.log" 2>/dev/null
  exit 1
fi
