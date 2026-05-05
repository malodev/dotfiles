#!/usr/bin/env bash

apply_preset() {
    local preset="$1"

    case "$preset" in
        minimal|ssh)
            for group in "${!INSTALL_GROUPS[@]}"; do
                SELECTED_GROUPS[$group]=0
            done
            for group in core shell terminal dev; do
                SELECTED_GROUPS[$group]=1
            done
            ;;
        standard)
            for group in "${!INSTALL_GROUPS[@]}"; do
                SELECTED_GROUPS[$group]=0
            done
            for group in core shell terminal dev editor system-info; do
                SELECTED_GROUPS[$group]=1
            done
            ;;
        full)
            for group in "${!INSTALL_GROUPS[@]}"; do
                SELECTED_GROUPS[$group]=1
            done
            ;;
    esac

    local group
    for group in "${INSTALL_ORDER[@]}"; do
        if ! group_supported_on_current_platform "$group"; then
            SELECTED_GROUPS[$group]=0
        fi
    done
}
