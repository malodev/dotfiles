#=============================================================================
# Bash Profile - Executed for login shells
#=============================================================================

# Source .bashrc if it exists
if [[ -f "$HOME/.bashrc" ]]; then
    . "$HOME/.bashrc"
fi

# Cargo (Rust)
[[ -f "$HOME/.cargo/env" ]] && . "$HOME/.cargo/env"
