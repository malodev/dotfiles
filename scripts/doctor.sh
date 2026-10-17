#!/usr/bin/env bash
#=============================================================================
# doctor.sh
#
# Cross-OS diagnostic & capability sensor for the dotfiles repository.
# Provides a deterministic snapshot of:
#   - Platform & environment (OS, distro, WSL, SSH, GUI, sudo)
#   - Toolchain & package managers (mise, brew, stow, nvim, starship, rg, fd, etc.)
#   - Agent harnesses & linked skills (pi, claude, agy, ~/.agents/skills)
#   - Stow symlink status & sentinel override drift
#   - Git working tree status
#
# Usage:
#   ./scripts/doctor.sh           # Human-readable summary
#   ./scripts/doctor.sh --json    # Structured JSON output for LLM agents
#=============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOTFILES_REPO="$SCRIPT_DIR"
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

JSON_MODE=0
for arg in "$@"; do
  case "$arg" in
    --json) JSON_MODE=1 ;;
    --help|-h)
      echo "Usage: $0 [--json]"
      echo "  (no args)  Human-readable health and capability report"
      echo "  --json     Machine-readable JSON report for LLM agents"
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

#-----------------------------------------------------------------------------
# 1. Platform & Environment Detection
#-----------------------------------------------------------------------------
UNAME_S="$(uname -s 2>/dev/null || echo "Unknown")"
UNAME_M="$(uname -m 2>/dev/null || echo "Unknown")"
OS="unknown"
DISTRO="none"
IS_WSL="false"
IS_SSH="false"
HAS_GUI="false"
HAS_SUDO="false"

case "$UNAME_S" in
  Darwin*)
    OS="macos"
    DISTRO="macos"
    HAS_GUI="true"
    ;;
  Linux*)
    OS="linux"
    if [[ -f /etc/os-release ]]; then
      # shellcheck disable=SC1091
      . /etc/os-release
      DISTRO="${ID:-linux}"
    fi
    if [[ -d /usr/share/omarchy ]] || grep -qi "omarchy" /etc/os-release 2>/dev/null; then
      DISTRO="omarchy"
    fi
    if grep -qi "microsoft" /proc/version 2>/dev/null; then
      IS_WSL="true"
    fi
    if [[ -n "${WAYLAND_DISPLAY:-}" || -n "${DISPLAY:-}" ]]; then
      HAS_GUI="true"
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    OS="windows"
    DISTRO="windows"
    HAS_GUI="true"
    ;;
esac

if [[ -n "${SSH_TTY:-}" || -n "${SSH_CONNECTION:-}" ]]; then
  IS_SSH="true"
  [[ "$OS" == "macos" ]] && HAS_GUI="false"
fi

if [[ "$EUID" -eq 0 ]] || sudo -n true 2>/dev/null; then
  HAS_SUDO="true"
elif groups 2>/dev/null | grep -Eq '\b(sudo|wheel|admin)\b'; then
  HAS_SUDO="prompt"
fi

#-----------------------------------------------------------------------------
# 2. Tool & Agent Checks
#-----------------------------------------------------------------------------
has_cmd() { command -v "$1" >/dev/null 2>&1; }
cmd_path() { command -v "$1" 2>/dev/null || echo ""; }

CORE_TOOLS=(git curl stow mise nvim starship zoxide rg fd fzf jq lazygit tmux zsh bash nu)
AGENT_TOOLS=(pi claude agy llm)

#-----------------------------------------------------------------------------
# 3. Symlink & Config Health
#-----------------------------------------------------------------------------
check_link_state() {
  local target="$1"
  if [[ -L "$target" ]]; then
    if [[ -e "$target" ]]; then
      local resolved
      resolved="$(readlink "$target" 2>/dev/null || true)"
      if [[ "$resolved" == *"dotfiles"* || "$resolved" == "$DOTFILES_REPO"* ]]; then
        echo "linked"
      else
        echo "external-symlink"
      fi
    else
      echo "dangling-symlink"
    fi
  elif [[ -e "$target" ]]; then
    echo "real-file-or-dir"
  else
    echo "absent"
  fi
}

NVIM_DEFAULT_STATE="$(check_link_state "$HOME/.config/nvim")"
NVIM_LITE_STATE="$(check_link_state "$HOME/.config/nvim-lite")"
NVIM_MALO_STATE="$(check_link_state "$HOME/.config/nvim-malo")"
NVIM_ACTIVE_PROFILE="none"
if [[ -L "$HOME/.config/nvim" ]]; then
  case "$(readlink "$HOME/.config/nvim" 2>/dev/null || true)" in
    *nvim-lite*) NVIM_ACTIVE_PROFILE="nvim-lite" ;;
    *nvim-malo*) NVIM_ACTIVE_PROFILE="nvim-malo" ;;
    *)           NVIM_ACTIVE_PROFILE="custom" ;;
  esac
