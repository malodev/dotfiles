#!/usr/bin/env bash

#=============================================================================
# DEVELOPER TOOLS (for Mason.nvim LSP servers)
#=============================================================================
install_uv_tool() {
    if command_exists uv; then
        log_success "uv is already installed: $(uv --version 2>/dev/null || command -v uv)"
        return 0
    fi

    log_info "Installing uv for current user..."

    if [[ "$DRY_RUN" == "1" ]]; then
        log_dry_run "Would install uv via official installer to $HOME/.local/bin/uv"
        return 0
    fi

    ensure_user_local_bin
    curl -LsSf https://astral.sh/uv/install.sh | sh || log_warn "uv installation failed, install manually from https://docs.astral.sh/uv/"

    if command_exists uv; then
        log_success "uv installed successfully: $(uv --version 2>/dev/null || command -v uv)"
    elif [[ -x "$HOME/.local/bin/uv" ]]; then
        log_success "uv installed successfully: $HOME/.local/bin/uv"
        warn_if_user_local_bin_not_in_path
    else
        log_warn "uv installation may have failed (not found in PATH)"
    fi
}

install_bun_tool() {
    if command_exists bun; then
        log_success "bun is already installed: $(bun --version 2>/dev/null || command -v bun)"
        return 0
    fi

    log_info "Installing bun for current user..."

    if [[ "$DRY_RUN" == "1" ]]; then
        log_dry_run "Would install bun via official installer to $HOME/.bun/bin/bun"
        return 0
    fi

    curl -fsSL https://bun.sh/install | bash || log_warn "bun installation failed, install manually from https://bun.sh/docs/installation"

    if command_exists bun; then
        log_success "bun installed successfully: $(bun --version 2>/dev/null || command -v bun)"
    elif [[ -x "$HOME/.bun/bin/bun" ]]; then
        log_success "bun installed successfully: $HOME/.bun/bin/bun"
        if [[ ":$PATH:" != *":$HOME/.bun/bin:"* ]]; then
            log_warn "$HOME/.bun/bin is not in PATH. Add: export PATH=\"$HOME/.bun/bin:\$PATH\""
        fi
    else
        log_warn "bun installation may have failed (not found in PATH)"
    fi
}

install_llm_cli() {
    if command_exists llm; then
        return 0
    fi

    log_info "Installing llm CLI..."

    if command_exists uv; then
        uv tool install llm || log_warn "llm installation failed, install manually: uv tool install llm"
    else
        if ! command_exists pipx; then
            local sudo_prefix=""
            [[ $EUID -ne 0 ]] && sudo_prefix="sudo"

            case "$DISTRO" in
                arch) $sudo_prefix pacman -S --noconfirm python-pipx || log_warn "python-pipx installation failed" ;;
                debian) $sudo_prefix apt-get install -y pipx 2>/dev/null || $sudo_prefix apt-get install -y python3-pipx 2>/dev/null || pip3 install --user pipx ;;
                fedora) $sudo_prefix dnf install -y pipx || log_warn "pipx installation failed" ;;
                *) pip3 install --user pipx || log_warn "pipx installation failed" ;;
            esac
        fi

        if command_exists pipx; then
            pipx install llm || log_warn "llm installation failed, install manually: pipx install llm"
        else
            log_warn "pipx is not available; cannot install llm automatically"
        fi
    fi

    if command_exists llm; then
        log_success "llm CLI installed successfully"
    elif [[ -x "$HOME/.local/bin/llm" ]]; then
        log_success "llm CLI installed successfully: $HOME/.local/bin/llm"
        warn_if_user_local_bin_not_in_path
    else
        log_warn "llm CLI installation may have failed (not found in PATH)"
    fi
}

