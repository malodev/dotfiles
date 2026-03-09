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
# INSTALLATION GROUPS
#=============================================================================
# Define groups and their packages
# Format: "group_name:package1,package2,package3"
declare -A INSTALL_GROUPS=(
    # Core (always installed - dependencies)
    ["core"]="stow"

    # Shell & Terminal (bare minimum)
    ["shell"]="bash zsh starship nushell"

    # Editor configurations
    ["editor"]="nvim-malo nvim-lazy nvim-test nvim-php nvim-astro"

    # Terminal tools
    ["terminal"]="kitty tmux"

    # Desktop environment (macOS only)
    ["desktop"]="sketchybar aerospace borders"

    # Window manager (Linux only)
    ["linux"]="i3"

    # Development tools
    ["dev"]="git bat lazygit"

    # Extras
    ["extras"]="shell-color-scripts"
)

# Group descriptions for display
declare -A GROUP_DESC=(
    ["core"]="Core dependencies (GNU Stow)"
    ["shell"]="Shell configurations (Bash, Zsh, Starship, Nushell)"
    ["editor"]="Neovim configurations (malo, lazy, test, php, astro)"
    ["terminal"]="Terminal tools (Kitty, Tmux)"
    ["desktop"]="Desktop environment (SketchyBar, AeroSpace, Borders)"
    ["linux"]="Linux window manager (i3)"
    ["dev"]="Development tools (Git, Lazygit, Delta, Bat, LLM)"
    ["extras"]="Extra utilities (Shell color scripts)"
)

# Installation order (groups with dependencies first)
INSTALL_ORDER=("core" "shell" "editor" "terminal" "desktop" "linux" "dev" "extras")

# Neovim configurations
declare -A NVIM_CONFIGS=(
    ["malo"]="nvim-malo (main - LazyVim based)"
    ["lazy"]="nvim-lazy (pure LazyVim)"
    ["test"]="nvim-test (experimental)"
    ["php"]="nvim-php (PHP development)"
    ["astro"]="nvim-astro (AstroNvim based)"
)

# Default selections by OS
declare -A DEFAULT_GROUPS
if [[ "$(uname)" == "Darwin" ]]; then
    DEFAULT_GROUPS=(
        ["core"]=1
        ["shell"]=1
        ["editor"]=1
        ["terminal"]=1
        ["desktop"]=1
        ["linux"]=0
        ["dev"]=1
        ["extras"]=0
    )
else
    DEFAULT_GROUPS=(
        ["core"]=1
        ["shell"]=1
        ["editor"]=1
        ["terminal"]=1
        ["desktop"]=0
        ["linux"]=0
        ["dev"]=1
        ["extras"]=1
    )
fi

# Selected groups (associative array with selected state)
declare -A SELECTED_GROUPS

# Safe accessor for associative arrays
get_group_selection() {
    local group="$1"
    local default="${2:-0}"
    # Check if key exists, return default if not
    if [[ -v "SELECTED_GROUPS[$group]" ]]; then
        echo "${SELECTED_GROUPS[$group]}"
    else
        echo "$default"
    fi
}

has_group() {
    local group="$1"
    [[ -v "INSTALL_GROUPS[$group]" ]]
}
#=============================================================================
# UI HELPERS
#=============================================================================
show_header() {
    clear
    echo "=========================================="
    echo "  Dotfiles Installation"
    echo "=========================================="
    echo ""
}

show_banner() {
    echo ""
    echo "=========================================="
    echo "  $1"
    echo "=========================================="
    echo ""
}

