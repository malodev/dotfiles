ZSH_DISABLE_COMPFIX="true"

fpath=(/usr/share/zsh/$ZSH_VERSION/functions $fpath)

# If you come from bash you might have to change your $PATH.
export PATH=$HOME/.local/bin:$HOME/bin:/usr/local/sbin:/usr/local/bin:$PATH

# Zplug
# Check if zplug is installed
if [[ ! -d ~/.zplug ]]; then
    git clone https://github.com/zplug/zplug ~/.zplug
    source ~/.zplug/init.zsh && zplug update --self
fi

ZSH_DISABLE_COMPFIX="true"
# Essential
source ~/.zplug/init.zsh

ZSH_DISABLE_COMPFIX="true"
zplug "lib/history", from:oh-my-zsh

# Make sure to use double quotes
zplug "zsh-users/zsh-history-substring-search"

# Use the package as a command
# And accept glob patterns (e.g., brace, wildcard, ...)
zplug "b4b4r07/enhancd", use:enhancd.sh

zplug "zsh-users/zsh-syntax-highlighting", defer:2

ZSH_DISABLE_COMPFIX="true"
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
