#!/usr/bin/env bash
# Act on the focused window through yabai.
#
# Called from Karabiner-Elements (Option+H/J/K/L, Option+Shift+H/J/K/L,
# Option+Shift+M) instead of skhd: skhd is a CGEventTap and macOS Secure
# Keyboard Entry blinds event taps session-wide, while Karabiner grabs the
# keyboard at the HID layer and is unaffected by SE.
#
# Actions:
#   focus west|south|north|east   focus the neighbouring window
#   swap  west|south|north|east   exchange frames with that neighbour
#   fill                          maximize the focused window into its Space,
#                                 inside the padding (grid 1:1:0:0:1:1)
#
# Directions: yabai's west|south|north|east are TREE selectors (DIR_SEL inside
# WINDOW_SEL, the same family as sibling/uncle/cousin), so in float layout --
# where there is no tree -- they always fail with "could not locate a <dir>
# managed window". Verified 2026-09-30 in the action log. So the native selector
# is tried first (it has the right semantics in bsp/stack) and, when it fails, a
# neighbour is picked by geometry from the window frames on the focused Space.
# Invisible, minimized and degenerate windows are skipped, so a stale 0x0 record
# cannot win the search.
#
# `fill` only means anything in float layout: in bsp/stack yabai owns placement
# and re-flows the Space, undoing the grid a moment later (yabai says "cannot
# apply grid layout to a managed window"). So fill switches a non-float Space to
# float first, then grids the window. Option+Shift+T undoes that if you wanted
# the tiling.
#
# Usage: yabai_window_action.sh [--dry-run] focus|swap <direction> | fill

set -uo pipefail

# Karabiner's shell_command runs with a very limited environment; yabai derives
# its socket path from $USER, so make sure the basics are set.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export USER="${USER:-$(id -un)}"
export HOME="${HOME:-/Users/$USER}"

yabai="${YABAI_BIN:-/opt/homebrew/bin/yabai}" # YABAI_BIN is for tests only

log() {
  printf '%s: %s\n' "$(date '+%F %T')" "$*" \
    >>"${TMPDIR:-/tmp}/window_action.log" 2>/dev/null
}

run_yabai() {
  local out
  if ! out="$("$yabai" -m "$@" 2>&1)"; then
    log "yabai -m $* failed: $out"
    return 1
  fi
}

# Probe without logging: the native tree selector is expected to fail in float
# layout, and that is not worth a log line.
try_yabai() { "$yabai" -m "$@" >/dev/null 2>&1; }

current_layout() {
  "$yabai" -m query --spaces --space 2>/dev/null |
    sed -n 's/.*"type"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p' | head -1
}

# Print "<focused-id> <neighbour-id>" for the given direction, or nothing.
# Windows are compared by centre; the nearest one in the direction wins, ties
# broken by the perpendicular distance.
neighbours() {
  "$yabai" -m query --windows --space 2>/dev/null | python3 -c '
import json, sys

direction = sys.argv[1]
try:
    windows = json.load(sys.stdin)
except Exception:
    sys.exit(0)

focused = next((w for w in windows if w.get("has-focus")), None)
if focused is None:
    sys.exit(0)

def centre(w):
    f = w["frame"]
    return f["x"] + f["w"] / 2, f["y"] + f["h"] / 2

fx, fy = centre(focused)
best = None
for w in windows:
    if w["id"] == focused["id"] or not w.get("is-visible") or w.get("is-minimized"):
        continue
    f = w["frame"]
    if f["w"] < 50 or f["h"] < 50:
        continue
    cx, cy = centre(w)
    dx, dy = cx - fx, cy - fy
    primary, perpendicular = (dx, dy) if direction in ("west", "east") else (dy, dx)
    if direction in ("west", "north") and primary >= -1:
        continue
    if direction in ("east", "south") and primary <= 1:
        continue
    candidate = (abs(primary), abs(perpendicular), w["id"])
    if best is None or candidate < best:
        best = candidate

if best is not None:
    print(focused["id"], best[2])
' "$1" 2>/dev/null
}

dry=0
args=()
for a in "$@"; do
  case "$a" in
    --dry-run | -n) dry=1 ;;
    *) args+=("$a") ;;
  esac
done

action="${args[0]:-}"
arg="${args[1]:-}"

case "$action" in
  focus | swap)
    case "$arg" in
      west | south | north | east) ;;
      *)
        echo "yabai_window_action: '$action' needs west|south|north|east, got '${arg}'" >&2
        exit 64
        ;;
    esac

    picked="$(neighbours "$arg")"
    if ((dry)); then
      printf 'yabai -m window --%s %s        (native tree selector)\n' "$action" "$arg"
      if [[ -n "$picked" ]]; then
        set -- $picked
        if [[ "$action" == focus ]]; then
          printf 'yabai -m window %s --focus   (geometry fallback)\n' "$2"
        else
          printf 'yabai -m window %s --swap %s   (geometry fallback)\n' "$1" "$2"
        fi
      else
        printf 'no visible window to the %s -> nothing to do\n' "$arg"
      fi
      exit 0
    fi

    if try_yabai window --"$action" "$arg"; then
      exit 0
    fi

    if [[ -z "$picked" ]]; then
      log "no visible window to the ${arg} of the focused window (float layout)"
      exit 1
    fi
    set -- $picked
    if [[ "$action" == focus ]]; then
      run_yabai window "$2" --focus || exit 1
    else
      run_yabai window "$1" --swap "$2" || exit 1
    fi
    ;;

  fill)
    layout="$(current_layout)"
    if [[ -z "$layout" ]]; then
      log "fill: could not read the layout of the focused space from yabai"
      exit 1
    fi
    if [[ "$layout" != float ]]; then
      if ((dry)); then
        printf 'space --layout float   (space was %s)\nwindow --grid 1:1:0:0:1:1\n' "$layout"
        exit 0
      fi
      run_yabai space --layout float || exit 1
      # Give yabai a moment to drop the tiling before gridding the window.
      sleep 0.3
    fi
    if ((dry)); then
      printf 'yabai -m window --grid 1:1:0:0:1:1\n'
      exit 0
    fi
    run_yabai window --grid 1:1:0:0:1:1 || exit 1
    ;;

  *)
    echo "yabai_window_action: usage: $0 [--dry-run] focus|swap <direction> | fill" >&2
    exit 64
    ;;
esac
