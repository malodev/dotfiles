#!/bin/bash
#=============================================================================
# Common Functions for Dotfiles Installation Scripts
# Source this file in other scripts: source scripts/common.sh
#=============================================================================

# Prevent double sourcing
[[ -n "${_COMMON_SOURCED:-}" ]] && return 0
_COMMON_SOURCED=1

#=============================================================================
# OS DETECTION
#=============================================================================
detect_os() {
    OS=$(uname -s)
    DISTRO=""

    case "$OS" in
        Darwin)
            # macOS
            ;;
        Linux)
            if [[ -f /etc/arch-release ]]; then
                DISTRO="arch"
            elif [[ -f /etc/debian_version ]]; then
                DISTRO="debian"
            elif [[ -f /etc/fedora-release ]]; then
                DISTRO="fedora"
            elif [[ -f /etc/redhat-release ]]; then
                DISTRO="redhat"
            else
                DISTRO="unknown"
            fi
            ;;
        *)
            log_error "Unsupported OS: $OS"
            return 1
            ;;
    esac

    export OS DISTRO
}

is_macos() {
    [[ "$OS" == "Darwin" ]]
}

is_linux() {
    [[ "$OS" == "Linux" ]]
}

is_arch() {
    [[ "$DISTRO" == "arch" ]]
}

is_debian() {
    [[ "$DISTRO" == "debian" ]]
}

#=============================================================================
# COMMAND CHECKS
#=============================================================================
command_exists() {
    command -v "$1" &> /dev/null
}

ensure_command() {
    local cmd="$1"
    local install_cmd="$2"

    if ! command_exists "$cmd"; then
        log_info "$cmd not found. Installing..."
        eval "$install_cmd" || {
            log_error "Failed to install $cmd"
            return 1
        }
    fi
}

require_commands() {
    local missing=()

    for cmd in "$@"; do
        command_exists "$cmd" || missing+=("$cmd")
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required commands: ${missing[*]}"
        return 1
    fi

    return 0
}

#=============================================================================
# DRY RUN MODE
#=============================================================================
# Set DRY_RUN=1 or use --dry-run flag to enable dry-run mode
is_dry_run() {
    [[ "${DRY_RUN:-0}" == "1" ]]
}

dry_run_msg() {
    if is_dry_run; then
        echo "[DRY RUN] $1"
    fi
}

# Run command only if not in dry-run mode
run_or_dry() {
    if is_dry_run; then
        dry_run_msg "Would execute: $*"
        return 0
    else
        "$@"
    fi
}

# Safe command execution that respects dry-run mode
safe_run() {
    local cmd="$*"
    if is_dry_run; then
        log_info "[DRY RUN] Would execute: $cmd"
        return 0
    else
        log_info "Executing: $cmd"
        eval "$cmd"
    fi
}

#=============================================================================
# LOGGING
#=============================================================================
# Set up logging if LOG_FILE is defined
if [[ -n "${LOG_FILE:-}" ]]; then
    # Create log directory if needed
    LOG_DIR=$(dirname "$LOG_FILE")
    [[ ! -d "$LOG_DIR" ]] && mkdir -p "$LOG_DIR"

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

    log_dry_run() {
        if is_dry_run; then
            echo "[DRY RUN] $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
        fi
    }
else
    # No logging configured, use plain echo
    log_info() { echo "[INFO] $1"; }
    log_success() { echo "[SUCCESS] $1"; }
    log_error() { echo "[ERROR] $1" >&2; }
    log_warn() { echo "[WARN] $1"; }
    log_dry_run() {
        if is_dry_run; then
            echo "[DRY RUN] $1"
        fi
    }
fi

#=============================================================================
# PACKAGE MANAGER DETECTION
#=============================================================================
detect_package_manager() {
    if is_macos; then
        if command_exists brew; then
            echo "homebrew"
        fi
    elif is_arch; then
        if command_exists yay; then
            echo "yay"
        elif command_exists paru; then
            echo "paru"
        elif command_exists pacman; then
            echo "pacman"
        fi
    elif is_debian; then
        if command_exists apt-get; then
            echo "apt"
        fi
    fi
}

# Install a package using the appropriate package manager
pm_install() {
    local packages=("$@")

    if is_macos && command_exists brew; then
        brew install "${packages[@]}"
    elif is_arch; then
        if command_exists yay; then
            yay -S --noconfirm "${packages[@]}"
        elif command_exists paru; then
            paru -S --noconfirm "${packages[@]}"
        elif command_exists pacman; then
            sudo pacman -S --noconfirm "${packages[@]}"
        else
            log_error "No package manager found on Arch"
            return 1
        fi
    elif is_debian && command_exists apt-get; then
        sudo apt-get update -qq
        sudo apt-get install -y "${packages[@]}"
    else
        log_error "No package manager found"
        return 1
    fi
}

#=============================================================================
# DIRECTORY SAFETY
#=============================================================================
# Save and restore original directory
save_dir() {
    _ORIGINAL_DIR="$(pwd)"
    export _ORIGINAL_DIR
}

restore_dir() {
    [[ -n "${_ORIGINAL_DIR:-}" ]] && cd "$_ORIGINAL_DIR"
}

# Create directory and change to it
cdmkdir() {
    local dir="$1"
    mkdir -p "$dir" && cd "$dir"
}

#=============================================================================
# SUDO CHECK
#=============================================================================
has_sudo() {
    sudo -n true 2>/dev/null
}

ensure_sudo() {
    if ! has_sudo; then
        log_warn "sudo access required. You may be prompted for your password."
    fi
}

#=============================================================================
# DOWNLOAD HELPERS
#=============================================================================
download() {
    local url="$1"
    local output="$2"
    local temp_dir="${3:-$(mktemp -d)}"

    if command_exists curl; then
        curl -L -o "$output" "$url"
    elif command_exists wget; then
        wget -O "$output" "$url"
    else
        log_error "Neither curl nor wget found"
        return 1
    fi
}

#=============================================================================
# PROMPT HELPERS
#=============================================================================
prompt_yes_no() {
    local prompt="$1"
    local default="${2:-N}"

    local yn
    if [[ "$default" == "Y" ]]; then
        read -p "$prompt [Y/n]: " -n 1 -r yn
        echo
        [[ -z "$yn" || "$yn" =~ ^[Yy]$ ]]
    else
        read -p "$prompt [y/N]: " -n 1 -r yn
        echo
        [[ "$yn" =~ ^[Yy]$ ]]
    fi
}

#=============================================================================
# GIT HELPERS
#=============================================================================
git_clone_or_update() {
    local repo_url="$1"
    local dest_dir="$2"

    if [[ -d "$dest_dir/.git" ]]; then
        log_info "Updating $dest_dir..."
        git -C "$dest_dir" pull
    else
        log_info "Cloning $repo_url to $dest_dir..."
        git clone "$repo_url" "$dest_dir"
    fi
}

#=============================================================================
# CLEANUP TRAP
#=============================================================================
cleanup_on_exit() {
    local cleanup_func="$1"
    trap "$cleanup_func; restore_dir" EXIT INT TERM
}

#=============================================================================
# INITIALIZATION
#=============================================================================
# Auto-detect OS on source
detect_os

# Export functions for use in subshells
export -f log_info log_success log_error log_warn
export -f command_exists ensure_command require_commands
export -f is_macos is_linux is_arch is_debian
export -f save_dir restore_dir cdmkdir
export -f has_sudo ensure_sudo
export -f download prompt_yes_no
export -f git_clone_or_update
export -f pm_install
