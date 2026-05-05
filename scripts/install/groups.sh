#!/usr/bin/env bash

#=============================================================================
# INSTALLATION GROUPS
#=============================================================================
source "$SCRIPT_DIR/scripts/install/manifest.sh"

# Selected groups/packages (associative arrays with selected state)
declare -A DEFAULT_GROUPS
declare -A SELECTED_GROUPS
declare -A SELECTED_PACKAGES
declare -A STOW_SKIP_PACKAGES
declare -A STOW_SKIP_PATHS
PACKAGE_ONLY_MODE=0

init_default_groups() {
    local group
    DEFAULT_GROUPS=()

    if [[ "$(uname)" == "Darwin" ]]; then
        for group in "${!DEFAULT_GROUPS_DARWIN[@]}"; do
            DEFAULT_GROUPS[$group]="${DEFAULT_GROUPS_DARWIN[$group]}"
        done
    else
        for group in "${!DEFAULT_GROUPS_LINUX[@]}"; do
            DEFAULT_GROUPS[$group]="${DEFAULT_GROUPS_LINUX[$group]}"
        done
    fi
}
