#!/usr/bin/env bash
# Keep this session clear of a stuck Secure Keyboard Entry flag.
#
# Every hotkey on this machine now lives outside the event-tap layer (native
# "Switch to Desktop" symbolic hotkeys, plus Karabiner-Elements complex
# modifications), so a stuck SE flag no longer kills them. It still silently
# breaks any other CGEventTap tool, and it would break skhd again if bindings
# were ever put back in ~/.config/skhd/skhdrc -- skhd refuses to start while SE
# is set:
#   "skhd: secure keyboard entry is enabled by (<pid>) '<app>'! abort.."
# so this still watches the flag and reports. skhd is no longer started or
# supervised here (its launchd job is disabled). The file name is historical;
# launchd/com.malo.ensure-skhd.plist points at it.
#
# Two different conditions leave SE on, and they need different handling:
#
#   (a) kitty's own SE toggle is on:
#       `defaults read net.kovidgoyal.kitty SecureKeyboardEntry` == 1 and the
#       menu item kitty -> Secure Keyboard Entry is ticked. One click clears it
#       for good.
#
#   (b) the flag is stuck / leaked by macOS, which blames whichever app was
#       frontmost when the leak happened. Verified 2026-09-26 on this machine:
#       ioreg reports kCGSSessionSecureInputPID=<kitty pid> while kitty's pref is
#       0 and its menu item is unticked, i.e. kitty believes SE is off. An
#       on->off toggle then does NOT clear the flag (tested); only quitting the
#       blamed app or a fresh login/reboot does. Nothing here can clear that
#       unattended, so the script reports it and, if opted in, relaunches kitty.
#
# Therefore the check is LIVE (ioreg), never kitty's pref alone -- the pref lies
# in case (b), which is exactly why the old version of this script silently did
# nothing. kitty's own path is closed by config on top of that: kitty.conf maps
# opt+cmd+s to no_op and this script pins the persisted pref to false, so only a
# deliberate click on the menu item can turn SE on. Runs from launchd on wake and
# every 5 minutes.

set -uo pipefail
# /usr/sbin is required: ioreg lives there and it is the whole detection.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

KITTY_DOMAIN=net.kovidgoyal.kitty
STATE=/tmp/ensure_skhd.state
RELAUNCH_STAMP=/tmp/ensure_skhd.kitty_relaunch
RELAUNCH_COOLDOWN=1800 # seconds between opt-in kitty relaunches

# 1 = when the SE flag is stuck and the blamed process is kitty, quit and reopen
# kitty. Panes living under the herdr server survive a kitty restart; plain
# kitty shells and whatever they are running do not, which is why this is off by
# default. Turn it on with:
#   launchctl setenv RELAUNCH_KITTY_ON_STUCK_SE 1
RELAUNCH_KITTY_ON_STUCK_SE="${RELAUNCH_KITTY_ON_STUCK_SE:-0}"

log() { printf '%s: %s\n' "$(date '+%F %T')" "$*" >&2; }

se_holder_pid() {
  ioreg -l -w 0 2>/dev/null |
    grep -o '"kCGSSessionSecureInputPID"=[0-9]*' | head -1 | cut -d= -f2
}
se_on() {
  local pid
  pid="$(se_holder_pid)"
  [[ -n "$pid" && "$pid" != "0" ]]
}
proc_of() { ps -o comm= -p "$1" 2>/dev/null | head -1; }
kitty_running() { pgrep -x kitty >/dev/null 2>&1; }
kitty_se_pref_on() {
  [[ "$(defaults read "$KITTY_DOMAIN" SecureKeyboardEntry 2>/dev/null || echo 0)" == "1" ]]
}

# SE is permanently disabled for kitty: kitty.conf unbinds opt+cmd+s (kitty's own
# default binding) and kitty only enables SE at startup when this persisted
# desired-state pref is true. The menu item can still flip it, so pin it back.
pin_kitty_se_pref_off() {
  if kitty_se_pref_on; then
    defaults write "$KITTY_DOMAIN" SecureKeyboardEntry -bool false 2>/dev/null || true
    log "reset kitty's persisted Secure Keyboard Entry state to off"
  fi
}

click_kitty_se() {
  osascript >/dev/null 2>&1 <<'APPLESCRIPT'
tell application "System Events"
  tell process "kitty"
    click menu bar item "kitty" of menu bar 1
    delay 0.2
    click menu item "Secure Keyboard Entry" of menu "kitty" of menu bar 1
  end tell
end tell
APPLESCRIPT
}

# Leave kitty's own SE state OFF whichever way it started, so this can never
# turn SE on and walk away.
kitty_se_set_off() {
  if kitty_se_pref_on; then
    click_kitty_se
  else
    click_kitty_se
    sleep 0.5
    click_kitty_se
  fi
  sleep 0.5
  ! kitty_se_pref_on
}

notify() {
  osascript -e "display notification \"$1\" with title \"skhd: hotkeys down\"" >/dev/null 2>&1 || true
}

state_is() { [[ -f "$STATE" ]] && [[ "$(<"$STATE")" == "$1" ]]; }
remember() { printf '%s\n' "$1" >"$STATE" 2>/dev/null || true; }

# ----------------------------------------------------------------- secure input
pin_kitty_se_pref_off

if se_on; then
  holder_pid="$(se_holder_pid)"
  holder="$(proc_of "$holder_pid")"
  state_is "on:$holder_pid" || state_is "stuck:$holder_pid" ||
    log "secure keyboard entry is ON (pid $holder_pid '$holder') -> skhd receives no key events"

  # Cheap clear: kitty's own toggle is a real fix in case (a). In the stuck case
  # the on->off dance is known not to help, so try it once per episode instead
  # of flashing kitty's menu every 5 minutes.
  if kitty_running; then
    if kitty_se_pref_on || ! state_is "stuck:$holder_pid"; then
      kitty_se_set_off
    fi
  fi

  if ! se_on; then
    log "cleared SE through kitty's Secure Keyboard Entry toggle"
    remember off
  else
    if ! state_is "stuck:$holder_pid"; then
      log "SE still ON after toggling: flag is stuck/leaked (macOS blames '$holder')"
      notify "Secure Keyboard Entry is stuck (blamed on $holder). Hotkeys stay dead until that app quits or you reboot."
    fi
    remember "stuck:$holder_pid"

    if [[ "$RELAUNCH_KITTY_ON_STUCK_SE" == "1" && "$holder" == *kitty* ]] && kitty_running; then
      now="$(date +%s)"
      last=0
      [[ -f "$RELAUNCH_STAMP" ]] && last="$(stat -f %m "$RELAUNCH_STAMP" 2>/dev/null || echo 0)"
      if ((now - last < RELAUNCH_COOLDOWN)); then
        log "skipping kitty relaunch ($((now - last))s since the last one)"
      else
        touch "$RELAUNCH_STAMP"
        log "relaunching kitty to drop the stuck SE claim"
        osascript -e 'quit app "kitty"' >/dev/null 2>&1 || true
        sleep 2
        open -a kitty >/dev/null 2>&1 || true
        sleep 3
        if se_on; then
          log "SE still ON after relaunching kitty - reboot is required"
        else
          log "SE cleared by relaunching kitty"
          remember off
        fi
      fi
    fi
  fi
else
  state_is off || log "secure keyboard entry is off"
  remember off
fi
