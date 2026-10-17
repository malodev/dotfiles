#!/usr/bin/env bash
#=============================================================================
# parrot-prompt.sh
#
# Two-line Parrot/Kali style Bash prompt (ported from root@10.0.3.13):
#   ╭─[✗:1]─[user@host]─[~/path] (branch *)
#   ╰──╼ (venv) $
#
# Activated when:
#   - DOTFILES_BASH_PROMPT="parrot"
#   - or ~/.config/dotfiles-bash-prompt contains "parrot"
#   - or toggled via `dot prompt parrot` / `bash_prompt_parrot`
#=============================================================================

export GIT_PS1_SHOWDIRTYSTATE=1
export GIT_PS1_SHOWCOLORHINTS=1
export GIT_PS1_SHOWUNTRACKEDFILES=1
export VIRTUAL_ENV_DISABLE_PROMPT=1

# Ensure __git_ps1 is available (either from system git-prompt.sh or lightweight fallback)
if ! declare -F __git_ps1 >/dev/null 2>&1; then
    for _gp in \
        /usr/share/git/completion/git-prompt.sh \
        /usr/lib/git-core/git-sh-prompt \
        /etc/bash_completion.d/git-prompt \
        /opt/homebrew/etc/bash_completion.d/git-prompt.sh \
        /usr/local/etc/bash_completion.d/git-prompt.sh; do
        if [[ -f "$_gp" ]]; then
            # shellcheck disable=SC1090
            source "$_gp"
            break
        fi
    done
    unset _gp
fi

if ! declare -F __git_ps1 >/dev/null 2>&1; then
    __git_ps1() {
        local fmt="${1:- (%s)}"
        local b
        b="$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null)" || return 0
        [[ -n "$b" ]] && printf "$fmt" "$b"
    }
fi

_parrot_virtualenv_info() {
    if [[ -n "${VIRTUAL_ENV:-}" ]]; then
        printf "(%s) " "${VIRTUAL_ENV##*/}"
    elif [[ -n "${CONDA_DEFAULT_ENV:-}" ]]; then
        printf "(%s) " "${CONDA_DEFAULT_ENV}"
    fi
}

_parrot_check_errs() {
    if [[ "${1:-0}" -ne 0 ]]; then
        printf "[✗:%s]─" "${1}"
    fi
}

parrot_prompt() {
    local color_mode="${1:-yes}"
    local NO_COLOR="\[\e[0m\]"
    local DEFAULT_COLOR="\[\e[0;39m\]"
    local RED="\[\e[0;31m\]"
    local LIGHT_RED="\[\e[1;31m\]"
    local GREEN="\[\e[0;32m\]"
    local YELLOW="\[\e[1;33m\]"
    local BICyan="\[\e[1;96m\]"
    local BIPurple="\[\e[1;95m\]"

    if [[ "$color_mode" == "yes" && "${TERM:-dumb}" != "dumb" ]]; then
        local user_host
        if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
            user_host="${LIGHT_RED}root${YELLOW}@${BICyan}\h"
        else
            user_host="${DEFAULT_COLOR}\u${YELLOW}@${BICyan}\h"
        fi
        PS1="${RED}╭─\$(_parrot_check_errs \$?)[${user_host}${RED}]─[${GREEN}\w${RED}]\$(__git_ps1 \" ${BICyan}(%s)\")\n${RED}╰──╼ ${BIPurple}\$(_parrot_virtualenv_info)${YELLOW}\\\$${NO_COLOR} "
    else
        PS1="┌──[\u@\h]─[\w]\$(__git_ps1 \" (%s)\")\n└──╼ \$(_parrot_virtualenv_info)\\\$ "
    fi

    case "${TERM:-}" in
        xterm*|rxvt*)
            PS1="\[\e]0;${debian_chroot:+($debian_chroot)}\u@\h: \w\a\]$PS1"
            ;;
    esac
}
