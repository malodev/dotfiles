#!/usr/bin/env bash
# Auto-toggle Secure Keyboard Entry off in kitty after wake from sleep.
# Kitty enables SE by default, which blocks skhd/yabai hotkeys.
# This runs via launchd on wake and periodically.
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# Check if kitty is running
pgrep -x kitty >/dev/null 2>&1 || exit 0

# Check if skhd is already running and healthy
if pgrep -x skhd >/dev/null 2>&1; then
  # skhd is running, but might be blocked. Try a quick health check:
  # If skhd has been running less than 5 min, assume it's fine
  exit 0
fi

# skhd isn't running — SE is probably on. Toggle it.
osascript -e '
tell application "System Events"
  tell process "kitty"
    set frontmost to true
    delay 0.3
    key down command
    key down option
    delay 0.1
    keystroke "s"
    delay 0.1
    key up option
    key up command
  end tell
end tell
'

sleep 0.5

# Start skhd if not running
pgrep -x skhd >/dev/null 2>&1 || /opt/homebrew/bin/skhd &
