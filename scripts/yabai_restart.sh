#!/usr/bin/env bash
# Restart yabai -- the remedy for yabai's stale-window-record failure mode.
#
# yabai caches a frame and an AX element reference per window. When an app
# recreates or re-registers its window (Qt apps like Telegram Desktop do, so do
# Chrome/Electron), that cached reference goes dead: yabai then reports the
# window with a 0x0 frame forever, bsp gives it a useless tile, and
# `window --grid` / `--move` / `--resize` exit 0 while doing nothing at all --
# the window looks floated and every geometry hotkey silently misses it.
# Verified 2026-09-30 on this machine: Telegram id 27913 read 0,0 0x0 in yabai
# while AX had it at 1163,497 1095x1327; a yabai restart restored the record and
# Option+Shift+M started working on it.
#
# Called from Karabiner-Elements (Option+Shift+R complex modification in
# ~/.config/karabiner/karabiner.json) rather than from skhd, because skhd is a
# CGEventTap and Secure Event Input blinds event taps session-wide.
#
# Usage: yabai_restart.sh [--dry-run]

set -uo pipefail

# Karabiner's shell_command runs with a very limited environment; yabai derives
# its socket path from $USER, so make sure the basics are set.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export USER="${USER:-$(id -un)}"
export HOME="${HOME:-/Users/$USER}"

yabai=/opt/homebrew/bin/yabai
label=com.asmvik.yabai

log() {
  printf '%s: %s\n' "$(date '+%F %T')" "$*" \
    >>"${TMPDIR:-/tmp}/yabai_restart.log" 2>/dev/null
}

before="$(pgrep -x yabai | head -1)"

if [[ "${1:-}" == "--dry-run" || "${1:-}" == "-n" ]]; then
  printf 'would restart yabai (currently pid %s)\n' "${before:-not running}"
  exit 0
fi

if ! out="$("$yabai" --restart-service 2>&1)"; then
  log "yabai --restart-service failed (${out:-no output}), falling back to launchctl kickstart"
  launchctl kickstart -k "gui/$(id -u)/$label" >/dev/null 2>&1 ||
    { log "launchctl kickstart failed too"; exit 1; }
fi

# Wait for the socket to answer again -- a new pid alone is not proof it is up.
up=0
for _ in $(seq 1 20); do
  sleep 0.25
  if "$yabai" -m query --spaces >/dev/null 2>&1; then
    up=1
    break
  fi
done

after="$(pgrep -x yabai | head -1)"

if ((up)); then
  log "restarted yabai: pid ${before:-none} -> ${after:-none}"
else
  log "yabai did not answer after restart (pid ${before:-none} -> ${after:-none})"
  exit 1
fi
