fpath=(/usr/share/zsh/$ZSH_VERSION/functions $fpath)

# Fig pre block. Keep at the top of this file.
[[ -f $HOME/.fig/shell/zshrc.pre.zsh ]] && source "$HOME/.fig/shell/zshrc.pre.zsh"
export LC_ALL=it_IT.UTF-8 && export LANG=it_IT.UTF-8
# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# If you come from bash you might have to change your $PATH.
export PATH=$HOME/bin:/usr/local/sbin:/usr/local/bin:$PATH

# Zplug
# Check if zplug is installed
if [[ ! -d ~/.zplug ]]; then
    git clone https://github.com/zplug/zplug ~/.zplug
    source ~/.zplug/init.zsh && zplug update --self
fi

# Essential
source ~/.zplug/init.zsh

zplug "lib/history", from:oh-my-zsh

# Make sure to use double quotes
zplug "zsh-users/zsh-history-substring-search"

# Use the package as a command
# And accept glob patterns (e.g., brace, wildcard, ...)
zplug "b4b4r07/enhancd", use:enhancd.sh

zplug "zsh-users/zsh-syntax-highlighting", defer:2

zplug check || zplug install

# Then, source plugins and add commands to $PATH
zplug load
# END Zplug

# tabtab source for serverless package
# uninstall by removing these lines or running `tabtab uninstall serverless`
##[[ -f /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/serverless.zsh ]] && . /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/serverless.zsh
# tabtab source for sls package
# uninstall by removing these lines or running `tabtab uninstall sls`
##[[ -f /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/sls.zsh ]] && . /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/sls.zsh

bindkey -v # vi mode
bindkey ^R history-incremental-search-backward # rebind ^R 
bindkey ^S history-incremental-search-forward # rebind ^S

echo "🛠️zshrc loaded."
source "$HOME/.zshrc_local"


# pnpm
export PNPM_HOME="/home/mauro/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
# pnpm end
