#!/usr/bin/env bash

install_homebrew_packages() {
    local should_use_brew=0

    if [[ "$OS" == "Darwin" ]]; then
        should_use_brew=1
    elif [[ "$OS" == "Linux" && "${WITH_BREW:-0}" == "1" ]]; then
        should_use_brew=1
    fi

    if [[ "$should_use_brew" == "1" ]] && [[ -f "$SCRIPT_DIR/Brewfile" ]]; then
        show_banner "Installing Homebrew Packages"
        log_dry_run "  brew bundle --file=$SCRIPT_DIR/Brewfile"
        if [[ "$DRY_RUN" == "0" ]]; then
            log_info "Installing packages from Brewfile..."
            brew bundle --file="$SCRIPT_DIR/Brewfile" || log_warn "Brew bundle installation had issues"
        fi
    fi
}

_aur_install_or_warn() {
    local command_name="$1"
    local package_name="$2"
    local description="${3:-$package_name}"

    if [[ "${USER_LOCAL:-0}" == "1" ]] && user_local_preferred_package "$package_name"; then
        log_info "$package_name is user-local preferred; skipping AUR/system package install"
        return 0
    fi

    if command_exists "$command_name"; then
        return 0
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
        log_dry_run "Would install AUR package: $package_name ($description)"
        return 0
    fi

    if command_exists yay; then
        yay -S --noconfirm "$package_name" || log_warn "$description installation failed"
    elif command_exists paru; then
        paru -S --noconfirm "$package_name" || log_warn "$description installation failed"
    else
        log_warn "$description requires an AUR helper (yay/paru) or manual installation"
    fi
}

user_local_preferred_package() {
    local pkg="$1"
    case "$pkg" in
        fzf|ripgrep|bat|fd|fd-find|git-delta|lazygit|lazydocker|go|golang|golang-go|starship|zoxide|tmux|urlview|kitty-terminfo)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

_linux_pkg_install() {
    local description="$1"
    shift
    local packages=("$@")

    if [[ "$OS" == "Darwin" ]]; then
        return 0
    fi
    if [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    local to_install=()
    for pkg in "${packages[@]}"; do
        if [[ "${USER_LOCAL:-0}" == "1" ]] && user_local_preferred_package "$pkg"; then
            log_info "$pkg is user-local preferred; skipping system package install"
            continue
        fi

        local cmd
        cmd="$(command_for_package "$pkg")"
        if ! command_exists "$cmd"; then
            to_install+=("$pkg")
        fi
    done

    if [[ ${#to_install[@]} -eq 0 ]]; then
        log_success "$description: all packages already installed"
        return 0
    fi

    log_info "$description: installing ${to_install[*]}..."
    if [[ "$DRY_RUN" == "1" ]]; then
        log_dry_run "Would install: ${to_install[*]}"
        return 0
    fi

    pm_install "${to_install[@]}" || log_warn "Some packages from '$description' failed to install"
}

install_cli_tools() {
    if [[ "$OS" == "Darwin" ]] || [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    show_banner "Installing CLI Tools (Linux)"

    case "$DISTRO" in
        arch)
            _linux_pkg_install "CLI tools" fzf ripgrep lsd bat fd gdu bottom procs jq curl wget imagemagick p7zip poppler ffmpeg ffmpegthumbnailer unzip
            _aur_install_or_warn "yazi" "yazi" "yazi"
            _aur_install_or_warn "viu" "viu" "viu"
            ;;
        debian)
            # On Ubuntu/Debian LTS, apt versions of many CLI tools are very old.
            # Install from GitHub releases / official installers for the latest versions.
            log_info "Preferring latest user-local installs for CLI tools on Debian/Ubuntu..."

            # Tools best installed via GitHub release (latest version)
            install_fzf_user_local
            install_ripgrep_user_local
            install_fd_user_local
            install_lsd_user_local
            install_bat_user_local

            # libripgrep from GitHub release (for nvim telescope)
            _linux_pkg_install "CLI tools (apt fallback)" jq curl wget unzip imagemagick p7zip-full poppler-utils ffmpeg

            for tool in yazi bottom gdu procs viu ffmpegthumbnailer; do
                if ! command_exists "$tool"; then
                    log_info "$tool not found — skipping (install manually or use --with-brew)"
                fi
            done
            ;;

        debian-apt-fallback)
            # Legacy apt-only path — used when --user-local or --with-brew is not desired.
            _linux_pkg_install "CLI tools (apt)" fzf ripgrep bat fd-find jq curl wget imagemagick p7zip-full poppler-utils ffmpeg unzip
            for tool in lsd yazi bottom gdu procs viu ffmpegthumbnailer; do
                if ! command_exists "$tool"; then
                    log_warn "$tool is not in default Debian/Ubuntu repos — install manually or use --with-brew"
                fi
            done
            ;;
        fedora)
            _linux_pkg_install "CLI tools" fzf ripgrep bat fd-find lsd jq curl wget ImageMagick p7zip poppler-utils ffmpeg ffmpegthumbnailer unzip
            for tool in yazi bottom gdu procs viu; do
                if ! command_exists "$tool"; then
                    log_warn "$tool may not be in Fedora repos — install manually or use --with-brew"
                fi
            done
            ;;
        *) log_warn "CLI tools installation not configured for $DISTRO" ;;
    esac
}

