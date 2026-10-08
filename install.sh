#!/usr/bin/env bash

#=============================================================================
# Dotfiles Installation Script
# Supports: macOS, Arch Linux, Ubuntu/Debian
#
# Usage:
#   ./install.sh                  # Interactive menu (default)
#   ./install.sh --dry-run        # Show what would be installed
#   ./install.sh --list-groups    # List available groups
#   ./install.sh shell editor     # Install specific groups
#=============================================================================

# Check bash version for associative array support
if [[ "${BASH_VERSINFO[0]}" -lt 4 ]]; then
    echo "Error: This script requires Bash 4.0 or later for associative arrays."
    echo ""
    echo "Your bash version: $BASH_VERSION"
    echo ""
    if [[ "$(uname)" == "Darwin" ]]; then
        echo "On macOS, install a newer bash via Homebrew:"
        echo "  brew install bash"
        echo ""
        echo "Then run this script with:"
        echo "  /opt/homebrew/bin/bash $0 \"$@\""
        echo ""
        echo "Or set it as your default shell."
    fi
    exit 1
fi

set -eo pipefail  # Exit on error and pipe failures (no -u for associative arrays)

#=============================================================================
# CONFIGURATION
#=============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/tmp/dotfiles_install_$(date +%Y%m%d_%H%M%S).log"
ORIGINAL_DIR="$(pwd)"
DRY_RUN=0
INTERACTIVE=1
USER_LOCAL=0

#=============================================================================
# SOURCE COMMON FUNCTIONS (must be early for log_* functions)
#=============================================================================
if [[ -f "$SCRIPT_DIR/scripts/common.sh" ]]; then
    source "$SCRIPT_DIR/scripts/common.sh"
else
    # Fallback logging if common.sh is not available
    log_info() { echo "[INFO] $1"; }
    log_success() { echo "[SUCCESS] $1"; }
    log_error() { echo "[ERROR] $1" >&2; }
    log_warn() { echo "[WARN] $1"; }
    log_dry_run() {
        if [[ "$DRY_RUN" == "1" ]]; then
            echo "[DRY RUN] $1"
        fi
    }
fi

#=============================================================================
# ROOT USER CHECK
#=============================================================================
# Running as root is supported but requires caution
if [[ $EUID -eq 0 ]]; then
    log_warn "Running as root user"
    log_info "This will install dotfiles for the root user account"
    # Set HOME to /root if not set (for consistency)
    HOME="${HOME:-/root}"
fi

#=============================================================================
# MODULES
#=============================================================================
source "$SCRIPT_DIR/scripts/install/groups.sh"
init_default_groups
source "$SCRIPT_DIR/scripts/install/helpers.sh"
source "$SCRIPT_DIR/scripts/install/ui.sh"
source "$SCRIPT_DIR/scripts/install/nvim.sh"
source "$SCRIPT_DIR/scripts/install/presets.sh"
source "$SCRIPT_DIR/scripts/install/core.sh"
source "$SCRIPT_DIR/scripts/install/selection.sh"
source "$SCRIPT_DIR/scripts/install/cli.sh"
source "$SCRIPT_DIR/scripts/install/flow.sh"
source "$SCRIPT_DIR/scripts/install/packages.sh"
source "$SCRIPT_DIR/scripts/install/dev-tools.sh"
source "$SCRIPT_DIR/scripts/install/mise.sh"

#=============================================================================
# INSTALL NODE DEPENDENCIES
#=============================================================================
install_node_dependencies() {
    # Only run npm ci if the pi-agent group was selected
    if [[ "$(get_group_selection pi-agent 2>/dev/null || echo 0)" != "1" ]]; then
        return
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
        log_dry_run "npm ci (in $SCRIPT_DIR)"
        return
    fi

    if [[ ! -f "$SCRIPT_DIR/package.json" ]]; then
        return
    fi

    if ! command -v npm &>/dev/null; then
        log_warn "npm not found — skipping Node.js dependency installation"
        log_info "Install Node.js and run: cd $SCRIPT_DIR && npm ci"
        return
    fi

    log_info "Installing Node.js dependencies (npm ci)..."
    cd "$SCRIPT_DIR"
    if npm ci --no-audit --no-fund 2>&1 | tee -a "$LOG_FILE"; then
        log_success "Node.js dependencies installed"
    else
        log_error "npm ci failed — extension may not load"
        log_info "Try manually: cd $SCRIPT_DIR && npm ci"
    fi
    cd "$ORIGINAL_DIR"
}

