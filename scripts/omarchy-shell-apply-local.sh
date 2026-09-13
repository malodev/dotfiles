#!/usr/bin/env bash
#
# Machine-local overrides for Omarchy's shell config.
#
#   base  : <repo>/hyprland/.config/omarchy/shell.json   tracked, shared
#   delta : ~/.config/omarchy/shell.local.json           gitignored, per machine
#   live  : ~/.config/omarchy/shell.json                 what the shell reads
#   last  : ~/.local/state/omarchy/shell.generated.json  what we last generated
#
# Without a delta file the live path is kept as a symlink to the base, so
# Omarchy's own writes (bar commands, plugin toggles, UI edits) land in the
# dotfiles as ordinary git diffs.
#
# With a delta file the live file is generated as `base * delta` (a recursive
# JSON merge), because a machine-local value cannot survive in a file that is
# also the shared one. That loses the automatic write-back, so this script
# covers the reverse direction too: before regenerating, any live change since
# the last generation is **promoted** into the base with the delta-owned keys
# removed. UI/CLI edits on a delta machine therefore show up as a git diff in
# that machine's checkout — they are never silently dropped.
#
# Usage: omarchy-shell-apply-local.sh [--promote] [--quiet]
#   (no args)   promote if the live file drifted, regenerate live, reload shell
#   --promote   force the promotion first (use before committing on a delta machine)
#   --quiet     no output unless something changed (used by the boot hook)

set -euo pipefail

mode=apply
quiet=0
for arg in "$@"; do
  case "$arg" in
  --promote) mode=promote ;;
  --quiet) quiet=1 ;;
  *)
    echo "Usage: omarchy-shell-apply-local.sh [--promote] [--quiet]" >&2
    exit 2
    ;;
  esac
done

repo=${DOTFILES_ROOT:-$(cd -- "$(dirname -- "$(readlink -f -- "$0")")/.." && pwd)}
base="$repo/hyprland/.config/omarchy/shell.json"
live="$HOME/.config/omarchy/shell.json"
delta="$HOME/.config/omarchy/shell.local.json"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/omarchy"
last="$state_dir/shell.generated.json"

say() { ((quiet)) || printf 'omarchy-shell-local: %s\n' "$*"; }
die() {
  printf 'omarchy-shell-local: %s\n' "$*" >&2
  exit 1
}

command -v jq >/dev/null || die "jq is required"
[ -f "$base" ] || die "no shared config at $base"
[ -f "$delta" ] || delta=""

# --- promote: the live file becomes the shared base, except that the keys the
# delta owns keep the base's own values (the delta is that machine's authority
# for them). Paths are applied one by one: jq's `*` merge replaces whole arrays,
# which would blank out the bar layout. ---------------------------------------
promote() {
  local force=$1 paths tmp
  [ -f "$live" ] || return 0
  if [ -n "$delta" ]; then
    paths=$(jq -c '[paths(scalars)]' "$delta") || die "delta is not valid JSON"
  else
    paths='[]'
  fi
  if [ "$force" != force ]; then
    [ -f "$last" ] || return 0          # nothing generated yet: live == base
    cmp -s "$live" "$last" && return 0  # no drift
  fi
  tmp=$(mktemp "$(dirname -- "$base")/.shell.json.promote.XXXXXX")
  jq --argjson dp "$paths" --slurpfile b "$base" '
      reduce $dp[] as $p (.;
        ($b[0] | getpath($p)) as $v
        | if $v == null then delpaths([$p]) else setpath($p; $v) end)
    ' "$live" >"$tmp" || die "could not compute the promoted config"
  if cmp -s "$tmp" "$base"; then
    rm -f "$tmp"
    return 0
  fi
  mv "$tmp" "$base"
  say "promoted live changes into $base (delta-owned keys keep the base's values) — review and commit"
}

# --- no delta: the shared file is the live file, linked ----------------------
if [ -z "$delta" ]; then
  if [ -f "$live" ] && [ ! -L "$live" ]; then
    # A machine that used to carry a delta: keep its edits in the shared file
    # before replacing the file with the link.
    promote force
  fi
  if [ ! -e "$live" ]; then
    mkdir -p "$(dirname -- "$live")"
    ln -s "$(realpath --relative-to="$(dirname -- "$live")" "$base")" "$live"
    say "linked $live -> $base"
  else
    say "no delta file; keeping the shared config linked"
  fi
  exit 0
fi

# --- delta machine: promote drift, then regenerate live ----------------------
mkdir -p "$state_dir" "$(dirname -- "$live")"

if [ "$mode" = promote ]; then
  promote force
else
  promote drift
fi

jq -e 'type == "object"' "$delta" >/dev/null || die "delta is not a JSON object"
tmp=$(mktemp "$(dirname -- "$live")/.shell.json.XXXXXX")
# Recursive object merge; arrays are replaced as a whole (jq merge semantics).
jq -s '.[0] * .[1]' "$base" "$delta" >"$tmp" || die "could not merge base and delta"
jq -e 'type == "object"' "$tmp" >/dev/null || die "merge produced invalid JSON"
# mv replaces the destination name, so a leftover symlink is swapped for the
# generated file (and the shell's atomic-write watcher sees one rename).
mv -f "$tmp" "$live"
cp "$live" "$last"
say "generated $live from base + delta ($(jq -c 'paths(scalars)' "$delta" | tr -d '[]"' | tr ',' ' '))"
omarchy-shell -q shell reloadConfig >/dev/null 2>&1 || true
