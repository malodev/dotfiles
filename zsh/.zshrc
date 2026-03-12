# ~/.zshrc — Optimized with zinit + turbo mode
# Migration from zplug: 2026-03-12

# If you come from bash you might have to change your $PATH.
export PATH=$HOME/.local/bin:$HOME/bin:/usr/local/sbin:/usr/local/bin:$PATH

export DEFAULT_USER="$USER"

#=============================================================================
# OS DETECTION
#=============================================================================
# Detect operating system and set environment variables
# Keeps zsh config independent (doesn't source scripts/common.sh)
if [[ "$(uname)" == "Darwin" ]]; then
    export OSX=1
    export IS_MACOS=1
else
    export OSX=0
    export IS_MACOS=0
fi

if [[ "$(uname)" == "Linux" ]]; then
    export LINUX=1
    export IS_LINUX=1
else
    export LINUX=0
    export IS_LINUX=0
fi

# Detect Linux distributions
if [[ "$IS_LINUX" == "1" ]]; then
    [[ -f /etc/arch-release ]] && export IS_ARCH=1
    [[ -f /etc/debian_version ]] && export IS_DEBIAN=1
fi

#=============================================================================
# MACOS-SPECIFIC
#=============================================================================
[[ "$OSX" == "1" ]] && alias updatedb='sudo launchctl load -w /System/Library/LaunchDaemons/com.apple.locate.plist'

# Make sure that homebrew binaries are in the PATH
# Detect both Intel Macs (/usr/local/bin) and Apple Silicon (/opt/homebrew/bin)
if [[ "$OSX" == "1" ]]; then
    if [[ -d /opt/homebrew/bin ]]; then
        # Apple Silicon Mac
        export PATH="/opt/homebrew/bin:$PATH"
    elif [[ -d /usr/local/bin ]]; then
        # Intel Mac
        export PATH="/usr/local/bin:$PATH"
    fi
fi

# Linux Homebrew (uncomment if using Homebrew on Linux)
if [[ "$IS_LINUX" == "1" ]] && [[ -d /home/linuxbrew/.linuxbrew/bin ]]; then
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
fi

#=============================================================================
# COMPLETION
#=============================================================================
export ZSH_DISABLE_COMPFIX="true"
# Add system functions path if it exists (Linux)
[[ -d /usr/share/zsh/$ZSH_VERSION/functions ]] && fpath=(/usr/share/zsh/$ZSH_VERSION/functions $fpath)
# On macOS, zsh functions are in a different location
[[ -d /usr/local/share/zsh/$ZSH_VERSION/functions ]] && fpath=(/usr/local/share/zsh/$ZSH_VERSION/functions $fpath)