# Checkbox menu function
# Usage: checkbox_menu "Prompt" "option1|desc1" "option2|desc2" ...
# Returns: array of selected options
checkbox_menu() {
    local prompt="$1"
    shift
    local -a options=("$@")
    local -a selections
    local -a checked

    # Check if stdin is a terminal
    if [[ ! -t 0 ]]; then
        echo "Error: stdin is not a terminal. Cannot show interactive menu." >&2
        echo "Use --minimal, --standard, --full, or specify groups manually." >&2
        echo "Example: $0 --minimal" >&2
        return 1
    fi

    # Initialize checked state from default selections
    for i in "${!options[@]}"; do
        local opt="${options[$i]%%|*}"
        if [[ "$(get_group_selection "$opt")" == "1" ]]; then
            checked[$i]=1
        else
            checked[$i]=0
        fi
    done

    # Show menu (using simple numbered list)
    # ALL display goes to stderr so it's visible (stdout is captured by caller)
    local done=0

    while [[ $done -eq 0 ]]; do
        # Clear screen and show menu
        clear >&2
        echo "==========================================" >&2
        echo "  Dotfiles Installation - Select Groups" >&2
        echo "==========================================" >&2
        echo "" >&2
        echo "$prompt" >&2
        echo "" >&2
        echo "Groups marked with [*] are currently selected." >&2
        echo "" >&2
        echo "Commands:" >&2
        echo "  - Type numbers separated by spaces to toggle selection" >&2
        echo "  - Example: '1 3 5' toggles items 1, 3, and 5" >&2
        echo "  - Type 'a' to select all" >&2
        echo "  - Type 'n' to select none" >&2
        echo "  - Type 'd' to show defaults for your OS" >&2
        echo "  - Press Enter when done to confirm selection" >&2
        echo "  - Type 'q' to cancel" >&2
        echo "" >&2

        for i in "${!options[@]}"; do
            local opt="${options[$i]%%|*}"
            local desc="${options[$i]#*|}"

            if [[ ${checked[$i]} -eq 1 ]]; then
                printf "  [%2d] [*] %s\n" "$((i+1))" "$desc" >&2
            else
                printf "  [%2d] [ ] %s\n" "$((i+1))" "$desc" >&2
            fi
        done

        echo "" >&2
        echo -n "Your choice (or Enter when done): " >&2

        local input
        read -r input <&0

        # Handle cancel
        if [[ "$input" == "q" ]] || [[ "$input" == "Q" ]]; then
            return 1
        fi

        # Handle done (empty input)
        if [[ -z "$input" ]]; then
            done=1
            continue
        fi

        # Handle "select all"
        if [[ "$input" == "a" ]] || [[ "$input" == "A" ]]; then
            for i in "${!options[@]}"; do
                checked[$i]=1
            done
            continue
        fi

        # Handle "select none"
        if [[ "$input" == "n" ]] || [[ "$input" == "N" ]]; then
            for i in "${!options[@]}"; do
                checked[$i]=0
            done
            continue
        fi

        # Handle "show defaults"
        if [[ "$input" == "d" ]] || [[ "$input" == "D" ]]; then
            for i in "${!options[@]}"; do
                local opt="${options[$i]%%|*}"
                if [[ "$(get_group_selection "$opt")" == "1" ]]; then
                    checked[$i]=1
                else
                    checked[$i]=0
                fi
            done
            continue
        fi

        # Parse input and toggle selections
        for num in $input; do
            if [[ "$num" =~ ^[0-9]+$ ]]; then
                local idx=$((num - 1))
                if [[ $idx -ge 0 ]] && [[ $idx -lt ${#options[@]} ]]; then
                    if [[ ${checked[$idx]} -eq 1 ]]; then
                        checked[$idx]=0
                    else
                        checked[$idx]=1
                    fi
                fi
            fi
        done
    done

    # Collect selections - THIS GOES TO STDOUT (captured by caller)
    for i in "${!checked[@]}"; do
        if [[ ${checked[$i]} -eq 1 ]]; then
            selections+=("${options[$i]%%|*}")
        fi
    done

    printf '%s\n' "${selections[@]}"
    return 0
}

#=============================================================================
# NEONVIM CONFIG SELECTION
#=============================================================================
select_nvim_config() {
    # In non-interactive mode, default to nvim-malo immediately
    # Do this BEFORE any array operations (set -e will exit on array errors)
    if [[ "$INTERACTIVE" == "0" ]] || [[ ! -t 0 ]]; then
        [[ "$INTERACTIVE" == "0" ]] && log_info "Defaulting to nvim-malo"

        local selected_key="malo"
        local selected_pkg="nvim-$selected_key"
        local config_dir="../dotfiles/$selected_pkg/.config/nvim-$selected_key"
        local nvim_config="$HOME/.config/nvim"

        if [[ -d "$SCRIPT_DIR/$config_dir" ]]; then
            if [[ "$DRY_RUN" == "0" ]]; then
                # Backup existing nvim config if it's not a symlink
                if [[ -e "$nvim_config" && ! -L "$nvim_config" ]]; then
                    mv "$nvim_config" "${nvim_config}.backup.$(date +%Y%m%d)"
                    log_info "Backed up existing nvim config"
                fi
                # Create relative symlink (compatible with stow)
                ln -sf "$config_dir" "$nvim_config"
                log_success "Default Neovim set to: $selected_pkg"
            else
                log_dry_run "Would set default Neovim to: $selected_pkg"
            fi
        else
            log_warn "Configuration directory not found: $SCRIPT_DIR/$config_dir"
        fi
        return 0
    fi

    # Interactive mode - show selection menu
    show_banner "Select Default Neovim Configuration"

    echo "Choose which Neovim configuration to use as default:"
    echo ""
    local opts=()
    local default_idx=0
    local idx=0

    # Build options list - hardcode keys to avoid array expansion issues
    for key in "malo" "lazy" "test" "php" "astro"; do
        local desc="${NVIM_CONFIGS[$key]:-nvim-$key}"
        opts+=("$key|$desc")
        if [[ "$key" == "malo" ]]; then
            default_idx=$idx
        fi
        ((idx++))
    done

    # Simple numeric selection
    for i in "${!opts[@]}"; do
        local desc="${opts[$i]#*|}"
        echo "  $((i+1))) $desc"
    done
    echo ""

    local choice
    read -p "Enter choice [1-${#opts[@]}] [default: 1]: " choice

    # Default to 1 (malo) if empty
    choice=${choice:-1}

    if [[ "$choice" =~ ^[0-9]+$ ]] && [[ $choice -ge 1 ]] && [[ $choice -le ${#opts[@]} ]]; then
        local selected_key="${opts[$((choice-1))]%%|*}"
        local selected_pkg="nvim-$selected_key"
        local config_dir="$selected_pkg/.config/nvim-$selected_key"

        if [[ -d "$SCRIPT_DIR/$config_dir" ]]; then
            local nvim_config="$HOME/.config/nvim"
            log_info "Setting $selected_pkg as default Neovim configuration..."

            if [[ "$DRY_RUN" == "0" ]]; then
                # Backup existing nvim config if it's not a symlink
                if [[ -e "$nvim_config" && ! -L "$nvim_config" ]]; then
                    mv "$nvim_config" "${nvim_config}.backup.$(date +%Y%m%d)"
                    log_info "Backed up existing nvim config to ${nvim_config}.backup.$(date +%Y%m%d)"
                fi

                # Create relative symlink (compatible with stow)
                ln -sf "$config_dir" "$nvim_config"
                log_success "Default Neovim set to: $selected_pkg"
            else
                log_dry_run "Would set default Neovim to: $selected_pkg"
            fi
        else
            log_warn "Configuration directory not found: $SCRIPT_DIR/$config_dir"
        fi
    else
        log_warn "Invalid choice, skipping Neovim configuration"
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
            ;;
        Linux)
            if [[ -f /etc/arch-release ]]; then
                DISTRO="arch"
            elif [[ -f /etc/debian_version ]]; then
                DISTRO="debian"
            elif [[ -f /etc/fedora-release ]]; then
                DISTRO="fedora"
            else
                DISTRO="unknown"
            fi
            ;;
        *)
            log_error "Unsupported OS: $OS"
            exit 1
            ;;
    esac
}

#=============================================================================
# INSTALLATION FUNCTIONS
#=============================================================================
install_group() {
    local group="$1"
    local packages=(${INSTALL_GROUPS[$group]})

    if [[ -z "${packages[*]}" ]]; then
        return
    fi

    show_banner "Installing: $group"

    # Detect current shell for shell group (only if not manually overridden)
    local current_shell=""
    local install_specific_shells=0

    if [[ "$group" == "shell" ]]; then
        current_shell=$(basename "$SHELL")

        # Check if specific shells were manually requested
        if [[ -n "${MANUAL_SHELL_PACKAGES:-}" ]]; then
            install_specific_shells=1
            log_info "Installing manually specified shell configs: $MANUAL_SHELL_PACKAGES"
        else
            log_info "Current shell: $current_shell - only stowing $current_shell config"
        fi
    fi

    for pkg in "${packages[@]}"; do
        if [[ "$group" == "editor" && "$pkg" =~ ^nvim- ]]; then
            # Skip nvim configs in main loop - handled separately
            continue
        fi

        # For shell group, handle shell config filtering
        if [[ "$group" == "shell" ]]; then
            if [[ $install_specific_shells -eq 1 ]]; then
                # Specific shells were manually requested
                # Check if this package is in the manual list
                local should_install=0
                for manual_shell in $MANUAL_SHELL_PACKAGES; do
                    if [[ "$pkg" == "$manual_shell" ]]; then
                        should_install=1
                        break
                    fi
                done

                # Skip shell configs not in the manual list
                if [[ $should_install -eq 0 ]] && [[ "$pkg" =~ ^(bash|zsh|nushell|fish)$ ]]; then
                    log_dry_run "  Skipping $pkg (not in manual selection)"
                    continue
                fi
            else
                # No manual selection - only install current shell
                if [[ "$pkg" == "$current_shell" ]]; then
                    # Match: install this shell config
                    :
                elif [[ "$pkg" =~ ^(bash|zsh|nushell|fish)$ ]]; then
                    # This is a shell config, but not the current one - skip it
                    log_dry_run "  Skipping $pkg (not current shell, use './install.sh $pkg' to install)"
                    continue
                fi
            fi
            # starship and other non-shell packages get installed normally
        fi

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
}

install_nvim_configs() {
    show_banner "Installing: Neovim Configurations"

    # Install all selected nvim configs
    for pkg in ${INSTALL_GROUPS[editor]}; do
        if [[ "$pkg" =~ ^nvim- ]] && [[ -d "$SCRIPT_DIR/$pkg" ]]; then
            if [[ "$(get_group_selection "$pkg" "1")" == "1" ]]; then
                log_dry_run "  stow $pkg"
                if [[ "$DRY_RUN" == "0" ]]; then
                    log_info "Stowing $pkg..."
                    stow -v "$pkg" 2>&1 | tee -a "$LOG_FILE"
                fi
            fi
        fi
    done
}

install_neovim_binary() {
    if [[ "$(get_group_selection "editor")" != "1" ]]; then
        return
    fi

    # macOS: installed via Brewfile
    if [[ "$OS" == "Darwin" ]]; then
        return 0
    fi

    if command_exists nvim; then
        log_success "Neovim already installed: $(nvim --version | head -1)"
        return 0
    fi

    log_dry_run "Would install latest Neovim binary from GitHub releases"
    if [[ "$DRY_RUN" == "1" ]]; then
        return 0
    fi

    log_info "Installing latest Neovim from GitHub releases..."

    local sudo_prefix=""
    if [[ $EUID -ne 0 ]]; then
        sudo_prefix="sudo"
    fi

    curl -Lo /tmp/nvim.tar.gz \
        "https://github.com/neovim/neovim/releases/latest/download/nvim-linux-x86_64.tar.gz" \
        2>/dev/null \
        && $sudo_prefix tar -xzf /tmp/nvim.tar.gz -C /usr/local --strip-components=1 \
        && rm -f /tmp/nvim.tar.gz \
        || log_warn "Neovim installation failed, install manually from https://github.com/neovim/neovim/releases"

    if command_exists nvim; then
        log_success "Neovim installed: $(nvim --version | head -1)"
    fi
}

install_homebrew_packages() {
    if [[ "$OS" == "Darwin" ]] && [[ -f "$SCRIPT_DIR/Brewfile" ]]; then
        show_banner "Installing Homebrew Packages"
        log_dry_run "  brew bundle (from Brewfile)"
        if [[ "$DRY_RUN" == "0" ]]; then
            log_info "Installing packages from Brewfile..."
            brew bundle || log_warn "Brew bundle installation had issues"
        fi
    fi
}

#=============================================================================
# LINUX PACKAGE INSTALLATION (when not using Homebrew)
#=============================================================================
# These functions install system packages on Linux using the native package
# manager. On macOS (or Linux with --with-brew), the Brewfile handles these.

# Helper: install packages only on Linux without Homebrew
# Skips if on macOS, or if --with-brew was passed (Brewfile handles it)
_linux_pkg_install() {
    local description="$1"
    shift
    local packages=("$@")

    # Skip on macOS (Brewfile handles it)
    if [[ "$OS" == "Darwin" ]]; then
        return 0
    fi

    # Skip on Linux if using Homebrew (Brewfile handles it)
    if [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    # Filter out already-installed packages
    local to_install=()
    for pkg in "${packages[@]}"; do
        # Map package name to command name for common mismatches
        local cmd="$pkg"
        case "$pkg" in
            golang-go|golang) cmd="go" ;;
            python3-pip) cmd="pip3" ;;
            python-pip) cmd="pip" ;;
            base-devel|build-essential) cmd="make" ;;
            nodejs|node) cmd="node" ;;
        esac
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

# Install core CLI tools on Linux (part of base installation)
install_cli_tools() {
    if [[ "$OS" == "Darwin" ]] || [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    show_banner "Installing CLI Tools (Linux)"

    # Package names vary by distro
    case "$DISTRO" in
        arch)
            _linux_pkg_install "CLI tools" \
                fzf ripgrep lsd bat fd gdu bottom procs jq \
                curl wget w3m lynx imagemagick p7zip poppler \
                ffmpeg ffmpegthumbnailer unzip
            # yazi is in community/AUR
            if ! command_exists yazi; then
                if command_exists yay; then
                    yay -S --noconfirm yazi || log_warn "yazi installation failed"
                elif command_exists paru; then
                    paru -S --noconfirm yazi || log_warn "yazi installation failed"
                else
                    log_warn "yazi requires an AUR helper (yay/paru) or manual installation"
                fi
            fi
            # viu for image preview
            if ! command_exists viu; then
                if command_exists yay; then
                    yay -S --noconfirm viu || log_warn "viu installation failed"
                elif command_exists paru; then
                    paru -S --noconfirm viu || log_warn "viu installation failed"
                else
                    log_warn "viu requires an AUR helper (yay/paru) or manual installation"
                fi
            fi
            ;;
        debian)
            _linux_pkg_install "CLI tools" \
                fzf ripgrep bat fd-find jq \
                curl wget w3m lynx imagemagick p7zip-full poppler-utils \
                ffmpeg unzip
            # lsd, yazi, bottom, gdu, procs, viu are not in default Debian repos
            for tool in lsd yazi bottom gdu procs viu ffmpegthumbnailer; do
                if ! command_exists "$tool"; then
                    log_warn "$tool is not in default Debian/Ubuntu repos — install manually or use --with-brew"
                fi
            done
            ;;
        fedora)
            _linux_pkg_install "CLI tools" \
                fzf ripgrep bat fd-find lsd jq \
                curl wget w3m lynx ImageMagick p7zip poppler-utils \
                ffmpeg ffmpegthumbnailer unzip
            for tool in yazi bottom gdu procs viu; do
                if ! command_exists "$tool"; then
                    log_warn "$tool may not be in Fedora repos — install manually or use --with-brew"
                fi
            done
            ;;
        *)
            log_warn "CLI tools installation not configured for $DISTRO"
            ;;
    esac
}

