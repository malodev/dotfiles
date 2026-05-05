#!/usr/bin/env bash

resolve_install_mode() {
    if [[ -n "$CLI_USE_PRESET" ]]; then
        apply_preset "$CLI_USE_PRESET"
        log_info "Using preset: $CLI_USE_PRESET"
        INTERACTIVE=0
    elif [[ ${#CLI_MANUAL_ARGS[@]} -gt 0 ]]; then
        resolve_manual_selection "${CLI_MANUAL_ARGS[@]}"
    else
        apply_default_selection_mode
    fi
}

run_interactive_group_selection() {
    if [[ "$INTERACTIVE" != "1" ]]; then
        return 0
    fi

    local menu_options=()
    local selections
    local group

    for group in "${INSTALL_ORDER[@]}"; do
        menu_options+=("$group|${GROUP_DESC[$group]}")
    done

    if selections=$(checkbox_menu "Select installation groups (Space to toggle, Enter to confirm):" "${menu_options[@]}"); then
        for group in "${!INSTALL_GROUPS[@]}"; do
            SELECTED_GROUPS[$group]=0
        done
        while IFS= read -r group; do
            SELECTED_GROUPS[$group]=1
        done <<< "$selections"
    else
        log_info "Installation cancelled"
        exit 0
    fi
}

show_selected_groups_summary() {
    if [[ "${LIGHTWEIGHT_INSTALL:-0}" != "0" ]]; then
        return 0
    fi

    local group
    show_banner "Selected Groups"
    for group in "${INSTALL_ORDER[@]}"; do
        if [[ "$(get_group_selection "$group")" == "1" ]]; then
            log_success "✓ $group - ${GROUP_DESC[$group]}"
            group_details "$group"
        fi
    done
    echo ""
}

show_pre_install_status_if_needed() {
    if [[ "$INTERACTIVE" == "0" ]] && [[ "${LIGHTWEIGHT_INSTALL:-0}" == "0" ]]; then
        show_package_manager_status
        show_required_tools_status
    fi
}

setup_package_manager_for_mode() {
    if [[ "${LIGHTWEIGHT_INSTALL:-0}" == "1" ]]; then
        if ! command_exists brew; then
            setup_homebrew
        elif [[ "$OS" == "Linux" ]]; then
            eval "$(brew shellenv 2>/dev/null || /home/linuxbrew/.linuxbrew/bin/brew shellenv)"
        fi
    else
        setup_homebrew
    fi
}

run_install_steps() {
    local group
    local pkg
    local key

    setup_stow

    if [[ "$PACKAGE_ONLY_MODE" == "1" ]]; then
        log_info "Package-only mode: skipping system package/tool installers"
    else
        if [[ "${LIGHTWEIGHT_INSTALL:-0}" == "0" ]]; then
            install_homebrew_packages
        fi
        install_cli_tools
        install_shell_tools
        install_editor_tools
        install_neovim_binary
        install_dev_tools
        setup_zoxide
        setup_starship
    fi

    for group in "${INSTALL_ORDER[@]}"; do
        if [[ "$(get_group_selection "$group")" == "1" ]]; then
            install_group "$group"
        fi
    done

    if has_selected_packages && [[ "$PACKAGE_ONLY_MODE" != "1" ]]; then
        for pkg in "${!SELECTED_PACKAGES[@]}"; do
            if package_in_selected_group "$pkg"; then
                continue
            fi
            if [[ -d "$SCRIPT_DIR/$pkg" ]]; then
                show_banner "Installing package: $pkg"
                stow_package "$pkg"
            else
                log_warn "Package directory not found: $pkg"
            fi
        done
    fi

    if [[ "$(get_group_selection "editor")" == "1" ]]; then
        install_nvim_configs
    fi

    if [[ "${SELECTED_GROUPS[editor]:-0}" == "1" ]]; then
        if [[ "$DRY_RUN" == "1" ]]; then
            if [[ "$PACKAGE_ONLY_MODE" == "1" ]]; then
                local selected_nvim="nvim-$(first_selected_nvim_key)"
                log_info "Would set default Neovim to: $selected_nvim"
            else
                log_info "Would set default Neovim to: nvim-$DEFAULT_NVIM_KEY"
                log_info "(Run without --dry-run to select different config)"
            fi
        else
            select_nvim_config
        fi
    fi

    if [[ "$PACKAGE_ONLY_MODE" != "1" ]]; then
        install_shell_color_scripts
        install_fastfetch
    fi
}

show_final_summary() {
    if [[ "${LIGHTWEIGHT_INSTALL:-0}" == "1" ]]; then
        echo ""
        if [[ "$DRY_RUN" == "1" ]]; then
            echo "  📋 DRY RUN - No changes made"
        else
            echo "  ✅ Done!"
        fi
        echo ""
        echo "  Next steps:"
        if [[ -n "${MANUAL_SHELL_PACKAGES:-}" ]]; then
            local shell
            for shell in $MANUAL_SHELL_PACKAGES; do
                case "$shell" in
                    bash) echo "    - Restart your shell or run: source ~/.bashrc" ;;
                    zsh) echo "    - Restart your shell or run: source ~/.zshrc" ;;
                    nushell) echo "    - Restart your shell or run: source ~/.config/nushell/env.nu" ;;
                    fish) echo "    - Restart your shell or run: source ~/.config/fish/config.fish" ;;
                esac
            done
        else
            echo "    - Restart your shell"
        fi
    else
        show_banner "Summary"
        echo ""
        if [[ "$DRY_RUN" == "1" ]]; then
            echo "  📋 DRY RUN MODE - No changes were made"
            echo ""
            echo "  To apply these changes, run:"
            echo "    ./install.sh"
        else
            echo "  ✅ Installation complete!"
        fi
        echo ""
        echo "  Log saved to: $LOG_FILE"
        echo ""
        echo "  Next steps:"
        echo "    - Restart your shell or run: source ~/.zshrc"
        if [[ "$OS" == "Darwin" && "$(get_group_selection "desktop")" == "1" ]]; then
            echo "    - Start SketchyBar: brew services restart sketchybar"
        fi
        if [[ "$(get_group_selection "extras")" == "1" ]]; then
            echo "    - Run: colorscript to see available color scripts"
        fi
    fi
}
