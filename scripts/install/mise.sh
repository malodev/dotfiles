#!/usr/bin/env bash
#=============================================================================
# MISE — tool/runtime manager bootstrap + tool sync.
#
# ensure_mise()   : install mise if absent (system package, else curl mise.run).
#                   Called early in install.sh main() so every later step can
#                   rely on `mise` and its shims.
# mise_sync_tools(): declare the dev/editor tools in mise's global config via
#                   `mise use -g` (which MERGES with any existing entries, e.g.
#                   claude/gh/pi written by Omarchy's installer) and install them.
#                   Runs AFTER stow and only when a group that consumes mise
#                   tools (dev / editor / editor-alt) is selected.
#=============================================================================

# Install mise if it isn't already available.
ensure_mise() {
    # Make mise itself (~/.local/bin) and its shims reachable for this run,
    # regardless of how it was installed.
    export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"

    if command_exists mise; then
        log_success "mise is already installed: $(command -v mise)"
        return 0
    fi

    log_dry_run "Would install mise (tool/runtime manager)"
    if [[ "$DRY_RUN" == "1" ]]; then
        return 0
    fi

    local sudo_prefix
    sudo_prefix=$(get_sudo_prefix)

    # 1. System package manager when sudo is available.
    if can_sys_install; then
        if is_arch; then
            # Omarchy repo ships mise-bin (tracks upstream jdx/mise);
            # fall back to the Arch repo's mise package.
            if $sudo_prefix pacman -S --noconfirm mise-bin 2>/dev/null; then
                log_success "mise installed via pacman (mise-bin, Omarchy repo)"
            elif $sudo_prefix pacman -S --noconfirm mise 2>/dev/null; then
                log_success "mise installed via pacman (mise, Arch repo)"
            fi
        elif is_macos && command_exists brew; then
            brew install mise && log_success "mise installed via Homebrew"
        elif is_debian || [[ "$DISTRO" == "fedora" ]]; then
            pm_install mise && log_success "mise installed via package manager"
        fi
    fi

    # 2. Universal sudo-less fallback (the common --user-local / shared-hosting case).
    if ! command_exists mise; then
        log_info "Installing mise user-locally (curl https://mise.run | sh)..."
        if command_exists curl; then
            curl https://mise.run | sh || log_warn "mise install script failed"
        else
            log_warn "curl not available — cannot bootstrap mise; install it manually"
            return 1
        fi
        # mise.run installs into ~/.local/bin; refresh PATH for this run.
        export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
    fi

    if command_exists mise; then
        log_success "mise ready: $(command -v mise)"
    else
        log_warn "mise still not on PATH after install — check ~/.local/bin"
    fi
}

# Declare the dev/editor tools in mise's global config and install them.
#
# Uses `mise use -g` (merge into ~/.config/mise/config.toml) rather than stowing
# a config file: Omarchy's installer already writes claude/gh/pi there, and a
# stowed file would replace those entries and trip stow's conflict check.
mise_sync_tools() {
    local want_dev=0 want_editor=0
    [[ "$(get_group_selection "dev")" == "1" ]] && want_dev=1
    if [[ "$(get_group_selection "editor")" == "1" ]] || [[ "$(get_group_selection "editor-alt")" == "1" ]]; then
        want_editor=1
    fi

    if [[ "$want_dev" == "0" && "$want_editor" == "0" ]]; then
        return 0
    fi

    if ! command_exists mise; then
        log_warn "mise not available — skipping mise tool install"
        return 0
    fi

    log_dry_run "Would run: mise use -g <dev tools> && mise install"
    if [[ "$DRY_RUN" == "1" ]]; then
        return 0
    fi

    if [[ "$want_dev" == "1" ]]; then
        log_info "Declaring dev tools in mise global config..."
        local tool
        for tool in \
            node@latest \
            go@latest \
            deno@latest \
            bun@latest \
            uv@latest \
            gh@latest \
            delta@latest \
            lazygit@latest \
            lazydocker@latest \
            hub@latest; do
            mise use -g "$tool" 2>/dev/null || log_warn "mise use -g $tool failed"
        done
    fi

    log_info "Installing mise-managed tools..."
    mise install || log_warn "mise install reported errors (some tools may need attention)"

    # Dev tool that rides on mise-managed uv.
    if [[ "$want_dev" == "1" ]] && ! command_exists llm; then
        if command_exists uv; then
            log_info "Installing llm CLI via uv..."
            uv tool install llm 2>/dev/null || log_warn "llm install failed"
        else
            log_warn "uv not available — install llm manually with: uv tool install llm"
        fi
    fi

    # Editor deps that ride on mise-managed node (npm).
    if [[ "$want_editor" == "1" ]]; then
        if ! command_exists yarn; then
            log_info "Installing yarn via npm (mise node)..."
            npm install -g --prefix "$HOME/.local" yarn 2>/dev/null || log_warn "yarn install failed"
        fi
        if ! command_exists tree-sitter; then
            log_info "Installing tree-sitter-cli via npm (mise node)..."
            npm install -g --prefix "$HOME/.local" tree-sitter-cli 2>/dev/null || log_warn "tree-sitter-cli install failed"
        fi
    fi
}