# Install shell/terminal tools on Linux
install_shell_tools() {
    if [[ "$OS" == "Darwin" ]] || [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    # Install shell tools if shell group is selected
    if [[ "$(get_group_selection "shell")" == "1" ]]; then
        case "$DISTRO" in
            arch)
                _linux_pkg_install "Shell tools" zsh
                # carapace is in AUR
                if ! command_exists carapace; then
                    if command_exists yay; then
                        yay -S --noconfirm carapace-bin || log_warn "carapace installation failed"
                    elif command_exists paru; then
                        paru -S --noconfirm carapace-bin || log_warn "carapace installation failed"
                    else
                        log_warn "carapace requires an AUR helper (yay/paru) or manual installation"
                    fi
                fi
                ;;
            debian)
                _linux_pkg_install "Shell tools" zsh
                if ! command_exists carapace; then
                    log_warn "carapace is not in Debian/Ubuntu repos — install manually or use --with-brew"
                fi
                ;;
            fedora)
                _linux_pkg_install "Shell tools" zsh
                if ! command_exists carapace; then
                    log_warn "carapace is not in Fedora repos — install manually or use --with-brew"
                fi
                ;;
        esac
    fi

    # Install terminal tools if terminal group is selected
    if [[ "$(get_group_selection "terminal")" == "1" ]]; then
        _linux_pkg_install "Terminal tools" tmux
        # kitty
        if ! command_exists kitty; then
            case "$DISTRO" in
                arch) _linux_pkg_install "Kitty" kitty ;;
                debian) _linux_pkg_install "Kitty" kitty-terminfo kitty ;;
                fedora) _linux_pkg_install "Kitty" kitty ;;
            esac
        fi
    fi
}

# Install editor (Neovim) and its dependencies on Linux
install_editor_tools() {
    if [[ "$(get_group_selection "editor")" != "1" ]]; then
        return 0
    fi

    if [[ "$OS" == "Darwin" ]] || [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    show_banner "Installing Editor Dependencies (Linux)"

    # Neovim itself
    case "$DISTRO" in
        arch)
            _linux_pkg_install "Neovim" neovim
            # Build tools for Treesitter and telescope-fzf-native
            _linux_pkg_install "Build tools" base-devel cmake
            # Neovim plugin dependencies
            _linux_pkg_install "Neovim dependencies" \
                nodejs npm yarn luarocks python-pynvim
            ;;
        debian)
            # Neovim in Debian/Ubuntu repos is often outdated
            if ! command_exists nvim; then
                # Try apt first (Ubuntu 24.04+ has 0.9+)
                if [[ "$DRY_RUN" == "1" ]]; then
                    log_dry_run "Would install neovim (via apt or AppImage)"
                else
                    log_info "Installing Neovim..."
                    local sudo_prefix=""
                    if [[ $EUID -ne 0 ]]; then
                        sudo_prefix="sudo"
                    fi
                    # Try apt, but warn if version is too old
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
            _linux_pkg_install "Neovim dependencies" \
                nodejs npm luarocks python3-pynvim
            if ! command_exists yarn; then
                log_info "Installing yarn via npm..."
                if [[ "$DRY_RUN" == "0" ]]; then
                    npm install -g yarn 2>/dev/null || log_warn "yarn installation via npm failed"
                fi
            fi
            ;;
        fedora)
            _linux_pkg_install "Neovim" neovim
            _linux_pkg_install "Build tools" gcc gcc-c++ make cmake
            _linux_pkg_install "Neovim dependencies" \
                nodejs npm luarocks python3-pynvim
            if ! command_exists yarn; then
                log_info "Installing yarn via npm..."
                if [[ "$DRY_RUN" == "0" ]]; then
                    npm install -g yarn 2>/dev/null || log_warn "yarn installation via npm failed"
                fi
            fi
            ;;
        *)
            log_warn "Editor dependencies installation not configured for $DISTRO"
            ;;
    esac

    # tree-sitter-cli (used by nvim-treesitter)
    if ! command_exists tree-sitter; then
        log_info "Installing tree-sitter-cli via npm..."
        if [[ "$DRY_RUN" == "0" ]]; then
            npm install -g tree-sitter-cli 2>/dev/null || log_warn "tree-sitter-cli installation failed"
        else
            log_dry_run "Would install tree-sitter-cli via npm"
        fi
    fi
}

