#!/usr/bin/env bash
#
# theme-set hook: make a theme switch visually complete in one step.
#
# `omarchy theme set` recolours the shell and Hyprland and signals the
# terminals, but two things lag behind:
#
#   1. kitty only applies a config reload to windows created afterwards, so
#      terminals that are already open keep the previous palette.
#   2. the switch installs the theme's own artwork as the background, replacing
#      the graded Variety wallpaper until Variety's next change (up to a
#      minute, and longer while its rotation is paused).
#
# This hook pushes the fresh palette into every running kitty instance and
# re-applies the wallpaper through the Variety pipeline, so the grade uses the
# new palette immediately. $1 is the new theme slug; the palette is read from
# the staged theme, so the slug is only used for logging.

set -uo pipefail

theme=${1:-unknown}
state="${XDG_STATE_HOME:-$HOME/.local/state}/omarchy/current"
palette="$state/theme/kitty.conf"
wallpaper_script="$HOME/.config/variety/scripts/set_wallpaper"
runtime="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# 1. Push the new palette into running kitty instances.
if [ -r "$palette" ]; then
  pairs=()
  while read -r key value; do
    case "$key" in ''|'#'*) continue ;; esac
    [ -n "${value:-}" ] && pairs+=("${key}=${value}")
  done <"$palette"

  if ((${#pairs[@]})); then
    for sock in "$runtime"/omarchy-kitty-*; do
      [ -S "$sock" ] || continue
      if ! kitten @ --to "unix:$sock" set-colors --all "${pairs[@]}" >/dev/null 2>&1; then
        echo "theme-set hook ($theme): could not retint kitty on $sock" >&2
      fi
    done
  fi
fi

# 2. Re-apply the wallpaper through the Variety pipeline: it grades the last
#    wallpaper against the freshly staged palette and hands it to the
#    background service, replacing the theme's own artwork right away.
if [ -x "$wallpaper_script" ]; then
  raw=$(ls -t "$HOME"/Pictures/variety-copied-wallpaper-*.jpg 2>/dev/null | head -n1)
  if [ -n "${raw:-}" ]; then
    "$wallpaper_script" "$raw" refresh >/dev/null 2>&1 ||
      echo "theme-set hook ($theme): could not re-apply the graded wallpaper" >&2
  fi
fi

# 3. Nudge a running Herdr server so its UI re-reads the terminal palette.
if command -v herdr >/dev/null 2>&1; then
  herdr server reload-config >/dev/null 2>&1 || true
fi
