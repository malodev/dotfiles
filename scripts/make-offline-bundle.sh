#!/usr/bin/env bash
#=============================================================================
# make-offline-bundle.sh — build a tarball that can seed a machine with no internet
#
# Stage 0 needs the network for exactly three things:
#   1. the `mise` binary itself
#   2. the tools `mise` installs (node, neovim, starship, ripgrep, fd, fzf, jq, lazygit, …)
#   3. `pi` plus the npm packages it installs for itself
#
# This collects those, pinned, next to a copy of the repository, so that
# install-offline-bundle.sh can put them back and `bootstrap.sh --offline` can run without
# touching the network. Run it on a machine that already has everything installed.
#
# Usage:
#   scripts/make-offline-bundle.sh                     # every installed mise tool
#   scripts/make-offline-bundle.sh --tools "node jq"   # only these tools
#   scripts/make-offline-bundle.sh --out /tmp/bundles --with-git
#   scripts/make-offline-bundle.sh --dry-run
#
# Options:
#   --out DIR            where to write the tarball (default: <repo>/dist)
#   --tools "a b c"      only these mise tools (default: every installed one)
#   --with-git           include .git, so the target keeps history (bigger)
#   --no-pi-packages     skip ~/.pi/agent/npm (pi reinstalls them when it has internet)
#   --dry-run            print what would be collected
#=============================================================================
set -eo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO/dist"
TOOLS=""
WITH_GIT=0
PI_PACKAGES=1
DRY_RUN=0

usage() { sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)              OUT_DIR="$2"; shift 2 ;;
    --tools)            TOOLS="$2"; shift 2 ;;
    --with-git)         WITH_GIT=1; shift ;;
    --no-pi-packages)   PI_PACKAGES=0; shift ;;
    --dry-run)          DRY_RUN=1; shift ;;
    -h|--help)          usage; exit 0 ;;
    *) echo "make-offline-bundle: unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

info() { echo "  * $1"; }
ok()   { echo "  ✓ $1"; }
warn() { echo "  ! $1" >&2; }
run()  { if [[ "$DRY_RUN" == "1" ]]; then echo "  [dry-run] $*"; else "$@"; fi; }

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
STAMP="$(date +%Y%m%d)"
NAME="dotfiles-offline-$OS-$ARCH-$STAMP"
MISE_HOME="$HOME/.local/share/mise"
MISE_CONFIG="$HOME/.config/mise/config.toml"

echo "── offline bundle ──"
info "repository: $REPO"
info "platform:   $OS/$ARCH"

# PATH is not guaranteed: an agent running this over SSH gets a non-interactive shell.
MISE_BIN="$(command -v mise 2>/dev/null || true)"
if [[ -z "$MISE_BIN" ]]; then
  for candidate in "$HOME/.local/bin/mise" "$HOME/.local/share/mise/bin/mise" /opt/homebrew/bin/mise /usr/local/bin/mise; do
    [[ -x "$candidate" ]] && { MISE_BIN="$candidate"; break; }
  done
fi
[[ -n "$MISE_BIN" ]] || { warn "mise is not installed here: run bootstrap.sh first"; exit 1; }
info "mise:       $MISE_BIN ($("$MISE_BIN" --version 2>/dev/null | head -1))"