#=============================================================================
# DEVELOPER TOOLS (for Mason.nvim LSP servers)
#=============================================================================
install_dev_tools() {
    if [[ "$(get_group_selection "dev")" != "1" ]]; then
        return
    fi

    show_banner "Installing Developer Tools"

    # Use sudo prefix for non-root users
    local sudo_prefix=""
    if [[ $EUID -ne 0 ]]; then
        sudo_prefix="sudo"
    fi

    if [[ "$OS" == "Darwin" ]]; then
        # On macOS, these are installed via Brewfile
        log_info "Developer tools installed via Brewfile"
        return 0
    fi

    # Skip if using Homebrew on Linux (Brewfile handles it)
    if [[ "${WITH_BREW:-0}" == "1" ]]; then
        log_info "Developer tools will be installed via Brewfile"
        return 0
    fi

    log_info "Installing developer tools for Linux..."

    # Use sudo prefix for non-root users
    local sudo_prefix=""
    if [[ $EUID -ne 0 ]]; then
        sudo_prefix="sudo"
    fi

    # --- Git tools (git, gh, git-delta, lazygit) ---
    case "$DISTRO" in
        arch)
            _linux_pkg_install "Git tools" git github-cli git-delta
            # lazygit is in community/AUR
            if ! command_exists lazygit; then
                if command_exists yay; then
                    yay -S --noconfirm lazygit || log_warn "lazygit installation failed"
                elif command_exists paru; then
                    paru -S --noconfirm lazygit || log_warn "lazygit installation failed"
                else
                    log_warn "lazygit requires an AUR helper (yay/paru) or manual installation"
                fi
            fi
            ;;
        debian)
            _linux_pkg_install "Git tools" git
            # gh CLI
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
            # git-delta
            if ! command_exists delta; then
                log_info "Installing git-delta from GitHub releases..."
                if [[ "$DRY_RUN" == "0" ]]; then
                    local delta_version="0.18.2"
                    local delta_arch="amd64"
                    curl -fL "https://github.com/dandavison/delta/releases/download/${delta_version}/git-delta_${delta_version}_${delta_arch}.deb" \
                        -o /tmp/git-delta.deb 2>/dev/null \
                        && $sudo_prefix dpkg -i /tmp/git-delta.deb && rm -f /tmp/git-delta.deb \
                        || log_warn "git-delta installation failed"
                else
                    log_dry_run "Would install git-delta from GitHub releases"
                fi
            fi
            # lazygit
            if ! command_exists lazygit; then
                log_info "Installing lazygit from GitHub releases..."
                if [[ "$DRY_RUN" == "0" ]]; then
                    local lazygit_version
                    lazygit_version=$(curl -s "https://api.github.com/repos/jesseduffield/lazygit/releases/latest" | grep -Po '"tag_name": "v\K[^"]*' 2>/dev/null || echo "0.44.1")
                    curl -fL "https://github.com/jesseduffield/lazygit/releases/latest/download/lazygit_${lazygit_version}_Linux_x86_64.tar.gz" \
                        -o /tmp/lazygit.tar.gz 2>/dev/null \
                        && tar -xzf /tmp/lazygit.tar.gz -C /tmp lazygit \
                        && $sudo_prefix install /tmp/lazygit /usr/local/bin/lazygit && rm -f /tmp/lazygit /tmp/lazygit.tar.gz \
                        || log_warn "lazygit installation failed"
                else
                    log_dry_run "Would install lazygit from GitHub releases"
                fi
            fi
            ;;
        fedora)
            _linux_pkg_install "Git tools" git gh git-delta
            # lazygit via copr
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

    # --- Deno ---
    if ! command_exists deno; then
        log_info "Installing Deno..."
        if [[ "$DRY_RUN" == "0" ]]; then
            curl -fsSL https://deno.land/install.sh | sh || log_warn "Deno installation failed"
        else
            log_dry_run "Would install Deno via official installer"
        fi
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
        log_dry_run "  Would install: go, python3-pip, composer, unzip, lazygit, delta, bat, llm"
        return 0
    fi

    case "$DISTRO" in
            arch)
                # Install latest git
                if command_exists yay; then
                    yay -S --noconfirm git
                elif command_exists paru; then
                    paru -S --noconfirm git
                else
                    $sudo_prefix pacman -S --noconfirm git
                fi

                # Install go
                if ! command_exists go; then
                    if command_exists yay; then
                        yay -S --noconfirm go
                    elif command_exists paru; then
                        paru -S --noconfirm go
                    else
                        $sudo_prefix pacman -S --noconfirm go
                    fi
                fi



                # Install hub (GitHub CLI tool)
                if ! command_exists hub; then
                    if command_exists yay; then
                        yay -S --noconfirm hub
                    elif command_exists paru; then
                        paru -S --noconfirm hub
                    else
                        log_warn "hub not in official repos, install from AUR or https://github.com/mislav/hub"
                    fi
                fi

                # Install lazygit
                if ! command_exists lazygit; then
                    log_info "Installing lazygit..."
                    if command_exists yay; then
                        yay -S --noconfirm lazygit
                    elif command_exists paru; then
                        paru -S --noconfirm lazygit
                    else
                        $sudo_prefix pacman -S --noconfirm lazygit
                    fi
                fi

                # Install delta (git diff pager)
                if ! command_exists delta; then
                    log_info "Installing delta..."
                    if command_exists yay; then
                        yay -S --noconfirm git-delta
                    elif command_exists paru; then
                        paru -S --noconfirm git-delta
                    else
                        $sudo_prefix pacman -S --noconfirm git-delta
                    fi
                fi

                # Install bat (latest from GitHub to match delta's bundled version)
                if ! command_exists bat; then
                    log_info "Installing bat from GitHub releases..."
                    local bat_version
                    bat_version=$(curl -s "https://api.github.com/repos/sharkdp/bat/releases/latest" \
                        | grep -Po '"tag_name": "v\K[^"]*' 2>/dev/null || echo "0.24.0")
                    curl -Lo /tmp/bat.tar.gz \
                        "https://github.com/sharkdp/bat/releases/latest/download/bat-v${bat_version}-x86_64-unknown-linux-musl.tar.gz" \
                        2>/dev/null \
                        && tar -xzf /tmp/bat.tar.gz -C /tmp \
                        && $sudo_prefix install /tmp/bat-v${bat_version}-x86_64-unknown-linux-musl/bat /usr/local/bin/bat \
                        && rm -rf /tmp/bat* \
                        || log_warn "bat installation failed, install manually from https://github.com/sharkdp/bat"
                fi

                # Install llm CLI
                if ! command_exists llm; then
                    log_info "Installing llm CLI..."
                    if ! command_exists pipx; then
                        $sudo_prefix pacman -S --noconfirm python-pipx
                    fi
                    pipx install llm || log_warn "llm installation failed, install manually: pipx install llm"
                fi
                ;;

            debian)
                # Install latest git via git-core PPA
                if command_exists add-apt-repository; then
                    $sudo_prefix add-apt-repository -y ppa:git-core/ppa 2>/dev/null || true
                fi
                $sudo_prefix apt-get update -qq
                $sudo_prefix apt-get install -y git

                # Install latest Go from golang.org (apt ships outdated versions)
                log_info "Installing latest Go..."
                local go_version
                go_version=$(curl -s "https://go.dev/dl/?mode=json" \
                    | grep -Po '"version": "go\K[^"]*' | head -1 2>/dev/null || echo "1.26.0")
                curl -Lo /tmp/go.tar.gz "https://go.dev/dl/go${go_version}.linux-amd64.tar.gz" 2>/dev/null \
                    && $sudo_prefix rm -rf /usr/local/go \
                    && $sudo_prefix tar -C /usr/local -xzf /tmp/go.tar.gz \
                    && $sudo_prefix ln -sf /usr/local/go/bin/go /usr/local/bin/go \
                    && $sudo_prefix ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt \
                    && rm -f /tmp/go.tar.gz \
                    || log_warn "Go installation failed, install manually from https://go.dev/dl"

                # Install latest Node.js LTS via NodeSource
                if ! command_exists node; then
                    log_info "Installing Node.js LTS..."
                    curl -fsSL https://deb.nodesource.com/setup_lts.x | $sudo_prefix bash - 2>/dev/null \
                        && $sudo_prefix apt-get install -y nodejs \
                        || log_warn "Node.js installation failed, install manually from https://nodejs.org"
                fi

                # Install composer for PHP (only if PHP is installed)
                if command_exists php; then
                    if ! command_exists composer; then
                        # Download composer installer
                        curl -sS https://getcomposer.org/installer | php
                        if [[ -f composer.phar ]]; then
                            $sudo_prefix mv composer.phar /usr/local/bin/composer
                        fi
                    fi
                fi

            # Python pip packages
            if ! command_exists pip3; then
                _linux_pkg_install "Python pip" python3-pip
            fi
            if command_exists pip3; then
                log_info "Installing Python packages: basedpyright, black, isort..."
                if [[ "$DRY_RUN" == "0" ]]; then
                    pip3 install --user basedpyright black isort 2>/dev/null || log_warn "Some Python packages failed to install"
                fi
            fi

            # Python venv
            if ! python3 -m venv --help >/dev/null 2>&1; then
                log_info "Python venv module not found, installing..."
                if [[ "$DRY_RUN" == "0" ]]; then
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
                fi
            else
                log_success "Python venv module is available"
            fi

            # Hub
            if ! command_exists hub; then
                log_info "Installing hub from GitHub releases..."
                if [[ "$DRY_RUN" == "0" ]]; then
                    local hub_arch="amd64"
                    local hub_version="2.14.2"
                    curl -L "https://github.com/mislav/hub/releases/download/v${hub_version}/hub-linux-${hub_arch}-${hub_version}.tgz" \
                        -o /tmp/hub.tgz 2>/dev/null \
                        && tar -xzf /tmp/hub.tgz -C /tmp \
                        && $sudo_prefix /tmp/hub-linux-${hub_arch}-${hub_version}/install && rm -rf /tmp/hub* \
                        || log_warn "hub installation failed, install manually from https://github.com/mislav/hub"
                fi
            fi

            # Install lazygit - download from GitHub releases
            if ! command_exists lazygit; then
                    log_info "Installing lazygit from GitHub releases..."
                    local lazygit_version
                    lazygit_version=$(curl -s "https://api.github.com/repos/jesseduffield/lazygit/releases/latest" \
                        | grep -Po '"tag_name": "v\K[^"]*' 2>/dev/null || echo "0.44.1")
                    curl -Lo /tmp/lazygit.tar.gz \
                        "https://github.com/jesseduffield/lazygit/releases/latest/download/lazygit_${lazygit_version}_Linux_x86_64.tar.gz" \
                        2>/dev/null \
                        && tar -xzf /tmp/lazygit.tar.gz -C /tmp lazygit \
                        && $sudo_prefix install /tmp/lazygit /usr/local/bin/lazygit \
                        && rm -f /tmp/lazygit /tmp/lazygit.tar.gz \
                        || log_warn "lazygit installation failed, install manually from https://github.com/jesseduffield/lazygit"
                fi

                # Install delta (git diff pager) - download from GitHub releases
                if ! command_exists delta; then
                    log_info "Installing delta from GitHub releases..."
                    local delta_version
                    delta_version=$(curl -s "https://api.github.com/repos/dandavison/delta/releases/latest" \
                        | grep -Po '"tag_name": "\K[^"]*' 2>/dev/null || echo "0.18.2")
                    curl -Lo /tmp/delta.tar.gz \
                        "https://github.com/dandavison/delta/releases/latest/download/delta-${delta_version}-x86_64-unknown-linux-musl.tar.gz" \
                        2>/dev/null \
                        && tar -xzf /tmp/delta.tar.gz -C /tmp --wildcards "*/delta" --strip-components=1 \
                        && $sudo_prefix install /tmp/delta /usr/local/bin/delta \
                        && rm -f /tmp/delta /tmp/delta.tar.gz \
                        || log_warn "delta installation failed, install manually from https://github.com/dandavison/delta"
                fi

                # Install bat (latest from GitHub to match delta's bundled version)
                if ! command_exists bat; then
                    log_info "Installing bat from GitHub releases..."
                    local bat_version
                    bat_version=$(curl -s "https://api.github.com/repos/sharkdp/bat/releases/latest" \
                        | grep -Po '"tag_name": "v\K[^"]*' 2>/dev/null || echo "0.24.0")
                    curl -Lo /tmp/bat.tar.gz \
                        "https://github.com/sharkdp/bat/releases/latest/download/bat-v${bat_version}-x86_64-unknown-linux-musl.tar.gz" \
                        2>/dev/null \
                        && tar -xzf /tmp/bat.tar.gz -C /tmp \
                        && $sudo_prefix install /tmp/bat-v${bat_version}-x86_64-unknown-linux-musl/bat /usr/local/bin/bat \
                        && rm -rf /tmp/bat* \
                        || log_warn "bat installation failed, install manually from https://github.com/sharkdp/bat"
                fi

                # Install llm CLI
                if ! command_exists llm; then
                    log_info "Installing llm CLI..."
                    if ! command_exists pipx; then
                        $sudo_prefix apt-get install -y pipx 2>/dev/null \
                            || $sudo_prefix apt-get install -y python3-pipx 2>/dev/null \
                            || pip3 install --user pipx
                    fi
                    pipx install llm || log_warn "llm installation failed, install manually: pipx install llm"
                fi
                ;;

            fedora)
                # Install latest git
                $sudo_prefix dnf install -y git

                # Install go
                if ! command_exists go; then
                    $sudo_prefix dnf install -y golang
                fi

                # Install composer for PHP (only if PHP is installed)
                if command_exists php; then
                    if ! command_exists composer; then
                        if [[ "$DRY_RUN" == "0" ]]; then
                            $sudo_prefix dnf install -y composer
                        else
                            log_dry_run "Would install composer via dnf"
                        fi
                    fi
                fi

            # Python pip packages
            if ! command_exists pip3; then
                _linux_pkg_install "Python pip" python3-pip
            fi
            if command_exists pip3; then
                log_info "Installing Python packages: basedpyright, black, isort..."
                if [[ "$DRY_RUN" == "0" ]]; then
                    pip3 install --user basedpyright black isort 2>/dev/null || log_warn "Some Python packages failed to install"
                fi
            fi

            # Python venv
            if ! python3 -m venv --help >/dev/null 2>&1; then
                log_info "Python venv module not found, installing..."
                if [[ "$DRY_RUN" == "0" ]]; then
                    $sudo_prefix dnf install -y python3-venv || log_warn "python3-venv not found, may be included in python3 package"
                fi
            else
                log_success "Python venv module is available"
            fi

            # Hub
            if ! command_exists hub; then
                if [[ "$DRY_RUN" == "0" ]]; then
                    $sudo_prefix dnf install -y hub 2>/dev/null || log_warn "hub not in repos, install manually from https://github.com/mislav/hub"
                fi
            fi

            # Install lazygit
            if ! command_exists lazygit; then
                    log_info "Installing lazygit..."
                    $sudo_prefix dnf copr enable -y atim/lazygit 2>/dev/null \
                        && $sudo_prefix dnf install -y lazygit \
                        || log_warn "lazygit installation failed, install manually from https://github.com/jesseduffield/lazygit"
                fi

                # Install delta (git diff pager)
                if ! command_exists delta; then
                    log_info "Installing delta..."
                    $sudo_prefix dnf install -y git-delta 2>/dev/null \
                        || log_warn "delta installation failed, install manually from https://github.com/dandavison/delta"
                fi

                # Install bat (latest from GitHub to match delta's bundled version)
                if ! command_exists bat; then
                    log_info "Installing bat from GitHub releases..."
                    local bat_version
                    bat_version=$(curl -s "https://api.github.com/repos/sharkdp/bat/releases/latest" \
                        | grep -Po '"tag_name": "v\K[^"]*' 2>/dev/null || echo "0.24.0")
                    curl -Lo /tmp/bat.tar.gz \
                        "https://github.com/sharkdp/bat/releases/latest/download/bat-v${bat_version}-x86_64-unknown-linux-musl.tar.gz" \
                        2>/dev/null \
                        && tar -xzf /tmp/bat.tar.gz -C /tmp \
                        && $sudo_prefix install /tmp/bat-v${bat_version}-x86_64-unknown-linux-musl/bat /usr/local/bin/bat \
                        && rm -rf /tmp/bat* \
                        || log_warn "bat installation failed, install manually from https://github.com/sharkdp/bat"
                fi

                # Install llm CLI
                if ! command_exists llm; then
                    log_info "Installing llm CLI..."
                    if ! command_exists pipx; then
                        $sudo_prefix dnf install -y pipx
                    fi
                    pipx install llm || log_warn "llm installation failed, install manually: pipx install llm"
                fi
                ;;

        *)
            log_warn "Developer tools installation not configured for $DISTRO"
            ;;
    esac
}