install_hyprland_tools() {
    if [[ "$(get_group_selection "hyprland")" != "1" ]]; then
        return 0
    fi
    if [[ "$OS" == "Darwin" ]] || [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    show_banner "Installing Hyprland desktop tools (Linux)"

    case "$DISTRO" in
        arch) _linux_pkg_install "Hyprland wallpaper tools" variety swaybg ;;
        debian) _linux_pkg_install "Hyprland wallpaper tools" variety swaybg ;;
        fedora) _linux_pkg_install "Hyprland wallpaper tools" variety swaybg ;;
        *) log_warn "Hyprland wallpaper tool installation not configured for $DISTRO" ;;
    esac
}

install_web_cli_tools() {
    if [[ "$(get_group_selection "web-cli")" != "1" ]]; then
        return 0
    fi
    if [[ "$OS" == "Darwin" ]] || [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    show_banner "Installing Terminal Web Browsers (Linux)"

    case "$DISTRO" in
        arch) _linux_pkg_install "Terminal web browsers" w3m lynx ;;
        debian) _linux_pkg_install "Terminal web browsers" w3m lynx ;;
        fedora) _linux_pkg_install "Terminal web browsers" w3m lynx ;;
        *) log_warn "Terminal web browser installation not configured for $DISTRO" ;;
    esac
}

install_kitty_terminfo() {
    if command_exists infocmp && infocmp xterm-kitty >/dev/null 2>&1; then
        log_success "kitty terminfo is already installed"
        return 0
    fi

    if [[ "${USER_LOCAL:-0}" == "1" ]]; then
        install_kitty_terminfo_user_local
        return
    fi

    case "$DISTRO" in
        arch) _linux_pkg_install "Kitty terminfo" kitty-terminfo ;;
        debian) _linux_pkg_install "Kitty terminfo" kitty-terminfo ;;
        fedora) _linux_pkg_install "Kitty terminfo" kitty-terminfo ;;
    esac
}

install_shell_tools() {
    if [[ "$OS" == "Darwin" ]] || [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    if [[ "$(get_group_selection "shell")" == "1" ]]; then
        case "$DISTRO" in
            arch)
                _linux_pkg_install "Shell tools" zsh
                ;;
            debian)
                _linux_pkg_install "Shell tools" zsh
                ;;
            fedora)
                _linux_pkg_install "Shell tools" zsh
                ;;
        esac
    fi

    if [[ "$(get_group_selection "terminal")" == "1" ]]; then
        case "$DISTRO" in
            arch)
                _linux_pkg_install "Terminal tools" tmux
                _aur_install_or_warn "urlview" "urlview" "urlview"
                install_kitty_terminfo
                ;;
            debian)
                _linux_pkg_install "Terminal tools" tmux urlview
                install_kitty_terminfo
                ;;
            fedora)
                _linux_pkg_install "Terminal tools" tmux urlview
                install_kitty_terminfo
                ;;
        esac
    fi

    if [[ "$(get_group_selection "gui-terminal")" == "1" ]]; then
        if ! command_exists kitty; then
            case "$DISTRO" in
                arch) _linux_pkg_install "Kitty" kitty ;;
                debian) _linux_pkg_install "Kitty" kitty-terminfo kitty ;;
                fedora) _linux_pkg_install "Kitty" kitty ;;
            esac
        fi
    fi
}

