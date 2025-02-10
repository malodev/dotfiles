export startup_trace="$startup_trace\n~/.zshrc"
# echo "\n=====  ~/.zshrc  =====\n" >>/tmp/zsh_startup_trace.log
# echo "Initial fpath: $fpath" >>/tmp/zsh_startup_trace.log
# echo "" >>/tmp/zsh_startup_trace.log
initial_path=$PATH
initial_fpath=$fpath
# If you come from bash you might have to change your $PATH.
export PATH=$HOME/.local/bin:$HOME/bin:/usr/local/sbin:/usr/local/bin:$PATH

# Completion
export ZSH_DISABLE_COMPFIX="true"
fpath=(/usr/share/zsh/$ZSH_VERSION/functions $fpath)
# if you want use complition from bash in zsh
# uncomment next lines and comment next
# autoload -Uz compinit bashcompinit
# compinit
# bashcompinit
autoload -Uz compinit && compinit

# Zplug
# Check if zplug is installed
if [[ ! -d ~/.zplug ]]; then
  git clone https://github.com/zplug/zplug ~/.zplug
  source ~/.zplug/init.zsh && zplug update --self
fi

# if you encounter problem with zplug and compinit
# do the following (also valid for other folders):
# compaudit | xargs chmod -R go-w
# chown mauro:mauro ~/.zplug -R
# chmod go-w ~/.zplug -R
# chmod u+rwX ~/.zplug -R

## Essential
source ~/.zplug/init.zsh

zplug "lib/history", from:oh-my-zsh

## Make sure to use double quotes
zplug "zsh-users/zsh-history-substring-search"

## Use the package as a command
## And accept glob patterns (e.g., brace, wildcard, ...)
zplug "b4b4r07/enhancd", use:enhancd.sh

zplug "zsh-users/zsh-syntax-highlighting", defer:2
zplug "wfxr/forgit"
zplug "jeffreytse/zsh-vi-mode"
zplug 'zplug/zplug', hook-build:'zplug --self-manage'
#
zplug check || zplug install

## Then, source plugins and add commands to $PATH
zplug load
# END Zplug

# tabtab source for serverless package
# uninstall by removing these lines or running `tabtab uninstall serverless`
##[[ -f /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/serverless.zsh ]] && . /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/serverless.zsh
# tabtab source for sls package
# uninstall by removing these lines or running `tabtab uninstall sls`
##[[ -f /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/sls.zsh ]] && . /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/sls.zsh

bindkey -v                                     # vi mode
bindkey ^R history-incremental-search-backward # rebind ^R
bindkey ^S history-incremental-search-forward  # rebind ^S

echo "🛠️zshrc loaded."
# Log of changes:
# if command -v ccdiff &>/dev/null; then
#   diff_path=$(ccdiff <(echo $initial_path) <(echo $PATH))
#   diff_fpath=$(ccdiff <(echo $initial_fpath) <(echo $fpath))
#   echo "\nDiff fpath:\n$diff_fpath" >>/tmp/zsh_startup_trace.log
#   echo "\nDiff PATH:\n$diff_path" >>/tmp/zsh_startup_trace.log
#   echo "\nNew fpath:\n$fpath" >>/tmp/zsh_startup_trace.log
# fi
source "$HOME/.zshrc_local"