# Which tool installs go in. Empty --tools means everything mise has installed.
installed_tools=()
if [[ -d "$MISE_HOME/installs" ]]; then
  for d in "$MISE_HOME/installs"/*; do
    [[ -d "$d" ]] || continue
    installed_tools+=("$(basename "$d")")
  done
fi
[[ ${#installed_tools[@]} -gt 0 ]] || { warn "no mise installs found in $MISE_HOME/installs"; exit 1; }

selected_tools=()
if [[ -n "$TOOLS" ]]; then
  for t in $TOOLS; do
    if [[ -d "$MISE_HOME/installs/$t" ]]; then selected_tools+=("$t"); else warn "not installed, skipping: $t"; fi
  done
else
  selected_tools=("${installed_tools[@]}")
fi
[[ ${#selected_tools[@]} -gt 0 ]] || { warn "nothing to collect"; exit 1; }
info "tools:      ${selected_tools[*]}"

# The installed version of a tool. `mise ls` is authoritative: the installs directory also
# holds alias symlinks such as jq/1 -> ./1.8.2, and pinning "1" would be wrong.
pinned_for() {
  "$MISE_BIN" ls 2>/dev/null | awk -v t="$1" '
    $1 == t { if (NF >= 3) { v = $2 } else if (v == "") { v = $2 } }
    END { if (v != "") print v }'
}

if [[ "$DRY_RUN" == "1" ]]; then
  run "tar the repository (git history: $WITH_GIT) into $NAME/repo"
  run "copy $MISE_BIN into $NAME/home/.local/bin/mise"
  for t in "${selected_tools[@]}"; do run "copy $MISE_HOME/installs/$t into $NAME/home/.local/share/mise/installs/$t"; done
  run "write a pinned $NAME/home/.config/mise/config.toml from the installed versions"
  [[ "$PI_PACKAGES" == "1" && -d "$HOME/.pi/agent/npm" ]] && run "copy ~/.pi/agent/npm into $NAME/home/.pi/agent/npm"
  run "write $NAME/MANIFEST.txt and tar it to $OUT_DIR/$NAME.tar.gz"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. The repository (AppleDouble files excluded: macOS tar ships ._* otherwise)
mkdir -p "$WORK/$NAME/repo"
EXCLUDES=(--exclude=dist --exclude=node_modules --exclude=.DS_Store)
[[ "$WITH_GIT" != "1" ]] && EXCLUDES+=(--exclude=.git)
COPYFILE_DISABLE=1 tar -C "$REPO" "${EXCLUDES[@]}" -cf - . | tar -C "$WORK/$NAME/repo" -xf -
ok "repository copied ($(du -sh "$WORK/$NAME/repo" | cut -f1))"

# 2. The mise binary, in userspace
mkdir -p "$WORK/$NAME/home/.local/bin"
cp -p "$MISE_BIN" "$WORK/$NAME/home/.local/bin/mise"
chmod 0755 "$WORK/$NAME/home/.local/bin/mise"
ok "mise binary copied"

# 3. The tool installs
for t in "${selected_tools[@]}"; do
  mkdir -p "$WORK/$NAME/home/.local/share/mise/installs/$t"
  cp -a "$MISE_HOME/installs/$t/." "$WORK/$NAME/home/.local/share/mise/installs/$t/"
done
ok "tool installs copied ($(du -sh "$WORK/$NAME/home/.local/share/mise" | cut -f1))"

# 4. A config with *pinned* versions. `mise use -g node@lts` writes "lts", which needs the
#    network to resolve; the exact installed versions do not.
mkdir -p "$WORK/$NAME/home/.config/mise"
{
  echo "# Generated by make-offline-bundle.sh on $STAMP: pinned so that 'mise install'"
  echo "# resolves nothing and works with no network."
  echo "[tools]"
  for t in "${selected_tools[@]}"; do
    v="$(pinned_for "$t")"
    [[ -n "$v" ]] && printf '%s = "%s"\n' "$t" "$v"
  done
} > "$WORK/$NAME/home/.config/mise/config.toml"
ok "pinned mise config written"

# 5. pi's own npm packages (it would otherwise install them on first run)
if [[ "$PI_PACKAGES" == "1" && -d "$HOME/.pi/agent/npm" ]]; then
  mkdir -p "$WORK/$NAME/home/.pi/agent"
  cp -a "$HOME/.pi/agent/npm" "$WORK/$NAME/home/.pi/agent/npm"
  ok "pi packages copied ($(du -sh "$WORK/$NAME/home/.pi/agent/npm" | cut -f1))"
elif [[ "$PI_PACKAGES" == "1" ]]; then
  warn "no ~/.pi/agent/npm to copy: pi will install its packages when it first has network"
fi

# 6. Manifest, so the target can see what it got
{
  echo "dotfiles offline bundle"
  echo "built:        $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "platform:     $OS/$ARCH"
  echo "repo commit:  $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo "no git")"
  echo "repo dirty:   $(git -C "$REPO" status --porcelain 2>/dev/null | wc -l | tr -d ' ') files"
  echo "mise:         $("$MISE_BIN" --version 2>/dev/null | head -1)"
  echo "tools:"
  for t in "${selected_tools[@]}"; do echo "  $t $(pinned_for "$t")"; done
  echo "pi packages:  $([[ -d "$WORK/$NAME/home/.pi/agent/npm" ]] && echo yes || echo no)"
  echo "git history:  $([[ "$WITH_GIT" == "1" ]] && echo included || echo excluded)"
  echo ""
  echo "not included, on purpose:"
  echo "  node_modules/ under pi extensions (dev dependencies)"
  echo "  the system layer (install.sh): it needs a package manager"
  echo "  nvim-malo plugins: nvim-lite, the bootstrap default, needs none"
} > "$WORK/$NAME/MANIFEST.txt"

mkdir -p "$OUT_DIR"
COPYFILE_DISABLE=1 tar -C "$WORK" -czf "$OUT_DIR/$NAME.tar.gz" "$NAME"
ok "bundle written: $OUT_DIR/$NAME.tar.gz ($(du -sh "$OUT_DIR/$NAME.tar.gz" | cut -f1))"
echo ""
info "On the machine without internet:"
info "  tar -xzf $NAME.tar.gz && ./$NAME/repo/scripts/install-offline-bundle.sh $OUT_DIR/$NAME.tar.gz"
