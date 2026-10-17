#!/usr/bin/env bash
#=============================================================================
# bootstrap.sh — Stage 0 Minimal Seed for Agent-Managed Dotfiles (macOS/Linux)
#
# Solves the "chicken-and-egg" problem on a brand-new or rootless machine:
#   1. Clones the dotfiles repo if invoked via curl|sh
#   2. Installs `mise` in userspace (~/.local/bin/mise) — zero sudo required
#   3. Uses `mise` to install the portable baseline:
#      node@lts, neovim, starship, ripgrep, fd, fzf, jq, lazygit, zig
#   4. Installs `@earendil-works/pi-coding-agent` (`pi`) + `@earendil-works/pi-tui`
#   5. Seeds ~/.pi/agent/*.json from templates (essential set by default, or --full)
#   6. Links ~/.local/bin/dot, pi-inference, starship.toml, parrot-prompt.sh, nvim-malo, and Matt Pocock skills
#   7. Hands off to `dot doctor` / `dot agent` (or `./install.sh` for full OS setup)
#
# Usage:
#   ./bootstrap.sh                # Stage 0 bootstrap with essential pi extensions & models
#   ./bootstrap.sh --full         # Stage 0 bootstrap including all optional pi extensions
#   ./bootstrap.sh --dry-run      # Preview actions without writing
#   ./bootstrap.sh --launch-agent # Launch `pi` agent immediately after seed
#=============================================================================
set -eo pipefail

DRY_RUN=0
LAUNCH_AGENT=0
FULL_PI=0
REPO_URL="${DOTFILES_REPO_URL:-https://github.com/malodev/dotfiles.git}"
TARGET_DIR="${DOTFILES_DIR:-$HOME/dotfiles}"

for arg in "$@"; do
  case "$arg" in
    --dry-run)      DRY_RUN=1 ;;
    --launch-agent) LAUNCH_AGENT=1 ;;
    --full)         FULL_PI=1 ;;
    --help|-h)
      sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

info() { printf "  \033[1;34m•\033[0m %s\n" "$*"; }
ok()   { printf "  \033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[1;33m⚠\033[0m %s\n" "$*" >&2; }
run()  {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf "  \033[1;35m[dry-run]\033[0m %s\n" "$*"
  else
    "$@"
  fi
}

echo -e "\033[1;36m━━━ Stage 0: Agent-Managed Dotfiles Seed (Unix) ━━━\033[0m"

# 1. Locate or clone the repository
if [[ -n "${BASH_SOURCE[0]:-}" && -f "$(dirname "${BASH_SOURCE[0]}")/install.sh" ]]; then
  REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
elif [[ -d "$HOME/dotfiles/.git" ]]; then
  REPO="$HOME/dotfiles"
elif [[ -d "$HOME/.dotfiles/.git" ]]; then
  REPO="$HOME/.dotfiles"
else
  info "Cloning dotfiles repository to $TARGET_DIR..."
  run git clone "$REPO_URL" "$TARGET_DIR"
  REPO="$TARGET_DIR"
fi
ok "Repository located at $REPO"

# 2. Ensure ~/.local/bin and ~/.config exist
run mkdir -p "$HOME/.local/bin" "$HOME/.config"
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"

# 3. Bootstrap mise in userspace (no sudo needed)
if command -v mise >/dev/null 2>&1; then
  ok "mise already available: $(command -v mise)"
else
  info "Installing mise into ~/.local/bin/mise..."
  if [[ "$DRY_RUN" == "1" ]]; then
    run curl -fsSL https://mise.run \| sh
  else
    curl -fsSL https://mise.run | sh
    export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
  fi
fi

# 4. Install portable cross-OS baseline via mise
#    (zig is only needed when --full / nvim-malo compiles treesitter parsers without a system C compiler)
PORTABLE_TOOLS=(
  "node@lts"
  "neovim@latest"
  "starship@latest"
  "zoxide@latest"
  "ripgrep@latest"
  "fd@latest"
  "fzf@latest"
  "jq@latest"
  "lazygit@latest"
)
if [[ "$FULL_PI" == "1" ]]; then
  PORTABLE_TOOLS+=("zig@latest")
fi

