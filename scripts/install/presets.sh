#!/usr/bin/env bash

apply_preset() {
    local preset="$1"

    case "$preset" in
        minimal)
            for group in core shell; do
                SELECTED_GROUPS[$group]=1
            done
            for group in editor terminal desktop linux dev extras; do
                SELECTED_GROUPS[$group]=0
            done
            ;;
        standard)
            for group in core shell editor terminal; do
                SELECTED_GROUPS[$group]=1
            done
            for group in desktop linux dev extras; do
                SELECTED_GROUPS[$group]=0
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
