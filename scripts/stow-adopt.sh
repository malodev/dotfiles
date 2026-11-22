#!/usr/bin/env bash
#=============================================================================
# stow-adopt.sh
#
# Make a stow package stowable on a machine whose targets are real files.
#
# This is the recurring case: a machine has been running for months, ~/.gitconfig
# and ~/.bash_profile are real files somebody edited, and `stow git` aborts with
# "existing target is not owned by stow". Doing it by hand invites two mistakes —
# losing the machine's file, or adopting a path that belongs to the OS.
#
# The rules, and they are the point of this script:
#
#   - dry run unless --apply;
#   - a target that is already a link into this repository is left alone;
#   - a target that is a link somewhere else belongs to another tool: refused,
#     never repointed;
#   - a target that is a real file is backed up into
#     ${XDG_STATE_HOME:-~/.local/state}/dotfiles/adopted/<timestamp>/<path>
#     and only then replaced by the stow link;
#   - a target that is a real DIRECTORY is refused by default, because it mixes
#     machine files with dotfile ones (pass --adopt-dirs to move the whole
#     directory aside, which hides whatever else lived there);
#   - a path owned by the OS (Omarchy's ~/.config/omarchy, ~/.config/hypr and
#     friends) is refused outright: those files are rewritten by their owner.
#
# Usage:
#   scripts/stow-adopt.sh git bash            # dry run: what would change
#   scripts/stow-adopt.sh --apply git bash    # adopt, back up, stow, verify
#   scripts/stow-adopt.sh --adopt-dirs --apply nvim
#
# Afterwards, record the decision in ~/Work/AGENTS.md: which package now follows
# the repository on this machine, and what was backed up.
#=============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/dotfiles/adopted"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$STATE_DIR/$STAMP"
MODE="dry-run"
ADOPT_DIRS=0
PACKAGES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)      MODE="apply"; shift ;;
    --dry-run)    MODE="dry-run"; shift ;;
    --adopt-dirs) ADOPT_DIRS=1; shift ;;
    --help|-h)    awk 'NR>=3 && /^#=====/{exit} NR>=3' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)           echo "Unknown flag: $1" >&2; exit 1 ;;
    *)            PACKAGES+=("$1"); shift ;;
  esac
done

