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

# Set to 1 by relocate_shell_configs_to_local when machine-specific shell config
# is relocated to _local files during stow. Checked in final summary.
RELOCATED_SHELL_CONFIGS=0

# Ensure directories exist for packages that need real dirs (not symlinks to repo).
# Without this, stow creates ~/.pi as a symlink to pi/.pi, preventing pi from
# writing sessions/, bin/, auth.json, mcp-cache.json, etc. to its own space.
ensure_stow_target_dirs() {
    local pkg="$1"

    case "$pkg" in
        pi)
            if [[ ! -d "$HOME/.pi" ]]; then
                mkdir -p "$HOME/.pi/agent"
                log_info "Created $HOME/.pi/agent/ (real directory for pi runtime files)"
            elif [[ ! -d "$HOME/.pi/agent" ]]; then
                mkdir -p "$HOME/.pi/agent"
                log_info "Created $HOME/.pi/agent/"
            fi
            ;;
        git)
            # Ensure ~/.gitconfig_local exists (machine-specific: user.name, user.email, safe.directory)
            if [[ ! -f "$HOME/.gitconfig_local" && -f "$SCRIPT_DIR/git/.gitconfig.local.template" ]]; then
                if [[ "$DRY_RUN" == "1" ]]; then
                    log_dry_run "Would create $HOME/.gitconfig_local from template"
                else
                    cp "$SCRIPT_DIR/git/.gitconfig.local.template" "$HOME/.gitconfig_local"
                    log_info "Created $HOME/.gitconfig_local from template (edit with your name/email)"
                fi
            fi
            ;;
        *) ;;
    esac
}

stow_register_conflict() {
    local pkg="$1"
    local rel_path="$2"
    STOW_CONFLICT_REPORTS+=("$pkg:$rel_path")
}

stow_collect_conflicts() {
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

        if [[ -f "$source_path" && -f "$target_path" ]] && cmp -s "$source_path" "$target_path"; then
            STOW_SKIP_PACKAGES[$pkg]=1
            STOW_SKIP_PATHS["$pkg:$rel_path"]=1
            stow_register_conflict "$pkg" "$rel_path"
        else
            STOW_CONFLICT_REPORTS+=("$pkg:$rel_path")
            return 1
        fi
    done <<< "$output"

    [[ $saw_conflict -eq 1 ]]
}

stow_package_preflight() {
    local pkg="$1"
    local output

    ensure_stow_target_dirs "$pkg"

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
    if stow_collect_conflicts "$pkg" "$output"; then
        log_warn "Stow conflicts for $pkg are already-in-place files; skipping only those paths and continuing."
        return 0
    fi

    # Before failing, try relocating shell config files to _local files
    if relocate_shell_configs_to_local "$pkg"; then
        log_info "Re-checking stow after relocating shell configs..."
        output=$(stow -d "$SCRIPT_DIR" -t "$HOME" -n -v "$pkg" 2>&1) && {
            printf '%s\n' "$output" | tee -a "$LOG_FILE"
            return 0
        }
        printf '%s\n' "$output" | tee -a "$LOG_FILE"
    fi

    log_error "Stow conflict detected for $pkg. Resolve existing files or run stow manually after backing them up."
    return 1
}

