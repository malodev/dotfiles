#!/usr/bin/env bash

declare -a CLI_MANUAL_ARGS=()
CLI_USE_PRESET=""

print_help() {
    echo "Usage: $0 [options] [groups|packages...]"
    echo ""
    echo "Options:"
    echo "  --dry-run       Show what would be installed without making changes"
    echo "  --list-groups   List available installation groups"
    echo "  --with-brew     Use Homebrew on Linux (default: skip)"
    echo "  -g, --group G   Install an explicit group"
    echo "  -p, --package P Install an explicit dotfile package only"
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
    echo "  $0 --group shell      # Explicitly install a group"
    echo "  $0 --package tmux     # Explicitly install one dotfile package"
    echo "  $0 --with-brew shell  # Use Homebrew on Linux"
}

parse_cli_args() {
    CLI_MANUAL_ARGS=()
    CLI_USE_PRESET=""

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
                print_help
                exit 0
                ;;
            --list-groups)
                list_groups
                exit 0
                ;;
            --minimal|--standard|--full)
                CLI_USE_PRESET="${1#--}"
                shift
                ;;
            -g|--group)
                if [[ $# -lt 2 ]]; then
                    echo "Error: $1 requires a group name"
                    exit 1
                fi
                CLI_MANUAL_ARGS+=("__group:$2")
                echo "Requested group: $2"
                shift 2
                ;;
            -p|--package)
                if [[ $# -lt 2 ]]; then
                    echo "Error: $1 requires a package name"
                    exit 1
                fi
                CLI_MANUAL_ARGS+=("__package:$2")
                echo "Requested package: $2"
                shift 2
                ;;
            -*)
                echo "Unknown option: $1"
                echo "Run '$0 --help' for usage"
                exit 1
                ;;
            *)
                CLI_MANUAL_ARGS+=("$1")
                echo "Requested groups/packages: ${CLI_MANUAL_ARGS[*]}"
                shift
                ;;
        esac
    done
}
