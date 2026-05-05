#!/usr/bin/env bash

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

install_group() {
    local group="$1"
    local packages=(${INSTALL_GROUPS[$group]})

    if [[ -z "${packages[*]}" ]]; then
        return
    fi

    local has_stow_work=0
    local check_pkg
    for check_pkg in "${packages[@]}"; do
        if [[ ( "$group" == "editor" || "$group" == "editor-alt" ) && "$check_pkg" =~ ^nvim- ]]; then
            continue
        fi
        if [[ "$PACKAGE_ONLY_MODE" == "1" ]] && ! is_package_selected "$check_pkg"; then
            continue
        fi
        has_stow_work=1
        break
    done

    if [[ $has_stow_work -eq 0 ]]; then
        return
    fi

    show_banner "Installing: $group"

    local current_shell=""
    local install_specific_shells=0

    if [[ "$group" == "shell" ]]; then
        current_shell=$(basename "$SHELL")

        if [[ -n "${MANUAL_SHELL_PACKAGES:-}" ]]; then
            install_specific_shells=1
            log_info "Installing manually specified shell configs: $MANUAL_SHELL_PACKAGES"
        else
            log_info "Current shell: $current_shell - only stowing $current_shell config"
        fi
    fi

    for pkg in "${packages[@]}"; do
        if [[ ( "$group" == "editor" || "$group" == "editor-alt" ) && "$pkg" =~ ^nvim- ]]; then
            continue
        fi

        if [[ "$PACKAGE_ONLY_MODE" == "1" ]] && ! is_package_selected "$pkg"; then
            continue
        fi

        if [[ "$group" == "shell" ]]; then
            if [[ -v "STOW_SKIP_PACKAGES[$pkg]" ]]; then
                log_warn "Skipping $pkg stow because conflicting files were already present in HOME"
                continue
            fi
            if [[ $install_specific_shells -eq 1 ]]; then
                local should_install=0
                for manual_shell in $MANUAL_SHELL_PACKAGES; do
                    if [[ "$pkg" == "$manual_shell" ]]; then
                        should_install=1
                        break
                    fi
                done

                if [[ $should_install -eq 0 ]] && is_shell_config_package "$pkg"; then
                    log_dry_run "  Skipping $pkg (not in manual selection)"
                    continue
                fi
            else
                if [[ "$pkg" == "$current_shell" ]]; then
                    :
                elif is_shell_config_package "$pkg"; then
                    log_dry_run "  Skipping $pkg (not current shell, use './install.sh $pkg' to install)"
                    continue
                fi
            fi
        fi

        if [[ -d "$SCRIPT_DIR/$pkg" ]]; then
            stow_package "$pkg"
        else
            log_warn "Package directory not found: $pkg"
        fi
    done
}
