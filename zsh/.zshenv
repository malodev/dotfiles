# export startup_trace="$startup_trace\n~/.zshenv"
# echo "\n=====  ~/.zshenv  =====\n" >> /tmp/zsh_startup_trace.log
initial_path=$PATH
initial_fpath=$fpath

export TERM="xterm-256color"
skip_global_compinit=1



# Log of changes:
# if command -v ccdiff &>/dev/null; then
#   diff_path=$(ccdiff <(echo $initial_path) <(echo $PATH))
#   diff_fpath=$(ccdiff <(echo $initial_fpath) <(echo $fpath))
#   echo "Diff fpath:\n$diff_fpath" >>/tmp/zsh_startup_trace.log
#   echo "" >>/tmp/zsh_startup_trace.log
#   echo "Diff PATH:\n$diff_path" >>/tmp/zsh_startup_trace.log
# fi
