#!/usr/bin/env bash

resolve_manual_selection() {
    local -a manual_args=("$@")

    for group in "${!INSTALL_GROUPS[@]}"; do
        SELECTED_GROUPS[$group]=0
    done

    local manual_shell_packages=()
    local has_manual_group=0
    local has_manual_package=0
    local item

    for item in "${manual_args[@]}"; do
        local explicit_kind="auto"
        if [[ "$item" == __group:* ]]; then
            explicit_kind="group"
            item="${item#__group:}"
        elif [[ "$item" == __package:* ]]; then
            explicit_kind="package"
            item="${item#__package:}"
        fi

        if [[ "$explicit_kind" != "package" ]] && has_group "$item"; then
            if group_supported_on_current_platform "$item"; then
                SELECTED_GROUPS[$item]=1
            else
                SELECTED_GROUPS[$item]=0
                log_warn "Group '$item' is not supported on this platform; skipping"
            fi
            has_manual_group=1
        elif [[ "$explicit_kind" != "group" ]] && [[ -d "$SCRIPT_DIR/$item" ]]; then
            SELECTED_PACKAGES[$item]=1
            has_manual_package=1

            if is_shell_config_package "$item"; then
                manual_shell_packages+=("$item")
            fi

            local found_group=0
            local group
            for group in "${!INSTALL_GROUPS[@]}"; do
                if package_belongs_to_group "$item" "$group"; then
                    found_group=1
                fi
            done

            if [[ $found_group -eq 0 ]]; then
                log_warn "Package directory exists but is not assigned to an install group: $item"
            fi
        elif [[ "$explicit_kind" == "group" ]]; then
            log_warn "Unknown group: $item"
        elif [[ "$explicit_kind" == "package" ]]; then
            log_warn "Unknown package directory: $item"
        else
            log_warn "Unknown group or package: $item"
        fi
    done

    if [[ $has_manual_package -eq 1 && $has_manual_group -eq 0 ]]; then
        PACKAGE_ONLY_MODE=1
        export LIGHTWEIGHT_INSTALL=1

        for item in "${!SELECTED_PACKAGES[@]}"; do
            local group
            for group in "${!INSTALL_GROUPS[@]}"; do
                if package_belongs_to_group "$item" "$group"; then
                    SELECTED_GROUPS[$group]=1
                fi
            done
        done

        log_info "Package-only mode: stowing only selected dotfile packages: ${!SELECTED_PACKAGES[*]}"
        log_info "Package-only mode skips system tool/dependency installers."
    fi

    if [[ ${#manual_shell_packages[@]} -gt 0 ]]; then
        export MANUAL_SHELL_PACKAGES="${manual_shell_packages[*]}"
        log_info "Will install specific shell configs: ${manual_shell_packages[*]}"
        export LIGHTWEIGHT_INSTALL=1
    fi

    INTERACTIVE=0
}

apply_default_selection_mode() {
    local group
    for group in "${!DEFAULT_GROUPS[@]}"; do
        SELECTED_GROUPS[$group]="${DEFAULT_GROUPS[$group]}"
    done

    if [[ "$DRY_RUN" == "1" ]]; then
        INTERACTIVE=0
        log_info "Dry-run mode: Using default group selection"
        log_info "Run without --dry-run for interactive menu"
    else
        INTERACTIVE=1
    fi
}
