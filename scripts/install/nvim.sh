#!/usr/bin/env bash

nvim_configs_selected() {
    [[ "$(get_group_selection "editor")" == "1" ]] || [[ "$(get_group_selection "editor-alt")" == "1" ]] || nvim_package_selected
}

nvim_package_selected() {
    local pkg
    for pkg in "${!SELECTED_PACKAGES[@]}"; do
        [[ "$pkg" == nvim-* ]] && return 0
    done
    return 1
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

_nvim_version_from_bin() {
    local bin="${1:-nvim}"
    "$bin" --version 2>/dev/null | head -1 | sed -E 's/^NVIM v?([0-9]+\.[0-9]+\.[0-9]+).*/\1/'
}

version_ge() {
    local current="$1"
    local required="$2"
    [[ -n "$current" ]] || return 1
    [[ "$(printf '%s\n%s\n' "$required" "$current" | sort -V | head -1)" == "$required" ]]
}

install_neovim_binary() {
    if ! nvim_configs_selected; then
        return
    fi
    if [[ "$OS" == "Darwin" ]]; then
        return 0
    fi

    local min_version="0.11.0"
    local install_root="$HOME/.local/opt/nvim"
    local bin_dir="$HOME/.local/bin"
    local nvim_bin="$bin_dir/nvim"
    local current_bin=""
    local current_version=""

    if [[ -x "$nvim_bin" ]]; then
        current_bin="$nvim_bin"
        current_version="$(_nvim_version_from_bin "$nvim_bin")"
    elif command_exists nvim; then
        current_bin="$(command -v nvim)"
        current_version="$(_nvim_version_from_bin nvim)"
    fi

    if version_ge "$current_version" "$min_version"; then
        log_success "Neovim already installed: $current_bin ($("$current_bin" --version | head -1))"
        return 0
    fi

    if [[ -n "$current_bin" ]]; then
        log_warn "Neovim $current_version at $current_bin is older than required $min_version; installing latest upstream Neovim for current user"
    fi

    local machine_arch asset_arch
    machine_arch="$(uname -m)"
    case "$machine_arch" in
        x86_64|amd64) asset_arch="x86_64" ;;
        aarch64|arm64) asset_arch="arm64" ;;
        *)
            log_warn "Unsupported Neovim binary architecture: $machine_arch"
            log_warn "Install manually from https://github.com/neovim/neovim/releases"
            return 1
            ;;
    esac

    local archive="/tmp/nvim-linux-${asset_arch}.tar.gz"
    local url="https://github.com/neovim/neovim/releases/latest/download/nvim-linux-${asset_arch}.tar.gz"

    log_dry_run "Would install latest Neovim binary for current user: $nvim_bin"
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing latest Neovim from GitHub releases for current user..."
    mkdir -p "$install_root" "$bin_dir"

    if curl -fL "$url" -o "$archive" 2>/dev/null \
        && tar -xzf "$archive" -C "$install_root" --strip-components=1 \
        && ln -sfn "$install_root/bin/nvim" "$nvim_bin"; then
        rm "$archive" 2>/dev/null || true
        export PATH="$bin_dir:$PATH"
        log_success "Neovim installed: $nvim_bin ($($nvim_bin --version | head -1))"
    else
        rm "$archive" 2>/dev/null || true
        log_warn "Neovim installation failed, install manually from https://github.com/neovim/neovim/releases"
        return 1
    fi

    if [[ ":$PATH:" != *":$bin_dir:"* ]]; then
        log_warn "$bin_dir is not in PATH. Add: export PATH=\"$bin_dir:\$PATH\""
    fi
}