fi
STARSHIP_STATE="$(check_link_state "$HOME/.config/starship.toml")"
TMUX_STATE="$(check_link_state "$HOME/.tmux.conf")"
ZSHRC_STATE="$(check_link_state "$HOME/.zshrc")"
DOT_BIN_STATE="$(check_link_state "$HOME/.local/bin/dot")"

#-----------------------------------------------------------------------------
# 4. Sentinel Override & Git Drift
#-----------------------------------------------------------------------------
SENTINEL="# >>> END MANAGED CONFIG <<<"
SENTINEL_FILES=(
  "zsh/.zshenv|$HOME/.zshenv"
  "zsh/.zshrc|$HOME/.zshrc"
  "bash/.bashrc|$HOME/.bashrc"
  "git/.gitconfig|$HOME/.gitconfig"
  "hyprland/.config/hypr/hyprland.conf|$HOME/.config/hypr/hyprland.conf"
)

DRIFTED_SENTINELS=()
for entry in "${SENTINEL_FILES[@]}"; do
  IFS='|' read -r rel home_file <<< "$entry"
  if [[ -f "$home_file" && -f "$DOTFILES_REPO/$rel" ]]; then
    last_line="$(tail -n 1 "$home_file" 2>/dev/null || true)"
    if [[ "$last_line" != "$SENTINEL" ]]; then
      DRIFTED_SENTINELS+=("$rel")
    fi
  fi
done

if command -v git >/dev/null 2>&1; then
  GIT_DIRTY_COUNT="$({ git -C "$DOTFILES_REPO" status --porcelain 2>/dev/null || true; } | wc -l | tr -d ' ')"
  GIT_BRANCH="$(git -C "$DOTFILES_REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
else
  GIT_DIRTY_COUNT="0"
  GIT_BRANCH="no-git"
fi

# Count linked skills
SHARED_SKILLS_COUNT=0
if [[ -d "$HOME/.agents/skills" ]]; then
  SHARED_SKILLS_COUNT="$(find "$HOME/.agents/skills" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')"
fi
CLAUDE_SKILLS_COUNT=0
if [[ -d "$HOME/.claude/skills" ]]; then
  CLAUDE_SKILLS_COUNT="$(find "$HOME/.claude/skills" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')"
fi
PI_SKILLS_COUNT=0
if [[ -d "$HOME/.pi/agent/skills" ]]; then
  PI_SKILLS_COUNT="$(find "$HOME/.pi/agent/skills" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')"
fi

# Recommend profile
RECOMMENDED_PROFILE="standard"
if [[ "$OS" == "macos" && "$IS_SSH" == "false" ]]; then
  RECOMMENDED_PROFILE="workstation-macos"
elif [[ "$DISTRO" == "omarchy" || ( "$OS" == "linux" && "$HAS_GUI" == "true" ) ]]; then
  RECOMMENDED_PROFILE="workstation-linux"
elif [[ "$IS_SSH" == "true" || "$HAS_GUI" == "false" ]]; then
  RECOMMENDED_PROFILE="headless-ssh"
elif [[ "$OS" == "windows" ]]; then
  RECOMMENDED_PROFILE="workstation-windows"
fi