#=============================================================================
# SHARED AGENT SKILLS
#=============================================================================
# Upstream skills live in the pi/mattpocock-skills submodule and are linked
# per-skill into ~/.agents/skills (read by pi, Codex and other Agent Skills
# harnesses) and ~/.claude/skills. The linker is non-pruning: entries it does
# not own, e.g. skills installed locally or by the OS, are left untouched.
setup_agent_skills() {
    # Only run if the pi-agent group was selected
    if [[ "$(get_group_selection pi-agent 2>/dev/null || echo 0)" != "1" ]]; then
        return
    fi

    if [[ -f "$SCRIPT_DIR/.gitmodules" ]]; then
        if [[ "$DRY_RUN" == "1" ]]; then
            log_dry_run "git submodule update --init --recursive (in $SCRIPT_DIR)"
        else
            log_info "Initializing skill submodule..."
            git -C "$SCRIPT_DIR" submodule update --init --recursive 2>&1 | tee -a "$LOG_FILE" \
                || log_warn "Submodule init failed — shared agent skills will not be linked"
        fi
    fi

    local linker="$SCRIPT_DIR/pi/mattpocock-skills/scripts/link-skills.sh"
    if [[ ! -x "$linker" ]]; then
        log_warn "Skill linker not found: $linker — skipping shared agent skills"
        return
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
        log_dry_run "$linker"
        return
    fi

    log_info "Linking shared agent skills into ~/.agents/skills and ~/.claude/skills..."
    if "$linker" 2>&1 | tee -a "$LOG_FILE"; then
        log_success "Shared agent skills linked"
    else
        log_error "Linking shared agent skills failed"
    fi
}

#=============================================================================
# PI AGENT EXTENSIONS AND SKILLS
#=============================================================================
# ~/.pi/agent/extensions and ~/.pi/agent/skills have to hold dotfile-managed
# entries and machine-local ones at the same time, which stow cannot express.
# They are excluded from stow (.stow-local-ignore) and owned by this linker:
# it symlinks the repo's entries one per entry and never touches anything it
# did not create, so OS-installed skills and host-specific hooks stay put.
link_pi_agent_entries() {
    if [[ "$(get_group_selection pi-agent 2>/dev/null || echo 0)" != "1" ]]; then
        return
    fi

    local linker="$SCRIPT_DIR/scripts/link-pi-agent-entries.sh"
    if [[ ! -x "$linker" ]]; then
        log_warn "Pi agent entry linker not found: $linker — skipping"
        return
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
        log_dry_run "$linker"
        return
    fi

    log_info "Linking pi agent extensions and skills..."
    local output rc=0
    output=$("$linker" 2>&1) || rc=$?
    [[ -n "$output" ]] && printf '%s\n' "$output" | tee -a "$LOG_FILE"

    case "$rc" in
        0)
            log_success "Pi agent extensions and skills linked"
            ;;
        2)
            log_warn "pi agent extensions/skills are still one symlink into the repo"
            log_warn "Migrate them to per-entry links with:"
            log_warn "  $linker --unfold"
            ;;
        *)
            log_error "Linking pi agent extensions and skills failed"
            ;;
    esac
}

#=============================================================================
# MAIN INSTALLATION FLOW
#=============================================================================
main() {
    parse_cli_args "$@"

    if [[ -n "${LOG_FILE:-}" ]]; then
        mkdir -p "$(dirname "$LOG_FILE")"
    fi

    show_header
    detect_os
    resolve_install_mode

    echo "Log file: $LOG_FILE"
    echo ""

    run_interactive_group_selection
    show_selected_groups_summary
    show_pre_install_status_if_needed
    setup_stow
    ensure_mise
    setup_package_manager_for_mode
    # Install programs first — stow only handles dotfiles after
    run_install_programs
    run_stow_preflight_for_selection
    run_stow_and_post_steps
    setup_agent_skills
    link_pi_agent_entries
    mise_sync_tools
    install_node_dependencies
    show_final_summary
}

# Run main function
main "$@"

# Restore original directory
cd "$ORIGINAL_DIR"
