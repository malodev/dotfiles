# Fig pre block. Keep at the top of this file.
[[ -f $HOME/.fig/shell/zshrc.pre.zsh ]] && source "$HOME/.fig/shell/zshrc.pre.zsh"
export LC_ALL=it_IT.UTF-8 && export LANG=it_IT.UTF-8
# If you come from bash you might have to change your $PATH.
export PATH=$HOME/bin:/usr/local/sbin:/usr/local/bin:$PATH

# Zplug
# Check if zplug is installed
#if [[ ! -d ~/.zplug ]]; then
#    git clone https://github.com/zplug/zplug ~/.zplug
#    source ~/.zplug/init.zsh && zplug update --self
#fi

# Essential
source ~/.zplug/init.zsh

zplug "lib/history", from:oh-my-zsh

# Make sure to use double quotes
zplug "zsh-users/zsh-history-substring-search"

# Use the package as a command
# And accept glob patterns (e.g., brace, wildcard, ...)
zplug "Jxck/dotfiles", as:command, use:"bin/{histuniq,color}"
zplug "djui/alias-tips"
zplug "b4b4r07/enhancd", use:enhancd.sh

zplug "zsh-users/zsh-syntax-highlighting", defer:2

POWERLEVEL9K_MODE='awesome-fontconfig'
#POWERLEVEL9K_MODE='nerdfont-complete'

zplug "bhilburn/powerlevel9k", as:theme, use:powerlevel9k.zsh-theme

zplug "plugins/git",   from:oh-my-zsh
zplug "plugins/tmux",   from:oh-my-zsh

zplug check || zplug install

# Then, source plugins and add commands to $PATH
zplug load
# END Zplug

# tabtab source for serverless package
# uninstall by removing these lines or running `tabtab uninstall serverless`
[[ -f /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/serverless.zsh ]] && . /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/serverless.zsh
# tabtab source for sls package
# uninstall by removing these lines or running `tabtab uninstall sls`
[[ -f /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/sls.zsh ]] && . /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/sls.zsh

source "$HOME/.zshrc_local"
