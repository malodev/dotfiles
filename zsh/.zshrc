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
# HISTORY SETTINGS
#=============================================================================
HISTFILE="$HOME/.zsh_history"
HISTSIZE=1000000
SAVEHIST=1000000

setopt EXTENDED_HISTORY       # Save timestamp with each command
setopt INC_APPEND_HISTORY     # Write to file immediately (implies APPEND_HISTORY)
setopt HIST_FIND_NO_DUPS      # Don't show dups when searching
setopt HIST_EXPIRE_DUPS_FIRST # Expire dups first when trimming
setopt HIST_IGNORE_SPACE      # Commands starting with space are private
setopt HIST_VERIFY            # Show command before executing from history
setopt HIST_REDUCE_BLANKS     # Clean up whitespace

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
# User custom completions (drop _mytool files here)
fpath=($HOME/.zsh/completions $fpath)
# Add system functions path if it exists (Linux)
[[ -d /usr/share/zsh/$ZSH_VERSION/functions ]] && fpath=(/usr/share/zsh/$ZSH_VERSION/functions $fpath)
# On macOS, zsh functions are in a different location
[[ -d /usr/local/share/zsh/$ZSH_VERSION/functions ]] && fpath=(/usr/local/share/zsh/$ZSH_VERSION/functions $fpath)

# Compinit — cached, only regenerate once per day
# Required early because fzf and machine-specific configs use compdef
autoload -Uz compinit
if [[ -n ${ZDOTDIR:-$HOME}/.zcompdump(#qN.mh+24) ]]; then
  compinit
else
  compinit -C  # use cache (fast)
fi
# Compile zcompdump for faster loading (if missing or outdated)
{
  if [[ -s ~/.zcompdump && ( ! -s ~/.zcompdump.zwc || ~/.zcompdump -nt ~/.zcompdump.zwc ) ]]; then
    zcompile ~/.zcompdump
  fi
} &!

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

# Completion formatting (dimmed group headers)
zstyle ':completion:*' format $'\e[2;37mCompleting %d\e[m'

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
  # Resolves alias chains (lts/* → lts/iron → v20.x.x) and partial versions (24 → v24.14.0)
  if [ -s "$NVM_DIR/alias/default" ]; then
    NVM_DEFAULT=$(cat "$NVM_DIR/alias/default" 2>/dev/null)
    # Resolve lts/* alias chains
    while [[ "$NVM_DEFAULT" == lts/* ]]; do
      NVM_DEFAULT=$(cat "$NVM_DIR/alias/$NVM_DEFAULT" 2>/dev/null)
    done
    # Resolve partial version (e.g. "24" → "v24.14.0")
    if [ -n "$NVM_DEFAULT" ] && [ "${NVM_DEFAULT#v}" = "$NVM_DEFAULT" ] && [ "${NVM_DEFAULT#lts/}" = "$NVM_DEFAULT" ]; then
      NVM_DEFAULT=$(ls "$NVM_DIR/versions/node/" 2>/dev/null | grep "^v${NVM_DEFAULT}[.-]" | sort -V | tail -1)
    fi
    [ -n "$NVM_DEFAULT" ] && PATH="$NVM_DIR/versions/node/$NVM_DEFAULT/bin:$PATH"
  fi
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

bindkey "^[[A" history-substring-search-up
bindkey "^[[B" history-substring-search-down

#=============================================================================
# MACHINE-SPECIFIC OVERRIDES
#=============================================================================
# These files exist in $HOME (not in repo) for per-machine configuration
[[ -f ~/.zshrc_macair ]] && source ~/.zshrc_macair
[[ -f ~/.zshrc_ubu_oracle ]] && source ~/.zshrc_ubu_oracle

echo "🛠️zshrc loaded."

# bun completions
[ -s "/Users/mauro/.bun/_bun" ] && source "/Users/mauro/.bun/_bun"

alias gam="/Users/mauro/bin/gam7/gam"
