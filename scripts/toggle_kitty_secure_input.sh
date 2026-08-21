#!/usr/bin/env bash
# Turn OFF macOS Secure Keyboard Entry in kitty.
#
# Secure Keyboard Entry blocks global hotkey daemons (skhd/yabai) from
# capturing keystrokes, which breaks Option+number / Shift+Option+number and
# every other skhd/yabai hotkey. Kitty enables SE by default and only exposes a
# *toggle* action (no config option to disable it permanently), so this script
# reads kitty's live SE state from its preferences plist and only toggles when
# SE is currently ON.
#
# Detection:  defaults read net.kovidgoyal.kitty SecureKeyboardEntry
#             0 = off, 1 = on
# Toggle:     click the "Secure Keyboard Entry" item in kitty's app menu.

set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# Only proceed if kitty is running
pgrep -x kitty >/dev/null 2>&1 || exit 0

se_state() {
  defaults read net.kovidgoyal.kitty SecureKeyboardEntry 2>/dev/null || echo 0
}

if [[ "$(se_state)" != "1" ]]; then
  exit 0  # already off
fi

# Toggle it off. The item lives in kitty's application menu; System Events must
# open the app menu first, then click the item.
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
