#!/usr/bin/env bash
# adopt-report.sh - what belongs in the repository, and what stays on the machine.
#
# Read-only: it proposes a category for every difference it finds; the human confirms, and
# `dot adopt --apply` (not written yet) would do the moving. The model is ADOPTION.md.
#
#   1. tracked files that differ from the repository  (git status + only the added lines)
#   2. untracked files in the working tree            (a decision, never a `git add`)
#   3. managed paths whose live state is not right    (doctor's links and sentinels)
#   4. files that still carry inline edits            (extract-local-overrides.sh --dry-run)
#
# Signals are the smells from ADOPTION.md section 4 - a home path, a LAN name, a credential
# command, a cache - read from what *changed*, not from the whole file: a script that happens
# to contain "127.0.0.1" in its own code is not a machine-specific value, and a hunk that adds
# /Users/mauro is.
#
# Usage: adopt-report.sh [--diff] [--json] [--dir <repo>]
set -uo pipefail

REPO="${DOTFILES_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
FORMAT="text"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --diff)  FORMAT="text"; shift ;;
    --json)  FORMAT="json"; shift ;;
    --dir)   REPO="$2"; shift 2 ;;
    --apply)
      echo "adopt: --apply is not implemented yet; --diff only proposes (see ADOPTION.md section 8)" >&2
      exit 2 ;;
    --help|-h)
      cat <<'EOF'
Usage: adopt-report.sh [--diff] [--json] [--dir <repo>]

  --diff   human-readable report (default)
  --json   the same data as JSON, for an agent

Read-only: nothing is written, moved or committed. Every finding comes with a suggested
category - common, this machine's, someone else's, or "to decide" - and the reason.
EOF
      exit 0 ;;
    *) echo "adopt-report: unknown argument $1" >&2; exit 2 ;;
  esac
done

[[ -d "$REPO" ]] || { echo "adopt-report: not a directory: $REPO" >&2; exit 2; }

exec python3 - "$REPO" "$FORMAT" <<'PY'
import json
import pathlib
import re
import subprocess
import sys

repo, fmt = pathlib.Path(sys.argv[1]), sys.argv[2]

# Signals: the smells from ADOPTION.md section 4, matched against what changed.
SIGNALS = [
    ("absolute home path", re.compile(r"/Users/[A-Za-z]")),
    ("absolute home path", re.compile(r"C:\\\\Users\\\\")),
    ("LAN hostname", re.compile(r"[A-Za-z0-9_-]+\.(loc|lan)\b")),
    ("private address", re.compile(r"(192\.168|10\.[0-9]+|127\.0\.0\.1)[.:]")),
    ("credential reference", re.compile(r"api[-_]?key|[A-Za-z]ApiKey|bearer |\"sk-|!cat |credential")),
    ("cache, history or backup", re.compile(r"cache|history|\.bak")),
]
# Code carries these strings legitimately - a grep pattern, a test fixture - so they are only
# scanned for a *new* file when the extension says it is configuration, not code.
CODE_EXT = {".sh", ".bash", ".zsh", ".ps1", ".psm1", ".psd1", ".cmd", ".bat",
            ".py", ".js", ".mjs", ".ts", ".lua", ".rb", ".go", ".rs", ".pl"}
SENTINEL = "# >>> END MANAGED CONFIG <<<"


def git(*args):
    r = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True)
    return r.stdout


def changed_text(path):
    """What a tracked file gained: the added lines of its diff, not the whole file."""
    diff = git("diff", "-U0", "--", path)
    added = [ln[1:] for ln in diff.splitlines() if ln.startswith("+") and not ln.startswith("+++")]
    return "\n".join(added), len(added)


def whole_text(path):
    p = repo / path
    if not p.is_file():
        return "", 0
    try:
        return p.read_text(errors="replace"), None
    except OSError:
        return "", 0


def signals_in(text):
    hits = []
    for name, rx in SIGNALS:
        if rx.search(text) and name not in hits:
            hits.append(name)
    return hits


def sentinel_missing(path):
    p = repo / path
    if not p.is_file():
        return False
    lines = [ln for ln in p.read_text(errors="replace").splitlines() if ln.strip()]
    return bool(lines) and lines[-1].strip() != SENTINEL


