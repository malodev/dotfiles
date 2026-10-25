#!/usr/bin/env bash
# install-launch-agents.sh - render the tracked launchd templates into real LaunchAgents.
#
# A plist cannot expand a variable: the program path it runs has to be literal. So the
# repository keeps launchd/*.plist.template with __DOTFILES_REPO__ in it and this script writes
# the real file, which is what keeps a home path out of the tracked configuration
# (ADOPTION.md, and scripts/check-clean-room.sh enforces it).
#
# macOS only, opt-in, and idempotent: an agent whose file already matches is left alone, and an
# agent that changes is unloaded and reloaded so launchd sees the new path.
#
# This loads launchd jobs, so run it against the real HOME. --no-load writes the files only,
# which is what a test on a throwaway HOME wants: launchd keys a job by its Label, not by path,
# so loading a copy from a temporary directory would replace the real one.
#
#   ./scripts/install-launch-agents.sh --dry-run   # show what would change
#   ./scripts/install-launch-agents.sh             # write and (re)load
#   ./scripts/install-launch-agents.sh --no-load   # write only
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${DOTFILES_REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DEST="$HOME/Library/LaunchAgents"
DRY_RUN=0
LOAD=1

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-load) LOAD=0 ;;
    --help|-h)
      sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

info() { printf "  \033[1;34m•\033[0m %s\n" "$*"; }
ok()   { printf "  \033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[1;33m⚠\033[0m %s\n" "$*"; }

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "  launchd exists on macOS only; nothing to do on $(uname -s)" >&2
  exit 2
fi

shopt -s nullglob
templates=("$REPO"/launchd/*.plist.template)
if [[ ${#templates[@]} -eq 0 ]]; then
  info "no launchd/*.plist.template in $REPO"
  exit 0
fi

changed=0
for template in "${templates[@]}"; do
  name="$(basename "$template" .template)"
  target="$DEST/$name"
  rendered="$(sed "s|__DOTFILES_REPO__|$REPO|g" "$template")"

  if [[ -f "$target" ]] && [[ "$rendered" == "$(cat "$target")" ]]; then
    ok "$name — up to date"
    continue
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    info "[dry-run] would write $target"
    if [[ -f "$target" ]]; then
      diff -u "$target" <(printf '%s\n' "$rendered") | sed -n '3,12p' | sed 's/^/        /'
    fi
    changed=$((changed + 1))
    continue
  fi

  mkdir -p "$DEST"
  printf '%s\n' "$rendered" > "$target"
  ok "wrote $target"

  # Reload only what is loaded, and tolerate "not loaded": the first install has nothing to
  # boot out, and an agent with KeepAlive would otherwise double up.
  if [[ "$LOAD" == "1" ]]; then
    launchctl bootout "gui/$(id -u)" "$target" >/dev/null 2>&1 || true
    if launchctl bootstrap "gui/$(id -u)" "$target" >/dev/null 2>&1; then
      ok "loaded $name"
    else
      warn "$name written but not loaded — check: launchctl bootstrap gui/$(id -u) $target"
    fi
  else
    info "$name written (--no-load)"
  fi
  changed=$((changed + 1))
done

if [[ "$DRY_RUN" == "1" ]]; then
  info "$changed file(s) would change"
else
  [[ $changed -eq 0 ]] && info "nothing to do" || info "$changed agent(s) installed"
fi