# Before stow'ing a shell package (bash, zsh), relocate regular files that
# block stow symlinks into the corresponding _local file.
# E.g. ~/.zshrc (regular file) → append content to ~/.zshrc_local, remove file
# Returns 0 if all conflicts were resolved, 1 if some remain.
relocate_shell_configs_to_local() {
    local pkg="$1"
    local pkg_dir="$SCRIPT_DIR/$pkg"

    # Only handle shell config packages (bash, zsh)
    case "$pkg" in
        bash|zsh) ;;
        *) return 1 ;;
    esac

    # Determine the target _local file
    local local_file=""
    case "$pkg" in
        bash) local_file="$HOME/.bashrc_local" ;;
        zsh)  local_file="$HOME/.zshrc_local" ;;
    esac

    if [[ ! -d "$pkg_dir" ]]; then
        return 1
    fi

    # Known shell config files that tools commonly drop (relative to pkg_dir)
    # Only these will be relocated; other files (themes, etc.) are left alone.
    local known_configs=""
    case "$pkg" in
        bash) known_configs=".bashrc .bash_profile .bash_aliases .bash_logout" ;;
        zsh)  known_configs=".zshrc .zshenv .zprofile .zlogin" ;;
    esac

    local relocated_any=0
    local file_rel target content

    for file_rel in $known_configs; do
        target="$HOME/$file_rel"

        # Skip if already a symlink or doesn't exist
        [[ -L "$target" ]] && continue
        [[ ! -f "$target" ]] && continue

        # We have a regular file where stow wants a symlink
        log_info "Found regular file ~/$file_rel — relocating content to $(basename "$local_file")"

        content=$(cat "$target" 2>/dev/null || true)

        if [[ -z "$content" ]]; then
            rm -f "$target"
            log_info "  Removed empty ~/$file_rel"
            relocated_any=1
            continue
        fi

        # Ensure _local file exists with trailing newline
        if [[ ! -f "$local_file" ]]; then
            touch "$local_file"
        fi
        if [[ -s "$local_file" ]]; then
            local lastchar
            lastchar=$(tail -c 1 "$local_file" 2>/dev/null | od -A n -t x1 | tr -d ' ')
            [[ -n "$lastchar" && "$lastchar" != "0a" ]] && echo "" >> "$local_file"
            echo "" >> "$local_file"
        fi

        {
            echo "# >>> relocated from $file_rel on $(date +%Y-%m-%d)"
            echo "$content"
            echo "# <<< end $file_rel relocation"
        } >> "$local_file"

        rm -f "$target"

        log_info "  Relocated $(wc -l <<< "$content") lines from ~/$file_rel to $(basename "$local_file")"
        relocated_any=1
    done

    if [[ "$relocated_any" == "1" ]]; then
        RELOCATED_SHELL_CONFIGS=1
        log_success "Shell configs relocated so stow can create symlinks."
        return 0
    fi

    return 1
}

stow_package() {
    local pkg="$1"

    ensure_stow_target_dirs "$pkg"

    log_dry_run "  stow -d $SCRIPT_DIR -t $HOME $pkg"
    if [[ "$DRY_RUN" == "1" ]]; then
        return 0
    fi

    if [[ -v "STOW_SKIP_PACKAGES[$pkg]" ]]; then
        log_warn "Skipping $pkg stow because identical files already exist at target paths"
        return 0
    fi

    # Relocate any regular files that would block stow symlinks (belt-and-suspenders)
    relocate_shell_configs_to_local "$pkg" || true

    log_info "Stowing $pkg..."
    stow -d "$SCRIPT_DIR" -t "$HOME" -v "$pkg" 2>&1 | tee -a "$LOG_FILE"
}