#=============================================================================
# PRESET MODES
#=============================================================================
apply_preset() {
    local preset="$1"

    case "$preset" in
        minimal)
            # Bare minimum: core + shell
            for group in core shell; do
                SELECTED_GROUPS[$group]=1
            done
            for group in editor terminal desktop linux dev extras; do
                SELECTED_GROUPS[$group]=0
            done
            ;;
        standard)
            # Standard setup: core + shell + editor + terminal
            for group in core shell editor terminal; do
                SELECTED_GROUPS[$group]=1
            done
            for group in desktop linux dev extras; do
                SELECTED_GROUPS[$group]=0
            done
            ;;
        full)
            # Everything
            for group in "${!INSTALL_GROUPS[@]}"; do
                SELECTED_GROUPS[$group]=1
            done
            ;;
    esac

    # Adjust for platform
    if [[ "$OS" != "Darwin" ]]; then
        SELECTED_GROUPS[desktop]=0
    fi
    if [[ "$OS" == "Darwin" ]]; then
        SELECTED_GROUPS[linux]=0
    fi
}

#=============================================================================
# STATUS DISPLAY (from original)
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
# HOMEBREW SETUP (from original)
#=============================================================================
# Homebrew is opt-in on Linux (use --with-brew flag)
# On macOS, it's the standard package manager
setup_homebrew() {
    # On Linux, skip unless --with-brew was specified
    if [[ "$OS" == "Linux" ]] && [[ "${WITH_BREW:-0}" == "0" ]]; then
        log_info "Skipping Homebrew on Linux (use --with-brew to enable)"
        return 0
    fi

    if [[ "$DISTRO" == "arch" ]]; then
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
        if [[ "$DRY_RUN" == "1" ]]; then
            return 0
        fi

        log_info "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

        if [[ "$OS" == "Linux" ]]; then
            eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
        fi
    fi

    log_dry_run "Would update Homebrew..."
    if [[ "$DRY_RUN" == "0" ]]; then
        log_info "Updating Homebrew..."
        brew update || log_warn "Homebrew update failed, continuing..."
        log_info "Upgrading Homebrew packages..."
        brew upgrade || log_warn "Homebrew upgrade failed, continuing..."
    fi
}

