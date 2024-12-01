def --env cx [arg] {
    cd $arg
    ls -l
}

alias l = ls --all
alias c = clear
alias ll = ls -l
alias lk = lsd -al --hyperlink=auto 
alias v = nvim
alias t = tmux
alias tl = tmux list-sessions
alias ts = tmux new-session -A -s 

use ~/.cache/starship/init.nu
source ~/.cache/carapace/init.nu
source ~/.zoxide.nu
