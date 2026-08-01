#=============================================================================
# Bash Configuration
#=============================================================================

# Prevent recursive sourcing, e.g. ~/.bashrc -> ~/.bashrc_local -> ~/.bashrc.
if [[ -n "${DOTFILES_BASHRC_LOADING:-}" ]]; then
    if [[ -n "${DOTFILES_BASHRC_DEBUG:-}" || -f "$HOME/.bashrc_debug" ]]; then
        printf '[bashrc:%s] recursive source detected: returning early\n' "$(date +%H:%M:%S 2>/dev/null || echo '?')" >&2
    fi
    return
fi
DOTFILES_BASHRC_LOADING=1

# Cache hostname once per session (used by starship prompt — avoids forking
# hostname binary on every prompt render, critical on constrained machines)
export DOTFILES_HOSTNAME="${DOTFILES_HOSTNAME:-$(hostname 2>/dev/null || cat /etc/hostname 2>/dev/null || echo unknown)}"

#=============================================================================
# DEBUGGING BASH STARTUP / SSH LOGIN HANGS
#=============================================================================
# This file has opt-in checkpoints around common hang points (starship, zoxide,
# fzf, nvm, deno, virtualenvwrapper, and machine-local overrides). Debug output
# is written to stderr and is disabled by default so normal shells, SSH, scp, and
# sftp stay quiet.
#
# One-shot debug for a local interactive shell:
#   DOTFILES_BASHRC_DEBUG=1 bash -i
#
# One-shot debug for SSH/login startup:
#   ssh -tt HOST 'DOTFILES_BASHRC_DEBUG=1 bash -il'
#
# Persistent debug on a machine until removed:
#   touch ~/.bashrc_debug
#   # reproduce the slow/hung login, then disable it with:
#   rm ~/.bashrc_debug
#
# Agents/humans: when debugging hangs, look for the last printed checkpoint:
#   [bashrc:HH:MM:SS] <section>: before ...
# The line after that is the command/source likely hanging. Do not leave
# ~/.bashrc_debug enabled permanently on shared/remote machines.
_dotfiles_bashrc_debug_enabled=0
if [[ -n "${DOTFILES_BASHRC_DEBUG:-}" || -f "$HOME/.bashrc_debug" ]]; then
    _dotfiles_bashrc_debug_enabled=1
fi
_dotfiles_bashrc_debug() {
    [[ "${_dotfiles_bashrc_debug_enabled:-0}" == 1 ]] || return 0
    printf '[bashrc:%s] %s\n' "$(date +%H:%M:%S 2>/dev/null || echo '?')" "$*" >&2
}
_dotfiles_bashrc_debug "start flags=$- term=${TERM:-unset} ssh=${SSH_CONNECTION:+yes}"

# Keep non-interactive SSH/scp/sftp/remote-command sessions quiet and fast.
# Bash can read ~/.bashrc for remote commands; anything prompt/keybinding-related
# below this point should only run for interactive shells.
case $- in
    *i*) _dotfiles_bashrc_debug "interactive shell: continuing" ;;
    *)
        _dotfiles_bashrc_debug "non-interactive shell: returning early"
        unset DOTFILES_BASHRC_LOADING _dotfiles_bashrc_debug_enabled
        unset -f _dotfiles_bashrc_debug
        return
        ;;
esac

# Better history
export HISTCONTROL=ignoredups:erasedups
export HISTSIZE=
export HISTFILESIZE=
export HISTFILE=$HOME/.bash_eternal_history
# Persist history after every command without rereading the whole history file.
# `history -c; history -r` on every prompt can make SSH login appear to hang
# when ~/.bash_eternal_history is large.
_dotfiles_history_prompt='history -a; history -n'
if [[ "${PROMPT_COMMAND:-}" != *"$_dotfiles_history_prompt"* ]]; then
    if [[ -n "${PROMPT_COMMAND:-}" ]]; then
        PROMPT_COMMAND="$_dotfiles_history_prompt; $PROMPT_COMMAND"
    else
        PROMPT_COMMAND="$_dotfiles_history_prompt"
    fi
fi
unset _dotfiles_history_prompt
_dotfiles_bashrc_debug "history: configured"

# Append to history file, don't overwrite
shopt -s histappend

# Check window size and update LINES/COLUMNS after each command
shopt -s checkwinsize

# Autocorrect typos in path names
shopt -s cdspell
_dotfiles_bashrc_debug "shell options: configured"

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
_dotfiles_bashrc_debug "path: configured fzf=$(command -v fzf 2>/dev/null || echo missing) starship=$(command -v starship 2>/dev/null || echo missing)"

#=============================================================================
# ALIASES
#=============================================================================
# Source bash_aliases if it exists
if [[ -f "$HOME/.bash_aliases" ]]; then
    _dotfiles_bashrc_debug "aliases: source $HOME/.bash_aliases"
    . "$HOME/.bash_aliases"
    _dotfiles_bashrc_debug "aliases: done"