install_editor_tools() {
    if [[ "$(get_group_selection "editor")" != "1" ]] && [[ "$(get_group_selection "editor-alt")" != "1" ]]; then
        return 0
    fi
    if [[ "$OS" == "Darwin" ]] || [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    show_banner "Installing Editor Dependencies (Linux)"

    case "$DISTRO" in
        arch)
            _linux_pkg_install "Neovim" neovim
            _linux_pkg_install "Build tools" base-devel cmake
            _linux_pkg_install "Neovim dependencies" nodejs npm yarn luarocks python-pynvim
            ;;
        debian)
            if ! command_exists nvim; then
                if [[ "$DRY_RUN" == "1" ]]; then
                    log_dry_run "Would install neovim (via apt or AppImage)"
                else
                    log_info "Installing Neovim..."
                    local sudo_prefix
                    sudo_prefix=$(get_sudo_prefix)
                    if can_sys_install && $sudo_prefix apt-get install -y neovim 2>/dev/null; then
                        local nvim_version
                        nvim_version=$(nvim --version 2>/dev/null | head -1 | grep -oP '\d+\.\d+' || echo "0.0")
                        if [[ "$(echo "$nvim_version < 0.9" | bc -l 2>/dev/null || echo 1)" == "1" ]]; then
                            log_warn "Installed Neovim $nvim_version may be too old. Consider installing from https://github.com/neovim/neovim/releases"
                        fi
                    else
                        log_warn "apt install failed. Install Neovim manually from https://github.com/neovim/neovim/releases"
                    fi
                fi
            fi
            _linux_pkg_install "Build tools" build-essential cmake
            _linux_pkg_install "Neovim dependencies" nodejs npm luarocks python3-pynvim
            if ! command_exists yarn; then
                log_info "Installing yarn via npm for current user..."
                if [[ "$DRY_RUN" == "0" ]]; then
                    ensure_user_local_bin
                    npm install -g --prefix "$HOME/.local" yarn 2>/dev/null || log_warn "yarn installation via npm failed"
                fi
            fi
            ;;
        fedora)
            _linux_pkg_install "Neovim" neovim
            _linux_pkg_install "Build tools" gcc gcc-c++ make cmake
            _linux_pkg_install "Neovim dependencies" nodejs npm luarocks python3-pynvim
            if ! command_exists yarn; then
                log_info "Installing yarn via npm for current user..."
                if [[ "$DRY_RUN" == "0" ]]; then
                    ensure_user_local_bin
                    npm install -g --prefix "$HOME/.local" yarn 2>/dev/null || log_warn "yarn installation via npm failed"
                fi
            fi
            ;;
        *) log_warn "Editor dependencies installation not configured for $DISTRO" ;;
    esac

    if ! command_exists tree-sitter; then
        log_info "Installing tree-sitter-cli via npm for current user..."
        if [[ "$DRY_RUN" == "0" ]]; then
            ensure_user_local_bin
            npm install -g --prefix "$HOME/.local" tree-sitter-cli 2>/dev/null || log_warn "tree-sitter-cli installation failed"
        else
            log_dry_run "Would install tree-sitter-cli via npm to $HOME/.local/bin/tree-sitter"
        fi
    fi
}

setup_homebrew() {
    if [[ "$OS" == "Linux" ]] && [[ "${WITH_BREW:-0}" == "0" ]]; then
        log_info "Skipping Homebrew on Linux (use --with-brew to enable)"
        return 0
    fi

    if [[ "$DISTRO" == "arch" && "${WITH_BREW:-0}" == "0" ]]; then
        log_info "Arch Linux detected: Using pacman instead of Homebrew"
        return 0
    fi

    if command_exists brew; then
        log_success "Homebrew is already installed"
        if [[ "$OS" == "Linux" ]]; then
            eval "$(brew shellenv 2>/dev/null || /home/linuxbrew/.linuxbrew/bin/brew shellenv)"
        fi
    else
        log_dry_run "Would install Homebrew..."
        [[ "$DRY_RUN" == "1" ]] && return 0

        log_info "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        [[ "$OS" == "Linux" ]] && eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
    fi

    log_dry_run "Would update Homebrew..."
    if [[ "$DRY_RUN" == "0" ]]; then
        log_info "Updating Homebrew..."
        brew update || log_warn "Homebrew update failed, continuing..."
        log_info "Upgrading Homebrew packages..."
        brew upgrade || log_warn "Homebrew upgrade failed, continuing..."
    fi
}

