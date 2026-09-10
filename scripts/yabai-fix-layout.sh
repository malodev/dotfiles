#!/usr/bin/env bash
# Clear yabai "ghost window" squeezes without a manual restart.
#
# Ghosts are windows yabai discovered at the window-server level but could not
# attach an accessibility reference to (has-ax-reference=false). Tray apps such
# as Spotify and Telegram leave them behind while running windowless. yabai can
# neither rule-match them (`manage=off` does nothing) nor act on them
# (`could not locate the window to act on`), but it can still place one in a
# tile -- squeezing real windows into the rest of the space.
#
# A ghost counts as "squeezing" when it is part of the tiling (is-floating=false)
# and its frame does not overlap any real window on the same space, i.e. it
# occupies a tile of its own. After a yabai restart the ghost ends up
# overlapping a real window and stops reserving space, so this self-limits.
#
# Usage:
#   yabai-fix-layout.sh              # restart yabai only if a ghost is squeezing
#   yabai-fix-layout.sh --if-needed  # same as above, explicit
#   yabai-fix-layout.sh --force      # re-tile unconditionally
#   yabai-fix-layout.sh --check      # report squeezes, change nothing (0 = found)
#
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# The yabai CLI aborts with "env USER not set" without it (it derives its
# control socket name from the user). launchd normally provides USER, but make
# it explicit so the script also works from a stripped-down environment.
export USER="${USER:-$(id -un)}"

YABAI="/opt/homebrew/bin/yabai"
SERVICE="com.asmvik.yabai"
STAMP="${TMPDIR:-/tmp}/yabai-fix-layout.last"
LOG="${TMPDIR:-/tmp}/yabai-fix-layout.log"
DEBOUNCE_SECONDS=20

mode="if-needed"
case "${1:-}" in
  ""|--if-needed) mode="if-needed" ;;
  --force)        mode="force" ;;
  --check)        mode="check" ;;
  *) echo "usage: $(basename "$0") [--if-needed|--force|--check]" >&2; exit 2 ;;
esac

if [[ ! -x "$YABAI" ]]; then
  echo "yabai not found at $YABAI" >&2
  exit 1
fi

# Print "app(id=N,space=M)" for every ghost that occupies its own tile.
find_squeezing() {
  "$YABAI" -m query --windows 2>/dev/null | /usr/bin/python3 -c '
import json, sys

try:
    windows = json.load(sys.stdin)
except Exception:
    # yabai unreachable or returned nothing usable: report no squeezes.
    raise SystemExit(0)

def rect(w):
    f = w.get("frame") or {}
    x, y = f.get("x", 0), f.get("y", 0)
    return (x, y, x + f.get("w", 0), y + f.get("h", 0))

def overlaps(a, b):
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])

# Real, tiled windows, grouped by the space they live on.
reals = {}
for w in windows:
    if w.get("has-ax-reference") and not w.get("is-floating"):
        reals.setdefault(w.get("space"), []).append(w)

found = []
for w in windows:
    if w.get("has-ax-reference") or w.get("is-floating"):
        continue
    peers = reals.get(w.get("space"))
    if not peers:
        continue
    if not any(overlaps(rect(w), rect(p)) for p in peers):
        found.append("%s(id=%s,space=%s)" % (w.get("app"), w.get("id"), w.get("space")))

print(" ".join(found))
'
}

squeezing="$(find_squeezing || true)"

if [[ "$mode" == "check" ]]; then
  if [[ -n "$squeezing" ]]; then
    echo "squeezing ghosts: $squeezing"
    exit 0
  fi
  echo "no squeezing ghosts"
  exit 1
fi

if [[ "$mode" == "if-needed" && -z "$squeezing" ]]; then
  exit 0
fi

# Debounce so a burst of window events cannot restart yabai repeatedly.
now="$(date +%s)"
if [[ -f "$STAMP" ]]; then
  last="$(cat "$STAMP" 2>/dev/null || echo 0)"
  if [[ "$last" =~ ^[0-9]+$ ]] && (( now - last < DEBOUNCE_SECONDS )); then
    exit 0
  fi
fi
printf '%s\n' "$now" > "$STAMP"

printf '%s restarting %s (%s)\n' \
  "$(date '+%Y-%m-%d %H:%M:%S')" "$SERVICE" "${squeezing:-forced}" >> "$LOG"

launchctl kickstart -k "gui/$(id -u)/$SERVICE"