#-----------------------------------------------------------------------------
# 5. Output Generation
#-----------------------------------------------------------------------------
if [[ "$JSON_MODE" == "1" ]]; then
  printf '{\n'
  printf '  "repo": "%s",\n' "$DOTFILES_REPO"
  printf '  "platform": {\n'
  printf '    "os": "%s",\n' "$OS"
  printf '    "distro": "%s",\n' "$DISTRO"
  printf '    "arch": "%s",\n' "$UNAME_M"
  printf '    "is_wsl": %s,\n' "$IS_WSL"
  printf '    "is_ssh": %s,\n' "$IS_SSH"
  printf '    "has_gui": %s,\n' "$HAS_GUI"
  printf '    "sudo": "%s",\n' "$HAS_SUDO"
  printf '    "recommended_profile": "%s"\n' "$RECOMMENDED_PROFILE"
  printf '  },\n'

  printf '  "tools": {\n'
  for i in "${!CORE_TOOLS[@]}"; do
    t="${CORE_TOOLS[$i]}"
    comma=","
    [[ $i -eq $((${#CORE_TOOLS[@]} - 1)) ]] && comma=""
    if has_cmd "$t"; then
      printf '    "%s": true%s\n' "$t" "$comma"
    else
      printf '    "%s": false%s\n' "$t" "$comma"
    fi
  done
  printf '  },\n'

  printf '  "agents": {\n'
  for t in "${AGENT_TOOLS[@]}"; do
    if has_cmd "$t"; then
      printf '    "%s": "%s",\n' "$t" "$(cmd_path "$t")"
    else
      printf '    "%s": null,\n' "$t"
    fi
  done
  printf '    "shared_skills_count": %s,\n' "$SHARED_SKILLS_COUNT"
  printf '    "claude_skills_count": %s,\n' "$CLAUDE_SKILLS_COUNT"
  printf '    "pi_skills_count": %s\n' "$PI_SKILLS_COUNT"
  printf '  },\n'

  printf '  "links": {\n'
  printf '    "nvim_default": "%s",\n' "$NVIM_DEFAULT_STATE"
  printf '    "nvim_active_profile": "%s",\n' "$NVIM_ACTIVE_PROFILE"
  printf '    "nvim_lite": "%s",\n' "$NVIM_LITE_STATE"
  printf '    "nvim_malo": "%s",\n' "$NVIM_MALO_STATE"
  printf '    "starship": "%s",\n' "$STARSHIP_STATE"
  printf '    "tmux": "%s",\n' "$TMUX_STATE"
  printf '    "zshrc": "%s",\n' "$ZSHRC_STATE"
  printf '    "dot_cli": "%s"\n' "$DOT_BIN_STATE"
  printf '  },\n'

  printf '  "drift": {\n'
  printf '    "git_branch": "%s",\n' "$GIT_BRANCH"
  printf '    "git_dirty_files": %s,\n' "$GIT_DIRTY_COUNT"
  printf '    "sentinel_missing": ['
  for i in "${!DRIFTED_SENTINELS[@]}"; do
    [[ $i -gt 0 ]] && printf ', '
    printf '"%s"' "${DRIFTED_SENTINELS[$i]}"
  done
  printf ']\n'
  printf '  }\n'
  printf '}\n'
  exit 0
fi

# Human-readable output
echo -e "\033[1;36m━━━ Dotfiles Doctor ━━━\033[0m"
echo -e "  \033[1mRepository:\033[0m  $DOTFILES_REPO (branch: $GIT_BRANCH, dirty: $GIT_DIRTY_COUNT)"
echo -e "  \033[1mPlatform:\033[0m    $OS ($DISTRO / $UNAME_M) | GUI: $HAS_GUI | SSH: $IS_SSH | WSL: $IS_WSL | Sudo: $HAS_SUDO"
echo -e "  \033[1mProfile:\033[0m     $RECOMMENDED_PROFILE"
echo ""

echo -e "\033[1;36m━━━ Core Toolchain ━━━\033[0m"
missing_tools=()
installed_tools=()
for t in "${CORE_TOOLS[@]}"; do
  if has_cmd "$t"; then
    installed_tools+=("$t")
  else
    missing_tools+=("$t")
  fi
done
echo -e "  \033[1;32m✓ Installed:\033[0m ${installed_tools[*]:-none}"
if [[ ${#missing_tools[@]} -gt 0 ]]; then
  echo -e "  \033[1;33m⚠ Missing:\033[0m   ${missing_tools[*]}"
fi
echo ""

echo -e "\033[1;36m━━━ Agent Harnesses & Skills ━━━\033[0m"
for t in "${AGENT_TOOLS[@]}"; do
  if has_cmd "$t"; then
    echo -e "  \033[1;32m✓\033[0m $(printf '%-8s' "$t") → $(cmd_path "$t")"
  else
    echo -e "  \033[1;33m•\033[0m $(printf '%-8s' "$t") → not found on PATH"
  fi
done
echo -e "  \033[1;34m•\033[0m Skills linked: ~/.agents/skills ($SHARED_SKILLS_COUNT), ~/.claude/skills ($CLAUDE_SKILLS_COUNT), ~/.pi/agent/skills ($PI_SKILLS_COUNT)"
echo ""

echo -e "\033[1;36m━━━ Config & Link Health ━━━\033[0m"
printf "  %-22s %s (%s)\n" "~/.config/nvim:" "$NVIM_DEFAULT_STATE" "$NVIM_ACTIVE_PROFILE"
printf "  %-22s %s\n" "~/.config/nvim-lite:" "$NVIM_LITE_STATE"
printf "  %-22s %s\n" "~/.config/nvim-malo:" "$NVIM_MALO_STATE"
printf "  %-22s %s\n" "~/.config/starship:" "$STARSHIP_STATE"
printf "  %-22s %s\n" "~/.tmux.conf:" "$TMUX_STATE"
printf "  %-22s %s\n" "~/.zshrc:" "$ZSHRC_STATE"
printf "  %-22s %s\n" "~/.local/bin/dot:" "$DOT_BIN_STATE"
echo ""

echo -e "\033[1;36m━━━ Drift & Local Overrides ━━━\033[0m"
if [[ ${#DRIFTED_SENTINELS[@]} -eq 0 ]]; then
  echo -e "  \033[1;32m✓\033[0m All tracked sentinel files end with managed sentinel."
else
  echo -e "  \033[1;33m⚠\033[0m Files with inline additions (run 'dot overrides --apply' to extract):"
  for f in "${DRIFTED_SENTINELS[@]}"; do
    echo "    - $f"
  done
fi