setup_stow() {
    if command_exists stow; then
        log_success "GNU Stow is already installed"
        return 0
    fi

    log_dry_run "Would install GNU Stow..."
    if [[ "$DRY_RUN" == "1" ]]; then
        log_info "Would install stow using:"
        if [[ "$DISTRO" == "arch" ]]; then
            log_info "  pacman -S stow (or yay -S stow)"
        elif [[ "$DISTRO" == "debian" ]]; then
            log_info "  apt-get install stow"
        elif [[ "$OS" == "Darwin" ]]; then
            log_info "  brew install stow"
        fi
        return 0
    fi

    log_info "Installing GNU Stow..."
    local sudo_prefix
    sudo_prefix=$(get_sudo_prefix)
    local install_ok=0

    # Only try system package manager if sudo is available and passwordless
    if [[ -n "$sudo_prefix" ]] && sudo -n true 2>/dev/null; then
        case "$DISTRO" in
            arch)
                if command_exists yay; then
                    yay -S --noconfirm stow 2>/dev/null && install_ok=1 || true
                elif command_exists paru; then
                    paru -S --noconfirm stow 2>/dev/null && install_ok=1 || true
                else
                    $sudo_prefix pacman -S --noconfirm stow 2>/dev/null && install_ok=1 || true
                fi
                ;;
            debian)
                $sudo_prefix apt-get update -qq 2>/dev/null || true
                $sudo_prefix apt-get install -y stow 2>/dev/null && install_ok=1 || true
                ;;
            fedora)
                $sudo_prefix dnf install -y stow 2>/dev/null && install_ok=1 || true
                ;;
            *)
                if [[ "$OS" == "Darwin" ]]; then
                    brew install stow 2>/dev/null && install_ok=1 || true
                fi
                ;;
        esac
    fi

    if [[ $install_ok -eq 1 ]]; then
        log_success "GNU Stow installed via system package manager"
        return 0
    fi

    # Fallback: build from source into ~/.local (no root needed)
    setup_stow_user_local
}

setup_stow_user_local() {
    local stow_version="2.4.1"
    local stow_url="https://ftp.gnu.org/gnu/stow/stow-${stow_version}.tar.gz"
    local tmpdir
    ensure_user_local_bin
    tmpdir="$(mktemp -d)"

    log_info "Building GNU Stow ${stow_version} from source into ~/.local..."

    if ! command_exists make; then
        log_error "'make' is not available — required to build stow from source."
        log_error "Install stow manually or ask your hosting provider to install make."
        rm -rf "$tmpdir"
        return 1
    fi

    if ! command_exists perl; then
        log_error "'perl' is not available — required to run GNU Stow."
        rm -rf "$tmpdir"
        return 1
    fi

    log_info "Downloading stow ${stow_version}..."
    if ! curl -fL "$stow_url" -o "$tmpdir/stow.tar.gz" 2>/dev/null; then
        log_error "Failed to download stow from $stow_url"
        rm -rf "$tmpdir"
        return 1
    fi

    tar -xzf "$tmpdir/stow.tar.gz" -C "$tmpdir" || {
        log_error "Failed to extract stow tarball"
        rm -rf "$tmpdir"
        return 1
    }

    local build_dir
    build_dir="$(find "$tmpdir" -maxdepth 1 -type d -name 'stow-*' | head -1)"
    if [[ -z "$build_dir" || ! -d "$build_dir" ]]; then
        log_error "Could not find stow source directory after extraction"
        rm -rf "$tmpdir"
        return 1
    fi

    (
        cd "$build_dir"
        ./configure --prefix="$HOME/.local" 2>/dev/null || {
            log_error "stow ./configure failed"
            exit 1
        }
        make 2>/dev/null || {
            log_error "stow make failed"
            exit 1
        }
        make install 2>/dev/null || {
            log_error "stow make install failed"
            exit 1
        }
    ) || {
        rm -rf "$tmpdir"
        return 1
    }

    rm -rf "$tmpdir"
    export PATH="$HOME/.local/bin:$PATH"
    log_success "GNU Stow installed to ~/.local/bin"
    warn_if_user_local_bin_not_in_path
    return 0
}