def classify(path, state, sentinels, migrating):
    """(category, reason). The order is the criterion, not the file type."""
    suffix = pathlib.PurePath(path).suffix.lower()

    if path in sentinels or pathlib.PurePath(path).name in migrating:
        return "machine", "inline edits past the sentinel: scripts/extract-local-overrides.sh --apply"

    if state == "tracked-changed":
        text, added = changed_text(path)
        sigs = signals_in(text)
        detail = f"{added} added line{'' if added == 1 else 's'}" if added is not None else ""
        if "credential reference" in sigs:
            return "machine", f"{detail} with a credential: tracked template + untracked live file"
        if {"absolute home path", "LAN hostname", "private address"} & set(sigs):
            return "machine", f"{detail} naming this host: tracked template + untracked live file"
        if "cache, history or backup" in sigs:
            return "ignored", f"{detail} of cache or history: .gitignore"
        if suffix in CODE_EXT or suffix == "":
            return "common", f"{detail} of code: promote if it is generic"
        return "common", f"{detail}, no machine signal: promote as is"

    # untracked
    if (repo / path).is_dir():
        return "decide", "an untracked directory: keep it tracked on purpose, or ignore it with a comment"
    if suffix in CODE_EXT:
        return "common", "new code: check by hand for hardcoded host paths, then promote"
    if suffix == ".md" and "/" not in path:
        return "decide", "a document, not configuration: keep it tracked on purpose, or leave it out"
    text, _ = whole_text(path)
    sigs = signals_in(text)
    if "credential reference" in sigs or {"absolute home path", "LAN hostname", "private address"} & set(sigs):
        return "machine", "machine-specific values: template + live file, never a tracked value"
    if "cache, history or backup" in sigs:
        return "ignored", "cache, history or backup: .gitignore"
    return "common", "no machine signal: promote as is"


# ── gather ────────────────────────────────────────────────────────────────────────────────
doctor = {}
raw = subprocess.run([str(repo / "scripts" / "doctor.sh"), "--json"], capture_output=True, text=True)
if raw.returncode == 0 and raw.stdout.strip():
    try:
        doctor = json.loads(raw.stdout)
    except ValueError:
        doctor = {}
drift = doctor.get("drift") or {}
sentinels = set(drift.get("sentinel_missing") or [])

migrating = set()
extract = subprocess.run([str(repo / "scripts" / "extract-local-overrides.sh"), "--dry-run"],
                         capture_output=True, text=True)
for line in extract.stdout.splitlines():
    line = re.sub(r"\x1b\[[0-9;]*m", "", line)      # the script prints colour codes
    m = re.match(r"\s+•\s+(\S+)\s*$", line)        # only the "would migrate" list, where
    if m:                                          # the name is the whole line
        migrating.add(m.group(1))

LINK_HINT = {
    "external-symlink": "points outside the repository: deliberately someone else's, or an unfinished adoption",
    "broken": "the target is gone: the live path kept working, the repository did not",
    "plain-file": "a real file where the repository expects a link: edits here never reach the repository",
    "wrong-target": "links into the repository, but to a different path than the package says",
}
links = {}
for key, value in (doctor.get("links") or {}).items():
    state = value.get("state") if isinstance(value, dict) else value
    if key.endswith("_profile"):
        continue          # a chosen profile, not a link
    if state not in ("linked", "absent", "junction", "copied"):
        links[key] = state

files = []
for line in git("status", "--porcelain", "--untracked-files=normal").splitlines():
    if not line.strip():
        continue
    state = "untracked" if line[:2] == "??" else "tracked-changed"
    path = line[3:]
    category, reason = classify(path, state, sentinels, migrating)
    files.append({"path": path, "state": state, "category": category, "reason": reason})

summary = {k: sum(1 for f in files if f["category"] == k)
           for k in ("common", "machine", "decide", "ignored")}

if fmt == "json":
    print(json.dumps({"repo": str(repo), "files": files, "links_not_as_expected": links,
                      "sentinel_missing": sorted(sentinels),
                      "would_migrate": sorted(migrating), "summary": summary}, indent=2))
    sys.exit(0)

# ── text ──────────────────────────────────────────────────────────────────────────────────
MARK = {"common": "common", "machine": "this machine's", "decide": "to decide", "ignored": "someone else's"}
print("── dot adopt — what differs, and where it belongs ──")
print(f"  repository: {repo}")
print()

if not files and not links and not sentinels:
    print("  [OK] nothing differs: the working tree is clean and the links are as expected")
    sys.exit(0)

for f in files:
    tag = "untracked" if f["state"] == "untracked" else "tracked, changed"
    mark = "~" if f["state"] == "tracked-changed" else "?"
    print(f"  {mark} {f['path']}   [{tag}]")
    print(f"        → {MARK[f['category']]}: {f['reason']}")
    print()

if links:
    print("  links not as expected (dot doctor):")
    for key, state in sorted(links.items()):
        hint = LINK_HINT.get(str(state), "not the state the repository expects")
        print(f"        {key}: {state}")
        print(f"            → {hint}")
    print()

if sentinels:
    print("  sentinel missing (inline edits after the sentinel):")
    for path in sorted(sentinels):
        print(f"        {path}")
    print()

if migrating:
    print("  extract-local-overrides would move: " + ", ".join(sorted(migrating)))
    print()

print(f"  {summary['common']} common · {summary['machine']} this machine's · "
      f"{summary['decide']} to decide · {summary['ignored']} to ignore")
print("  read-only: nothing was written, moved or committed")
print("  next: decide per file; `dot adopt --apply <file>` is not implemented yet (ADOPTION.md §8)")
PY