# Compinit — cached, only regenerate once per day
# Required early because fzf, carapace, and machine-specific configs use compdef
autoload -Uz compinit
if [[ -n ${ZDOTDIR:-$HOME}/.zcompdump(#qN.mh+24) ]]; then
  compinit
else
  compinit -C  # use cache (fast)
fi

# Order of groups can be configured with zstyle group-order
zstyle ':completion:*:git:*' group-order 'main commands' 'alias commands' 'external commands'

#=============================================================================
# ZINIT — plugin manager (replaces zplug)
#=============================================================================
# Auto-install zinit if not present
ZINIT_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}/zinit/zinit.git"
if [[ ! -d "$ZINIT_HOME" ]]; then
  mkdir -p "$(dirname $ZINIT_HOME)"
  git clone https://github.com/zdharma-continuum/zinit.git "$ZINIT_HOME"
fi
source "${ZINIT_HOME}/zinit.zsh"

# --- Plugins (turbo mode = deferred loading) ---

# Vi mode — load immediately (needs to be active for keybindings)
zinit light jeffreytse/zsh-vi-mode

# History substring search — deferred
zinit ice wait"0" lucid
zinit light zsh-users/zsh-history-substring-search

# Enhancd — deferred
zinit ice wait"0" lucid pick"init.sh"
zinit light b4b4r07/enhancd

# Forgit — deferred (low priority, not needed at prompt)
zinit ice wait"1" lucid
zinit light wfxr/forgit

# Syntax highlighting — MUST load last
zinit ice wait"1" lucid
zinit light zsh-users/zsh-syntax-highlighting

# --- END Plugins ---

bindkey -v                                     # vi mode
bindkey ^R history-incremental-search-backward # rebind ^R
bindkey ^S history-incremental-search-forward  # rebind ^S

#=============================================================================
# OPTIONAL TOOLS (with existence checks)
#=============================================================================
# Starship prompt - https://starship.rs/
if command -v starship >/dev/null 2>&1; then
    eval "$(starship init zsh)"
    echo "🛠️starship loaded."
fi

# Zoxide - smarter cd command - https://github.com/ajeetdsouza/zoxide
if command -v zoxide >/dev/null 2>&1; then
    eval "$(zoxide init zsh)"
fi

# Carapace - multi-shell completion - https://github.com/carapace-sh/carapace
if command -v carapace >/dev/null 2>&1; then
    export CARAPACE_BRIDGES='zsh,fish,bash,inshellisense'
    zstyle ':completion:*' format $'\e[2;37mCompleting %d\e[m'
    source <(carapace _carapace)
    echo "🛠️carapace loaded."
fi

#=============================================================================
# GIT CONFIGURATION
#=============================================================================
alias git_for_cfg='/usr/bin/git --git-dir=$HOME/.cfg/ --work-tree=$HOME'
alias config='/usr/bin/git --git-dir=$HOME/.cfg/ --work-tree=$HOME'
alias cfg='/usr/bin/git --git-dir=$HOME/.cfg/ --work-tree=$HOME'
alias cfglazy='lazygit --git-dir=$HOME/.cfg/ --work-tree=$HOME'
alias cfgls='config ls-tree --full-tree --name-only -r HEAD'

#=============================================================================
# LS COLORS
#=============================================================================
if [[ "$OSX" == "1" ]]; then
   export CLICOLOR=1
   export LSCOLORS=gxBxhxDxfxhxhxhxhxcxcx
else
  eval "$(dircolors -b)"
  alias ls='ls --color=auto'
fi

#=============================================================================
# ALIASES
#=============================================================================
alias l='ls -al'
alias v='nvim'
alias t='tmux'
alias ts='tmux new-session -A -s'
alias tl='tmux list-sessions'

export EDITOR=nvim

#=============================================================================
# PATH ADDITIONS
#=============================================================================
# Radicle - peer-to-peer code collaboration
[[ -d "$HOME/.radicle/bin" ]] && export PATH="$HOME/.radicle/bin:$PATH"

# CPAN (for building stow)
PATH="$HOME/perl5/bin${PATH:+:${PATH}}"; export PATH;
PERL5LIB="$HOME/perl5/lib/perl5${PERL5LIB:+:${PERL5LIB}}"; export PERL5LIB;
PERL_LOCAL_LIB_ROOT="$HOME/perl5${PERL_LOCAL_LIB_ROOT:+:${PERL_LOCAL_LIB_ROOT}}"; export PERL_LOCAL_LIB_ROOT;
PERL_MB_OPT="--install_base \"$HOME/perl5\""; export PERL_MB_OPT;
PERL_MM_OPT="INSTALL_BASE=$HOME/perl5"; export PERL_MM_OPT;

# pnpm - https://pnpm.io/
# Fixed: use $HOME instead of hardcoded username
export PNPM_HOME="$HOME/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac

# yarn - https://yarnpkg.com/
[[ -d "$HOME/.yarn/bin" ]] && export PATH="$HOME/.yarn/bin:$HOME/.config/yarn/global/node_modules/.bin:$PATH"

#=============================================================================
# LANGUAGE VERSION MANAGERS — lazy-loaded for fast startup
#=============================================================================
# nvm - node version manager (lazy-loaded: ~300ms savings)
# Check both standard and XDG locations for nvm
if [ -d "${HOME}/.nvm" ]; then
  export NVM_DIR="${HOME}/.nvm"
elif [ -n "${XDG_CONFIG_HOME-}" ] && [ -d "${XDG_CONFIG_HOME}/nvm" ]; then
  export NVM_DIR="${XDG_CONFIG_HOME}/nvm"
fi
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # Add nvm's default node to PATH immediately (no subprocess cost)
  [ -s "$NVM_DIR/alias/default" ] && PATH="$NVM_DIR/versions/node/$(cat "$NVM_DIR/alias/default")/bin:$PATH"
  # Lazy-load nvm itself — only runs when you first call nvm/node/npm/npx
  nvm() {
    unfunction nvm node npm npx 2>/dev/null
    \. "$NVM_DIR/nvm.sh"
    nvm "$@"
  }
  node() {
    unfunction nvm node npm npx 2>/dev/null
    \. "$NVM_DIR/nvm.sh"
    node "$@"
  }
  npm() {
    unfunction nvm node npm npx 2>/dev/null
    \. "$NVM_DIR/nvm.sh"
    npm "$@"
  }
  npx() {
    unfunction nvm node npm npx 2>/dev/null
    \. "$NVM_DIR/nvm.sh"
    npx "$@"
  }
fi

# deno
[ -f "$HOME/.deno/env" ] && source "$HOME/.deno/env"

# rust cargo
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"

#=============================================================================
# FUZZY FINDER
#=============================================================================
# fzf integration with zsh-vi-mode
# Uses modern `fzf --zsh` (single source, replaces legacy ~/.fzf.zsh)
# 2>/dev/null suppresses harmless "(eval):1: can't change option: zle"
# (upstream fzf bug: saves/restores read-only zle option in always blocks)
if command -v fzf >/dev/null 2>&1; then
  function zvm_after_init() {
    eval "$(fzf --zsh)" 2>/dev/null
  }
  # Also source directly in case zsh-vi-mode isn't loaded yet
  eval "$(fzf --zsh)" 2>/dev/null
fi

#=============================================================================
# HISTORY SETTINGS
#=============================================================================
# In bash, Setting the HISTFILESIZE and HISTSIZE variables to an empty string
# makes the bash history size unlimited. However, it's not possible to set the
# history to an unlimited size in zsh (theoretically, at least). From a zsh
# mailing list, it appears the max history size can be LONG_MAX from limits.h
# header file. That has a (really huge) value of 9223372036854775807, which
# should be enough to store trillions of commands.
export HISTFILE=~/.zsh_history
export HISTFILESIZE=9223372036854775807
export HISTSIZE=9223372036854775807
export SAVEHIST=9223372036854775807

# Records the timestamp of each command. To view time: history -E
export HISTTIMEFORMAT="[%F %T] "

setopt EXTENDED_HISTORY          # Timestamps
setopt APPEND_HISTORY            # Append, don't overwrite
setopt INC_APPEND_HISTORY        # Write immediately, not on exit
# setopt SHARE_HISTORY           # ← REMOVE THIS (causes race conditions + dedup storms)

setopt HIST_FIND_NO_DUPS         # Don't show dups when searching (cosmetic only)
setopt HIST_EXPIRE_DUPS_FIRST    # Only remove dups when hitting limit
setopt HIST_IGNORE_SPACE         # Commands starting with space are private
setopt HIST_VERIFY               # Show command before executing from history
setopt HIST_REDUCE_BLANKS        # Clean up whitespace

# REMOVE these aggressive dedup options:
# setopt HIST_IGNORE_ALL_DUPS    # ← This destroys your history
# setopt HIST_SAVE_NO_DUPS       # ← This too

bindkey "^[[A" history-substring-search-up
bindkey "^[[B" history-substring-search-down

#=============================================================================
# MACHINE-SPECIFIC OVERRIDES
#=============================================================================
# These files exist in $HOME (not in repo) for per-machine configuration
[[ -f ~/.zshrc_macair ]] && source ~/.zshrc_macair
[[ -f ~/.zshrc_ubu_oracle ]] && source ~/.zshrc_ubu_oracle

echo "🛠️zshrc loaded."