install_shell_color_scripts() {
    if [[ "$(get_group_selection "editor")" != "1" ]] && ! is_package_selected "nvim-malo"; then
        return
    fi

    local colorscript_install_dir="$HOME/.local/bin"
    local colorscript_share_dir="$HOME/.local/share/shell-color-scripts"
    local colorscript_path="$colorscript_install_dir/colorscript"

    if [[ -x "$colorscript_path" ]]; then
        log_success "shell-color-scripts already installed"
        return 0
    fi

    log_dry_run "Would install shell-color-scripts for current user to $colorscript_install_dir and $colorscript_share_dir"
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing shell-color-scripts..."
    local sudo_prefix
    sudo_prefix=$(get_sudo_prefix)

    mkdir -p "$colorscript_install_dir" "$colorscript_share_dir"
    mkdir -p ~/.local/src
    cd ~/.local/src
    [[ -d shell-color-scripts ]] && rm -rf shell-color-scripts
    git clone https://gitlab.com/dwt1/shell-color-scripts.git
    cd shell-color-scripts
    cp -rf colorscripts "$colorscript_share_dir/"
    install -m 0755 colorscript.sh "$colorscript_install_dir/colorscript"
    # Patch the hardcoded /opt path to the user-local install location
    sed -i "s|/opt/shell-color-scripts/colorscripts|$colorscript_share_dir/colorscripts|g" "$colorscript_install_dir/colorscript" 2>/dev/null || true
    mkdir -p "$HOME/.local/share/man/man1" 2>/dev/null || true
    cp colorscript.1 "$HOME/.local/share/man/man1/" 2>/dev/null || true
    mkdir -p ~/.zsh/completion 2>/dev/null || true
    cp completions/_colorscript ~/.zsh/completion/ 2>/dev/null || true
    cp completions/colorscript.fish "$HOME/.local/share/fish/vendor_completions.d/" 2>/dev/null || true
    [[ ":$PATH:" != *":$colorscript_install_dir:"* ]] && log_warn "$colorscript_install_dir is not in PATH. Add: export PATH=\"$colorscript_install_dir:\$PATH\""
    cd "$ORIGINAL_DIR"
}

install_fastfetch() {
    if [[ "$(get_group_selection "system-info")" != "1" ]]; then
        return
    fi
    if command_exists fastfetch; then
        log_success "fastfetch is already installed"
        return 0
    fi
    if [[ "$OS" == "Darwin" ]]; then
        return 0
    fi
    if [[ "$OS" == "Linux" ]] && [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    local fastfetch_bin_dir="$HOME/.local/bin"
    log_dry_run "Would install fastfetch for current user: $fastfetch_bin_dir/fastfetch"
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing fastfetch..."
    mkdir -p "$fastfetch_bin_dir"
    local sudo_prefix
    sudo_prefix=$(get_sudo_prefix)

    case "$DISTRO" in
        arch)
            if command_exists yay; then
                yay -S --noconfirm fastfetch-git
            elif command_exists paru; then
                paru -S --noconfirm fastfetch-git
            else
                log_info "Installing fastfetch from GitHub releases..."
                local fastfetch_dir="$HOME/.local/share/fastfetch"
                mkdir -p "$fastfetch_dir"
                if curl -fL "https://github.com/fastfetch-cli/fastfetch/releases/latest/download/fastfetch-linux-amd64" -o "$fastfetch_dir/fastfetch" 2>/dev/null; then
                    if [[ -s "$fastfetch_dir/fastfetch" ]] && ! grep -q "Not Found" "$fastfetch_dir/fastfetch" 2>/dev/null; then
                        chmod +x "$fastfetch_dir/fastfetch"
                        ln -sfn "$fastfetch_dir/fastfetch" "$fastfetch_bin_dir/fastfetch"
                        log_success "fastfetch installed to $fastfetch_bin_dir/fastfetch"
                    else
                        log_warn "fastfetch download appears invalid, trying alternative method..."
                        rm -f "$fastfetch_dir/fastfetch"
                    fi
                else
                    log_warn "fastfetch download failed, you can install manually from https://github.com/fastfetch-cli/fastfetch/releases"
                fi
            fi
            ;;
        debian)
            log_info "Installing fastfetch from GitHub releases..."
            if curl -fL "https://github.com/fastfetch-cli/fastfetch/releases/latest/download/fastfetch-linux-amd64.tar.gz" -o "/tmp/fastfetch.tar.gz" 2>/dev/null; then
                if [[ -s "/tmp/fastfetch.tar.gz" ]] && ! grep -q "Not Found" "/tmp/fastfetch.tar.gz" 2>/dev/null; then
                    tar -xzf "/tmp/fastfetch.tar.gz" -C "/tmp" 2>/dev/null \
                        && install_to_user_local_bin /tmp/fastfetch-linux-amd64/usr/bin/fastfetch fastfetch \
                        && rm -rf /tmp/fastfetch-linux-amd64 /tmp/fastfetch.tar.gz \
                        && log_success "fastfetch installed" \
                        || log_warn "fastfetch tarball appears invalid"
                    rm -f "/tmp/fastfetch.tar.gz"
                else
                    log_warn "fastfetch download appears invalid"
                    rm -f "/tmp/fastfetch.tar.gz"
                fi
            else
                log_warn "fastfetch download failed, install manually from https://github.com/fastfetch-cli/fastfetch/releases"
            fi
            ;;
        fedora)
            if can_sys_install && $sudo_prefix dnf install -y fastfetch 2>/dev/null; then
                :
            else
                [[ -n "$(get_sudo_prefix)" ]] || log_info "Skipping fastfetch system install (no sudo / --user-local)"
                log_info "Installing fastfetch from GitHub releases..."
                local fastfetch_dir="$HOME/.local/share/fastfetch"
                mkdir -p "$fastfetch_dir"
                if curl -fL "https://github.com/fastfetch-cli/fastfetch/releases/latest/download/fastfetch-linux-amd64" -o "$fastfetch_dir/fastfetch" 2>/dev/null; then
                    if [[ -s "$fastfetch_dir/fastfetch" ]] && ! grep -q "Not Found" "$fastfetch_dir/fastfetch" 2>/dev/null; then
                        chmod +x "$fastfetch_dir/fastfetch"
                        ln -sfn "$fastfetch_dir/fastfetch" "$fastfetch_bin_dir/fastfetch"
                        log_success "fastfetch installed to $fastfetch_bin_dir/fastfetch"
                    else
                        log_warn "fastfetch download appears invalid"
                        rm -f "$fastfetch_dir/fastfetch"
                    fi
                else
                    log_warn "fastfetch download failed, install manually from https://github.com/fastfetch-cli/fastfetch/releases"
                fi
            fi
            ;;
        *) log_warn "fastfetch installation not configured for $DISTRO" ;;
    esac

    if command_exists fastfetch; then
        log_success "fastfetch installed successfully"
    elif [[ -x "$fastfetch_bin_dir/fastfetch" ]]; then
        log_success "fastfetch installed successfully: $fastfetch_bin_dir/fastfetch"
        [[ ":$PATH:" != *":$fastfetch_bin_dir:"* ]] && log_warn "$fastfetch_bin_dir is not in PATH. Add: export PATH=\"$fastfetch_bin_dir:\$PATH\""
    else
        log_warn "fastfetch installation may have failed (not found in PATH)"
    fi
}

