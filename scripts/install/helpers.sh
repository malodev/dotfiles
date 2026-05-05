#!/usr/bin/env bash

#=============================================================================
# GROUP/PACKAGE HELPERS
#=============================================================================
get_group_selection() {
    local group="$1"
    local default="${2:-0}"

    if [[ -v "SELECTED_GROUPS[$group]" ]]; then
        echo "${SELECTED_GROUPS[$group]}"
    else
        echo "$default"
    fi
}

has_group() {
    local group="$1"
    [[ -v "INSTALL_GROUPS[$group]" ]]
}

has_selected_packages() {
    [[ ${#SELECTED_PACKAGES[@]} -gt 0 ]]
}

is_package_selected() {
    local pkg="$1"
    [[ -v "SELECTED_PACKAGES[$pkg]" ]]
}

package_belongs_to_group() {
    local pkg="$1"
    local group="$2"
    local group_pkg

    for group_pkg in ${INSTALL_GROUPS[$group]}; do
        if [[ "$group_pkg" == "$pkg" ]]; then
            return 0
        fi
    done

    return 1
}

package_in_selected_group() {
    local pkg="$1"
    local group

    for group in "${INSTALL_ORDER[@]}"; do
        if [[ "$(get_group_selection "$group")" == "1" ]] && package_belongs_to_group "$pkg" "$group"; then
            return 0
        fi
    done

    return 1
}

is_shell_config_package() {
    local pkg="$1"
    local shell_pkg

    for shell_pkg in "${SHELL_CONFIG_PACKAGES[@]}"; do
        if [[ "$pkg" == "$shell_pkg" ]]; then
            return 0
        fi
    done

    return 1
}

command_for_package() {
    local pkg="$1"
    echo "${COMMAND_CHECK_OVERRIDES[$pkg]:-$pkg}"
}

group_supported_on_current_platform() {
    local group="$1"
    local platform="${GROUP_PLATFORM[$group]:-all}"

    case "$platform" in
        all) return 0 ;;
        macos) [[ "$OS" == "Darwin" ]] ;;
        linux) [[ "$OS" == "Linux" ]] ;;
        *)
            log_warn "Unknown platform constraint '$platform' for group '$group'"
            return 1
            ;;
    esac
}

first_selected_nvim_key() {
    local key

    for key in "${NVIM_CONFIG_ORDER[@]}"; do
        if is_package_selected "nvim-$key"; then
            echo "$key"
            return 0
        fi
    done

    echo "$DEFAULT_NVIM_KEY"
}

#=============================================================================
# UI HELPERS
#=============================================================================
_render_group_detail_line() {
    local line="$1"
    local current_shell="$2"
    local package_mode="$3"

    line="${line//__CURRENT_SHELL__/${current_shell:-unknown}}"
    line="${line//__PACKAGE_MODE__/$package_mode}"
    line="${line//__HOME__/$HOME}"

    if [[ -n "$line" ]]; then
        echo "         $line"
    fi
}

group_details() {
    local group="$1"
    local current_shell="${SHELL##*/}"
    local package_mode="native package manager"

    if [[ "$OS" == "Darwin" ]]; then
        package_mode="Homebrew/Brewfile"
    elif [[ "$OS" == "Linux" && "${WITH_BREW:-0}" == "1" ]]; then
        package_mode="Homebrew/Brewfile (--with-brew)"
    fi

    _render_group_detail_line "${GROUP_DETAIL_LINE_1[$group]:-}" "$current_shell" "$package_mode"
    _render_group_detail_line "${GROUP_DETAIL_LINE_2[$group]:-}" "$current_shell" "$package_mode"
    _render_group_detail_line "${GROUP_DETAIL_LINE_3[$group]:-}" "$current_shell" "$package_mode"
    _render_group_detail_line "${GROUP_DETAIL_LINE_4[$group]:-}" "$current_shell" "$package_mode"
}

#=============================================================================
# STOW / USER-LOCAL HELPERS
#=============================================================================
stow_package_preflight() {
    local pkg="$1"

    log_dry_run "  stow preflight -d $SCRIPT_DIR -t $HOME $pkg"
    if [[ "$DRY_RUN" == "1" ]]; then
        return 0
    fi

    log_info "Checking stow conflicts for $pkg..."
    if ! stow -d "$SCRIPT_DIR" -t "$HOME" -n -v "$pkg" 2>&1 | tee -a "$LOG_FILE"; then
        log_error "Stow conflict detected for $pkg. Resolve existing files or run stow manually after backing them up."
        return 1
    fi
}

stow_package() {
    local pkg="$1"

    log_dry_run "  stow -d $SCRIPT_DIR -t $HOME $pkg"
    if [[ "$DRY_RUN" == "1" ]]; then
        return 0
    fi

    log_info "Stowing $pkg..."
    stow -d "$SCRIPT_DIR" -t "$HOME" -v "$pkg" 2>&1 | tee -a "$LOG_FILE"
}

ensure_user_local_bin() {
    mkdir -p "$HOME/.local/bin"
}

warn_if_user_local_bin_not_in_path() {
    if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
        log_warn "$HOME/.local/bin is not in PATH. Add: export PATH=\"$HOME/.local/bin:\$PATH\""
    fi
}

install_to_user_local_bin() {
    local source_path="$1"
    local binary_name="${2:-$(basename "$source_path")}"

    ensure_user_local_bin
    install -m 0755 "$source_path" "$HOME/.local/bin/$binary_name"
    warn_if_user_local_bin_not_in_path
}

symlink_to_user_local_bin() {
    local target_path="$1"
    local link_name="${2:-$(basename "$target_path")}"

    ensure_user_local_bin
    ln -sfn "$target_path" "$HOME/.local/bin/$link_name"
    warn_if_user_local_bin_not_in_path
}
