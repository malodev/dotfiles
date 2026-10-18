#!/usr/bin/env bash
#=============================================================================
# install-offline-bundle.sh — restore a bundle on a machine with no internet
#
# Puts back what make-offline-bundle.sh collected (the repository, the `mise` binary, the
# tool installs, a pinned mise config, pi's npm packages) and then runs Stage 0 with
# `--offline`, which skips every step that would need the network.
#
# Usage:
#   scripts/install-offline-bundle.sh <bundle.tar.gz> [target-dir]
#
# Defaults to ~/dotfiles. An existing mise config is kept as config.toml.pre-bundle once, so
# a second run does not overwrite the first backup.
#
# What this cannot do: the system layer (`install.sh`, i.e. stow and the package manager) and
# nvim-malo's plugins. Stage 0 userspace only is the point.
#=============================================================================
set -eo pipefail

BUNDLE="${1:-}"
DIR="${2:-$HOME/dotfiles}"

if [[ -z "$BUNDLE" || ! -f "$BUNDLE" ]]; then
  sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
fi

info() { echo "  * $1"; }
ok()   { echo "  ✓ $1"; }
warn() { echo "  ! $1" >&2; }

echo "── restoring offline bundle ──"
info "bundle: $BUNDLE"
info "target: $DIR"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar -xzf "$BUNDLE" -C "$WORK"
BUNDLE_ROOT="$(find "$WORK" -maxdepth 1 -mindepth 1 -type d | head -1)"
[[ -n "$BUNDLE_ROOT" ]] || { warn "the bundle has no top-level directory"; exit 1; }

if [[ -f "$BUNDLE_ROOT/MANIFEST.txt" ]]; then
  info "manifest:"
  sed 's/^/      /' "$BUNDLE_ROOT/MANIFEST.txt"
fi

# 1. Repository
mkdir -p "$DIR"
COPYFILE_DISABLE=1 tar -C "$BUNDLE_ROOT/repo" -cf - . | tar -C "$DIR" -xf -
ok "repository restored in $DIR"

# 2. mise binary, tool installs, pinned config, pi packages
if [[ -d "$BUNDLE_ROOT/home" ]]; then
  if [[ -f "$HOME/.config/mise/config.toml" && ! -f "$HOME/.config/mise/config.toml.pre-bundle" ]]; then
    cp -a "$HOME/.config/mise/config.toml" "$HOME/.config/mise/config.toml.pre-bundle"
    info "existing mise config kept at ~/.config/mise/config.toml.pre-bundle"
  fi
  mkdir -p "$HOME/.local/share/mise/installs" "$HOME/.pi/agent"
  COPYFILE_DISABLE=1 tar -C "$BUNDLE_ROOT/home" -cf - . | tar -C "$HOME" -xf -
  [[ -f "$HOME/.local/bin/mise" ]] && chmod 0755 "$HOME/.local/bin/mise"
  ok "mise, tool installs and pi packages restored into \$HOME"
fi

export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"

# 3. Shims, then Stage 0 in offline mode
if [[ -x "$HOME/.local/bin/mise" ]]; then
  "$HOME/.local/bin/mise" reshim >/dev/null 2>&1 || warn "mise reshim had warnings"
  ok "mise shims rebuilt ($("$HOME/.local/bin/mise" --version 2>/dev/null | head -1))"
else
  warn "no mise binary in the bundle"
fi

echo ""
info "running Stage 0 with --offline"
DOTFILES_OFFLINE=1 bash "$DIR/bootstrap.sh" --offline

echo ""
info "verify with:"
info "  cd $DIR && ./local-bin/.local/bin/dot doctor --json"
info "  . \$HOME/.bashrc 2>/dev/null; dot doctor"
