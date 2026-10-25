#!/usr/bin/env bash
# check-clean-room.sh - no machine's specifics in the tracked configuration.
#
# ADOPTION.md section 2, as a check: "after adopting on machine A, deploying to a clean machine
# must produce a configuration with no trace of A". The full version of that is a deploy to a
# throwaway host; this is the part that runs on every commit, in CI, in a second.
#
# What counts as a trace: a home path of one user, the domain of one site, a private address, a
# credential command that names a file in someone's home. What does not: $HOME, ${HOME} and ~,
# which are portable, and the templates, which are the thing deployed and must therefore be
# clean too - they are scanned like everything else.
#
# Markdown is skipped: documentation describes real examples on purpose, and ADOPTION.md itself
# is the list of what those examples look like. If a document does need an exception, that is a
# sign the example belongs in the allowlist below with a reason.
#
# Exit: 0 clean, 1 findings, 2 usage.
set -uo pipefail

REPO="${DOTFILES_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ALLOW_FILE="$REPO/scripts/clean-room-allow.txt"
FORMAT="text"

for arg in "$@"; do
  case "$arg" in
    --json) FORMAT="json" ;;
    --help|-h)
      cat <<'EOF'
Usage: check-clean-room.sh [--json]

Scans every tracked, non-Markdown file for values that are only true on one machine.
Exit 0 when clean, 1 when something leaked, 2 on a usage error.
EOF
      exit 0 ;;
    *) echo "check-clean-room: unknown argument $arg" >&2; exit 2 ;;
  esac
done

cd "$REPO" || { echo "check-clean-room: not a repository: $REPO" >&2; exit 2; }

# pattern|why it is a trace
PATTERNS=(
  '/Users/[a-z][a-z0-9._-]*/|home path of one macOS user'
  'C:\\\\Users\\\\[^$%]|home path of one Windows user'
  '[a-z0-9-]+\.marconi\.loc|domain of one site'
  '(^|[^0-9])192\.168\.[0-9]+\.[0-9]+|private LAN address'
)
# A credential command is not a trace by itself: "!cat ~/.config/x" and "!cat $HOME/.config/x"
# are portable, which is exactly the point of writing them that way. Only an absolute home
# path is a trace, and the two rules above already catch those.

is_allowed() {
  local path="$1" line="$2"
  [[ -f "$ALLOW_FILE" ]] || return 1
  local allow_path allow_pat
  while IFS='|' read -r allow_path allow_pat _rest; do
    [[ -z "$allow_path" || "$allow_path" == \#* ]] && continue
    # glob on purpose: an entry may name a whole directory
    # shellcheck disable=SC2053
    [[ "$path" == $allow_path ]] || continue
    [[ "$line" == *$allow_pat* ]] && return 0
  done < "$ALLOW_FILE"
  return 1
}

findings=0
report=""

while IFS= read -r file; do
  [[ "$file" == *.md ]] && continue          # documentation: examples are the point
  [[ "$file" == scripts/clean-room-allow.txt ]] && continue
  [[ -f "$file" ]] || continue
  for entry in "${PATTERNS[@]}"; do
    pattern="${entry%%|*}"
    why="${entry#*|}"
    while IFS= read -r hit; do
      [[ -z "$hit" ]] && continue
      is_allowed "$file" "$hit" && continue
      findings=$((findings + 1))
      report+="$file:$hit|$why"$'\n'
    done < <(grep -nE -- "$pattern" "$file" 2>/dev/null || true)
  done
done < <(git ls-files)

if [[ "$FORMAT" == "json" ]]; then
  printf '%s' "$report" | python3 -c '
import json, sys
items = []
for line in sys.stdin.read().splitlines():
    if not line.strip(): continue
    where, why = line.split("|", 1)
    path, lineno, text = where.split(":", 2)
    items.append({"file": path, "line": int(lineno), "text": text.strip(), "why": why})
print(json.dumps({"clean": not items, "findings": len(items), "items": items}, indent=2))
'
  [[ $findings -eq 0 ]] && exit 0 || exit 1
fi

if [[ $findings -eq 0 ]]; then
  echo "  [OK] clean: no home path, site domain, private address or credential path in the tracked files"
  exit 0
fi

echo "── clean-room: values that are only true on one machine ──"
echo
printf '%s' "$report" | while IFS='|' read -r where why; do
  [[ -z "$where" ]] && continue
  path="${where%%:*}"
  rest="${where#*:}"
  echo "  $path:${rest%%:*}   ($why)"
  echo "        ${rest#*:}"
  echo
done
echo "  $findings finding(s). Move the value to the live file or a *_local file, or add a line to"
echo "  scripts/clean-room-allow.txt with the reason it is not one: path|text|reason"
exit 1