fi

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
_dotfiles_bashrc_debug "prompt: checking starship"
if command -v starship >/dev/null 2>&1; then
    _dotfiles_bashrc_debug "prompt: starship found $(command -v starship)"
    # Auto-detect constrained machines and use a lightweight prompt config.
    # Only runs once (when STARSHIP_CONFIG is not already set by user).
    if [[ ! -f "${STARSHIP_CONFIG:-}" ]]; then
        _use_minimal=0
        # Explicit lightweight marker (created by ./install.sh --lightweight)
        [[ -f "$HOME/.config/dotfiles-lightweight.enabled" ]] && _use_minimal=1
        # Aruba / shared hosting — web directory structure exists
        [[ -d /web/htdocs ]] && _use_minimal=1
        # Low memory (<2GB)
        _mem_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 0)
        [[ "$_mem_kb" -gt 0 && "$_mem_kb" -lt 2000000 ]] && _use_minimal=1
        # Few CPUs (<=2)
        _cpu_count=$(nproc 2>/dev/null || echo 0)
        [[ "$_cpu_count" -gt 0 && "$_cpu_count" -le 2 ]] && _use_minimal=1

        if [[ $_use_minimal -eq 1 ]]; then
            _minimal_config="$HOME/.config/starship-minimal.toml"
            if [[ -f "$_minimal_config" ]]; then
                export STARSHIP_CONFIG="$_minimal_config"
            fi
        fi
        unset _use_minimal _mem_kb _cpu_count _minimal_config
    fi
    _dotfiles_bashrc_debug "prompt: before starship init"
    eval "$(starship init bash)"
    _dotfiles_bashrc_debug "prompt: after starship init"
elif [[ -x "$HOME/.local/bin/starship" ]]; then
    export PATH="$HOME/.local/bin:$PATH"
    _dotfiles_bashrc_debug "prompt: before local starship init"
    eval "$(starship init bash)"
    _dotfiles_bashrc_debug "prompt: after local starship init"
else
    _dotfiles_bashrc_debug "prompt: using fallback prompt"
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
_dotfiles_bashrc_debug "prompt: configured"

#=============================================================================
# ZOXIDE - smarter cd command
#=============================================================================
# https://github.com/ajeetdsouza/zoxide
_dotfiles_bashrc_debug "zoxide: checking"
if command -v zoxide >/dev/null 2>&1; then
    _dotfiles_bashrc_debug "zoxide: before init"
    eval "$(zoxide init bash)"
    _dotfiles_bashrc_debug "zoxide: after init"
fi

#=============================================================================
# VIRTUAL ENVIRONMENT
#=============================================================================
# virtualenvwrapper settings
[[ -d "$HOME/.virtualenvs" ]] && export WORKON_HOME="$HOME/.virtualenvs"
if [[ -f "$HOME/bin/virtualenvwrapper_bashrc" ]]; then
    _dotfiles_bashrc_debug "virtualenvwrapper: before source"
    source "$HOME/bin/virtualenvwrapper_bashrc"
    _dotfiles_bashrc_debug "virtualenvwrapper: after source"
fi

#=============================================================================
# LANGUAGE VERSION MANAGERS
#=============================================================================
# nvm - node version manager
_dotfiles_bashrc_debug "nvm: checking"
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
_dotfiles_bashrc_debug "nvm: configured"

# deno
if [[ -f "$HOME/.deno/env" ]]; then
    _dotfiles_bashrc_debug "deno: before source"
    source "$HOME/.deno/env"
    _dotfiles_bashrc_debug "deno: after source"
fi

#=============================================================================
# FZF
#=============================================================================
_dotfiles_bashrc_debug "fzf: checking"
if command -v fzf >/dev/null 2>&1; then
  _dotfiles_bashrc_debug "fzf: found $(command -v fzf) version=$(fzf --version 2>/dev/null | head -n 1 || echo unknown)"
  if fzf --help 2>/dev/null | grep -q -- '--bash'; then
    _dotfiles_bashrc_debug "fzf: before fzf --bash"
    eval "$(fzf --bash)" 2>/dev/null
    _dotfiles_bashrc_debug "fzf: after fzf --bash"
  else
    _dotfiles_bashrc_debug "fzf: --bash not supported, skipping"
  fi
fi

#=============================================================================
# MACHINE-SPECIFIC OVERRIDES
#=============================================================================
# These files exist in $HOME (not in repo) for per-machine configuration
for _dotfiles_local_bashrc in \
    "$HOME/.bashrc_macair" \
    "$HOME/.bashrc_ubu_oracle" \
    "$HOME/.bash_macair" \
    "$HOME/.bashrc_malo" \
    "$HOME/.bashrc_local"; do
    if [[ -f "$_dotfiles_local_bashrc" ]]; then
        _dotfiles_bashrc_debug "local: before source $_dotfiles_local_bashrc"
        . "$_dotfiles_local_bashrc"
        _dotfiles_bashrc_debug "local: after source $_dotfiles_local_bashrc"
    fi
done
unset _dotfiles_local_bashrc

_dotfiles_bashrc_debug "done"
unset DOTFILES_BASHRC_LOADING
unset -f _dotfiles_bashrc_debug
unset _dotfiles_bashrc_debug_enabled

# >>> END MANAGED CONFIG <<<
