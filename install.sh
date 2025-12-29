#!/bin/bash

#=============================================================================
# Dotfiles Installation Script
# Supports: macOS, Arch Linux, Ubuntu/Debian
#
# Usage:
#   ./install.sh           # Normal installation
#   ./install.sh --dry-run # Show what would be installed without changes
#   DRY_RUN=1 ./install.sh # Alternative dry-run syntax
#=============================================================================

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

#=============================================================================
# CONFIGURATION
#=============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/tmp/dotfiles_install_$(date +%Y%m%d_%H%M%S).log"
ORIGINAL_DIR="$(pwd)"
DRY_RUN=0

# Parse arguments
for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--dry-run]"
            echo ""
            echo "Options:"
            echo "  --dry-run    Show what would be installed without making changes"
            echo "  -h, --help   Show this help message"
            exit 0
            ;;
    esac
done

export DRY_RUN SCRIPT_DIR

#=============================================================================
# SOURCE COMMON FUNCTIONS
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
# STATUS DISPLAY
#=============================================================================
show_status_header() {
    local name="$1"
    echo ""
    echo "=========================================="
    echo "  $name"
    echo "=========================================="
}

show_installed_status() {
    local cmd="$1"
    local description="$2"

    if command_exists "$cmd"; then
        local version
        version=$($cmd --version 2>/dev/null | head -n1 || echo "installed")
        log_success "✓ $description: $version"
    else
        log_info "✗ $description: NOT INSTALLED"
    fi
}

show_package_status() {
    local stow_dir="$1"
    local name="$2"

    if [[ -d "$stow_dir" ]]; then
        # Check if stowed (symlink exists in target)
        local target symlink
        case "$name" in
            *nvim*)
                target="$HOME/.config/nvim"
                ;;
            *kitty*)
                target="$HOME/.config/kitty"
                ;;
            *tmux*)
                target="$HOME/.tmux.conf"
                ;;
            *starship*)
                target="$HOME/.config/starship.toml"
                ;;
            *nushell*)
                target="$HOME/.config/nushell"
                ;;
            *zsh*)
                target="$HOME/.zshrc"
                ;;
            *sketchybar*)
                target="$HOME/.config/sketchybar"
                ;;
            *aerospace*)
                target="$HOME/.config/aerospace"
                ;;
            *i3*)
                target="$HOME/.config/i3"
                ;;
            *)
                target=""
                ;;
        esac

        if [[ -n "$target" && -L "$target" ]]; then
            log_success "✓ $name: STOWED (→ $target)"
        elif [[ -n "$target" && -e "$target" ]]; then
            log_warn "⚠ $name: EXISTS but not symlinked (→ $target)"
        else
            log_info "✗ $name: AVAILABLE but not stowed"
        fi
    else
        log_warn "✗ $name: NOT FOUND in repo"
    fi
}

#=============================================================================
# OS AND DISTRIBUTION DETECTION
#=============================================================================
detect_os() {
    OS=$(uname -s)
    DISTRO=""

    case "$OS" in
        Darwin)
            log_info "Detected macOS"
            ;;
        Linux)
            if [[ -f /etc/arch-release ]]; then
                DISTRO="arch"
                log_info "Detected Arch Linux"
            elif [[ -f /etc/debian_version ]]; then
                DISTRO="debian"
                log_info "Detected Debian/Ubuntu"
            elif [[ -f /etc/fedora-release ]]; then
                DISTRO="fedora"
                log_info "Detected Fedora"
            else
                DISTRO="unknown"
                log_warn "Unknown Linux distribution"
            fi
            ;;
        *)
            log_error "Unsupported OS: $OS"
            exit 1
            ;;
    esac
}

#=============================================================================
# PACKAGE MANAGER STATUS
#=============================================================================
show_package_manager_status() {
    show_status_header "Package Manager Status"

    if [[ "$OS" == "Darwin" ]]; then
        if command_exists brew; then
            show_installed_status "brew" "Homebrew"
        else
            log_info "✗ Homebrew: NOT INSTALLED"
        fi
    elif [[ "$DISTRO" == "arch" ]]; then
        if command_exists yay; then
            show_installed_status "yay" "yay (AUR helper)"
        elif command_exists paru; then
            show_installed_status "paru" "paru (AUR helper)"
        fi
        show_installed_status "pacman" "pacman"
    elif [[ "$DISTRO" == "debian" ]]; then
        if command_exists brew; then
            show_installed_status "brew" "Homebrew (Linux)"
        fi
        show_installed_status "apt-get" "apt"
    fi
}

