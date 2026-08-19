#!/usr/bin/env bash

#=============================================================================
# DEVELOPER TOOLS
#
# Dev tools (node, go, deno, bun, uv, gh, git-delta, lazygit, lazydocker, hub,
# llm) are now installed via mise — see scripts/install/mise.sh (mise_sync_tools).
#
# This function keeps the `dev` group's program-install step and its
# macOS/Brewfile early-return; on Linux it defers to mise (bootstrapped in
# install.sh main() via ensure_mise, tools installed post-stow via mise_sync_tools).
#=============================================================================

install_dev_tools() {
    if [[ "$(get_group_selection "dev")" != "1" ]]; then
        return
    fi

    show_banner "Installing Developer Tools"

    if [[ "$OS" == "Darwin" ]] || [[ "${WITH_BREW:-0}" == "1" ]]; then
        log_info "Developer tools installed via Brewfile"
        return 0
    fi

    # mise was bootstrapped in install.sh main() (ensure_mise); the actual tool
    # install happens after stow in mise_sync_tools(). Nothing else to do here.
    log_info "Developer tools (node, go, deno, bun, uv, gh, git-delta, lazygit, lazydocker, hub) will be installed via mise."
}
