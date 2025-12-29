#!/bin/bash

#=============================================================================
# LuaRocks Local Installation Script
# Installs LuaRocks to ~/.local/ for user-specific package management
#=============================================================================

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

#=============================================================================
# CONFIGURATION
#=============================================================================
LUAROCKS_VERSION="${LUAROCKS_VERSION:-3.11.1}"
INSTALL_DIR="$HOME/.local"
SRC_DIR="$HOME/.local/src"
ORIGINAL_DIR="$(pwd)"
LOG_FILE="/tmp/luarocks_install_$(date +%Y%m%d_%H%M%S).log"

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

log_warn() {
    echo "[WARN] $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

#=============================================================================
# CHECKS
#=============================================================================
check_build_tools() {
    log_info "Checking for required build tools..."

    local missing_tools=()

    for tool in gcc make tar wget gzip; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done

    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log_error "Missing required build tools: ${missing_tools[*]}"
        echo ""
        echo "Please install the missing tools:"
        echo "  - Arch: sudo pacman -S base-devel"
        echo "  - Debian/Ubuntu: sudo apt-get install build-essential"
        echo "  - macOS: xcode-select --install"
        exit 1
    fi

    log_success "All required build tools found"
}

check_luarocks_installed() {
    if command -v luarocks &> /dev/null; then
        local version=$(luarocks --version 2>/dev/null | head -n1 || echo "unknown")
        log_warn "LuaRocks is already installed ($version)"
        read -p "Do you want to reinstall? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Installation cancelled"
            exit 0
        fi
    fi
}

#=============================================================================
# INSTALLATION
#=============================================================================
install_luarocks() {
    log_info "Installing LuaRocks ${LUAROCKS_VERSION}..."

    # Create source directory
    mkdir -p "$SRC_DIR"
    cd "$SRC_DIR"

    # Download LuaRocks
    local luarocks_url="https://luarocks.org/releases/luarocks-${LUAROCKS_VERSION}.tar.gz"
    log_info "Downloading from $luarocks_url..."

    if ! wget -q "$luarocks_url"; then
        log_error "Failed to download LuaRocks"
        cd "$ORIGINAL_DIR"
        exit 1
    fi

    # Extract
    log_info "Extracting..."
    tar zxpf "luarocks-${LUAROCKS_VERSION}.tar.gz"

    # Build and install
    cd "luarocks-${LUAROCKS_VERSION}"

    log_info "Configuring..."
    if ! ./configure --prefix="$INSTALL_DIR"; then
        log_error "Configure failed"
        cd "$ORIGINAL_DIR"
        exit 1
    fi

    log_info "Building..."
    if ! make; then
        log_error "Build failed"
        cd "$ORIGINAL_DIR"
        exit 1
    fi

    log_info "Installing..."
    if ! make install; then
        log_error "Installation failed"
        cd "$ORIGINAL_DIR"
        exit 1
    fi

    # Cleanup
    cd "$SRC_DIR"
    rm -f "luarocks-${LUAROCKS_VERSION}.tar.gz"
    rm -rf "luarocks-${LUAROCKS_VERSION}"

    cd "$ORIGINAL_DIR"
}

#=============================================================================
# POST-INSTALLATION
#=============================================================================
verify_installation() {
    log_info "Verifying installation..."

    # Add ~/.local/bin to PATH if not already there
    if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
        log_warn "~/.local/bin is not in your PATH"
        echo ""
        echo "Add the following to your ~/.bashrc or ~/.zshrc:"
        echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi

    # Check if luarocks command is available
    if [[ -x "$INSTALL_DIR/bin/luarocks" ]]; then
        log_success "LuaRocks installed to $INSTALL_DIR/bin/"
        "$INSTALL_DIR/bin/luarocks" --version | head -n1
    else
        log_error "LuaRocks binary not found after installation"
        return 1
    fi
}

#=============================================================================
# MAIN
#=============================================================================
main() {
    echo "=========================================="
    echo "  LuaRocks Local Installation"
    echo "=========================================="
    echo "Version: $LUAROCKS_VERSION"
    echo "Install dir: $INSTALL_DIR"
    echo "Log file: $LOG_FILE"
    echo ""

    check_build_tools
    check_luarocks_installed
    install_luarocks
    verify_installation

    echo ""
    log_success "LuaRocks installation complete!"
    echo ""
    echo "Log saved to: $LOG_FILE"
}

# Run main
main "$@"

# Restore original directory
cd "$ORIGINAL_DIR"