#=============================================================================
# REQUIRED TOOLS STATUS
#=============================================================================
show_required_tools_status() {
    show_status_header "Required Tools Status"

    local tools=("git" "stow" "curl" "wget" "tar" "gzip")

    for tool in "${tools[@]}"; do
        if command_exists "$tool"; then
            log_success "✓ $tool: INSTALLED"
        else
            log_info "✗ $tool: NOT INSTALLED"
        fi
    done
}

#=============================================================================
# DOTFILES PACKAGES STATUS
#=============================================================================
show_dotfiles_status() {
    show_status_header "Dotfiles Packages Status"

    local common_packages=(
        "nvim-malo:Neovim (malo config)"
        "nvim-test:Neovim (test config)"
        "kitty:Kitty terminal"
        "tmux:Tmux"
        "starship:Starship prompt"
        "nushell:Nushell"
        "zsh:Zsh"
    )

    for pkg_info in "${common_packages[@]}"; do
        IFS=':' read -r pkg_name pkg_desc <<< "$pkg_info"
        show_package_status "$SCRIPT_DIR/$pkg_name" "$pkg_desc ($pkg_name)"
    done

    # Platform-specific packages
    if [[ "$OS" == "Darwin" ]]; then
        echo ""
        log_info "macOS-specific packages:"
        show_package_status "$SCRIPT_DIR/sketchybar" "SketchyBar"
        show_package_status "$SCRIPT_DIR/aerospace" "AeroSpace"
    elif [[ "$OS" == "Linux" ]]; then
        echo ""
        log_info "Linux-specific packages:"
        show_package_status "$SCRIPT_DIR/i3" "i3 window manager"
    fi
}

#=============================================================================
# HOMEBREW SETUP
#=============================================================================
setup_homebrew() {
    # On Arch, skip Homebrew - use pacman/yay instead
    if [[ "$DISTRO" == "arch" ]]; then
        log_info "Arch Linux detected: Using pacman instead of Homebrew"
        return 0
    fi

    if command_exists brew; then
        log_success "Homebrew is already installed"
        # Ensure Homebrew is in PATH for Linux
        if [[ "$OS" == "Linux" ]]; then
            eval "$(($(command -v brew) shellenv 2>/dev/null || echo '/home/linuxbrew/.linuxbrew/bin/brew') shellenv)"
        fi
    else
        log_dry_run "Would install Homebrew..."
        if [[ "$DRY_RUN" == "1" ]]; then
            return 0
        fi

        log_info "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

        # Add Homebrew to PATH for Linux
        if [[ "$OS" == "Linux" ]]; then
            eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
        fi
    fi

    # Update Homebrew
    log_dry_run "Would update Homebrew..."
    if [[ "$DRY_RUN" == "0" ]]; then
        log_info "Updating Homebrew..."
        brew update || log_warn "Homebrew update failed, continuing..."

        log_info "Upgrading Homebrew packages..."
        brew upgrade || log_warn "Homebrew upgrade failed, continuing..."
    fi
}

#=============================================================================
# GNU STOW SETUP
#=============================================================================
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

    case "$DISTRO" in
        arch)
            if command_exists yay; then
                yay -S --noconfirm stow
            elif command_exists paru; then
                paru -S --noconfirm stow
            else
                sudo pacman -S --noconfirm stow
            fi
            ;;
        debian)
            sudo apt-get update
            sudo apt-get install -y stow
            ;;
        fedora)
            sudo dnf install -y stow
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

#=============================================================================
# PACKAGE INSTALLATION
#=============================================================================
install_packages() {
    show_status_header "Installing Dotfiles"

    log_dry_run "DRY RUN: Would stow the following packages..."

    # Common packages for all systems
    local common_packages=(
        "nvim-malo"
        "nvim-test"
        "kitty"
        "tmux"
        "starship"
        "nushell"
        "zsh"
    )

    for pkg in "${common_packages[@]}"; do
        if [[ -d "$SCRIPT_DIR/$pkg" ]]; then
            log_dry_run "  stow $pkg"
            if [[ "$DRY_RUN" == "0" ]]; then
                log_info "Stowing $pkg..."
                stow -v "$pkg" 2>&1 | tee -a "$LOG_FILE"
            fi
        else
            log_warn "Package directory not found: $pkg"
        fi
    done

    # macOS-specific packages
    if [[ "$OS" == "Darwin" ]]; then
        local macos_packages=("sketchybar" "aerospace")
        for pkg in "${macos_packages[@]}"; do
            if [[ -d "$SCRIPT_DIR/$pkg" ]]; then
                log_dry_run "  stow $pkg (macOS)"
                if [[ "$DRY_RUN" == "0" ]]; then
                    log_info "Stowing $pkg..."
                    stow -v "$pkg" 2>&1 | tee -a "$LOG_FILE"
                fi
            fi
        done

        # Install Homebrew packages from Brewfile
        if [[ -f "$SCRIPT_DIR/Brewfile" ]]; then
            log_dry_run "  brew bundle (from Brewfile)"
            if [[ "$DRY_RUN" == "0" ]]; then
                log_info "Installing packages from Brewfile..."
                brew bundle || log_warn "Brew bundle installation had issues"
            fi
        fi
    fi

    # Linux-specific packages
    if [[ "$OS" == "Linux" && -d "$SCRIPT_DIR/i3" ]]; then
        log_dry_run "  stow i3 (Linux)"
        if [[ "$DRY_RUN" == "0" ]]; then
            log_info "Stowing i3..."
            stow -v i3 2>&1 | tee -a "$LOG_FILE"
        fi
    fi
}

