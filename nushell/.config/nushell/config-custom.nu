def --env cx [arg] {
    cd $arg
    ls -l
}
$env.EDITOR = 'nvim'
alias v = nvim
alias vi = nvim
alias vim = nvim
alias l = ls --all
alias c = clear
alias ll = ls -l
alias lk = lsd -al --hyperlink=auto 
alias t = tmux
alias tl = tmux list-sessions
alias ts = tmux new-session -A -s 

use ~/.cache/starship/init.nu
source ~/.cache/carapace/init.nu
source ~/.zoxide.nu