#=============================================================================
# GNU STOW SETUP (from original)
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

    # Use sudo prefix for non-root users
    local sudo_prefix=""
    if [[ $EUID -ne 0 ]]; then
        sudo_prefix="sudo"
    fi

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

#=============================================================================
# SHELL COLOR SCRIPTS (from original)
#=============================================================================
install_shell_color_scripts() {
    if [[ "$(get_group_selection "extras")" != "1" ]]; then
        return
    fi

    local colorscript_install_dir=""
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

    # Use sudo prefix for non-root users
    local sudo_prefix=""
    if [[ $EUID -ne 0 ]]; then
        sudo_prefix="sudo"
    fi

    # Ensure build tools are installed on Linux
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

    if [[ "$OS" == "Linux" ]] && [[ $EUID -ne 0 ]] && ! sudo -n true 2>/dev/null; then
        log_warn "sudo access required for colorscript installation"
        log_info "You may be prompted for your password"
    fi

    mkdir -p ~/.local/src
    cd ~/.local/src

    if [[ -d shell-color-scripts ]]; then
        rm -rf shell-color-scripts
    fi

    git clone https://gitlab.com/dwt1/shell-color-scripts.git
    cd shell-color-scripts

    if [[ "$OS" == "Linux" ]]; then
        $sudo_prefix make install 2>&1 | tee -a "$LOG_FILE"
        if [[ -d /usr/share/zsh/site-functions ]]; then
            $sudo_prefix cp completions/_colorscript /usr/share/zsh/site-functions 2>/dev/null || true
        fi
    else
        make install 2>&1 | tee -a "$LOG_FILE"
        mkdir -p ~/.zsh/completion 2>/dev/null || true
        cp completions/_colorscript ~/.zsh/completion/ 2>/dev/null || true
    fi

    cd "$ORIGINAL_DIR"
}

#=============================================================================
# FASTFETCH SETUP
#=============================================================================
install_fastfetch() {
    if [[ "$(get_group_selection "extras")" != "1" ]]; then
        return
    fi

    # Skip if already installed
    if command_exists fastfetch; then
        log_success "fastfetch is already installed"
        return 0
    fi

    # Skip on macOS (will be installed via Brewfile)
    if [[ "$OS" == "Darwin" ]]; then
        return 0
    fi

    # Skip on Linux if using Homebrew (installed via Brewfile)
    if [[ "$OS" == "Linux" ]] && [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    log_dry_run "Would install fastfetch..."

    if [[ "$DRY_RUN" == "1" ]]; then
        return 0
    fi

    log_info "Installing fastfetch..."

    # Use sudo prefix for non-root users
    local sudo_prefix=""
    if [[ $EUID -ne 0 ]]; then
        sudo_prefix="sudo"
    fi

    case "$DISTRO" in
        arch)
            # Install from AUR or prebuilt binary
            if command_exists yay; then
                yay -S --noconfirm fastfetch-git
            elif command_exists paru; then
                paru -S --noconfirm fastfetch-git
            else
                # Download prebuilt binary from GitHub
                log_info "Installing fastfetch from GitHub releases..."
                local fastfetch_dir="$HOME/.local/share/fastfetch"
                mkdir -p "$fastfetch_dir"

                # Follow redirects and check for proper download
                if curl -fL "https://github.com/fastfetch-cli/fastfetch/releases/latest/download/fastfetch-linux-amd64" \
                    -o "$fastfetch_dir/fastfetch" 2>/dev/null; then

                    # Verify the file was downloaded correctly (not a 404 page)
                    if [[ -s "$fastfetch_dir/fastfetch" ]] && ! grep -q "Not Found" "$fastfetch_dir/fastfetch" 2>/dev/null; then
                        chmod +x "$fastfetch_dir/fastfetch"
                        # Add to PATH via symlink
                        mkdir -p /usr/local/bin 2>/dev/null || true
                        $sudo_prefix ln -sf "$fastfetch_dir/fastfetch" /usr/local/bin/fastfetch 2>/dev/null || \
                            ln -sf "$fastfetch_dir/fastfetch" "$HOME/.local/bin/fastfetch" 2>/dev/null
                        log_success "fastfetch installed to $fastfetch_dir/fastfetch"
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
            # Install from prebuilt binary
            log_info "Installing fastfetch from GitHub releases..."
            local fastfetch_dir="$HOME/.local/share/fastfetch"
            mkdir -p "$fastfetch_dir"

            if curl -fL "https://github.com/fastfetch-cli/fastfetch/releases/latest/download/fastfetch-linux-amd64" \
                -o "$fastfetch_dir/fastfetch" 2>/dev/null; then

                # Verify the file was downloaded correctly
                if [[ -s "$fastfetch_dir/fastfetch" ]] && ! grep -q "Not Found" "$fastfetch_dir/fastfetch" 2>/dev/null; then
                    chmod +x "$fastfetch_dir/fastfetch"
                    mkdir -p /usr/local/bin 2>/dev/null || true
                    $sudo_prefix ln -sf "$fastfetch_dir/fastfetch" /usr/local/bin/fastfetch 2>/dev/null || \
                        ln -sf "$fastfetch_dir/fastfetch" "$HOME/.local/bin/fastfetch" 2>/dev/null
                    log_success "fastfetch installed to $fastfetch_dir/fastfetch"
                else
                    log_warn "fastfetch download appears invalid"
                    rm -f "$fastfetch_dir/fastfetch"
                fi
            else
                log_warn "fastfetch download failed, install manually from https://github.com/fastfetch-cli/fastfetch/releases"
            fi
            ;;
        fedora)
            # Available in copr repo or prebuilt binary
            if ! $sudo_prefix dnf install -y fastfetch 2>/dev/null; then
                log_info "Installing fastfetch from GitHub releases..."
                local fastfetch_dir="$HOME/.local/share/fastfetch"
                mkdir -p "$fastfetch_dir"

                if curl -fL "https://github.com/fastfetch-cli/fastfetch/releases/latest/download/fastfetch-linux-amd64" \
                    -o "$fastfetch_dir/fastfetch" 2>/dev/null; then

                    # Verify the file was downloaded correctly
                    if [[ -s "$fastfetch_dir/fastfetch" ]] && ! grep -q "Not Found" "$fastfetch_dir/fastfetch" 2>/dev/null; then
                        chmod +x "$fastfetch_dir/fastfetch"
                        mkdir -p /usr/local/bin 2>/dev/null || true
                        $sudo_prefix ln -sf "$fastfetch_dir/fastfetch" /usr/local/bin/fastfetch 2>/dev/null || \
                            ln -sf "$fastfetch_dir/fastfetch" "$HOME/.local/bin/fastfetch" 2>/dev/null
                        log_success "fastfetch installed to $fastfetch_dir/fastfetch"
                    else
                        log_warn "fastfetch download appears invalid"
                        rm -f "$fastfetch_dir/fastfetch"
                    fi
                else
                    log_warn "fastfetch download failed, install manually from https://github.com/fastfetch-cli/fastfetch/releases"
                fi
            fi
            ;;
        *)
            log_warn "fastfetch installation not configured for $DISTRO"
            ;;
    esac

    # Verify installation
    if command_exists fastfetch; then
        log_success "fastfetch installed successfully"
    else
        log_warn "fastfetch installation may have failed (not found in PATH)"
    fi
}

