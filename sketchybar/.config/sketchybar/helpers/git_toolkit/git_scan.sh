#!/usr/bin/env bash
set -euo pipefail

# Config (override via env)
PROJECTS_DIR="${PROJECTS_DIR:-$HOME/Projects}"
MAX_REPOS="${MAX_REPOS:-10}"
RECENT_DAYS="${RECENT_DAYS:-0}"
MAX_DEPTH="${MAX_DEPTH:-4}"

[[ -d "$PROJECTS_DIR" ]] || exit 0

# Find git repos - use fd if available (faster), else find
if command -v fd &>/dev/null; then
    mapfile -t repos < <(
        fd --hidden --type d --max-depth "$MAX_DEPTH" \
            --exclude node_modules --exclude .cache --exclude dist \
            --exclude build --exclude out --exclude .venv --exclude venv \
            --exclude .tox --exclude target --exclude vendor --exclude Pods \
            '\.git$' "$PROJECTS_DIR" 2>/dev/null | sed -E 's#/\.git/?$##'
    )
else
    mapfile -t repos < <(
        find "$PROJECTS_DIR" -maxdepth "$MAX_DEPTH" -type d -name '.git' 2>/dev/null \
            | grep -v -E '/(node_modules|\.cache|dist|build|out|\.venv|venv|\.tox|target|vendor|Pods)/' \
            | sed 's#/\.git$##'
    )
fi

((${#repos[@]} == 0)) && exit 0

# Collect timestamps and sort by recency
tmp_ts=$(mktemp)
trap 'rm -f "$tmp_ts"' EXIT

for r in "${repos[@]}"; do
    ts=$(git -C "$r" log -1 --format=%ct 2>/dev/null || echo 0)
    echo "$ts|$r"
done | sort -t'|' -k1 -nr > "$tmp_ts"

# Read sorted repos
mapfile -t sorted < <(cut -d'|' -f2 "$tmp_ts")
declare -A timestamps
while IFS='|' read -r ts path; do
    timestamps["$path"]="$ts"
done < "$tmp_ts"

now=$(date +%s)
count=0

for r in "${sorted[@]}"; do
    [[ -d "$r/.git" ]] || continue

    ts="${timestamps[$r]:-0}"
    if ((RECENT_DAYS > 0 && ts > 0)); then
        ((now - ts > RECENT_DAYS * 86400)) && continue
    fi

    name=$(basename "$r")
    branch=$(git -C "$r" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '-')

    # Fast dirty check
    dirty=0
    [[ -n "$(git -C "$r" status --porcelain -uno 2>/dev/null | head -1)" ]] && dirty=1
    [[ -n "$(git -C "$r" ls-files --others --exclude-standard 2>/dev/null | head -1)" ]] && dirty=1

    # ahead/behind
    ahead=0 behind=0
    if git -C "$r" rev-parse --abbrev-ref --symbolic-full-name @{u} &>/dev/null; then
        read -r behind ahead < <(git -C "$r" rev-list --left-right --count @{u}...HEAD 2>/dev/null || echo "0 0")
    fi

    rel=$(git -C "$r" log -1 --date=relative --format='%ad' 2>/dev/null || echo '-')

    # GitHub slug
    slug="-"
    if remote=$(git -C "$r" remote get-url origin 2>/dev/null); then
        [[ "$remote" =~ github.com[:/]+([^/]+)/([^/.]+) ]] && slug="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
    fi

    printf "%s|%s|%s|%s|%s|%s|%s|%s\n" \
        "$name" "$r" "$branch" "$dirty" "$ahead" "$behind" "$rel" "$slug"

    ((++count >= MAX_REPOS)) && break
done