report_stow_conflicts() {
    if [[ ${#STOW_CONFLICT_REPORTS[@]} -eq 0 ]]; then
        return 0
    fi

    log_warn "Stow conflicts detected (already existing files):"
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

#=============================================================================
# USER-LOCAL GITHUB RELEASE INSTALL HELPERS
#=============================================================================
# Prefer these over apt on Ubuntu/Debian LTS where packages are often outdated.

# Generic: install a single-binary tool from latest GitHub release by asset pattern.
# Usage: install_github_release_tool "owner/repo" "binary_name" "asset_pattern" [target_dir]
install_github_release_tool() {
    local repo="$1"
    local binary="$2"
    local asset_pattern="${3:--*linux_amd64.tar.gz}"
    local target_dir="${4:-$HOME/.local/bin}"

    # Only skip if already exists in target_dir (user-local)
    if [[ -x "$target_dir/$binary" ]]; then
        return 0
    fi

    log_dry_run "Would install $binary from $repo latest release"
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing $binary from $repo..."

    local version_tag version_short url
    version_tag=$(curl -s "https://api.github.com/repos/$repo/releases/latest" | grep -Po '"tag_name": "\K[^"]*' 2>/dev/null || true)
    if [[ -z "$version_tag" ]]; then
        log_warn "Could not determine latest $binary version, skipping"
        return 1
    fi
    version_short="${version_tag#v}"

    # Try substituting version into the asset pattern (replace * with version_short)
    local resolved_pattern="${asset_pattern//\*/$version_short}"

    url=$(curl -s "https://api.github.com/repos/$repo/releases/latest" \
        | grep -Po '"browser_download_url": "\K[^"]*' \
        | grep -m1 "$resolved_pattern" 2>/dev/null || true)

    if [[ -z "$url" ]]; then
        # Fallback: try the raw pattern without version substitution
        url=$(curl -s "https://api.github.com/repos/$repo/releases/latest" \
            | grep -Po '"browser_download_url": "\K[^"]*' \
            | grep -m1 "$asset_pattern" 2>/dev/null || true)
    fi

    if [[ -z "$url" ]]; then
        log_warn "Could not find download asset for $binary ($asset_pattern), skipping"
        return 1
    fi

    ensure_user_local_bin
    mkdir -p "/tmp/gh-install-$binary"

    curl -fL "$url" -o "/tmp/gh-install-$binary/$binary.tar.gz" 2>/dev/null \
        && tar -xzf "/tmp/gh-install-$binary/$binary.tar.gz" -C "/tmp/gh-install-$binary" 2>/dev/null \
        && find "/tmp/gh-install-$binary" -type f -name "$binary" -exec install -m 0755 {} "$target_dir/$binary" \; \
        && rm -rf "/tmp/gh-install-$binary" \
        && log_success "$binary installed to $target_dir/$binary" \
        || {
            rm -rf "/tmp/gh-install-$binary"
            log_warn "$binary installation failed"
            return 1
        }

    warn_if_user_local_bin_not_in_path
}

# Install fzf from GitHub releases (always, even if older apt version exists)
install_fzf_user_local() {
    # Always install/upgrade: apt version (0.44) lacks features from latest (0.72+)
    log_dry_run "Would install/upgrade fzf from GitHub releases"
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing fzf from GitHub releases..."

    ensure_user_local_bin
    local target_dir="$HOME/.local/bin"
    local version_tag version_short
    version_tag=$(curl -s "https://api.github.com/repos/junegunn/fzf/releases/latest" | grep -Po '"tag_name": "\K[^"]*' 2>/dev/null || echo "v0.60.0")
    version_short="${version_tag#v}"
    local url="https://github.com/junegunn/fzf/releases/download/${version_tag}/fzf-${version_short}-linux_amd64.tar.gz"

    if curl -fL "$url" -o /tmp/fzf.tar.gz 2>/dev/null; then
        tar -xzf /tmp/fzf.tar.gz -C "$target_dir" fzf && chmod +x "$target_dir/fzf"
        rm -f /tmp/fzf.tar.gz
        log_success "fzf installed/upgraded to $target_dir/fzf"
    else
        log_warn "fzf installation failed, install manually from https://github.com/junegunn/fzf"
        rm -f /tmp/fzf.tar.gz
        return 1
    fi

    # Check PATH ordering: ~/.local/bin must come before /usr/bin
    if [[ "$target_dir" != "/usr/bin" && "$target_dir" != "/bin" ]]; then
        local local_bin_first
        local_bin_first=$(echo "$PATH" | tr ':' '\n' | head -1)
        if [[ "$local_bin_first" != "$target_dir" ]]; then
            log_warn "$target_dir is not first in PATH. System fzf ($(command -v fzf 2>/dev/null || echo 'unknown')) may shadow the newer user-local install."
            log_info "  Ensure $target_dir is early in your PATH, e.g.:"
            log_info "    export PATH=\"$target_dir:\$PATH\""
        fi
    fi
}

# Install ripgrep from GitHub releases (always, to get latest even if apt version exists)
install_ripgrep_user_local() {
    local target_dir="$HOME/.local/bin"

    # Check if a user-local install already exists and is recent enough
    if [[ -x "$target_dir/rg" ]]; then
        return 0
    fi

    log_dry_run "Would install ripgrep from GitHub releases"
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing ripgrep from GitHub releases..."

    ensure_user_local_bin
    local version_tag version_short
    version_tag=$(curl -s "https://api.github.com/repos/BurntSushi/ripgrep/releases/latest" | grep -Po '"tag_name": "\K[^"]*' 2>/dev/null || echo "14.1.1")
    version_short="${version_tag#v}"
    local url="https://github.com/BurntSushi/ripgrep/releases/download/${version_tag}/ripgrep-${version_short}-x86_64-unknown-linux-musl.tar.gz"

    curl -fL "$url" -o /tmp/rg.tar.gz 2>/dev/null \
        && tar -xzf /tmp/rg.tar.gz -C /tmp --wildcards "*/rg" --strip-components=1 \
        && install_to_user_local_bin /tmp/rg rg \
        && rm -f /tmp/rg /tmp/rg.tar.gz \
        && log_success "ripgrep installed" \
        || log_warn "ripgrep installation failed"

    warn_if_user_local_bin_not_in_path
}

# Install fd from GitHub releases (always, to get latest even if apt version exists)
install_fd_user_local() {
    local target_dir="$HOME/.local/bin"

    # Check if a user-local install already exists
    if [[ -x "$target_dir/fd" ]]; then
        return 0
    fi

    log_dry_run "Would install fd from GitHub releases"
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing fd from GitHub releases..."

    ensure_user_local_bin
    local version_tag version_short
    version_tag=$(curl -s "https://api.github.com/repos/sharkdp/fd/releases/latest" | grep -Po '"tag_name": "\K[^"]*' 2>/dev/null || echo "v10.2.0")
    version_short="${version_tag#v}"
    local url="https://github.com/sharkdp/fd/releases/download/${version_tag}/fd-${version_short}-x86_64-unknown-linux-musl.tar.gz"

    curl -fL "$url" -o /tmp/fd.tar.gz 2>/dev/null \
        && tar -xzf /tmp/fd.tar.gz -C /tmp --strip-components=1 \
        && install_to_user_local_bin /tmp/fd fd \
        && rm -rf /tmp/fd /tmp/fd.tar.gz \
        && log_success "fd installed" \
        || log_warn "fd installation failed"

    warn_if_user_local_bin_not_in_path
}

# Install lsd from GitHub releases (always, to get latest)
install_lsd_user_local() {
    local target_dir="$HOME/.local/bin"

    if [[ -x "$target_dir/lsd" ]]; then
        return 0
    fi

    log_dry_run "Would install lsd from GitHub releases"
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing lsd from GitHub releases..."

    ensure_user_local_bin
    local version_tag version_short
    version_tag=$(curl -s "https://api.github.com/repos/Peltoche/lsd/releases/latest" | grep -Po '"tag_name": "\K[^"]*' 2>/dev/null || echo "v1.1.5")
    version_short="${version_tag#v}"
    local url="https://github.com/Peltoche/lsd/releases/download/${version_tag}/lsd-${version_short}-x86_64-unknown-linux-musl.tar.gz"

    curl -fL "$url" -o /tmp/lsd.tar.gz 2>/dev/null \
        && tar -xzf /tmp/lsd.tar.gz -C /tmp --strip-components=1 \
        && install_to_user_local_bin /tmp/lsd lsd \
        && rm -rf /tmp/lsd /tmp/lsd.tar.gz \
        && log_success "lsd installed" \
        || log_warn "lsd installation failed"

    warn_if_user_local_bin_not_in_path
}

# Install bat from GitHub releases (always, to get latest even if apt version exists)
install_bat_user_local() {
    local target_dir="$HOME/.local/bin"

    # Check if a user-local install already exists
    if [[ -x "$target_dir/bat" ]]; then
        return 0
    fi

    log_dry_run "Would install bat from GitHub releases"
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing bat from GitHub releases..."

    ensure_user_local_bin
    local version_tag version_short
    version_tag=$(curl -s "https://api.github.com/repos/sharkdp/bat/releases/latest" | grep -Po '"tag_name": "\K[^"]*' 2>/dev/null || echo "v0.25.0")
    version_short="${version_tag#v}"
    local url="https://github.com/sharkdp/bat/releases/download/${version_tag}/bat-${version_short}-x86_64-unknown-linux-musl.tar.gz"

    curl -fL "$url" -o /tmp/bat.tar.gz 2>/dev/null \
        && tar -xzf /tmp/bat.tar.gz -C /tmp --strip-components=1 \
        && install_to_user_local_bin /tmp/bat bat \
        && rm -rf /tmp/bat /tmp/bat.tar.gz \
        && log_success "bat installed" \
        || log_warn "bat installation failed"

    warn_if_user_local_bin_not_in_path
}
