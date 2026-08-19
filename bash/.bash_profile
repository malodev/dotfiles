#=============================================================================
# Bash Profile - Executed for login shells
#=============================================================================

# Source .bashrc if it exists
if [[ -f "$HOME/.bashrc" ]]; then
    . "$HOME/.bashrc"
fi

# Cargo (Rust)
[[ -f "$HOME/.cargo/env" ]] && . "$HOME/.cargo/env"

# User-local toolchains
export PATH="$HOME/.local/bin:$PATH"

# >>> machine-specific overrides (untracked) <<<
[[ -f ~/.bash_profile_local ]] && source ~/.bash_profile_local
# >>> END MANAGED CONFIG <<<