if command -v mise >/dev/null 2>&1 || [[ "$DRY_RUN" == "1" ]]; then
  info "Declaring portable baseline tools in mise..."
  for tool in "${PORTABLE_TOOLS[@]}"; do
    run mise use -g "$tool" || warn "mise use -g $tool failed"
  done
  info "Installing mise tools..."
  run mise install || warn "Some mise tools had warnings"
fi

# Seed zoxide with the dotfiles repo path so `z dot` works immediately on a fresh machine
if command -v zoxide >/dev/null 2>&1 && [[ "$DRY_RUN" == "0" ]]; then
  zoxide add "$REPO" 2>/dev/null || true
fi

# 5. Ensure an Agent CLI (`pi`) is installed so the agent can complete setup
#    NOTE: Upstream pi moved from @mariozechner/pi-coding-agent to @earendil-works/pi-coding-agent.
#    Also install @earendil-works/pi-tui into both global node_modules and ~/.pi/agent/npm
#    (where pi 1.3+ installs user extension packages like pi-web-access).
if command -v pi >/dev/null 2>&1 && ! readlink -f "$(command -v pi)" 2>/dev/null | grep -q "@mariozechner"; then
  ok "pi coding agent already installed: $(command -v pi)"
else
  info "Installing @earendil-works/pi-coding-agent and @earendil-works/pi-tui..."
  if command -v npm >/dev/null 2>&1 || [[ "$DRY_RUN" == "1" ]]; then
    run rm -f "$HOME/.local/bin/pi"
    run npm install -g @earendil-works/pi-coding-agent @earendil-works/pi-tui || warn "npm install pi failed"
    run mkdir -p "$HOME/.pi/agent/npm"
    run npm install --prefix "$HOME/.pi/agent/npm" @earendil-works/pi-tui || true
    command -v mise >/dev/null 2>&1 && [[ "$DRY_RUN" == "0" ]] && mise reshim || true
  else
    warn "npm not yet on PATH; run 'mise exec node@lts -- npm install -g @earendil-works/pi-coding-agent @earendil-works/pi-tui' after bootstrap"
  fi
fi

# 6. Link minimal core configs (works even without GNU Stow!)
#    Default Neovim profile in bootstrap is `nvim-lite` (instant startup, zero C compile);
#    pass `--full` or run `dot nvim malo` for the full daily-driver `nvim-malo` IDE config.
info "Linking core configs (dot CLI, bash, starship, nvim-lite, pi configs & agent skills)..."
run ln -sfn "$REPO/local-bin/.local/bin/dot" "$HOME/.local/bin/dot"
run ln -sfn "$REPO/starship/.config/starship.toml" "$HOME/.config/starship.toml"
run ln -sfn "$REPO/nvim-lite/.config/nvim-lite" "$HOME/.config/nvim-lite"
run ln -sfn "$REPO/nvim-malo/.config/nvim-malo" "$HOME/.config/nvim-malo"
if [[ ! -e "$HOME/.config/nvim" || -L "$HOME/.config/nvim" ]]; then
  if [[ "$FULL_PI" == "1" ]]; then
    run ln -sfn "$REPO/nvim-malo/.config/nvim-malo" "$HOME/.config/nvim"
  else
    run ln -sfn "$REPO/nvim-lite/.config/nvim-lite" "$HOME/.config/nvim"
  fi
fi

# Link bash startup files (backing up default OS /etc/skel files if present) so PATH, zoxide (`z`), starship/parrot prompt, and fzf work on first login
for bfile in .bashrc .bash_profile .bash_aliases; do
  if [[ -f "$HOME/$bfile" && ! -L "$HOME/$bfile" ]]; then
    run mv "$HOME/$bfile" "$HOME/${bfile}.bak-skel"
  fi
done
if command -v stow >/dev/null 2>&1; then
  run stow -d "$REPO" -t "$HOME" bash 2>/dev/null || {
    run mkdir -p "$HOME/.bashrc.d"
    run ln -sfn "$REPO/bash/.bashrc" "$HOME/.bashrc"
    run ln -sfn "$REPO/bash/.bash_profile" "$HOME/.bash_profile"
    run ln -sfn "$REPO/bash/.bash_aliases" "$HOME/.bash_aliases"
    run ln -sfn "$REPO/bash/.bashrc.d/parrot-prompt.sh" "$HOME/.bashrc.d/parrot-prompt.sh"
  }