[[ ${#PACKAGES[@]} -gt 0 ]] || { echo "usage: stow-adopt.sh [--apply] [--adopt-dirs] <package>..." >&2; exit 1; }
command -v stow >/dev/null 2>&1 || { echo "error: stow is not installed" >&2; exit 1; }

say()  { printf '  %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }

# Paths an owner other than this repository keeps: adopting them would be undone
# by that owner on its next rewrite, and the machine would silently lose the
# setting in between.
is_os_owned() {
  case "$1" in
    .config/omarchy|.config/omarchy/*|.config/hypr|.config/hypr/*) return 0 ;;
    .local/share/omarchy|.local/share/omarchy/*) return 0 ;;
    .config/systemd|.config/systemd/*) return 0 ;;
    *) return 1 ;;
  esac
}

# Package entries, as paths relative to $HOME. Directories are pruned: stow
# creates them on demand, and adopting one is a different decision.
package_paths() {
  ( cd "$REPO/$1" && find . \( -name node_modules -o -name .git \) -prune -o -type f -print ) |
    sed 's|^\./||'
}

adopted=0; skipped=0; refused=0; failed=0

for pkg in "${PACKAGES[@]}"; do
  [[ -d "$REPO/$pkg" ]] || { warn "$pkg: not a directory in the repository"; failed=$((failed + 1)); continue; }
  printf '\n── %s ──\n' "$pkg"

  mapfile -t paths < <(package_paths "$pkg")
  [[ ${#paths[@]} -gt 0 ]] || { warn "no files"; continue; }

  to_adopt=(); to_relink=()
  for rel in "${paths[@]}"; do
    target="$HOME/$rel"
    if is_os_owned "$rel"; then
      warn "$rel: owned by the OS, refused"
      refused=$((refused + 1)); continue
    fi
    if [[ -L "$target" ]]; then
      resolved="$(readlink -f "$target" 2>/dev/null || true)"
      case "$resolved" in
        "$REPO"/*)
          # Ours, but not the link stow would make: an absolute link (or one
          # made by hand) is refused by stow as "not owned by stow". The content
          # is in the repository, so the link itself is disposable.
          if [[ "$(readlink "$target")" == "$resolved" ]]; then
            to_relink+=("$rel")
          else
            skipped=$((skipped + 1))
          fi
          ;;
        *) warn "$rel: link to $(readlink "$target"), owned by another tool, refused"; refused=$((refused + 1)) ;;
      esac
      continue
    fi
    resolved="$(readlink -f "$target" 2>/dev/null || true)"
    case "$resolved" in
      "$REPO"/*) skipped=$((skipped + 1)); continue ;;
    esac
    if [[ -d "$target" ]]; then
      if [[ "$ADOPT_DIRS" == "1" ]]; then
        to_adopt+=("$rel")
      else
        warn "$rel: real directory (may hold machine files), refused — use --adopt-dirs to move it aside"
        refused=$((refused + 1))
      fi
      continue
    fi
    [[ -e "$target" ]] && to_adopt+=("$rel")                # a real file: adopt
  done

  # Directory entries: stow links directories as well, so an absolute link to a
  # package directory (e.g. ~/.bashrc.d) is the same conflict one level up.
  for rel in "${paths[@]}"; do
    dir="$rel"
    while [[ "$dir" == */* ]]; do
      dir="${dir%/*}"
      t="$HOME/$dir"
      [[ -L "$t" ]] || continue
      res="$(readlink -f "$t" 2>/dev/null || true)"
      [[ "$res" == "$REPO"/* && "$(readlink "$t")" == "$res" ]] || continue
      case " ${to_relink[*]} " in *" $dir "*) continue ;; esac
      to_relink+=("$dir")
    done
  done

  for rel in "${to_relink[@]}"; do
    if [[ "$MODE" == "dry-run" ]]; then
      say "[dry-run] relink $rel (absolute link, stow wants its own)"
    else
      rm -f "$HOME/$rel"
      say "relinked $rel"
    fi
  done

  [[ ${#to_adopt[@]} -eq 0 && ${#to_relink[@]} -eq 0 ]] && say "nothing to adopt"
  if [[ ${#to_adopt[@]} -gt 0 ]]; then
    for rel in "${to_adopt[@]}"; do
      if [[ "$MODE" == "dry-run" ]]; then
        say "[dry-run] adopt $rel → backup in $BACKUP_DIR/$rel"
      else
        mkdir -p "$(dirname "$BACKUP_DIR/$rel")"
        if cp -a "$HOME/$rel" "$BACKUP_DIR/$rel" 2>/dev/null; then
          rm -rf "${HOME:?}/$rel"
          adopted=$((adopted + 1))
          say "adopted $rel (backup: $BACKUP_DIR/$rel)"
        else
          warn "$rel: could not back it up, left untouched"
          failed=$((failed + 1))
        fi
      fi
    done
  fi

  if [[ "$MODE" == "dry-run" ]]; then
    say "[dry-run] then: stow -t $HOME $pkg"
    continue
  fi

  stow -t "$HOME" "$pkg" 2>&1 | sed 's/^/  /'
  if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
    warn "stow $pkg failed"
    failed=$((failed + 1)); continue
  fi
  # A stow that left any package file not pointing into the repo is a failure,
  # whatever stow returned.
  bad=0
  for rel in "${paths[@]}"; do
    is_os_owned "$rel" && continue
    [[ -e "$HOME/$rel" || -L "$HOME/$rel" ]] || { warn "$rel: missing after stow"; bad=$((bad + 1)); continue; }
    resolved="$(readlink -f "$HOME/$rel" 2>/dev/null || true)"
    case "$resolved" in "$REPO"/*) ;; *) warn "$rel: does not resolve into the repository"; bad=$((bad + 1)) ;; esac
  done
  [[ "$bad" -eq 0 ]] && say "verified: every entry now links into the repository"
  failed=$((failed + bad))
done

printf '\n── summary ──\n'
printf '  %s adopted · %s already ours · %s refused · %s failed\n' "$adopted" "$skipped" "$refused" "$failed"
if [[ "$MODE" == "dry-run" ]]; then
  printf '  dry run: nothing was changed (pass --apply)\n'
elif [[ "$adopted" -gt 0 ]]; then
  printf '  backups: %s\n' "$BACKUP_DIR"
fi
[[ "$refused" -eq 0 && "$failed" -eq 0 ]]
