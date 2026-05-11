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
    run_stow_preflight_for_selection
    setup_package_manager_for_mode
    run_install_steps
    show_final_summary
}

# Run main function
main "$@"

# Restore original directory
cd "$ORIGINAL_DIR"
