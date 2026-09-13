#!/usr/bin/env bash
#
# Publish the shell-config changes made on this machine back into the dotfiles.
#
# On a machine with ~/.config/omarchy/shell.local.json the live shell.json is
# generated from the shared tracked file plus that delta, so UI/CLI edits made
# here (bar layout, plugin toggles, `omarchy bar set`) do not reach the dotfiles
# by themselves. This promotes them: everything except the delta-owned keys is
# written back into hyprland/.config/omarchy/shell.json, ready to commit.
#
# Usage: omarchy-shell-promote.sh [--quiet]

set -euo pipefail

script="$(readlink -f -- "$0")"
exec "$(dirname -- "$script")/omarchy-shell-apply-local.sh" --promote "$@"
