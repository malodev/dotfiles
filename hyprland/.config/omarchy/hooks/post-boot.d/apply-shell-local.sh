#!/usr/bin/env bash
#
# Re-apply this machine's shell.json delta after login.
#
# Omarchy rewrites ~/.config/omarchy/shell.json whenever the bar or a plugin
# changes, and a fresh stow can replace it too; on a machine with
# ~/.config/omarchy/shell.local.json the generated file has to be rebuilt after
# that, otherwise the machine-local values (idle policy, per-machine bar bits)
# are lost. The script is a no-op on machines without a delta file, where the
# shared file is simply symlinked.

set -euo pipefail

hook_path="$(readlink -f -- "$0")"
repo="${DOTFILES_ROOT:-$(cd -- "$(dirname -- "$hook_path")/../../../../.." && pwd)}"

[ -x "$repo/scripts/omarchy-shell-apply-local.sh" ] || exit 0
exec "$repo/scripts/omarchy-shell-apply-local.sh" --quiet
