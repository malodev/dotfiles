#!/bin/bash

#=============================================================================
# JetBrains Mono Nerd Font Installation Script
# Supports: macOS, Linux (Arch/Debian/Ubuntu)
#=============================================================================

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

#=============================================================================
# CONFIGURATION
#=============================================================================
FONT_VERSION="${FONT_VERSION:-v3.3.0}"
FONT_URL="https://github.com/ryanoasis/nerd-fonts/releases/download/${FONT_VERSION}/JetBrainsMono.zip"
ORIGINAL_DIR="$(pwd)"
LOG_FILE="/tmp/jetbrains_font_install_$(date +%Y%m%d_%H%M%S).log"
TEMP_DIR=$(mktemp -d)

#=============================================================================
# OS DETECTION
#=============================================================================
OS=$(uname -s)

# Determine font directory based on OS
if [[ "$OS" == "Darwin" ]]; then
    FONT_DIR="$HOME/Library/Fonts"
    FONT_CACHE_CMD="fc-cache -fv"
elif [[ "$OS" == "Linux" ]]; then
    # Use XDG standard location
    FONT_DIR="$HOME/.local/share/fonts"
    FONT_CACHE_CMD="fc-cache -fv"
else
    echo "ERROR: Unsupported OS: $OS"
    exit 1
fi

#=============================================================================
# LOGGING FUNCTIONS
#=============================================================================
log_info() {
    echo "[INFO] $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo "[SUCCESS] $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo "[ERROR] $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE" >&2
}

#=============================================================================
# CLEANUP
#=============================================================================
cleanup() {
    log_info "Cleaning up temporary files..."
    rm -rf "$TEMP_DIR"
    cd "$ORIGINAL_DIR"
}

trap cleanup EXIT

#=============================================================================
# CHECKS
#=============================================================================
check_dependencies() {
    log_info "Checking dependencies..."

    local missing_tools=()
    local install_instructions=""

    # Check for curl or wget
    if ! command -v curl &> /dev/null && ! command -v wget &> /dev/null; then
        missing_tools+=("curl or wget")
    fi

    # Check for unzip
    if ! command -v unzip &> /dev/null; then
        missing_tools+=("unzip")
    fi

    # Check for fc-cache (fontconfig)
    if ! command -v fc-cache &> /dev/null; then
        missing_tools+=("fontconfig")
    fi

    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        echo ""
        echo "Install instructions:"
        if [[ "$OS" == "Darwin" ]]; then
            echo "  brew install unzip fontconfig"
        elif [[ -f /etc/arch-release ]]; then
            echo "  sudo pacman -S unzip fontconfig"
        elif [[ -f /etc/debian_version ]]; then
            echo "  sudo apt-get install unzip fontconfig"
        fi
        exit 1
    fi

    log_success "All dependencies found"
}

check_already_installed() {
    # Check if any JetBrainsMono Nerd Font files exist
    if ls "$FONT_DIR"/JetBrainsMono*NERD* 2>/dev/null; then
        log_warn "JetBrains Mono Nerd Font already installed in $FONT_DIR"
        read -p "Do you want to reinstall? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Installation cancelled"
            exit 0
        fi
        log_info "Removing existing fonts..."
        rm -f "$FONT_DIR"/JetBrainsMono*NERD*
    fi
}

#=============================================================================
# INSTALLATION
#=============================================================================
download_font() {
    log_info "Downloading JetBrains Mono Nerd Font ${FONT_VERSION}..."

    cd "$TEMP_DIR"

    # Try curl first, fallback to wget
    if command -v curl &> /dev/null; then
        if ! curl -L -o JetBrainsMono.zip "$FONT_URL"; then
            log_error "Failed to download font"
            exit 1
        fi
    elif command -v wget &> /dev/null; then
        if ! wget -O JetBrainsMono.zip "$FONT_URL"; then
            log_error "Failed to download font"
            exit 1
        fi
    fi

    log_success "Download complete"
}

extract_font() {
    log_info "Extracting font files..."

    cd "$TEMP_DIR"

    if ! unzip -q JetBrainsMono.zip; then
        log_error "Failed to extract font archive"
        exit 1
    fi

    rm -f JetBrainsMono.zip
    log_success "Extraction complete"
}

install_font() {
    log_info "Installing fonts to $FONT_DIR..."

    # Create font directory if it doesn't exist
    mkdir -p "$FONT_DIR"

    # Move font files (filter for only Nerd Font variants)
    find "$TEMP_DIR" -name "*JetBrainsMono*NERD*" -type f -exec mv {} "$FONT_DIR"/ \;

    log_success "Font files installed"
}

refresh_font_cache() {
    log_info "Refreshing font cache..."

    if command -v fc-cache &> /dev/null; then
        fc-cache -fv "$FONT_DIR" 2>&1 | tee -a "$LOG_FILE"

        # On macOS, also kill the font daemon
        if [[ "$OS" == "Darwin" ]]; then
            sudo killall -9 fontd 2>/dev/null || true
        fi

        log_success "Font cache refreshed"
    else
        log_warn "fc-cache not found, skipping cache refresh"
        log_warn "You may need to log out and back in for fonts to be recognized"
    fi
}

#=============================================================================
# MAIN
#=============================================================================
main() {
    echo "=========================================="
    echo "  JetBrains Mono Nerd Font Installer"
    echo "=========================================="
    echo "Version: $FONT_VERSION"
    echo "Target dir: $FONT_DIR"
    echo "Log file: $LOG_FILE"
    echo ""

    check_dependencies
    check_already_installed
    download_font
    extract_font
    install_font
    refresh_font_cache

    echo ""
    log_success "Installation complete!"
    echo ""
    echo "The JetBrains Mono Nerd Font has been installed to:"
    echo "  $FONT_DIR"
    echo ""
    echo "You may need to restart applications for the font to appear."
    echo ""
    echo "Log saved to: $LOG_FILE"
}

# Run main
main "$@"
