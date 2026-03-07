# Copilot Instructions

## Build, test, and lint commands

This repository is a GNU Stow-managed dotfiles repo, so most work is validated by targeted setup or manual reload commands rather than by a traditional build pipeline.

### Repo-wide setup

```bash
# Guided install with OS-aware package groups
./install.sh

# Preview or inspect install groups without changing the machine
./install.sh --dry-run
./install.sh --list-groups

# Install only selected groups
./install.sh shell editor

# Manual symlink management
stow *
stow nvim-malo

# Install Homebrew dependencies declared in Brewfile
brew bundle
```

### Neovim (`nvim-malo`)

```bash
cd nvim-malo/.config/nvim-malo

# Format all Lua files
stylua .

# Format a single file
stylua path/to/file.lua

# Check formatting without rewriting files
stylua --check .
```

Manual validation for Neovim changes:

```vim
nvim
:LspInfo
:checkhealth
:Lazy sync
:Snacks notifier.show_history()
```

### SketchyBar (`sketchybar`, macOS)

```bash
brew services restart sketchybar
sketchybar --reload
sketchybar --update
log stream --predicate 'process == "sketchybar"'
tail -f /opt/homebrew/var/log/sketchybar/sketchybar.err.log
tail -f /opt/homebrew/var/log/sketchybar/sketchybar.out.log
```

### Tmux

- Install or refresh tmux plugins with `<prefix> + I`.
- The tmux prefix in this repo is `Ctrl+Space`, not the default `Ctrl+b`.

### Automated tests and single-test runs

- There is no repo-wide automated test suite or CI workflow in this repository.
- There is no single-test command to document; the most targeted validation here is usually package-specific, such as `stow <package>`, `stylua path/to/file.lua`, or reloading the affected app (`sketchybar --reload`, opening `nvim`, etc.).

## High-level architecture

- This repository manages dotfiles for multiple machines with **GNU Stow**. Each top-level package directory contains files laid out as they should appear in `$HOME`, usually under `.config/`.
- The main installation entry point is `install.sh`. It groups packages by role (`shell`, `editor`, `terminal`, `desktop`, `linux`, `dev`, `extras`), uses `scripts/common.sh` for OS and package-manager detection, and changes default selections based on the current platform.
- The repo is intentionally cross-platform:
  - **macOS-first** desktop stack: `aerospace`, `sketchybar`, and `borders`
  - **Linux-specific** window-manager config: `i3`
  - Shared tooling and shell/editor configs: `zsh`, `bash`, `nushell`, `tmux`, `git`, `starship`, `nvim-*`
- `nvim-malo` is the primary Neovim configuration. Its entry flow is:
  - `init.lua` -> `options.lua` -> `lazy-init.lua` -> `keymaps/`
  - `lazy-init.lua` loads `lua/plugins/` for normal Neovim, `lua/plugins_always/` for shared plugins, and `lua/plugins_vscode/` for VSCode Neovim.
  - `lua/plugins_notvscode/` is kept for reference and is explicitly disabled.
- The active SketchyBar package uses the SbarLua framework. Its startup flow is:
  - `sketchybarrc` -> `helpers/init.lua` -> `init.lua`
  - `init.lua` wires bar defaults and loads the `items/` modules that render widgets.
- AeroSpace and SketchyBar are connected: workspace changes in AeroSpace trigger SketchyBar updates, so changes in one may need validation in both.
- There are multiple alternative or historical configs in the repo (`nvim-lazy`, `nvim-astro`, `nvim-test`, `nvim-php`, other sketchybar-related directories). Treat `nvim-malo` and `sketchybar/` as the primary active configs unless the user explicitly asks for another variant.

## Key conventions

- Prefer editing the active Stow package, not backup or reference directories. Directories ending in `.ignore` or names like `*-old` are typically excluded or kept as historical references.
- Keep Stow semantics in mind: editing a file inside a package changes what will be symlinked into `$HOME`. `.stow-local-ignore` excludes repo metadata and a few special paths from being stowed.
- For `nvim-malo`, preserve the existing user customizations called out in its docs:
  - Rose Pine Moon is the default theme
  - custom dashboard/notify behavior is intentional
  - Oil is configured to show hidden files
  - ClaudeCode-related keymaps are deliberate
- Follow the Neovim Lua patterns already documented in `nvim-malo/.config/nvim-malo/AGENTS.md`:
  - wrap `require(...)` in `pcall(...)`
  - use `require("keymaps.util").safe_keymap_set` instead of calling `vim.keymap.set` directly
  - check feature flags in `lua/config/init.lua` before enabling optional functionality
  - add new plugins under the active `lua/plugins/` category structure, not under `lua/plugins_notvscode/`
- Neovim Lua formatting is standardized with `stylua.toml`: 2-space indentation and a 120-column width.
- When changing OS-specific behavior, reuse the existing platform detection patterns instead of hardcoding paths or assuming macOS-only behavior. The repo already distinguishes macOS, Arch, and Debian-style environments in `install.sh` and `scripts/common.sh`.
- SketchyBar changes should respect the Lua module structure (`colors.lua`, `settings.lua`, `items/`, `helpers/`) and the fact that this setup is vertical, not a default horizontal bar.
- If you need to prepare a commit message or release note, follow the conventional-commit setup defined in `.cz.toml`.
