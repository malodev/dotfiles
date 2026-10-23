alias l='ls -alF'
alias v='nvim'
alias t='tmux'
alias ts='tmux new-session -A -s'
alias tl='tmux list-sessions'
# alias git_for_cfg='/usr/bin/git --git-dir=$HOME/.cfg/ --work-tree=$HOME'

# Machine-local aliases (gam install paths, tool overrides) belong in
# ~/.bash_aliases_local, which this file sources at the end.

# >>> machine-specific overrides (untracked) <<<
[[ -f ~/.bash_aliases_local ]] && source ~/.bash_aliases_local
# >>> END MANAGED CONFIG <<<
