# If you come from bash you might have to change your $PATH.
export PATH=$HOME/bin:/usr/local/bin:$PATH

# Path to your oh-my-zsh installation.
export ZSH=/Users/mauro/.oh-my-zsh

# Set name of the theme to load. Optionally, if you set this to "random"
# it'll load a random theme each time that oh-my-zsh is loaded.
# See https://github.com/robbyrussell/oh-my-zsh/wiki/Themes
#ZSH_THEME="robbyrussell"
ZSH_THEME="agnoster"

# Uncomment the following line to use case-sensitive completion.
# CASE_SENSITIVE="true"

# Uncomment the following line to use hyphen-insensitive completion. Case
# sensitive completion must be off. _ and - will be interchangeable.
# HYPHEN_INSENSITIVE="true"

# Uncomment the following line to disable bi-weekly auto-update checks.
# DISABLE_AUTO_UPDATE="true"

# Uncomment the following line to change how often to auto-update (in days).
# export UPDATE_ZSH_DAYS=13

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COLORS="true"

# Uncomment the following line to disable auto-setting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
# COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# The optional three formats: "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# HIST_STAMPS="mm/dd/yyyy"

# Would you like to use another custom folder than $ZSH/custom?
# ZSH_CUSTOM=/path/to/new-custom-folder

# Which plugins would you like to load? (plugins can be found in ~/.oh-my-zsh/plugins/*)
# Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
plugins=(git)

source $ZSH/oh-my-zsh.sh

# User configuration

# export MANPATH="/usr/local/man:$MANPATH"

# You may need to manually set your language environment
# export LANG=en_US.UTF-8

# Preferred editor for local and remote sessions
# if [[ -n $SSH_CONNECTION ]]; then
#   export EDITOR='vim'
# else
#   export EDITOR='mvim'
# fi

# Compilation flags
# export ARCHFLAGS="-arch x86_64"

# ssh
# export SSH_KEY_PATH="~/.ssh/rsa_id"

# Set personal aliases, overriding those provided by oh-my-zsh libs,
# plugins, and themes. Aliases can be placed here, though oh-my-zsh
# users are encouraged to define aliases within the ZSH_CUSTOM folder.
# For a full list of active aliases, run `alias`.
#
# Example aliases
# alias zshconfig="mate ~/.zshrc"
# alias ohmyzsh="mate ~/.oh-my-zsh"
#
#
alias passwd_gen='LC_ALL=C tr -dc "[:alpha:][:alnum:]" < /dev/urandom | head -c 20 | pbcopy'
alias updatedb='sudo launchctl load -w /System/Library/LaunchDaemons/com.apple.locate.plist'

gitlab_group_members_id() { [[ $1 != "" ]] && gitlab group_members $1|awk -F "|" '{print $5}'|grep -E '\d+' }
gitlab_users() {
	tmpfile=$(mktemp /tmp/gitlab_users.XXXXXX)
	exec 3>"$tmpfile"
	exec 4<"$tmpfile"
	rm "$tmpfile"
    gitlab users "{per_page: 100, page: 1}"|grep -E 'active' >& 3
    gitlab users "{per_page: 100, page: 2}"|grep -E 'active' >& 3

	if [[ $1 != "" ]]; then
		cat <& 4 >$1
    else
		cat <& 4
    fi
}
gitlab_users_match() {
	if [[ $1 != "" ]]; then
		awk -F '|' 'NR==FNR {seen[$1]=1; next} gsub(/ /, "", $10) && $10!="" && seen[$10]==1 { print $12}' $1 <(gitlab_users)
	fi
}
# group_id=$(gitlab create_group "4bi-2016" "4bi-2016" "{ visibility_level: 0 }" | tail -2|head -1|awk -F '|' '{print $4}')
# for i in $(gitlab_users_match 4bi.txt); do gitlab add_group_member 225 $i 30; done
#
export DEFAULT_USER=mauro

export GITLAB_API_PRIVATE_TOKEN=Q7oVX1DkeLBsfCRJX1qr
export GITLAB_API_ENDPOINT=http://gitlab.marconirovereto.it/api/v3
alias git_for_cfg='/usr/bin/git --git-dir=$HOME/.cfg/ --work-tree=$HOME'
