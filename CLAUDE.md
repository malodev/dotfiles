# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a multi-machine dotfiles repository managed with [GNU Stow](https://www.gnu.org/software/stow/), designed to work across:
- **macOS** (primary)
- **Arch Linux** (Omarcchy)
- **Ubuntu/Debian Linux**

Each tool/application has its own directory containing configuration files, typically following XDG Base Directory specification with nested `.config/` subdirectories.

## Installation Commands

```bash
# Clone the repository
git clone https://github.com/malodev/dotfiles ~/.dotfiles

# Install all configurations
cd ~/.dotfiles
stow *

# Install specific package only
stow <package_name>  # e.g., stow nvim-malo

# Full installation (includes Homebrew dependencies)
./install.sh
```

The `install.sh` script:
- Installs Homebrew if not present
- Runs `brew bundle` to install dependencies from Brewfile
- Uses Stow to symlink configurations
- Detects OS (macOS/Linux) and installs platform-specific configs

## Architecture

### Neovim Configuration (`nvim-malo/`)

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

- Multiple Neovim configs exist (`nvim-malo`, `nvim-test`, `nvim-astro`, `nvim-php`, etc.) - `nvim-malo` is the primary
- Directories ending in `.ignore` or `.disabled` are excluded via `.gitignore`
- Some configs have `-old` variants (e.g., `sketchybar-old/`, `nvim-malo-old.ignore/`) as backups

## Dependencies

Managed via Homebrew from `Brewfile`:
- CLI tools: `fzf`, `ripgrep`, `lsd`, `bat`, `fd`, `procs`, `yazi`, `jq`, etc.
- Shells: `zsh`, `nushell`, `starship`
- Development: `neovim`, `git`, `lazygit`, `node`, `yarn`, `deno`
- macOS apps: `visual-studio-code`, `kitty`, `karabiner-elements`, `aerospace`, `sketchybar`
- Fonts: `font-hack-nerd-font`, `font-sketchybar-app-font`