install_user_local_preferred_tools() {
    if [[ "${USER_LOCAL:-0}" != "1" ]]; then
        return 0
    fi
    if [[ "$OS" == "Darwin" ]] || [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    show_banner "Installing User-local Preferred Tools"
    log_info "User-local mode: system package managers are avoided for fzf/rg/bat/fd/delta/lazygit/lazydocker/go/starship/zoxide/tmux/urlview/kitty-terminfo when possible."

    install_uv_tool
    install_bun_tool
    install_lazydocker_tool

    if ! command_exists starship; then
        log_dry_run "Would install starship to $HOME/.local/bin/starship"
        if [[ "$DRY_RUN" == "0" ]]; then
            ensure_user_local_bin
            curl -sS https://starship.rs/install.sh | sh -s -- -y -b "$HOME/.local/bin" || log_warn "starship installation failed"
        fi
    else
        log_success "starship is already installed"
    fi

    if ! command_exists zoxide; then
        log_dry_run "Would install zoxide to $HOME/.local/bin/zoxide"
        if [[ "$DRY_RUN" == "0" ]]; then
            ensure_user_local_bin
            curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh -s -- --bin-dir "$HOME/.local/bin" || log_warn "zoxide installation failed"
        fi
    else
        log_success "zoxide is already installed"
    fi

    if ! command_exists go; then
        log_dry_run "Would install Go to $HOME/.local/opt/go with symlinks in $HOME/.local/bin"
        if [[ "$DRY_RUN" == "0" ]]; then
            local go_version go_root
            go_root="$HOME/.local/opt/go"
            go_version=$(curl -s "https://go.dev/dl/?mode=json" | grep -Po '"version": "go\K[^"]*' | head -1 2>/dev/null || echo "1.26.0")
            mkdir -p "$HOME/.local/opt"
            curl -Lo /tmp/go.tar.gz "https://go.dev/dl/go${go_version}.linux-amd64.tar.gz" 2>/dev/null \
                && rm -rf "$go_root" \
                && tar -C "$HOME/.local/opt" -xzf /tmp/go.tar.gz \
                && symlink_to_user_local_bin "$go_root/bin/go" go \
                && symlink_to_user_local_bin "$go_root/bin/gofmt" gofmt \
                && rm -f /tmp/go.tar.gz \
                || log_warn "Go installation failed, install manually from https://go.dev/dl"
        fi
    else
        log_success "go is already installed"
    fi

    # --- SSH-safe terminal tools (tmux, urlview, kitty-terminfo) ---
    install_tmux_user_local
    install_urlview_user_local
    install_kitty_terminfo_user_local
}

install_tmux_user_local() {
    if command_exists tmux; then
        log_success "tmux is already installed"
        return 0
    fi

    log_dry_run "Would install tmux to $HOME/.local/bin/tmux"
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing tmux (user-local)..."
    local arch
    arch=$(uname -m)
    case "$arch" in
        x86_64)  arch="amd64" ;;
        aarch64) arch="arm64" ;;
        *)       log_warn "tmux: unsupported architecture $arch"; return 1 ;;
    esac

    # Try static binary from GitHub releases (no API call, redirect-based URL).
    # nelsonjchen/tmux-static-build provides pre-built static binaries.
    local static_url="https://github.com/nelsonjchen/tmux-static-build/releases/latest/download/tmux.linux-${arch}"
    log_info "Downloading tmux static build for linux-${arch}..."
    if curl -fsSL "$static_url" -o /tmp/tmux 2>/dev/null && [[ -s /tmp/tmux ]]; then
        ensure_user_local_bin
        install -m 0755 /tmp/tmux "$HOME/.local/bin/tmux" && rm -f /tmp/tmux && log_success "tmux installed to $HOME/.local/bin/tmux" && return 0
        rm -f /tmp/tmux
    fi
    log_info "Static binary not available, will build from source..."

    # Source build fallback — check build dependencies before attempting.
    local missing_deps=()
    for dep in make gcc pkg-config; do
        command_exists "$dep" || missing_deps+=("$dep")
    done
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log_warn "tmux source build requires: ${missing_deps[*]} — install them first and re-run"
        log_warn "Also needs: libevent-dev, ncurses-dev (or equivalent on your distro)"
        return 1
    fi
    if ! pkg-config --exists libevent 2>/dev/null && ! ldconfig -p 2>/dev/null | grep -q libevent; then
        log_warn "tmux: libevent development headers not found — install libevent-dev (or equivalent)"
        return 1
    fi
    if ! pkg-config --exists ncurses 2>/dev/null && ! ldconfig -p 2>/dev/null | grep -q libncurses; then
        log_warn "tmux: ncurses development headers not found — install ncurses-dev (or equivalent)"
        return 1
    fi

    local build_dir="$HOME/.local/src/tmux"
    rm -rf "$build_dir"
    log_info "Building tmux from source..."
    if git clone --depth 1 https://github.com/tmux/tmux.git "$build_dir" 2>/dev/null; then
        (
            cd "$build_dir"
            sh autogen.sh 2>/dev/null || true
            ./configure --prefix="$HOME/.local" 2>/dev/null || { log_warn "tmux ./configure failed"; exit 1; }
            make -j"$(nproc 2>/dev/null || echo 1)" 2>/dev/null || { log_warn "tmux make failed"; exit 1; }
            ensure_user_local_bin
            install -m 0755 tmux "$HOME/.local/bin/tmux"
        ) || { rm -rf "$build_dir"; log_warn "tmux source build failed"; return 1; }
        rm -rf "$build_dir"
        log_success "tmux built and installed to $HOME/.local/bin/tmux"
    else
        log_warn "tmux clone failed — install manually"
        return 1
    fi
    warn_if_user_local_bin_not_in_path
}

