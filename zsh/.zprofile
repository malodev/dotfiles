export startup_trace="$startup_trace\n~/.zprofile"
echo "\n=====  ~/.zprofile  =====\n" >> /tmp/zsh_startup_trace.log
initial_path=$PATH
initial_fpath=$fpath

#eval $(/home/linuxbrew/.linuxbrew/bin/brew shellenv)


# Added by Toolbox App
# Fixed: use $HOME instead of hardcoded username; make conditional on directory existence
JETBRAINS_TOOLBOX="$HOME/.local/share/JetBrains/Toolbox/scripts"
[[ -d "$JETBRAINS_TOOLBOX" ]] && export PATH="$PATH:$JETBRAINS_TOOLBOX"

# Log of changes:
if command -v ccdiff &>/dev/null; then
  diff_path=$(ccdiff <(echo $initial_path) <(echo $PATH))
  diff_fpath=$(ccdiff <(echo $initial_fpath) <(echo $fpath))
  echo "\nDiff fpath:\n$diff_fpath" >>/tmp/zsh_startup_trace.log
  echo "\nDiff PATH:\n$diff_path" >>/tmp/zsh_startup_trace.log
fi
