#!/usr/bin/env bash
#=============================================================================
# fleet-sync.sh
#
# Fast-forward the dotfiles checkout on every machine in the fleet, so a change
# pushed to origin reaches the other machines without logging into each one.
#
# This is the "automatic" half of a push. It is deliberately conservative,
# because a sync that guesses is worse than no sync:
#
#   - it only ever fast-forwards (`git merge --ff-only`), never rebases, never
#     resets, never forces, never discards anything;
#   - it refuses a target whose working tree has modified tracked files, or
#     whose branch has commits that are not on origin (`ahead`/`diverged`):
#     those need a decision, so they are reported, not resolved;
#   - untracked files are reported but do not block: `--ff-only` leaves them
#     alone unless the incoming commit adds the same path, and then git refuses
#     on its own;
#   - it is read-only unless `--apply` is given. The default is a dry run, so an
#     agent can always show the plan first.
#
# After a fast-forward it re-links the agent entries and seeds the instruction
# files, so a machine that just received a new skill or AGENTS.md actually has
# it in place.
#
# Usage:
#   scripts/fleet-sync.sh                     # dry run over the fleet file
#   scripts/fleet-sync.sh --apply             # fast-forward every safe target
#   scripts/fleet-sync.sh --hosts FILE        # use another fleet file
#   scripts/fleet-sync.sh --host HOST         # one target, for a spot check
#   DOTFILES_FLEET=FILE scripts/fleet-sync.sh # same as --hosts
#
# Fleet file: one ssh destination per line, `#` starts a comment. Profiles are
# not used: this only needs an ssh target that already has the repository.
#=============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="dry-run"
FLEET="${DOTFILES_FLEET:-$REPO/hosts/home.local.fleet}"
ONLY_HOST=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)      MODE="apply"; shift ;;
    --dry-run)    MODE="dry-run"; shift ;;
    --hosts)      FLEET="$2"; shift 2 ;;
    --host)       ONLY_HOST="$2"; shift 2 ;;
    --help|-h)    awk 'NR>=3 && /^#=====/{exit} NR>=3' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

info() { printf '  %s\n' "$*"; }
rule() { printf '\n── %s ──\n' "$*"; }

[[ -f "$FLEET" ]] || { echo "error: no fleet file at $FLEET" >&2; exit 1; }

# The remote half: fetch, judge, and (only in apply mode) fast-forward + relink.
remote_script() {
  cat <<'REMOTE'
set -uo pipefail
cd "$HOME/dotfiles" 2>/dev/null || { echo "STATE=no-repo"; exit 0; }
git fetch --prune --quiet 2>/dev/null
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
dirty="$(git status --porcelain 2>/dev/null | grep -vc '^??' || true)"
untracked="$(git status --porcelain 2>/dev/null | grep -c '^??' || true)"
ahead=0; behind=0
if [[ "$branch" == "main" ]]; then
  read -r behind ahead < <(git rev-list --left-right --count origin/main...HEAD 2>/dev/null || echo "0 0")
fi
echo "STATE=ok"
echo "BRANCH=$branch"
echo "TIP=$(git log -1 --format='%h %ad %s' --date=short 2>/dev/null)"
echo "DIRTY=$dirty"
echo "UNTRACKED=$untracked"
echo "BEHIND=$behind"
echo "AHEAD=$ahead"
if [[ "${MODE:-dry-run}" != "apply" ]]; then
  exit 0
fi
if [[ "$branch" != "main" || "$dirty" -gt 0 || "$ahead" -gt 0 ]]; then
  echo "DONE=skipped"
  exit 0
fi
if git merge --ff-only --quiet origin/main 2>&1; then
  echo "MERGED=1"
  [[ -x scripts/link-pi-agent-entries.sh ]] && scripts/link-pi-agent-entries.sh >/dev/null 2>&1
  [[ -x scripts/seed-agent-instructions.sh ]] && scripts/seed-agent-instructions.sh >/dev/null 2>&1
  echo "RELINKED=1"
  echo "MERGED_TIP=$(git log -1 --format='%h %ad %s' --date=short)"
else
  echo "MERGED=0"
  echo "DONE=failed"
fi
REMOTE
}

hosts=()
if [[ -n "$ONLY_HOST" ]]; then
  hosts+=("$ONLY_HOST")
else
  while IFS= read -r line; do
    line="${line%%#*}"
    set -- $line
    [[ $# -ge 1 ]] && hosts+=("$1")
  done <"$FLEET"
fi

[[ ${#hosts[@]} -gt 0 ]] || { echo "error: $FLEET lists no hosts" >&2; exit 1; }

self_local="$(hostname -s 2>/dev/null || hostname)"
self_fqdn="$(hostname -f 2>/dev/null || true)"
skipped=0; updated=0; failed=0

for host in "${hosts[@]}"; do
  rule "$host"
  if [[ "$host" == "$self_local" || "$host" == "$self_fqdn" ]]; then
    info "this machine, skipping"
    continue
  fi
  out="$(ssh -o BatchMode=yes -o ConnectTimeout=8 "$host" \
        "MODE=$MODE bash -s" <<<"$(remote_script)" 2>&1)"
  if grep -q '^STATE=no-repo' <<<"$out"; then
    info "no ~/dotfiles on this host, skipping"
    continue
  fi
  if ! grep -q '^STATE=ok' <<<"$out"; then
    info "unreachable: $(head -n 1 <<<"$out")"
    failed=$((failed + 1))
    continue
  fi
  get() { sed -n "s/^$1=//p" <<<"$out" | head -n 1; }
  branch="$(get BRANCH)"; dirty="$(get DIRTY)"; untracked="$(get UNTRACKED)"
  behind="$(get BEHIND)"; ahead="$(get AHEAD)"; tip="$(get TIP)"
  info "HEAD $tip"
  info "branch $branch · behind $behind · ahead $ahead · dirty $dirty · untracked $untracked"

  if [[ "$branch" != "main" ]]; then
    info "SKIP: not on main"
    skipped=$((skipped + 1)); continue
  fi
  if [[ "$ahead" -gt 0 ]]; then
    info "SKIP: $ahead commit(s) not on origin/main — needs a human decision, nothing forced"
    skipped=$((skipped + 1)); continue
  fi
  if [[ "$dirty" -gt 0 ]]; then
    info "SKIP: $dirty modified tracked file(s) — local work, nothing overwritten"
    skipped=$((skipped + 1)); continue
  fi
  if [[ "$behind" -eq 0 ]]; then
    info "up to date"
    continue
  fi

  if [[ "$MODE" != "apply" ]]; then
    info "[dry-run] would fast-forward $behind commit(s), then relink agent entries"
    continue
  fi

  if grep -q '^MERGED=1' <<<"$out"; then
    # The target prints TIP before and after the merge; the second one is the new HEAD.
    info "fast-forwarded $behind commit(s) → $(sed -n 's/^MERGED_TIP=//p' <<<"$out" | head -n 1)"
    grep -q '^RELINKED=1' <<<"$out" && info "agent entries relinked, instruction files seeded"
    updated=$((updated + 1))
  else
    info "FAILED to fast-forward: $(grep -v '^[A-Z_]*=' <<<"$out" | head -n 2 | tr '\n' ' ')"
    failed=$((failed + 1))
  fi
done

rule "summary"
info "$updated updated · $skipped skipped · $failed failed"
[[ "$MODE" == "apply" ]] || info "dry run: nothing was changed (pass --apply to fast-forward)"
