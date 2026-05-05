#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_SCRIPT="$REPO_DIR/install.sh"

case_log_path() {
    local name="$1"
    echo "/tmp/validate-install.$$.$(echo "$name" | tr ' /' '__').log"
}

run_case() {
    local name="$1"
    shift

    local log_path
    log_path="$(case_log_path "$name")"

    echo "==> $name"
    "$@" >"$log_path" 2>&1
    echo "    ok"
}

assert_in_log() {
    local name="$1"
    local pattern="$2"
    local log_path
    log_path="$(case_log_path "$name")"

    if ! grep -Fq -- "$pattern" "$log_path"; then
        echo "Assertion failed for '$name': expected to find '$pattern'" >&2
        echo "--- log: $log_path ---" >&2
        cat "$log_path" >&2
        exit 1
    fi
}

assert_not_in_log() {
    local name="$1"
    local pattern="$2"
    local log_path
    log_path="$(case_log_path "$name")"

    if grep -Fq -- "$pattern" "$log_path"; then
        echo "Assertion failed for '$name': did not expect to find '$pattern'" >&2
        echo "--- log: $log_path ---" >&2
        cat "$log_path" >&2
        exit 1
    fi
}

cd "$REPO_DIR"

run_case "bash -n" bash -n "$INSTALL_SCRIPT"
run_case "manifest validation" "$REPO_DIR/scripts/validate-manifest.sh"
run_case "dry-run default preset" "$INSTALL_SCRIPT" --dry-run
run_case "dry-run minimal" "$INSTALL_SCRIPT" --minimal --dry-run
run_case "dry-run standard" "$INSTALL_SCRIPT" --standard --dry-run
run_case "dry-run full" "$INSTALL_SCRIPT" --full --dry-run
run_case "dry-run explicit group" "$INSTALL_SCRIPT" --group shell --dry-run
run_case "dry-run explicit package" "$INSTALL_SCRIPT" --package tmux --dry-run
run_case "dry-run nvim package" "$INSTALL_SCRIPT" --package nvim-malo --dry-run
run_case "dry-run mixed group+package" "$INSTALL_SCRIPT" --group shell --package tmux --dry-run
run_case "dry-run with brew" "$INSTALL_SCRIPT" --with-brew --minimal --dry-run
run_case "dry-run unsupported desktop group" "$INSTALL_SCRIPT" --group desktop --dry-run
run_case "list groups" "$INSTALL_SCRIPT" --list-groups
run_case "dry-run from outside repo" bash -lc "cd /tmp && '$INSTALL_SCRIPT' --package tmux --dry-run"

assert_in_log "dry-run explicit package" "Package-only mode: stowing only selected dotfile packages: tmux"
assert_in_log "dry-run explicit package" "stow -d $REPO_DIR -t $HOME tmux"
assert_not_in_log "dry-run explicit package" "stow -d $REPO_DIR -t $HOME kitty"

assert_in_log "dry-run nvim package" "Would set default Neovim to: nvim-malo"
assert_in_log "dry-run nvim package" "stow -d $REPO_DIR -t $HOME nvim-malo"
assert_not_in_log "dry-run nvim package" "stow -d $REPO_DIR -t $HOME nvim-lazy"

assert_in_log "dry-run mixed group+package" "Installing: shell"
assert_in_log "dry-run mixed group+package" "Installing package: tmux"
assert_in_log "dry-run mixed group+package" "stow -d $REPO_DIR -t $HOME tmux"

assert_in_log "dry-run with brew" "brew bundle --file=$REPO_DIR/Brewfile"
if [[ "$(uname)" != "Darwin" ]]; then
    assert_in_log "dry-run unsupported desktop group" "Group 'desktop' is not supported on this platform; skipping"
fi
assert_in_log "list groups" "core: (no stow packages)"
assert_in_log "list groups" "terminal: kitty tmux"
assert_in_log "dry-run from outside repo" "stow -d $REPO_DIR -t $HOME tmux"

if command -v shellcheck >/dev/null 2>&1; then
    run_case "shellcheck" shellcheck "$INSTALL_SCRIPT"
else
    echo "==> shellcheck"
    echo "    skipped (not installed)"
fi

echo "All install script validation checks passed."
