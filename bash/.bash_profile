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
export BUN_INSTALL="$HOME/.bun"
export DENO_INSTALL="$HOME/.deno"
export NVM_DIR="$HOME/.nvm"
export PATH="$HOME/.local/bin:$BUN_INSTALL/bin:$DENO_INSTALL/bin:$PATH"

# >>> machine-specific overrides (untracked) <<<
[[ -f ~/.bash_profile_local ]] && source ~/.bash_profile_local
# >>> END MANAGED CONFIG <<<
