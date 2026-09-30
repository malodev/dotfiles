#!/usr/bin/env bash
# Toggle the focused macOS Space between yabai's float layout and bsp (tiled).
#
# Called from Karabiner-Elements (see the Option+Shift+T complex modification in
# ~/.config/karabiner/karabiner.json) rather than from skhd, because skhd is a
# CGEventTap and macOS Secure Event Input blinds event taps session-wide, while
# Karabiner grabs the keyboard at the HID layer.
#
# yabai itself has no keybindings and no blind toggle for this, so the current
# layout is read first: `yabai -m space --layout` takes bsp|stack|float and
# `yabai -m space --toggle` only covers padding|gap|mission-control|show-desktop.
# The query output is pretty-printed JSON, so a sed one-liner is enough -- no jq
# or python dependency in Karabiner's minimal environment.
#
# Usage: yabai_toggle_layout.sh [--dry-run]
#
# Caveat: going to bsp lets yabai place and resize the windows on that Space,
# which is exactly what ~/.config/yabai/yabairc avoids by default (macOS Tiling
# plus Rectangle own window placement there). Coming back to float does NOT
# restore the arrangement the windows had before: yabai simply stops tiling and
# the windows keep the frames tiling gave them.

set -uo pipefail

# Karabiner's shell_command runs with a very limited environment; yabai derives
# its socket path from $USER, so make sure the basics are set.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export USER="${USER:-$(id -un)}"
export HOME="${HOME:-/Users/$USER}"

yabai=/opt/homebrew/bin/yabai

log() {
  printf '%s: %s\n' "$(date '+%F %T')" "$*" \
    >>"${TMPDIR:-/tmp}/toggle_layout.log" 2>/dev/null
}

current="$("$yabai" -m query --spaces --space 2>/dev/null |
  sed -n 's/.*"type"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p' | head -1)"

if [[ -z "$current" ]]; then
  log "could not read the current space layout from yabai"
  exit 1
fi

case "$current" in
  bsp) target=float ;;
  *) target=bsp ;;
esac

if [[ "${1:-}" == "--dry-run" || "${1:-}" == "-n" ]]; then
  printf '%s -> %s\n' "$current" "$target"
  exit 0
fi

if ! out="$("$yabai" -m space --layout "$target" 2>&1)"; then
  log "space --layout $target failed: $out"
  exit 1
fi
