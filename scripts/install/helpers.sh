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
        local pkg="nvim-$key"
        if is_package_selected "$pkg" || package_in_selected_group "$pkg"; then
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
declare -a STOW_CONFLICT_REPORTS=()
declare -A STOW_SKIP_PACKAGES=()

stow_register_conflict() {
    local pkg="$1"
    local rel_path="$2"
    STOW_CONFLICT_REPORTS+=("$pkg:$rel_path")
}

stow_conflicts_are_identical_files() {
    local pkg="$1"
    local output="$2"
    local conflict_line
    local rel_path
    local source_path
    local target_path
    local saw_conflict=0

    while IFS= read -r conflict_line; do
        [[ "$conflict_line" == *"cannot stow "*" over existing target "* ]] || continue
        saw_conflict=1

        rel_path="${conflict_line#* over existing target }"
        rel_path="${rel_path%% since *}"
        rel_path="${rel_path#./}"
        source_path="$SCRIPT_DIR/$pkg/$rel_path"
        target_path="$HOME/$rel_path"

        if [[ ! -f "$source_path" || ! -f "$target_path" ]]; then
            return 1
        fi
        if ! cmp -s "$source_path" "$target_path"; then
            return 1
        fi
        stow_register_conflict "$pkg" "$rel_path"
    done <<< "$output"

    [[ $saw_conflict -eq 1 ]]
}

stow_package_preflight() {
    local pkg="$1"
    local output

    log_dry_run "  stow preflight -d $SCRIPT_DIR -t $HOME $pkg"
    if [[ "$DRY_RUN" == "1" ]]; then
        return 0
    fi

    log_info "Checking stow conflicts for $pkg..."
    output=$(stow -d "$SCRIPT_DIR" -t "$HOME" -n -v "$pkg" 2>&1) && {
        printf '%s\n' "$output" | tee -a "$LOG_FILE"
        return 0
    }

    printf '%s\n' "$output" | tee -a "$LOG_FILE"
    if stow_conflicts_are_identical_files "$pkg" "$output"; then
        log_warn "Stow conflicts for $pkg are identical existing files; will skip only those paths and continue."
        STOW_SKIP_PACKAGES[$pkg]=1
        return 0
    fi

    log_error "Stow conflict detected for $pkg. Resolve existing files or run stow manually after backing them up."
    return 1
}

stow_package() {
    local pkg="$1"

    log_dry_run "  stow -d $SCRIPT_DIR -t $HOME $pkg"
    if [[ "$DRY_RUN" == "1" ]]; then
        return 0
    fi

    if [[ -v "STOW_SKIP_PACKAGES[$pkg]" ]]; then
        log_warn "Skipping $pkg stow because identical files already exist at target paths"
        return 0
    fi

    log_info "Stowing $pkg..."
    stow -d "$SCRIPT_DIR" -t "$HOME" -v "$pkg" 2>&1 | tee -a "$LOG_FILE"
}

report_stow_conflicts() {
    if [[ ${#STOW_CONFLICT_REPORTS[@]} -eq 0 ]]; then
        return 0
    fi

    log_warn "Stow conflicts detected (already-in-place files skipped):"
    local entry pkg rel_path
    for entry in "${STOW_CONFLICT_REPORTS[@]}"; do
        pkg="${entry%%:*}"
        rel_path="${entry#*:}"
        log_warn "  $pkg: $rel_path"
    done
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
