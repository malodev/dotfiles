#=============================================================================
# Bash Configuration
#=============================================================================

# Cache hostname once per session (used by starship prompt — avoids forking
# hostname binary on every prompt render, critical on constrained machines)
export DOTFILES_HOSTNAME="${DOTFILES_HOSTNAME:-$(hostname 2>/dev/null || cat /etc/hostname 2>/dev/null || echo unknown)}"

# Better history
export HISTCONTROL=ignoredups:erasedups
export HISTSIZE=
export HISTFILESIZE=
# Force prompt to write history after every command
PROMPT_COMMAND="history -a; history -c; history -r; ${PROMPT_COMMAND}"
export HISTFILE=$HOME/.bash_eternal_history

# Append to history file, don't overwrite
shopt -s histappend

# Check window size and update LINES/COLUMNS after each command
shopt -s checkwinsize

# Autocorrect typos in path names
shopt -s cdspell

#=============================================================================
# PATH
#=============================================================================
# Add user bin directories to PATH if they exist
[[ -d "$HOME/.local/bin" ]] && export PATH="$HOME/.local/bin:$PATH"
[[ -d "$HOME/bin" ]] && export PATH="$HOME/bin:$PATH"

# Homebrew
if [[ -d "/opt/homebrew/bin" ]]; then
    export PATH="/opt/homebrew/bin:$PATH"
elif [[ -d "/usr/local/bin" ]]; then
    export PATH="/usr/local/bin:$PATH"
fi

# Linux Homebrew
if [[ -d "/home/linuxbrew/.linuxbrew/bin" ]]; then
    export PATH="/home/linuxbrew/.linuxbrew/bin:$PATH"
fi

# Miniconda (optional)
[[ -d "$HOME/miniconda3/bin" ]] && export PATH="$HOME/miniconda3/bin:$PATH"
[[ -d "/opt/miniconda/bin" ]] && export PATH="$PATH:/opt/miniconda/bin"

#=============================================================================
# ALIASES
#=============================================================================
# Source bash_aliases if it exists
[ -f "$HOME/.bash_aliases" ] && . "$HOME/.bash_aliases"

# Use gdircolors if available (macOS coreutils)
if command -v gdircolors >/dev/null 2>&1; then
    alias dircolors='gdircolors'
fi

# Enable color support of ls
if [ "$TERM" != "dumb" ]; then
    if command -v dircolors >/dev/null 2>&1; then
        eval "$(dircolors -b)"
        alias ls='ls --color=auto'
    fi
fi

#=============================================================================
# PROMPT - Starship
#=============================================================================

# Initialize starship if available, otherwise use simple prompt
if command -v starship >/dev/null 2>&1; then
    # Auto-detect constrained machines (shared hosting, low-spec VPS)
    # and use a lightweight prompt config to avoid per-prompt lag.
    if [[ ! -f "${STARSHIP_CONFIG:-}" ]]; then
        _mem_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 0)
        _cpu_count=$(nproc 2>/dev/null || echo 0)
        if [[ "$_mem_kb" -gt 0 && "$_mem_kb" -lt 2000000 ]] || [[ "$_cpu_count" -gt 0 && "$_cpu_count" -le 2 ]]; then
            _minimal_config="$HOME/.config/starship-minimal.toml"
            if [[ -f "$_minimal_config" ]]; then
                export STARSHIP_CONFIG="$_minimal_config"
            fi
        fi
        unset _mem_kb _cpu_count _minimal_config
    fi
    eval "$(starship init bash)"
elif [[ -x "$HOME/.local/bin/starship" ]]; then
    export PATH="$HOME/.local/bin:$PATH"
    eval "$(starship init bash)"
else
    # Fallback prompt (simple but functional)
    # Set debian_chroot if in a chroot
    if [ -z "$debian_chroot" ] && [ -r /etc/debian_chroot ]; then
        debian_chroot=$(cat /etc/debian_chroot)
    fi

    # Simple colored prompt
    PS1='${debian_chroot:+($debian_chroot)}\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '

    # Set terminal title for xterm/rxvt
    case "$TERM" in
        xterm*|rxvt*)
            PROMPT_COMMAND='echo -ne "\033]0;${USER}@${HOSTNAME}: ${PWD/$HOME/~}\007"'
            ;;
    esac
fi

#=============================================================================
# ZOXIDE - smarter cd command
#=============================================================================
# https://github.com/ajeetdsouza/zoxide
if command -v zoxide >/dev/null 2>&1; then
    eval "$(zoxide init bash)"
fi

#=============================================================================
# VIRTUAL ENVIRONMENT
#=============================================================================
# virtualenvwrapper settings
[[ -d "$HOME/.virtualenvs" ]] && export WORKON_HOME="$HOME/.virtualenvs"
[[ -f "$HOME/bin/virtualenvwrapper_bashrc" ]] && source "$HOME/bin/virtualenvwrapper_bashrc"

#=============================================================================
# LANGUAGE VERSION MANAGERS
#=============================================================================
# nvm - node version manager
if [[ -d "$HOME/.nvm" ]]; then
  export NVM_DIR="$HOME/.nvm"
fi
if [[ -n "${NVM_DIR:-}" && -s "$NVM_DIR/nvm.sh" ]]; then
  # Add default node to PATH immediately if available
  if [[ -s "$NVM_DIR/alias/default" ]]; then
    NVM_DEFAULT=$(cat "$NVM_DIR/alias/default" 2>/dev/null)
    while [[ "${NVM_DEFAULT:-}" == lts/* ]]; do
      NVM_DEFAULT=$(cat "$NVM_DIR/alias/$NVM_DEFAULT" 2>/dev/null)
    done
    if [[ -n "${NVM_DEFAULT:-}" && -d "$NVM_DIR/versions/node/$NVM_DEFAULT/bin" ]]; then
      PATH="$NVM_DIR/versions/node/$NVM_DEFAULT/bin:$PATH"
    fi
  fi
  nvm() {
    unfunction nvm node npm npx 2>/dev/null
    . "$NVM_DIR/nvm.sh"
    nvm "$@"
  }
  node() {
    unfunction nvm node npm npx 2>/dev/null
    . "$NVM_DIR/nvm.sh"
    node "$@"
  }
  npm() {
    unfunction nvm node npm npx 2>/dev/null
    . "$NVM_DIR/nvm.sh"
    npm "$@"
  }
  npx() {
    unfunction nvm node npm npx 2>/dev/null
    . "$NVM_DIR/nvm.sh"
    npx "$@"
  }
fi

# deno
[[ -f "$HOME/.deno/env" ]] && source "$HOME/.deno/env"

#=============================================================================
# FZF
#=============================================================================
if command -v fzf >/dev/null 2>&1; then
  eval "$(fzf --bash)" 2>/dev/null
fi

#=============================================================================
# MACHINE-SPECIFIC OVERRIDES
#=============================================================================
# These files exist in $HOME (not in repo) for per-machine configuration
[[ -f "$HOME/.bashrc_macair" ]] && . "$HOME/.bashrc_macair"
[[ -f "$HOME/.bashrc_ubu_oracle" ]] && . "$HOME/.bashrc_ubu_oracle"
[[ -f "$HOME/.bash_macair" ]] && . "$HOME/.bash_macair"
[[ -f "$HOME/.bashrc_malo" ]] && . "$HOME/.bashrc_malo"
[[ -f "$HOME/.bashrc_local" ]] && . "$HOME/.bashrc_local"
