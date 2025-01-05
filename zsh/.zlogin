export startup_trace="$startup_trace\n~/.zlogin"
echo "\n=====  ~/.zlogin  =====\n" >> /tmp/zsh_startup_trace.log
initial_path=$PATH
initial_fpath=$fpath


# Log of changes:
diff_path=$(ccdiff <(echo $initial_path) <(echo $PATH))
diff_fpath=$(ccdiff <(echo $initial_fpath) <(echo $fpath))
echo "\nDiff fpath:\n$diff_fpath" >>/tmp/zsh_startup_trace.log
echo "\nDiff PATH:\n$diff_path" >>/tmp/zsh_startup_trace.log