#=============================================================================
# SHELL COLOR SCRIPTS
#=============================================================================
install_shell_color_scripts() {
    local colorscript_install_dir=""

    # Detect colorscript location based on OS
    if [[ "$OS" == "Darwin" ]]; then
        colorscript_install_dir="/usr/local/bin"
    else
        colorscript_install_dir="/usr/bin"
    fi

    local colorscript_path="$colorscript_install_dir/colorscript"

    if [[ -x "$colorscript_path" ]]; then
        log_success "shell-color-scripts already installed"
        return 0
    fi

    log_dry_run "Would install shell-color-scripts to $colorscript_install_dir"

    if [[ "$DRY_RUN" == "1" ]]; then
        return 0
    fi

    log_info "Installing shell-color-scripts..."

    # Check for sudo access on Linux
    if [[ "$OS" == "Linux" ]] && ! sudo -n true 2>/dev/null; then
        log_warn "sudo access required for colorscript installation"
        log_info "You may be prompted for your password"
    fi

    mkdir -p ~/.local/src
    cd ~/.local/src

    if [[ -d shell-color-scripts ]]; then
        log_info "Removing existing shell-color-scripts directory..."
        rm -rf shell-color-scripts
    fi

    git clone https://gitlab.com/dwt1/shell-color-scripts.git
    cd shell-color-scripts

    if [[ "$OS" == "Linux" ]]; then
        sudo make install 2>&1 | tee -a "$LOG_FILE"
        if [[ -d /usr/share/zsh/site-functions ]]; then
            sudo cp completions/_colorscript /usr/share/zsh/site-functions 2>/dev/null || true
        fi
    else
        make install 2>&1 | tee -a "$LOG_FILE"
        mkdir -p ~/.zsh/completion 2>/dev/null || true
        cp completions/_colorscript ~/.zsh/completion/ 2>/dev/null || true
    fi

    cd "$ORIGINAL_DIR"
}

#=============================================================================
# SUMMARY
#=============================================================================
show_summary() {
    show_status_header "Summary"

    echo ""
    if [[ "$DRY_RUN" == "1" ]]; then
        echo "  📋 DRY RUN MODE - No changes were made"
        echo ""
        echo "  To apply these changes, run:"
        echo "    ./install.sh"
    else
        echo "  ✅ Installation complete!"
    fi
    echo ""
    echo "  Log saved to: $LOG_FILE"
    echo ""
    echo "  Next steps:"
    echo "    - Restart your shell or run: source ~/.zshrc"
    if [[ "$OS" == "Darwin" ]]; then
        echo "    - Start SketchyBar: brew services restart sketchybar"
    fi
    echo "    - Run: colorscript to see available color scripts"
}

#=============================================================================
# MAIN INSTALLATION FLOW
#=============================================================================
main() {
    echo "=========================================="
    echo "  Dotfiles Installation"
    echo "=========================================="
    if [[ "$DRY_RUN" == "1" ]]; then
        echo "  📋 DRY RUN MODE"
    fi
    echo "  Log file: $LOG_FILE"
    echo ""

    # Detect OS
    detect_os

    # Show current status
    show_package_manager_status
    show_required_tools_status
    show_dotfiles_status

    if [[ "$DRY_RUN" == "1" ]]; then
        echo ""
        log_info "Dry run mode - showing what would be installed:"
    fi

    # Setup package manager
    setup_homebrew

    # Setup GNU Stow
    setup_stow

    # Install dotfiles
    install_packages

    # Install extras
    install_shell_color_scripts

    # Show summary
    show_summary
}

# Run main function
main "$@"

# Restore original directory
cd "$ORIGINAL_DIR"
