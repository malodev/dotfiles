#!/usr/bin/env bash
# Ensure skhd is running and kitty's Secure Keyboard Entry is OFF.
#
# Secure Keyboard Entry (SE) blocks skhd/yabai global hotkeys, so the recurring
# "Option+number stopped switching desktops" failure is caused by SE being on.
# The fix is twofold: keep skhd alive, and keep SE off. Kitty re-enables SE when
# it regains focus, opens a new window, or the machine wakes from sleep, which
# is why the problem is periodic. This runs via launchd on wake and every 5 min.
#
# SE state is read live from kitty's preferences plist; we only toggle when ON.
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# 1. Start skhd if it isn't running.
if ! pgrep -x skhd >/dev/null 2>&1; then
  /opt/homebrew/bin/skhd &
  sleep 0.5
fi

# 2. Turn off Secure Keyboard Entry if kitty has it on.
if ! pgrep -x kitty >/dev/null 2>&1; then
  exit 0
fi

se_state() {
  defaults read net.kovidgoyal.kitty SecureKeyboardEntry 2>/dev/null || echo 0
}

if [[ "$(se_state)" != "1" ]]; then
  exit 0  # already off
fi

osascript <<'APPLESCRIPT'
tell application "System Events"
  tell process "kitty"
    click menu bar item "kitty" of menu bar 1
    delay 0.2
    click menu item "Secure Keyboard Entry" of menu "kitty" of menu bar 1
  end tell
end tell
APPLESCRIPT

echo "$(date): turned secure keyboard entry off" >&2