install_urlview_user_local() {
    if command_exists urlview; then
        log_success "urlview is already installed"
        return 0
    fi

    log_dry_run "Would install urlview to $HOME/.local/bin/urlview"
    [[ "$DRY_RUN" == "1" ]] && return 0

    if ! command_exists make || ! command_exists gcc; then
        log_warn "urlview requires 'make' and 'gcc' to build — skipping"
        return 0
    fi

    log_info "Building urlview from source (user-local)..."
    local build_dir="$HOME/.local/src/urlview"
    rm -rf "$build_dir"
    if git clone --depth 1 https://github.com/sigpipe/urlview.git "$build_dir" 2>/dev/null; then
        (
            cd "$build_dir"
            autoreconf -i 2>/dev/null || true
            ./configure --prefix="$HOME/.local" 2>/dev/null || { log_warn "urlview ./configure failed"; exit 1; }
            make -j"$(nproc 2>/dev/null || echo 1)" 2>/dev/null || { log_warn "urlview make failed"; exit 1; }
            ensure_user_local_bin
            install -m 0755 urlview "$HOME/.local/bin/urlview"
        ) || { rm -rf "$build_dir"; return 1; }
        rm -rf "$build_dir"
        log_success "urlview installed to $HOME/.local/bin/urlview"
    else
        log_warn "urlview clone failed — install manually"
        return 0
    fi
    warn_if_user_local_bin_not_in_path
}

