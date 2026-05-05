#!/usr/bin/env bash

nvim_configs_selected() {
    [[ "$(get_group_selection "editor")" == "1" ]] || [[ "$(get_group_selection "editor-alt")" == "1" ]]
}

select_nvim_config() {
    if [[ "$INTERACTIVE" == "0" ]] || [[ ! -t 0 ]]; then
        [[ "$INTERACTIVE" == "0" ]] && log_info "Defaulting to nvim-malo"

        local selected_key
        selected_key="$(first_selected_nvim_key)"
        local selected_pkg="nvim-$selected_key"
        local config_dir="$SCRIPT_DIR/$selected_pkg/.config/nvim-$selected_key"
        local nvim_config="$HOME/.config/nvim"

        if [[ -d "$config_dir" ]]; then
            if [[ "$DRY_RUN" == "0" ]]; then
                mkdir -p "$HOME/.config"
                if [[ -e "$nvim_config" && ! -L "$nvim_config" ]]; then
                    local backup_path="${nvim_config}.backup.$(date +%Y%m%d_%H%M%S)"
                    mv "$nvim_config" "$backup_path"
                    log_info "Backed up existing nvim config to $backup_path"
                fi
                ln -sfn "$config_dir" "$nvim_config"
                log_success "Default Neovim set to: $selected_pkg"
            else
                log_dry_run "Would set default Neovim to: $selected_pkg ($nvim_config -> $config_dir)"
            fi
        else
            log_warn "Configuration directory not found: $config_dir"
        fi
        return 0
    fi

    show_banner "Select Default Neovim Configuration"
    echo "Choose which Neovim configuration to use as default:"
    echo ""
    local opts=()
    local default_idx=0
    local idx=0

    for key in "${NVIM_CONFIG_ORDER[@]}"; do
        local desc="${NVIM_CONFIGS[$key]:-nvim-$key}"
        opts+=("$key|$desc")
        if [[ "$key" == "$DEFAULT_NVIM_KEY" ]]; then
            default_idx=$idx
        fi
        ((idx++))
    done

    for i in "${!opts[@]}"; do
        local desc="${opts[$i]#*|}"
        echo "  $((i+1))) $desc"
    done
    echo ""

    local choice
    read -p "Enter choice [1-${#opts[@]}] [default: 1]: " choice
    choice=${choice:-1}

    if [[ "$choice" =~ ^[0-9]+$ ]] && [[ $choice -ge 1 ]] && [[ $choice -le ${#opts[@]} ]]; then
        local selected_key="${opts[$((choice-1))]%%|*}"
        local selected_pkg="nvim-$selected_key"
        local config_dir="$SCRIPT_DIR/$selected_pkg/.config/nvim-$selected_key"

        if [[ -d "$config_dir" ]]; then
            local nvim_config="$HOME/.config/nvim"
            log_info "Setting $selected_pkg as default Neovim configuration..."

            if [[ "$DRY_RUN" == "0" ]]; then
                mkdir -p "$HOME/.config"
                if [[ -e "$nvim_config" && ! -L "$nvim_config" ]]; then
                    local backup_path="${nvim_config}.backup.$(date +%Y%m%d_%H%M%S)"
                    mv "$nvim_config" "$backup_path"
                    log_info "Backed up existing nvim config to $backup_path"
                fi
                ln -sfn "$config_dir" "$nvim_config"
                log_success "Default Neovim set to: $selected_pkg"
            else
                log_dry_run "Would set default Neovim to: $selected_pkg ($nvim_config -> $config_dir)"
            fi
        else
            log_warn "Configuration directory not found: $config_dir"
        fi
    else
        log_warn "Invalid choice, skipping Neovim configuration"
    fi
}

install_nvim_configs() {
    show_banner "Installing: Neovim Configurations"

    local group
    local pkg
    for group in editor editor-alt; do
        if [[ "$(get_group_selection "$group")" != "1" ]]; then
            continue
        fi

        for pkg in ${INSTALL_GROUPS[$group]}; do
            if [[ "$pkg" =~ ^nvim- ]] && [[ -d "$SCRIPT_DIR/$pkg" ]]; then
                if [[ "$PACKAGE_ONLY_MODE" == "1" ]] && ! is_package_selected "$pkg"; then
                continue
            fi

            if [[ -v "STOW_SKIP_PACKAGES[$pkg]" ]]; then
                log_warn "Skipping $pkg stow because conflicting files were already present in HOME"
                continue
            fi

            if [[ "$(get_group_selection "$group")" != "1" ]]; then
                    continue
                fi

                stow_package "$pkg"
            fi
        done
    done
}

install_neovim_binary() {
    if ! nvim_configs_selected; then
        return
    fi
    if [[ "$OS" == "Darwin" ]]; then
        return 0
    fi
    if command_exists nvim; then
        log_success "Neovim already installed: $(nvim --version | head -1)"
        return 0
    fi

    local install_root="$HOME/.local/opt/nvim"
    local bin_dir="$HOME/.local/bin"
    local nvim_bin="$bin_dir/nvim"

    log_dry_run "Would install latest Neovim binary for current user: $nvim_bin"
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing latest Neovim from GitHub releases for current user..."
    mkdir -p "$install_root" "$bin_dir"

    curl -Lo /tmp/nvim.tar.gz \
        "https://github.com/neovim/neovim/releases/latest/download/nvim-linux-x86_64.tar.gz" \
        2>/dev/null \
        && tar -xzf /tmp/nvim.tar.gz -C "$install_root" --strip-components=1 \
        && ln -sfn "$install_root/bin/nvim" "$nvim_bin" \
        && rm -f /tmp/nvim.tar.gz \
        || log_warn "Neovim installation failed, install manually from https://github.com/neovim/neovim/releases"

    if [[ -x "$nvim_bin" ]]; then
        log_success "Neovim installed: $nvim_bin"
        if [[ ":$PATH:" != *":$bin_dir:"* ]]; then
            log_warn "$bin_dir is not in PATH. Add: export PATH=\"$bin_dir:\$PATH\""
        fi
    fi
}
