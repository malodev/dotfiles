# don't put duplicate lines in the history. See bash(1) for more options
export HISTCONTROL=ignoredups

# check the window size after each command and, if necessary,
# update the values of LINES and COLUMNS.
shopt -s checkwinsize

# make less more friendly for non-text input files, see lesspipe(1)
[ -x /usr/bin/lesspipe ] && eval "$(lesspipe)"

# set variable identifying the chroot you work in (used in the prompt below)
if [ -z "$debian_chroot" -a -r /etc/debian_chroot ]; then
    debian_chroot=$(cat /etc/debian_chroot)
fi
PS1='${debian_chroot:+($debian_chroot)}\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '

# If this is an xterm set the title to user@host:dir
case "$TERM" in
xterm*|rxvt*)
    PROMPT_COMMAND='echo -ne "\033]0;${USER}@${HOSTNAME}: ${PWD/$HOME/~}\007"'
    ;;
*)
    ;;
esac

# Alias definitions.
# You may want to put all your additions into a separate file like
# ~/.bash_aliases, instead of adding them here directly.
# See /usr/share/doc/bash-doc/examples in the bash-doc package.
[ -f ~/.bash_aliases ] && . ~/.bash_aliases

[ -d ~/.local/bin ] && export PATH="~/.local/bin:$PATH"
[ -d ~/bin ] && export PATH="~/bin:$PATH"

# enable color support of ls and also add handy aliases
if [ "$TERM" != "dumb" ]; then
    eval "`dircolors -b`"
    alias ls='ls --color=auto'
    #alias dir='ls --color=auto --format=vertical'
    #alias vdir='ls --color=auto --format=long'
fi

# virtualenvwrapper settings
[ -d $HOME/.virtualenvs ] && export WORKON_HOME="$HOME/.virtualenvs"
[ -f $HOME/bin/virtualenvwrapper_bashrc ] && source $HOME/bin/virtualenvwrapper_bashrc

which powerline-daemon >/dev/null && powerline-daemon -q 
POWERLINE_BASH_CONTINUATION=1
POWERLINE_BASH_SELECT=1
[ -f /usr/share/powerline/bindings/bash/powerline.sh ] && . /usr/share/powerline/bindings/bash/powerline.sh

# added by Miniconda3 3.18.3 installer
[ -d /opt/miniconda/bin ] && export PATH="$PATH:/opt/miniconda/bin"
export IBUS_ENABLE_SYNC_MODE=1

# Eternal bash history
# ---------------------
# Undocumented feature which sets the size to 'unlimited'.
# http://stackoverflow.com/questions/9457233/unlimited-bash-history
export HISTFILESIZE=
export HISTSIZE=
# Force prompt to write history after every command. See 'help history'
PROMPT_COMMAND="history -a; history -c; history -r; ${PROMPT_COMMAND}"
export HISTFILE=$HOME/.bash_eternal_history

# added by Anaconda3 installer
export PATH="/opt/anaconda3/bin:$PATH"