install_dev_tools() {
    if [[ "$(get_group_selection "dev")" != "1" ]]; then
        return
    fi

    show_banner "Installing Developer Tools"

    local sudo_prefix=""
    if [[ $EUID -ne 0 ]]; then
        sudo_prefix="sudo"
    fi

    if [[ "$OS" == "Darwin" ]]; then
        log_info "Developer tools installed via Brewfile"
        return 0
    fi

    if [[ "${WITH_BREW:-0}" == "1" ]]; then
        log_info "Developer tools will be installed via Brewfile"
        return 0
    fi

    log_info "Installing developer tools for Linux..."

    case "$DISTRO" in
        arch)
            _linux_pkg_install "Git tools" git github-cli git-delta
            _aur_install_or_warn "lazygit" "lazygit" "lazygit"
            ;;
        debian)
            _linux_pkg_install "Git tools" git
            if ! command_exists gh; then
                log_info "Installing GitHub CLI..."
                if [[ "$DRY_RUN" == "0" ]]; then
                    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | $sudo_prefix dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null \
                        && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | $sudo_prefix tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
                        && $sudo_prefix apt-get update -qq \
                        && $sudo_prefix apt-get install -y gh \
                        || log_warn "GitHub CLI installation failed"
                else
                    log_dry_run "Would install gh CLI from GitHub apt repo"
                fi
            fi
            if ! command_exists delta; then
                log_info "Installing git-delta from GitHub releases for current user..."
                if [[ "$DRY_RUN" == "0" ]]; then
                    local delta_version="0.18.2"
                    curl -fL "https://github.com/dandavison/delta/releases/latest/download/delta-${delta_version}-x86_64-unknown-linux-musl.tar.gz" \
                        -o /tmp/delta.tar.gz 2>/dev/null \
                        && tar -xzf /tmp/delta.tar.gz -C /tmp --wildcards "*/delta" --strip-components=1 \
                        && install_to_user_local_bin /tmp/delta delta \
                        && rm -f /tmp/delta /tmp/delta.tar.gz \
                        || log_warn "git-delta installation failed"
                else
                    log_dry_run "Would install git-delta from GitHub releases to $HOME/.local/bin/delta"
                fi
            fi
            if ! command_exists lazygit; then
                log_info "Installing lazygit from GitHub releases for current user..."
                if [[ "$DRY_RUN" == "0" ]]; then
                    local lazygit_version
                    lazygit_version=$(curl -s "https://api.github.com/repos/jesseduffield/lazygit/releases/latest" | grep -Po '"tag_name": "v\K[^"]*' 2>/dev/null || echo "0.44.1")
                    curl -fL "https://github.com/jesseduffield/lazygit/releases/latest/download/lazygit_${lazygit_version}_Linux_x86_64.tar.gz" \
                        -o /tmp/lazygit.tar.gz 2>/dev/null \
                        && tar -xzf /tmp/lazygit.tar.gz -C /tmp lazygit \
                        && install_to_user_local_bin /tmp/lazygit lazygit \
                        && rm -f /tmp/lazygit /tmp/lazygit.tar.gz \
                        || log_warn "lazygit installation failed"
                else
                    log_dry_run "Would install lazygit from GitHub releases to $HOME/.local/bin/lazygit"
                fi
            fi
            ;;
        fedora)
            _linux_pkg_install "Git tools" git gh git-delta
            if ! command_exists lazygit; then
                if [[ "$DRY_RUN" == "0" ]]; then
                    $sudo_prefix dnf copr enable -y atim/lazygit 2>/dev/null \
                        && $sudo_prefix dnf install -y lazygit \
                        || log_warn "lazygit installation failed"
                else
                    log_dry_run "Would install lazygit from copr"
                fi
            fi
            ;;
    esac

    install_uv_tool
    install_bun_tool

    if ! command_exists deno; then
        log_info "Installing Deno..."
        if [[ "$DRY_RUN" == "0" ]]; then
            curl -fsSL https://deno.land/install.sh | sh || log_warn "Deno installation failed"
            if command_exists deno; then
                log_success "Deno installed successfully"
            elif [[ -x "$HOME/.deno/bin/deno" ]]; then
                log_success "Deno installed successfully: $HOME/.deno/bin/deno"
                if [[ ":$PATH:" != *":$HOME/.deno/bin:"* ]]; then
                    log_warn "$HOME/.deno/bin is not in PATH. Add: export PATH=\"$HOME/.deno/bin:\$PATH\""
                fi
            else
                log_warn "Deno installation may have failed (not found in PATH)"
            fi
        else
            log_dry_run "Would install Deno via official installer to $HOME/.deno/bin/deno"
        fi
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
        log_dry_run "  Would install: uv, bun, go, python3-pip, composer, unzip, lazygit, delta, bat, llm"
        return 0
    fi

    case "$DISTRO" in
        arch)
            if ! command_exists go; then
                if command_exists yay; then
                    yay -S --noconfirm go || log_warn "go installation failed"
                elif command_exists paru; then
                    paru -S --noconfirm go || log_warn "go installation failed"
                else
                    $sudo_prefix pacman -S --noconfirm go || log_warn "go installation failed"
                fi
            fi

            if ! command_exists hub; then
                if command_exists yay; then
                    yay -S --noconfirm hub || log_warn "hub installation failed"
                elif command_exists paru; then
                    paru -S --noconfirm hub || log_warn "hub installation failed"
                else
                    log_warn "hub not in official repos, install from AUR or https://github.com/mislav/hub"
                fi
            fi

            if ! command_exists lazygit; then
                log_info "Installing lazygit..."
                if command_exists yay; then
                    yay -S --noconfirm lazygit || log_warn "lazygit installation failed"
                elif command_exists paru; then
                    paru -S --noconfirm lazygit || log_warn "lazygit installation failed"
                else
                    $sudo_prefix pacman -S --noconfirm lazygit || log_warn "lazygit installation failed"
                fi
            fi

            if ! command_exists delta; then
                log_info "Installing delta..."
                if command_exists yay; then
                    yay -S --noconfirm git-delta || log_warn "git-delta installation failed"
                elif command_exists paru; then
                    paru -S --noconfirm git-delta || log_warn "git-delta installation failed"
                else
                    $sudo_prefix pacman -S --noconfirm git-delta || log_warn "git-delta installation failed"
                fi
            fi

            if ! command_exists bat; then
                log_info "Installing bat..."
                $sudo_prefix pacman -S --noconfirm bat || log_warn "bat installation failed"
            fi

            install_llm_cli
            ;;

        debian)
            if command_exists add-apt-repository; then
                $sudo_prefix add-apt-repository -y ppa:git-core/ppa 2>/dev/null || true
            fi
            $sudo_prefix apt-get update -qq
            $sudo_prefix apt-get install -y git

            log_info "Installing latest Go for current user..."
            local go_version
            local go_root="$HOME/.local/opt/go"
            go_version=$(curl -s "https://go.dev/dl/?mode=json" | grep -Po '"version": "go\K[^"]*' | head -1 2>/dev/null || echo "1.26.0")
            mkdir -p "$HOME/.local/opt"
            curl -Lo /tmp/go.tar.gz "https://go.dev/dl/go${go_version}.linux-amd64.tar.gz" 2>/dev/null \
                && rm -rf "$go_root" \
                && tar -C "$HOME/.local/opt" -xzf /tmp/go.tar.gz \
                && symlink_to_user_local_bin "$go_root/bin/go" go \
                && symlink_to_user_local_bin "$go_root/bin/gofmt" gofmt \
                && rm -f /tmp/go.tar.gz \
                || log_warn "Go installation failed, install manually from https://go.dev/dl"

            if ! command_exists node; then
                log_info "Installing Node.js LTS..."
                curl -fsSL https://deb.nodesource.com/setup_lts.x | $sudo_prefix bash - 2>/dev/null \
                    && $sudo_prefix apt-get install -y nodejs \
                    || log_warn "Node.js installation failed, install manually from https://nodejs.org"
            fi

            if command_exists php && ! command_exists composer; then
                curl -sS https://getcomposer.org/installer | php
                if [[ -f composer.phar ]]; then
                    install_to_user_local_bin composer.phar composer
                    rm -f composer.phar
                fi
            fi

            if ! command_exists pip3; then
                _linux_pkg_install "Python pip" python3-pip
            fi
            if command_exists pip3; then
                log_info "Installing Python packages: basedpyright, black, isort..."
                pip3 install --user basedpyright black isort 2>/dev/null || log_warn "Some Python packages failed to install"
            fi

            if ! python3 -m venv --help >/dev/null 2>&1; then
                log_info "Python venv module not found, installing..."
                local python_version=$(python3 --version 2>/dev/null | awk '{print $2}' | cut -d. -f1-2)
                if [[ -n "$python_version" ]]; then
                    local venv_package="python${python_version}-venv"
                    log_info "Installing $venv_package for Python $python_version..."
                    if ! $sudo_prefix apt-get install -y "$venv_package" 2>/dev/null; then
                        log_warn "Versioned venv package not found, trying python3-venv..."
                        $sudo_prefix apt-get install -y python3-venv
                    fi
                else
                    $sudo_prefix apt-get install -y python3-venv
                fi
            else
                log_success "Python venv module is available"
            fi

            if ! command_exists hub; then
                log_info "Installing hub from GitHub releases for current user..."
                local hub_arch="amd64"
                local hub_version="2.14.2"
                curl -L "https://github.com/mislav/hub/releases/download/v${hub_version}/hub-linux-${hub_arch}-${hub_version}.tgz" \
                    -o /tmp/hub.tgz 2>/dev/null \
                    && tar -xzf /tmp/hub.tgz -C /tmp \
                    && install_to_user_local_bin "/tmp/hub-linux-${hub_arch}-${hub_version}/bin/hub" hub \
                    && rm -rf /tmp/hub* \
                    || log_warn "hub installation failed, install manually from https://github.com/mislav/hub"
            fi

            if ! command_exists lazygit; then
                log_info "Installing lazygit from GitHub releases for current user..."
                local lazygit_version
                lazygit_version=$(curl -s "https://api.github.com/repos/jesseduffield/lazygit/releases/latest" | grep -Po '"tag_name": "v\K[^"]*' 2>/dev/null || echo "0.44.1")
                curl -Lo /tmp/lazygit.tar.gz "https://github.com/jesseduffield/lazygit/releases/latest/download/lazygit_${lazygit_version}_Linux_x86_64.tar.gz" 2>/dev/null \
                    && tar -xzf /tmp/lazygit.tar.gz -C /tmp lazygit \
                    && install_to_user_local_bin /tmp/lazygit lazygit \
                    && rm -f /tmp/lazygit /tmp/lazygit.tar.gz \
                    || log_warn "lazygit installation failed, install manually from https://github.com/jesseduffield/lazygit"
            fi

            if ! command_exists delta; then
                log_info "Installing delta from GitHub releases for current user..."
                local delta_version
                delta_version=$(curl -s "https://api.github.com/repos/dandavison/delta/releases/latest" | grep -Po '"tag_name": "\K[^"]*' 2>/dev/null || echo "0.18.2")
                curl -Lo /tmp/delta.tar.gz "https://github.com/dandavison/delta/releases/latest/download/delta-${delta_version}-x86_64-unknown-linux-musl.tar.gz" 2>/dev/null \
                    && tar -xzf /tmp/delta.tar.gz -C /tmp --wildcards "*/delta" --strip-components=1 \
                    && install_to_user_local_bin /tmp/delta delta \
                    && rm -f /tmp/delta /tmp/delta.tar.gz \
                    || log_warn "delta installation failed, install manually from https://github.com/dandavison/delta"
            fi

            if ! command_exists bat; then
                log_info "Installing bat from GitHub releases for current user..."
                local bat_version
                bat_version=$(curl -s "https://api.github.com/repos/sharkdp/bat/releases/latest" | grep -Po '"tag_name": "v\K[^"]*' 2>/dev/null || echo "0.24.0")
                curl -Lo /tmp/bat.tar.gz "https://github.com/sharkdp/bat/releases/latest/download/bat-v${bat_version}-x86_64-unknown-linux-musl.tar.gz" 2>/dev/null \
                    && tar -xzf /tmp/bat.tar.gz -C /tmp \
                    && install_to_user_local_bin "/tmp/bat-v${bat_version}-x86_64-unknown-linux-musl/bat" bat \
                    && rm -rf /tmp/bat* \
                    || log_warn "bat installation failed, install manually from https://github.com/sharkdp/bat"
            fi

            install_llm_cli
            ;;

        fedora)
            $sudo_prefix dnf install -y git
            if ! command_exists go; then
                $sudo_prefix dnf install -y golang
            fi
            if command_exists php && ! command_exists composer; then
                $sudo_prefix dnf install -y composer
            fi
            if ! command_exists pip3; then
                _linux_pkg_install "Python pip" python3-pip
            fi
            if command_exists pip3; then
                log_info "Installing Python packages: basedpyright, black, isort..."
                pip3 install --user basedpyright black isort 2>/dev/null || log_warn "Some Python packages failed to install"
            fi
            if ! python3 -m venv --help >/dev/null 2>&1; then
                $sudo_prefix dnf install -y python3-venv || log_warn "python3-venv not found, may be included in python3 package"
            else
                log_success "Python venv module is available"
            fi
            if ! command_exists hub; then
                $sudo_prefix dnf install -y hub 2>/dev/null || log_warn "hub not in repos, install manually from https://github.com/mislav/hub"
            fi
            if ! command_exists lazygit; then
                log_info "Installing lazygit..."
                $sudo_prefix dnf copr enable -y atim/lazygit 2>/dev/null \
                    && $sudo_prefix dnf install -y lazygit \
                    || log_warn "lazygit installation failed, install manually from https://github.com/jesseduffield/lazygit"
            fi
            if ! command_exists delta; then
                log_info "Installing delta..."
                $sudo_prefix dnf install -y git-delta 2>/dev/null || log_warn "delta installation failed, install manually from https://github.com/dandavison/delta"
            fi
            if ! command_exists bat; then
                log_info "Installing bat from GitHub releases for current user..."
                local bat_version
                bat_version=$(curl -s "https://api.github.com/repos/sharkdp/bat/releases/latest" | grep -Po '"tag_name": "v\K[^"]*' 2>/dev/null || echo "0.24.0")
                curl -Lo /tmp/bat.tar.gz "https://github.com/sharkdp/bat/releases/latest/download/bat-v${bat_version}-x86_64-unknown-linux-musl.tar.gz" 2>/dev/null \
                    && tar -xzf /tmp/bat.tar.gz -C /tmp \
                    && install_to_user_local_bin "/tmp/bat-v${bat_version}-x86_64-unknown-linux-musl/bat" bat \
                    && rm -rf /tmp/bat* \
                    || log_warn "bat installation failed, install manually from https://github.com/sharkdp/bat"
            fi
            install_llm_cli
            ;;

        *)
            log_warn "Developer tools installation not configured for $DISTRO"
            ;;
    esac
}
