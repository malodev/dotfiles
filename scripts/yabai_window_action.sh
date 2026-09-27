#!/usr/bin/env bash
# Act on the focused window through yabai.
#
# Called from Karabiner-Elements (see the Option+H/J/K/L, Option+Shift+H/J/K/L
# and Option+Shift+M complex modifications in
# ~/.config/karabiner/karabiner.json) instead of skhd: skhd is a CGEventTap and
# macOS Secure Event Input blinds event taps session-wide, while Karabiner grabs
# the keyboard at the HID layer and is unaffected by SE.
#
# Usage:
#   yabai_window_action.sh focus west|south|north|east
#   yabai_window_action.sh swap  west|south|north|east
#   yabai_window_action.sh fill          # grid 1:1:0:0:1:1, i.e. fill the Space
#                                        # the way skhd's shift+alt+m did,
#                                        # leaving the 10px yabairc padding

set -uo pipefail

# Karabiner's shell_command runs with a very limited environment; yabai derives
# its socket path from $USER, so make sure the basics are set.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export USER="${USER:-$(id -un)}"
export HOME="${HOME:-/Users/$USER}"

action="${1:-}"
arg="${2:-}"
case "$action" in
  focus | swap)
    case "$arg" in
      west | south | north | east) ;;
      *)
        echo "yabai_window_action: '$action' needs west|south|north|east, got '${arg}'" >&2
        exit 64
        ;;
    esac
    argv=(window --"$action" "$arg")
    ;;
  fill)
    argv=(window --grid 1:1:0:0:1:1)
    ;;
  *)
    echo "yabai_window_action: usage: $0 focus|swap <direction> | fill" >&2
    exit 64
    ;;
esac

if ! out="$(/opt/homebrew/bin/yabai -m "${argv[@]}" 2>&1)"; then
  # Log failures only, so the log cannot grow without bound. "could not locate
  # the window to act on!" just means there is no window that way.
  printf '%s: %s failed: %s\n' "$(date '+%F %T')" "${argv[*]}" "$out" \
    >>"${TMPDIR:-/tmp}/window_action.log" 2>/dev/null
  exit 1
fi
