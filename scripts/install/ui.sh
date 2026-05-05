#!/usr/bin/env bash

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

checkbox_menu() {
    local prompt="$1"
    shift
    local -a options=("$@")
    local -a selections
    local -a checked

    if [[ ! -t 0 ]]; then
        echo "Error: stdin is not a terminal. Cannot show interactive menu." >&2
        echo "Use --minimal, --standard, --full, or specify groups manually." >&2
        echo "Example: $0 --minimal" >&2
        return 1
    fi

    for i in "${!options[@]}"; do
        local opt="${options[$i]%%|*}"
        if [[ "$(get_group_selection "$opt")" == "1" ]]; then
            checked[$i]=1
        else
            checked[$i]=0
        fi
    done

    local done=0
    while [[ $done -eq 0 ]]; do
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
            group_details "$opt" >&2
        done

        echo "" >&2
        echo -n "Your choice (or Enter when done): " >&2

        local input
        read -r input <&0

        if [[ "$input" == "q" ]] || [[ "$input" == "Q" ]]; then
            return 1
        fi
        if [[ -z "$input" ]]; then
            done=1
            continue
        fi
        if [[ "$input" == "a" ]] || [[ "$input" == "A" ]]; then
            for i in "${!options[@]}"; do checked[$i]=1; done
            continue
        fi
        if [[ "$input" == "n" ]] || [[ "$input" == "N" ]]; then
            for i in "${!options[@]}"; do checked[$i]=0; done
            continue
        fi
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

    for i in "${!checked[@]}"; do
        if [[ ${checked[$i]} -eq 1 ]]; then
            selections+=("${options[$i]%%|*}")
        fi
    done

    printf '%s\n' "${selections[@]}"
    return 0
}

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
        echo "$group: ${INSTALL_GROUPS[$group]:-(no stow packages)}"
        group_details "$group"
        echo ""
    done
    echo ""
}