#=============================================================================
# ZOXIDE SETUP
#=============================================================================
setup_zoxide() {
    # Only install if shell group is selected
    if [[ "$(get_group_selection "shell")" != "1" ]]; then
        return
    fi

    # Skip if already installed
    if command_exists zoxide; then
        log_success "zoxide is already installed"
        return 0
    fi

    # Skip on macOS (installed via Brewfile)
    if [[ "$OS" == "Darwin" ]]; then
        return 0
    fi

    # Skip on Linux if using Homebrew (installed via Brewfile)
    if [[ "$OS" == "Linux" ]] && [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    log_dry_run "Would install zoxide..."

    if [[ "$DRY_RUN" == "1" ]]; then
        return 0
    fi

    log_info "Installing zoxide..."

    # Debian/Ubuntu installation via curl script
    if [[ "$DISTRO" == "debian" ]]; then
        curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh
    else
        log_info "zoxide installation not configured for $DISTRO (will be installed via package manager if available)"
    fi
}

#=============================================================================
# STARSHIP SETUP
#=============================================================================
setup_starship() {
    # Only install if shell group is selected
    if [[ "$(get_group_selection "shell")" != "1" ]]; then
        return
    fi

    # Skip if already installed
    if command_exists starship; then
        log_success "starship is already installed"
        return 0
    fi

    # Skip on macOS (installed via Brewfile)
    if [[ "$OS" == "Darwin" ]]; then
        return 0
    fi

    # Skip on Linux if using Homebrew (installed via Brewfile)
    if [[ "$OS" == "Linux" ]] && [[ "${WITH_BREW:-0}" == "1" ]]; then
        return 0
    fi

    log_dry_run "Would install starship..."

    if [[ "$DRY_RUN" == "1" ]]; then
        return 0
    fi

    log_info "Installing starship..."

    # Use sudo prefix for non-root users
    local sudo_prefix=""
    if [[ $EUID -ne 0 ]]; then
        sudo_prefix="sudo"
    fi

    local install_success=0

    # Debian/Ubuntu - try apt first, fall back to curl script
    if [[ "$DISTRO" == "debian" ]]; then
        # Try apt install first (available in Ubuntu 22.04+ and Debian 12+)
        if $sudo_prefix apt-get update -qq 2>/dev/null; then
            if $sudo_prefix apt-get install -y starship 2>/dev/null; then
                install_success=1
            fi
        fi

        # Fall back to curl install script if apt failed
        if [[ $install_success -eq 0 ]]; then
            log_info "apt install failed, using official install script..."
            curl -sS https://starship.rs/install.sh | sh
        fi
    # Arch - install via pacman or yay
    elif [[ "$DISTRO" == "arch" ]]; then
        if command_exists yay; then
            yay -S --noconfirm starship && install_success=1
        elif command_exists paru; then
            paru -S --noconfirm starship && install_success=1
        else
            $sudo_prefix pacman -S --noconfirm starship && install_success=1
        fi
    # Fedora - install via dnf
    elif [[ "$DISTRO" == "fedora" ]]; then
        $sudo_prefix dnf install -y starship && install_success=1
    fi

    # Verify installation
    if command_exists starship; then
        log_success "starship installed successfully"
    else
        log_warn "starship installation may have failed (not found in PATH)"
    fi
}

#=============================================================================
# LIST GROUPS
#=============================================================================
list_groups() {
    echo ""
    echo "Available installation groups:"
    echo ""
    printf "%-15s %s\n" "Group" "Description"
    printf "%-15s %s\n" "------" "-----------"
    for group in "${INSTALL_ORDER[@]}"; do
        printf "%-15s %s\n" "$group" "${GROUP_DESC[$group]}"
    done
    echo ""
    echo "Packages in each group:"
    echo ""
    for group in "${INSTALL_ORDER[@]}"; do
        echo "$group: ${INSTALL_GROUPS[$group]}"
    done
    echo ""
}

#=============================================================================
# MAIN INSTALLATION FLOW
#=============================================================================
main() {
    # Parse arguments
    local manual_groups=()
    local use_preset=""

    while [[ $# -gt 0 ]]; do
        case $1 in
            --dry-run)
                DRY_RUN=1
                shift
                ;;
            --with-brew)
                WITH_BREW=1
                shift
                ;;
            -h|--help)
                echo "Usage: $0 [options] [groups|packages...]"
                echo ""
                echo "Options:"
                echo "  --dry-run       Show what would be installed without making changes"
                echo "  --list-groups   List available installation groups"
                echo "  --with-brew     Use Homebrew on Linux (default: skip)"
                echo "  --minimal       Minimal installation (core + shell)"
                echo "  --standard      Standard installation (core + shell + editor + terminal)"
                echo "  --full         Full installation (all groups)"
                echo "  -h, --help      Show this help message"
                echo ""
                echo "Groups:"
                echo "  ${INSTALL_ORDER[*]}"
                echo ""
                echo "Packages (can be installed individually):"
                echo "  Shell configs: bash, zsh, nushell"
                echo "  Others: starship, nvim-malo, kitty, tmux, etc."
                echo ""
                echo "Examples:"
                echo "  $0                    # Interactive menu"
                echo "  $0 --dry-run          # Preview what would be installed"
                echo "  $0 --minimal          # Minimal installation"
                echo "  $0 shell editor       # Install specific groups"
                echo "  $0 bash zsh           # Install specific shell configs"
                echo "  $0 nvim-malo tmux     # Install specific packages"
                echo "  $0 --with-brew shell  # Use Homebrew on Linux"
                exit 0
                ;;
            --list-groups)
                list_groups
                exit 0
                ;;
            --minimal|--standard|--full)
                use_preset="${1#--}"
                shift
                ;;
            -*)
                echo "Unknown option: $1"
                echo "Run '$0 --help' for usage"
                exit 1
                ;;
            *)
                manual_groups+=("$1")
                echo "Installing groups: ${manual_groups[*]}"
                shift
                ;;
        esac
    done

    # Initialize logging
    if [[ -n "${LOG_FILE:-}" ]]; then
        mkdir -p "$(dirname "$LOG_FILE")"
    fi

    show_header

    # Detect OS
    detect_os

    # Apply preset if specified
    if [[ -n "$use_preset" ]]; then
        apply_preset "$use_preset"
        log_info "Using preset: $use_preset"
        INTERACTIVE=0
    # Use manual groups/packages if specified
    elif [[ ${#manual_groups[@]} -gt 0 ]]; then
        # Reset selections
        for group in "${!INSTALL_GROUPS[@]}"; do
            SELECTED_GROUPS[$group]=0
        done

        # Track if any specific shell packages were manually selected
        local manual_shell_packages=()

        # Process each argument - could be a group or a specific package
        for item in "${manual_groups[@]}"; do
            if [[ -n "${INSTALL_GROUPS[$item]:-}" ]]; then
                # It's a group name
                SELECTED_GROUPS[$item]=1
            elif [[ -d "$SCRIPT_DIR/$item" ]]; then
                # It's a specific package directory
                # Check if it's a shell package
                if [[ "$item" =~ ^(bash|zsh|nushell|fish)$ ]]; then
                    manual_shell_packages+=("$item")
                fi
                # For other packages, we need to find which group they belong to
                # and enable that group
                for group in "${!INSTALL_GROUPS[@]}"; do
                    local packages=(${INSTALL_GROUPS[$group]})
                    for pkg in "${packages[@]}"; do
                        if [[ "$pkg" == "$item" ]]; then
                            SELECTED_GROUPS[$group]=1
                            break 2
                        fi
                    done
                done
            else
                log_warn "Unknown group or package: $item"
            fi
        done

        # If specific shell packages were requested, mark them for installation
        if [[ ${#manual_shell_packages[@]} -gt 0 ]]; then
            # Export for use by install_group
            export MANUAL_SHELL_PACKAGES="${manual_shell_packages[*]}"
            log_info "Will install specific shell configs: ${manual_shell_packages[*]}"
            # Mark as lightweight install (skip Homebrew updates, Brewfile, etc.)
            export LIGHTWEIGHT_INSTALL=1
        fi

        # Also check if only non-group packages were specified (individual packages)
        if [[ ${#manual_shell_packages[@]} -eq 0 ]]; then
            local has_group=0
            for item in "${manual_groups[@]}"; do
                if [[ -n "${INSTALL_GROUPS[$item]:-}" ]]; then
                    has_group=1
                    break
                fi
            done
            if [[ $has_group -eq 0 ]]; then
                # Only individual packages specified, no groups
                export LIGHTWEIGHT_INSTALL=1
                log_info "Lightweight mode: skipping Homebrew updates and Brewfile"
            fi
        fi

        INTERACTIVE=0
    # Use default selections (skip interactive in dry-run mode)
    else
        # Initialize with defaults
        for group in "${!DEFAULT_GROUPS[@]}"; do
            SELECTED_GROUPS[$group]="${DEFAULT_GROUPS[$group]}"
        done

        # Skip interactive mode in dry-run
        if [[ "$DRY_RUN" == "1" ]]; then
            INTERACTIVE=0
            log_info "Dry-run mode: Using default group selection"
            log_info "Run without --dry-run for interactive menu"
        else
            INTERACTIVE=1
        fi
    fi

    echo "Log file: $LOG_FILE"
    echo ""

    # Interactive menu
    if [[ "$INTERACTIVE" == "1" ]]; then
        # Build menu options
        local menu_options=()
        for group in "${INSTALL_ORDER[@]}"; do
            menu_options+=("$group|${GROUP_DESC[$group]}")
        done

        # Show menu and get selections
        local selections
        if selections=$(checkbox_menu "Select installation groups (Space to toggle, Enter to confirm):" "${menu_options[@]}"); then
            # Reset selections
            for group in "${!INSTALL_GROUPS[@]}"; do
                SELECTED_GROUPS[$group]=0
            done

            # Apply selections
            while IFS= read -r group; do
                SELECTED_GROUPS[$group]=1
            done <<< "$selections"
        else
            log_info "Installation cancelled"
            exit 0
        fi
    fi

    # Show what will be installed (skip in lightweight mode)
    if [[ "${LIGHTWEIGHT_INSTALL:-0}" == "0" ]]; then
        show_banner "Selected Groups"
        for group in "${INSTALL_ORDER[@]}"; do
            if [[ "$(get_group_selection "$group")" == "1" ]]; then
                log_success "✓ $group - ${GROUP_DESC[$group]}"
            fi
        done
        echo ""
    fi

    # Pause for confirmation (skip in lightweight mode)
    # REMOVED: User already confirmed in the checkbox menu

    # Show status (skip in interactive or lightweight mode)
    if [[ "$INTERACTIVE" == "0" ]] && [[ "${LIGHTWEIGHT_INSTALL:-0}" == "0" ]]; then
        show_package_manager_status
        show_required_tools_status
    fi

    # Setup package manager (skip updates in lightweight mode)
    if [[ "${LIGHTWEIGHT_INSTALL:-0}" == "1" ]]; then
        # In lightweight mode, just ensure Homebrew is in PATH, don't update
        if ! command_exists brew; then
            setup_homebrew
        elif [[ "$OS" == "Linux" ]]; then
            eval "$(brew shellenv 2>/dev/null || /home/linuxbrew/.linuxbrew/bin/brew shellenv)"
        fi
    else
        setup_homebrew
    fi

    # Setup GNU Stow
    setup_stow

    # Neovim config selection
    if [[ "${SELECTED_GROUPS[editor]:-0}" == "1" ]]; then
        if [[ "$DRY_RUN" == "1" ]]; then
            log_info "Would set default Neovim to: nvim-malo"
            log_info "(Run without --dry-run to select different config)"
        else
            select_nvim_config
        fi
    fi

    # Install groups in dependency order
    for group in "${INSTALL_ORDER[@]}"; do
        if [[ "$(get_group_selection "$group")" == "1" ]]; then
            install_group "$group"
        fi
    done

    # Install Neovim binary (Linux only, macOS uses Brewfile)
    install_neovim_binary

    # Install Neovim configs separately
    if [[ "$(get_group_selection "editor")" == "1" ]]; then
        install_nvim_configs
    fi

    # Install Homebrew packages (skip in lightweight mode)
    if [[ "${LIGHTWEIGHT_INSTALL:-0}" == "0" ]]; then
        install_homebrew_packages
    fi

    # Install Linux system packages (skipped on macOS / when using Homebrew)
    install_cli_tools
    install_shell_tools
    install_editor_tools

    # Install developer tools (git, gh, lazygit, go, pip, etc.)
    install_dev_tools

    # Install extras
    install_shell_color_scripts

    # Install fastfetch
    install_fastfetch

    # Install zoxide
    setup_zoxide

    # Install starship (shell group)
    setup_starship

    # Summary (simplified in lightweight mode)
    if [[ "${LIGHTWEIGHT_INSTALL:-0}" == "1" ]]; then
        echo ""
        if [[ "$DRY_RUN" == "1" ]]; then
            echo "  📋 DRY RUN - No changes made"
        else
            echo "  ✅ Done!"
        fi
        echo ""
        echo "  Next steps:"
        if [[ -n "${MANUAL_SHELL_PACKAGES:-}" ]]; then
            # Shell-specific next steps
            for shell in $MANUAL_SHELL_PACKAGES; do
                case "$shell" in
                    bash)
                        echo "    - Restart your shell or run: source ~/.bashrc"
                        ;;
                    zsh)
                        echo "    - Restart your shell or run: source ~/.zshrc"
                        ;;
                    nushell)
                        echo "    - Restart your shell or run: source ~/.config/nushell/env.nu"
                        ;;
                    fish)
                        echo "    - Restart your shell or run: source ~/.config/fish/config.fish"
                        ;;
                esac
            done
        else
            echo "    - Restart your shell"
        fi
    else
        show_banner "Summary"
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
        if [[ "$OS" == "Darwin" && "$(get_group_selection "desktop")" == "1" ]]; then
            echo "    - Start SketchyBar: brew services restart sketchybar"
        fi
        if [[ "$(get_group_selection "extras")" == "1" ]]; then
            echo "    - Run: colorscript to see available color scripts"
        fi
    fi
}

# Run main function
main "$@"

# Restore original directory
cd "$ORIGINAL_DIR"
