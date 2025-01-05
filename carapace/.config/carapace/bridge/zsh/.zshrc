
# Completion
export ZSH_DISABLE_COMPFIX="true"
fpath=(/home/linuxbrew/.linuxbrew/share/zsh/site-functions /home/linuxbrew/.linuxbrew/Cellar/zsh/5.9/share/zsh/functions $fpath)
# if you want use complition from bash in zsh
# uncomment next lines and comment next
# autoload -Uz compinit bashcompinit
# compinit
# bashcompinit
autoload -Uz compinit && compinit