else
  run mkdir -p "$HOME/.bashrc.d"
  run ln -sfn "$REPO/bash/.bashrc" "$HOME/.bashrc"
  run ln -sfn "$REPO/bash/.bash_profile" "$HOME/.bash_profile"
  run ln -sfn "$REPO/bash/.bash_aliases" "$HOME/.bash_aliases"
  run ln -sfn "$REPO/bash/.bashrc.d/parrot-prompt.sh" "$HOME/.bashrc.d/parrot-prompt.sh"
fi

# Link pi-three-agent-team, pi-inference (for llm.malo.tn.it / ds4.malo.tn.it models), and pi web-search configs
run mkdir -p "$HOME/.config/pi-three-agent-team" "$HOME/.config/pi-inference" "$HOME/.config/pi" "$HOME/.pi/agent" "$HOME/.local/lib"
run ln -sfn "$REPO/pi/.config/pi-three-agent-team/config.json" "$HOME/.config/pi-three-agent-team/config.json"
run ln -sfn "$REPO/pi/.config/pi-inference/client.json" "$HOME/.config/pi-inference/client.json"
run ln -sfn "$REPO/pi/.config/pi/web-search.json" "$HOME/.config/pi/web-search.json"
run ln -sfn "$REPO/pi/.pi/agent/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"
run ln -sfn "$REPO/pi/.pi/agent/pi-sub-bar-settings.json" "$HOME/.pi/agent/pi-sub-bar-settings.json"
run ln -sfn "$REPO/pi/.local/bin/pi-inference" "$HOME/.local/bin/pi-inference"
run ln -sfn "$REPO/pi/.local/lib/pi_inference" "$HOME/.local/lib/pi_inference"

# 7. Seed Pi settings (essential by default, --full for all optional packages) & link agent skills
PI_FLAG=()
[[ "$FULL_PI" == "1" ]] && PI_FLAG=(--full)

if [[ -x "$REPO/scripts/init-pi-settings.sh" ]]; then
  if [[ "$DRY_RUN" == "1" ]]; then
    "$REPO/scripts/init-pi-settings.sh" --dry-run "${PI_FLAG[@]}"
  else
    "$REPO/scripts/init-pi-settings.sh" "${PI_FLAG[@]}"
  fi
fi

if [[ -x "$REPO/scripts/link-pi-agent-entries.sh" ]]; then
  if [[ "$DRY_RUN" == "1" ]]; then
    "$REPO/scripts/link-pi-agent-entries.sh" --dry-run "${PI_FLAG[@]}"
  else
    "$REPO/scripts/link-pi-agent-entries.sh" "${PI_FLAG[@]}" || warn "Run './scripts/link-pi-agent-entries.sh --unfold' if directories are folded"
  fi
fi

# 8. Link Matt Pocock skills if submodule is present (initializes submodule if git is available and empty)
if [[ ! -f "$REPO/pi/mattpocock-skills/scripts/link-skills.sh" && -d "$REPO/.git" && "$DRY_RUN" == "0" ]]; then
  git -C "$REPO" submodule update --init --depth 1 pi/mattpocock-skills 2>/dev/null || true
fi
if [[ -x "$REPO/pi/mattpocock-skills/scripts/link-skills.sh" ]]; then
  info "Linking Matt Pocock skills..."
  if [[ "$DRY_RUN" == "1" ]]; then
    info "[dry-run] $REPO/pi/mattpocock-skills/scripts/link-skills.sh"
  else
    "$REPO/pi/mattpocock-skills/scripts/link-skills.sh" >/dev/null && ok "Linked Matt Pocock skills into ~/.agents/skills & ~/.claude/skills" || warn "mattpocock-skills linker had warnings"
  fi
fi

echo ""
ok "Stage 0 seed complete!"
echo ""
info "Next steps:"
info "  1. Ensure ~/.local/bin and ~/.local/share/mise/shims are on your PATH"
info "  2. Run 'dot doctor' to inspect machine health"
info "  3. Run 'dot agent \"complete the setup for this machine\"' to let the agent finish!"

if [[ "$LAUNCH_AGENT" == "1" && "$DRY_RUN" == "0" ]]; then
  exec "$HOME/.local/bin/dot" agent "Inspect this machine using dot doctor --json and guide me through completing the dotfiles setup."
fi
