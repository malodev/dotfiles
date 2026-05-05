#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=/dev/null
source "$REPO_DIR/scripts/install/manifest.sh"

fail() {
    echo "Manifest validation failed: $1" >&2
    exit 1
}

package_in_group() {
    local group="$1"
    local pkg="$2"
    local item
    for item in ${INSTALL_GROUPS[$group]}; do
        if [[ "$item" == "$pkg" ]]; then
            return 0
        fi
    done
    return 1
}

for group in "${INSTALL_ORDER[@]}"; do
    [[ -v "INSTALL_GROUPS[$group]" ]] || fail "group '$group' missing from INSTALL_GROUPS"
    [[ -v "GROUP_DESC[$group]" ]] || fail "group '$group' missing from GROUP_DESC"
    [[ -v "DEFAULT_GROUPS_DARWIN[$group]" ]] || fail "group '$group' missing from DEFAULT_GROUPS_DARWIN"
    [[ -v "DEFAULT_GROUPS_LINUX[$group]" ]] || fail "group '$group' missing from DEFAULT_GROUPS_LINUX"
    [[ -v "GROUP_PLATFORM[$group]" ]] || fail "group '$group' missing from GROUP_PLATFORM"
    case "${GROUP_PLATFORM[$group]}" in
        all|macos|linux) ;;
        *) fail "group '$group' has invalid platform '${GROUP_PLATFORM[$group]}'" ;;
    esac
done

for key in "${NVIM_CONFIG_ORDER[@]}"; do
    [[ -v "NVIM_CONFIGS[$key]" ]] || fail "nvim key '$key' missing from NVIM_CONFIGS"
    package_in_group editor "nvim-$key" || fail "editor group missing package nvim-$key"
done

found_default=0
for key in "${NVIM_CONFIG_ORDER[@]}"; do
    if [[ "$key" == "$DEFAULT_NVIM_KEY" ]]; then
        found_default=1
        break
    fi
done
[[ "$found_default" == "1" ]] || fail "DEFAULT_NVIM_KEY '$DEFAULT_NVIM_KEY' not present in NVIM_CONFIG_ORDER"

for shell_pkg in "${SHELL_CONFIG_PACKAGES[@]}"; do
    [[ -n "$shell_pkg" ]] || fail "empty shell package name in SHELL_CONFIG_PACKAGES"
done

for pkg in "${!COMMAND_CHECK_OVERRIDES[@]}"; do
    [[ -n "$pkg" ]] || fail "empty key in COMMAND_CHECK_OVERRIDES"
    [[ -n "${COMMAND_CHECK_OVERRIDES[$pkg]}" ]] || fail "empty command override for package '$pkg'"
done

echo "Manifest validation passed."
