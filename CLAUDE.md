# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is an **Agent-Managed Cross-OS Dotfiles** repository (see [`AGENTS.md`](AGENTS.md) and [`pi/.pi/agent/skills/dotfiles-maintainer/SKILL.md`](pi/.pi/agent/skills/dotfiles-maintainer/SKILL.md)), designed to work across:
- **macOS** (primary — Brewfile + `mise` + GNU Stow + AeroSpace + SketchyBar)
- **Arch Linux / Omarchy** (`pacman` + `mise` + GNU Stow + Hyprland)
- **Ubuntu/Debian & Headless SSH** (`apt` / rootless `mise` userspace + GNU Stow)
- **Native Windows** (Windows Terminal + PowerShell 7 / Nushell + `mise` + Zero-Admin Directory Junctions + `XDG_CONFIG_HOME=$HOME\.config`)

Each tool/application has its own directory containing configuration files, typically following XDG Base Directory specification with nested `.config/` subdirectories.

## Quick Commands (`dot` CLI, Bootstrap, & Verification)

```bash
# Stage 0 minimal userspace seed (installs mise + portable CLI + pi + links)
./bootstrap.sh              # macOS / Linux / WSL
# .\bootstrap.ps1           # Native Windows (PowerShell)

# Inspect OS capabilities, toolchain, symlinks, and config drift
./scripts/doctor.sh
./scripts/doctor.sh --json  # Structured JSON output for LLM agents

# Full modular installation (macOS / Linux)
./install.sh

# Validate installer, manifest, and isolated sandbox/Docker test environments
./scripts/validate-install.sh
./scripts/test-environments.sh          # Isolated $HOME sandbox + headless config tests
./scripts/test-environments.sh --docker # Also test inside clean Ubuntu/Alpine/Arch containers
```

## Architecture

### Neovim Configuration (`nvim-lite/`, `nvim-malo/`)

Stage 0 bootstrap links **`nvim-lite`** as `~/.config/nvim`: no plugins, no C compilation, sub-5ms startup, keeping nvim-malo's leader and keymap habits. `nvim-malo` is the full daily driver, selected with `bootstrap.sh --full` or `dot nvim malo` (`dot nvim status` shows the active profile).

The main Neovim config uses **LazyVim** as a base with **lazy.nvim** as the plugin manager.

**Entry point:** `nvim-malo/.config/nvim-malo/init.lua` → loads `options.lua`, `lazy-init.lua`, `keymaps.lua`

**Plugin structure:**
- `lua/plugins_notvscode/` - Full Neovim plugins (LSP, completion, UI, etc.)
- `lua/plugins_always/` - Plugins that work in both VSCode and standalone Neovim
- `lua/plugins_vscode/` - VSCode Neovim-specific plugins

Key plugin categories include: editing (nvim-surround), git (neogit, gingsign), LSP (null-ls, completion), UI (lualine, bufferline, alpha), tools (telescope, fzf, oil, yazi).

**Theme:** Catppuccin (installed via lazy.nvim)

### SketchyBar Configuration (`sketchybar/`)

Uses **SbarLua framework** (Lua instead of shell scripts) for macOS status bar.

**Active config:** `.config/sketchybar/` (others: `sketchybar-new/` is experimental, `sketchybar-old/` is deprecated shell-based)

**Key files:**
- `sketchybarrc` - Shell entry point
- `init.lua` - Main Lua entry, loads modules and starts event loop
- `colors.lua` - Tokyo Night color scheme
- `settings.lua` - Global settings, font configuration
- `items/` - Individual widgets (aerospace_workspaces, wifi, battery, media, weather, etc.)
- `helpers/` - Utility functions and app icon mappings

**Layout:** Vertical status bar (unconventional)

**Commands:**
```bash
brew services restart sketchybar  # Restart to apply changes
sketchybar --reload               # Reload config
log stream --predicate 'process == "sketchybar"'  # View logs
```

See `sketchybar/CLAUDE.md` for detailed SketchyBar documentation.

### AeroSpace Window Manager (`aerospace/`)

Tiling window manager for macOS with SketchyBar integration.

**Config:** `aerospace/.aerospace.toml`

**Key features:**
- Workspace change triggers SketchyBar updates via `exec-on-workspace-change`
- Custom keybindings (Alt+hjkl for navigation, Alt+shift+hjkl to move windows)
- Floating layout for specific apps (Telegram, Finder, WhatsApp, 1Password, Settings)
- Persistent workspaces: "1-9", "0", "A", "S", "D"

### Tmux Configuration (`tmux/`)

Uses **tpm** (Tmux Plugin Manager) with Catppuccin theme.

**Prefix:** `Ctrl+Space` (not Ctrl+b)

**Key features:**
- Vi-style pane navigation (hjkl)
- Session management with tmux-sessionx (bind `o`)
- Continuum for automatic session restore
- Clipboard integration via tmux-yank

**Install plugins:** Press `prefix + I` (Capital I) in tmux

## Platform-Specific

**macOS only:**
- `sketchybar/` - Status bar
- `aerospace/` - Tiling window manager
- `borders/` - Window border customization

**Linux only (Arch/Ubuntu/Debian):**
- `i3/` - i3 window manager configuration

The `install.sh` script automatically detects OS (`uname -s`) and installs platform-specific configs.

## Directory Structure Notes

- Multiple Neovim configs exist (`nvim-lite` — the Stage 0 bootstrap default, `nvim-malo` — the primary daily driver, `nvim-test`, `nvim-astro`, `nvim-php`, etc.)
- Directories ending in `.ignore` or `.disabled` are excluded via `.gitignore`
- Some configs have `-old` variants (e.g., `sketchybar-old/`, `nvim-malo-old.ignore/`) as backups

## Dependencies

Managed via Homebrew from `Brewfile`:
- CLI tools: `fzf`, `ripgrep`, `lsd`, `bat`, `fd`, `procs`, `yazi`, `jq`, etc.
- Shells: `zsh`, `nushell`, `starship`
- Development: `neovim`, `git`, `lazygit`, `node`, `yarn`, `deno`
- macOS apps: `visual-studio-code`, `kitty`, `karabiner-elements`, `aerospace`, `sketchybar`
- Fonts: `font-hack-nerd-font`, `font-sketchybar-app-font`
