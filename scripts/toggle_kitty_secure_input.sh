#!/usr/bin/env bash
# Toggle macOS Secure Keyboard Entry off in kitty so skhd/yabai hotkeys work.
# Secure Keyboard Entry blocks global hotkey daemons from capturing keystrokes.
# Kitty enables this by default with no config option to disable — only a toggle action.
#
# This script uses AppleScript to send Right-Option+Cmd+S to kitty.
# Right Option is used because the kitty config maps left option to Alt
# (macos_option_as_alt left), so left option won't trigger the toggle.

set -euo pipefail

# Only proceed if kitty is running
pgrep -x kitty >/dev/null 2>&1 || exit 0

# Only proceed if secure keyboard entry is actually enabled for kitty
# (check by seeing if skhd would fail to start)
if /opt/homebrew/bin/skhd -V 2>/dev/null; then
  exit 0  # skhd can start, nothing to do
fi

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

echo "$(date): toggled secure keyboard entry off" >&2