install_kitty_terminfo_user_local() {
    if command_exists infocmp && infocmp xterm-kitty >/dev/null 2>&1; then
        log_success "kitty terminfo is already installed"
        return 0
    fi

    if ! command_exists tic; then
        log_warn "tic (ncurses) is required to compile kitty terminfo — skipping"
        return 0
    fi

    log_dry_run "Would install xterm-kitty terminfo user-locally"
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing kitty terminfo (user-local)..."
    local terminfo_dir="$HOME/.terminfo"
    mkdir -p "$terminfo_dir"

    if curl -fsSL "https://raw.githubusercontent.com/kovidgoyal/kitty/master/terminfo/kitty.terminfo" -o /tmp/kitty.terminfo 2>/dev/null; then
        TERMINFO="$terminfo_dir" tic -x /tmp/kitty.terminfo 2>/dev/null && \
            rm -f /tmp/kitty.terminfo && \
            log_success "kitty terminfo installed to $terminfo_dir"
    else
        log_warn "Failed to download kitty.terminfo"
    fi
    warn_if_user_local_bin_not_in_path
}

setup_zoxide() {
    if [[ "$(get_group_selection "shell")" != "1" ]]; then
        return
    fi
    if command_exists zoxide; then
        log_success "zoxide is already installed"
        return 0
    fi
    if [[ "$OS" == "Darwin" ]]; then
        return 0
    fi
    if [[ "$OS" == "Linux" ]] && [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    if [[ "${USER_LOCAL:-0}" == "1" ]]; then
        log_info "zoxide is handled by user-local preferred tools"
        return 0
    fi

    log_dry_run "Would install zoxide..."
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing zoxide..."
    case "$DISTRO" in
        arch|fedora)
            _linux_pkg_install "zoxide" zoxide
            ;;
        debian)
            # Try the distro package first, then fall back to the official user-local installer.
            _linux_pkg_install "zoxide" zoxide
            if ! command_exists zoxide; then
                ensure_user_local_bin
                curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh -s -- --bin-dir "$HOME/.local/bin"
            fi
            ;;
        *)
            log_info "zoxide installation not configured for $DISTRO"
            ;;
    esac

    if command_exists zoxide; then
        log_success "zoxide installed successfully"
    elif [[ -x "$HOME/.local/bin/zoxide" ]]; then
        log_success "zoxide installed successfully: $HOME/.local/bin/zoxide"
        warn_if_user_local_bin_not_in_path
    else
        log_warn "zoxide installation may have failed (not found in PATH)"
    fi
}

setup_starship() {
    if [[ "$(get_group_selection "shell")" != "1" ]]; then
        return
    fi
    if command_exists starship; then
        log_success "starship is already installed"
        return 0
    fi
    if [[ "$OS" == "Darwin" ]]; then
        return 0
    fi
    if [[ "$OS" == "Linux" ]] && [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    if [[ "${USER_LOCAL:-0}" == "1" ]]; then
        log_info "starship is handled by user-local preferred tools"
        return 0
    fi

    log_dry_run "Would install starship..."
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing starship..."
    local sudo_prefix
    sudo_prefix=$(get_sudo_prefix)
    local install_success=0

    if [[ "$DISTRO" == "debian" ]]; then
        if can_sys_install; then
            if $sudo_prefix apt-get update -qq 2>/dev/null; then
                if $sudo_prefix apt-get install -y starship 2>/dev/null; then
                    install_success=1
                fi
            fi
        else
            log_info "Skipping starship system install (no sudo / --user-local)"
        fi
        if [[ $install_success -eq 0 ]]; then
            log_info "apt install failed, using official install script in $HOME/.local/bin..."
            ensure_user_local_bin
            curl -sS https://starship.rs/install.sh | sh -s -- -y -b "$HOME/.local/bin"
        fi
    elif [[ "$DISTRO" == "arch" ]]; then
        if command_exists yay; then
            yay -S --noconfirm starship && install_success=1
        elif command_exists paru; then
            paru -S --noconfirm starship && install_success=1
        else
            $sudo_prefix pacman -S --noconfirm starship && install_success=1
        fi
    elif [[ "$DISTRO" == "fedora" ]]; then
        if can_sys_install; then
            $sudo_prefix dnf install -y starship && install_success=1
        else
            log_info "Skipping starship system install (no sudo / --user-local)"
        fi
    fi

    if command_exists starship; then
        log_success "starship installed successfully"
    else
        log_warn "starship installation may have failed (not found in PATH)"
    fi
}
