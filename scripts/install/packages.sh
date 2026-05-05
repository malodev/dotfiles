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
            _linux_pkg_install "CLI tools" fzf ripgrep lsd bat fd gdu bottom procs jq curl wget w3m lynx imagemagick p7zip poppler ffmpeg ffmpegthumbnailer unzip
            _aur_install_or_warn "yazi" "yazi" "yazi"
            _aur_install_or_warn "viu" "viu" "viu"
            ;;
        debian)
            _linux_pkg_install "CLI tools" fzf ripgrep bat fd-find jq curl wget w3m lynx imagemagick p7zip-full poppler-utils ffmpeg unzip
            for tool in lsd yazi bottom gdu procs viu ffmpegthumbnailer; do
                if ! command_exists "$tool"; then
                    log_warn "$tool is not in default Debian/Ubuntu repos — install manually or use --with-brew"
                fi
            done
            ;;
        fedora)
            _linux_pkg_install "CLI tools" fzf ripgrep bat fd-find lsd jq curl wget w3m lynx ImageMagick p7zip poppler-utils ffmpeg ffmpegthumbnailer unzip
            for tool in yazi bottom gdu procs viu; do
                if ! command_exists "$tool"; then
                    log_warn "$tool may not be in Fedora repos — install manually or use --with-brew"
                fi
            done
            ;;
        *) log_warn "CLI tools installation not configured for $DISTRO" ;;
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
        _linux_pkg_install "Terminal tools" tmux
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
    if [[ "$(get_group_selection "editor")" != "1" ]]; then
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
                    local sudo_prefix=""
                    [[ $EUID -ne 0 ]] && sudo_prefix="sudo"
                    if $sudo_prefix apt-get install -y neovim 2>/dev/null; then
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
    local sudo_prefix=""
    [[ $EUID -ne 0 ]] && sudo_prefix="sudo"

    case "$DISTRO" in
        arch)
            if command_exists yay; then
                yay -S --noconfirm stow
            elif command_exists paru; then
                paru -S --noconfirm stow
            else
                $sudo_prefix pacman -S --noconfirm stow
            fi
            ;;
        debian)
            $sudo_prefix apt-get update
            $sudo_prefix apt-get install -y stow
            ;;
        fedora)
            $sudo_prefix dnf install -y stow
            ;;
        *)
            if [[ "$OS" == "Darwin" ]]; then
                brew install stow
            else
                log_error "Don't know how to install stow on this system"
                exit 1
            fi
            ;;
    esac
}

install_shell_color_scripts() {
    if [[ "$(get_group_selection "extras")" != "1" ]]; then
        return
    fi

    local colorscript_install_dir="$HOME/.local/bin"
    local colorscript_prefix="$HOME/.local"
    local colorscript_path="$colorscript_install_dir/colorscript"

    if [[ -x "$colorscript_path" ]]; then
        log_success "shell-color-scripts already installed"
        return 0
    fi

    log_dry_run "Would install shell-color-scripts for current user to $colorscript_install_dir"
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing shell-color-scripts..."
    local sudo_prefix=""
    [[ $EUID -ne 0 ]] && sudo_prefix="sudo"

    if [[ "$OS" == "Linux" ]] && ! command_exists make; then
        log_info "Installing build tools (make)..."
        if [[ "$DISTRO" == "debian" ]]; then
            $sudo_prefix apt-get update -qq
            $sudo_prefix apt-get install -y build-essential
        elif [[ "$DISTRO" == "arch" ]]; then
            if command_exists yay; then
                yay -S --noconfirm base-devel
            elif command_exists paru; then
                paru -S --noconfirm base-devel
            else
                $sudo_prefix pacman -S --noconfirm base-devel
            fi
        elif [[ "$DISTRO" == "fedora" ]]; then
            $sudo_prefix dnf install -y @development-tools
        fi
    fi

    mkdir -p "$colorscript_install_dir"
    mkdir -p ~/.local/src
    cd ~/.local/src
    [[ -d shell-color-scripts ]] && rm -rf shell-color-scripts
    git clone https://gitlab.com/dwt1/shell-color-scripts.git
    cd shell-color-scripts
    make PREFIX="$colorscript_prefix" install 2>&1 | tee -a "$LOG_FILE"
    mkdir -p ~/.zsh/completion 2>/dev/null || true
    cp completions/_colorscript ~/.zsh/completion/ 2>/dev/null || true
    [[ ":$PATH:" != *":$colorscript_install_dir:"* ]] && log_warn "$colorscript_install_dir is not in PATH. Add: export PATH=\"$colorscript_install_dir:\$PATH\""
    cd "$ORIGINAL_DIR"
}

install_fastfetch() {
    if [[ "$(get_group_selection "extras")" != "1" ]]; then
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
    local sudo_prefix=""
    [[ $EUID -ne 0 ]] && sudo_prefix="sudo"

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
            ;;
        fedora)
            if ! $sudo_prefix dnf install -y fastfetch 2>/dev/null; then
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

    log_dry_run "Would install starship..."
    [[ "$DRY_RUN" == "1" ]] && return 0

    log_info "Installing starship..."
    local sudo_prefix=""
    [[ $EUID -ne 0 ]] && sudo_prefix="sudo"
    local install_success=0

    if [[ "$DISTRO" == "debian" ]]; then
        if $sudo_prefix apt-get update -qq 2>/dev/null; then
            if $sudo_prefix apt-get install -y starship 2>/dev/null; then
                install_success=1
            fi
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
        $sudo_prefix dnf install -y starship && install_success=1
    fi

    if command_exists starship; then
        log_success "starship installed successfully"
    else
        log_warn "starship installation may have failed (not found in PATH)"
    fi
}
