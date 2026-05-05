# `install.sh` Fix and Refactor Plan

This document tracks recommended fixes and architectural improvements for `./install.sh`.

## Goals

- Make fresh-machine installs reliable across macOS, Arch, Debian/Ubuntu, and Fedora.
- Make dry-run output trustworthy.
- Make individual package installs behave as documented.
- Reduce the risk of broken symlinks and `stow` conflicts.
- Split the current monolithic installer into smaller maintainable modules.

---

## Implementation Progress

Started implementation in `install.sh`:

- [x] Stop trying to stow `core`/`stow` as a package.
- [x] Use explicit `stow -d "$SCRIPT_DIR" -t "$HOME"` paths.
- [x] Fix Neovim default symlink to use an absolute target.
- [x] Keep Linux Homebrew opt-in, but run `brew bundle` when `--with-brew` is explicitly passed.
- [x] Add more explicit group details to the textual menu, selected summary, and `--list-groups`.
- [x] Move fallback Neovim binary install to user-local paths under `~/.local`.
- [x] Move fallback `fastfetch` binary symlink and `shell-color-scripts` install to user-local paths where applicable.
- [x] Fix discovered dry-run bypasses for several direct AUR installer calls.
- [x] Add `stow` dry-run/conflict preflight before real stow operations.
- [x] Audit and update the remaining major direct installer/fallback paths for dry-run and user-local behavior (GitHub tarballs, npm globals, zoxide/starship curl installers, Go/composer fallbacks).
- [x] Implement initial real selected-package/package-only handling for dotfile packages.
- [x] Add explicit `--group`/`--package` flags and support mixed group+package installs.
- [ ] Further refine mixed-mode system package installer behavior if needed.
- [x] Reorder install flow so system tools/dependencies are installed before stowing configs and post-install extras run after stowing.
- [x] Start splitting the installer into modules (`scripts/install/groups.sh`, `scripts/install/helpers.sh`).
- [x] Split major package/dev-tool logic into dedicated modules (`scripts/install/packages.sh`, `scripts/install/dev-tools.sh`).
- [x] Remove the duplicated in-file legacy package/dev-tool definitions from `install.sh` after validating the sourced modules.
- [x] Split remaining UI, Neovim, and preset logic into dedicated modules (`scripts/install/ui.sh`, `scripts/install/nvim.sh`, `scripts/install/presets.sh`).
- [x] Move OS detection, stow group logic, and manual/default selection resolution into dedicated modules (`scripts/install/core.sh`, `scripts/install/selection.sh`).
- [x] Move CLI/help parsing and high-level install flow/summary steps into dedicated modules (`scripts/install/cli.sh`, `scripts/install/flow.sh`).
- [x] Shrink `install.sh` so it is now mostly a thin entrypoint with sourcing + `main()` orchestration.
- [x] Add a dry-run regression validation script (`scripts/validate-install.sh`).
- [x] Expand validation coverage with output assertions for package-only, mixed-mode, Neovim default selection, `--with-brew`, `--list-groups`, and running from outside the repo.
- [x] Add manifest consistency validation (`scripts/validate-manifest.sh`) and include it in the regression checks.
- [x] Clean up `install.sh` comment/module bootstrap clutter after the split.
- [x] Move package/group metadata into a Bash-native declarative manifest (`scripts/install/manifest.sh`).
- [x] Start driving more behavior from the manifest (shell package classification, Neovim config order/default selection).
- [x] Move platform support constraints and package command-check overrides into the manifest.
- [x] Review missing dependency coverage and improve installers for `zoxide`, `uv`, `llm`, and Deno PATH reporting.
- [x] Document the modular installer architecture (`INSTALLER_ARCHITECTURE.md`).
- [ ] Optionally evolve the manifest later toward YAML/JSON if external parsing is acceptable.

---

## Phase 1 — Critical Bug Fixes

### 1. Run `stow` with explicit source and target

**Problem:**

The script calls:

```bash
stow -v "$pkg"
```

This only works correctly if the script is launched from the dotfiles repo root.

**Fix:**

Use explicit paths everywhere:

```bash
stow -d "$SCRIPT_DIR" -t "$HOME" -v "$pkg"
```

For dry-run/conflict checks:

```bash
stow -d "$SCRIPT_DIR" -t "$HOME" -n -v "$pkg"
```

---

### 2. Fix default Neovim symlink creation

**Problem:**

`select_nvim_config()` creates relative symlinks like:

```bash
ln -sf "nvim-malo/.config/nvim-malo" "$HOME/.config/nvim"
```

Relative symlinks are resolved from `~/.config`, so this can point to the wrong location.

**Fix:**

After stowing the chosen Neovim config, point `~/.config/nvim` to the stowed config:

```bash
ln -sfn "$HOME/.config/nvim-malo" "$HOME/.config/nvim"
```

Or use an absolute repo path:

```bash
ln -sfn "$SCRIPT_DIR/nvim-malo/.config/nvim-malo" "$HOME/.config/nvim"
```

Preferred approach: link to the stowed config in `$HOME/.config`.

---

### 3. Stop trying to stow `core`

**Problem:**

The `core` group currently contains:

```bash
["core"]="stow"
```

But `stow` is a dependency, not a dotfiles package directory. This causes warnings such as:

```text
Package directory not found: stow
```

**Fix:**

Make `core` empty or handle dependencies separately:

```bash
["core"]=""
```

Keep `setup_stow()` responsible for installing GNU Stow.

---

### 4. Fix Linux `--with-brew` behavior while keeping it opt-in

**Intentional design:**

Homebrew on Linux should remain opt-in. Even if `brew` is already installed on Linux, the installer should not use it unless the user passes:

```bash
--with-brew
```

**Problem:**

When `--with-brew` is passed, Linux package installers skip native package installation because `WITH_BREW=1`, but `install_homebrew_packages()` currently only runs `brew bundle` on macOS.

So Linux Homebrew is correctly opt-in, but the opt-in path is incomplete.

**Fix:**

Run `brew bundle` on:

- macOS always, because Homebrew is the primary package manager there;
- Linux only when `--with-brew` was explicitly passed.

```bash
install_homebrew_packages() {
    local should_use_brew=0

    if [[ "$OS" == "Darwin" ]]; then
        should_use_brew=1
    elif [[ "$OS" == "Linux" && "${WITH_BREW:-0}" == "1" ]]; then
        should_use_brew=1
    fi

    if [[ "$should_use_brew" == "1" && -f "$SCRIPT_DIR/Brewfile" ]]; then
        show_banner "Installing Homebrew Packages"
        log_dry_run "  brew bundle --file=$SCRIPT_DIR/Brewfile"
        if [[ "$DRY_RUN" == "0" ]]; then
            brew bundle --file="$SCRIPT_DIR/Brewfile" || log_warn "Brew bundle installation had issues"
        fi
    fi
}
```

Consider adding a separate `Brewfile.linux` if macOS-only casks/services cause issues on Linux.

---

### 5. Make individual package installs actually individual

**Problem:**

Documented examples are misleading:

```bash
./install.sh tmux
./install.sh nvim-malo
./install.sh bash zsh
```

Currently, passing a package usually enables the entire group. For example:

- `tmux` enables `terminal`, which also installs `kitty`.
- `nvim-malo` enables `editor`, which can stow all Neovim configs.

**Fix:**

Introduce a separate selected package list:

```bash
declare -a SELECTED_PACKAGES=()
```

Rules:

- If user passes group names, install all packages in those groups.
- If user passes package names, install only those packages.
- If both are passed, install selected groups plus selected packages.
- Track selected shell packages explicitly instead of inferring from group state.

---

### 6. Make Neovim config selection explicit

**Problem:**

`install_nvim_configs()` checks package names against `SELECTED_GROUPS`, which only stores group names. Because it defaults to `1`, all Neovim configs are stowed.

**Fix options:**

Option A — intentional all-config install:

- Rename UI text to say all Neovim configs will be installed.
- Prompt only selects the default `~/.config/nvim` symlink.

Option B — install only chosen config:

- Add `SELECTED_NVIM_CONFIG`.
- Stow only that package unless user explicitly requests all editor configs.

Recommended: Option A for this repo, because multiple Neovim configs appear intentionally maintained.

---

## Phase 2 — Safety and Correctness

### 7. Prefer user-local binary installs for missing tools

**Preference:**

When a required binary/tool is missing and cannot be installed through the selected package manager path, prefer installing it for the current user only instead of writing into system locations such as:

```text
/usr/local/bin
/usr/bin
/opt
```

This avoids polluting the system and keeps the dotfiles installer safer to run on shared or work machines.

**Problem:**

Some current fallback installers write to system paths, for example:

- installing downloaded binaries into `/usr/local/bin`,
- symlinking tools into `/usr/local/bin`,
- extracting archives directly into `/usr/local`,
- using `sudo install` for optional tools.

Examples in the current script include fallback installers for tools like Neovim, Go, lazygit, delta, bat, fastfetch, and shell-color-scripts.

**Fix:**

Use user-local destinations by default:

```text
$HOME/.local/bin
$HOME/.local/share/<tool>
$HOME/.local/opt/<tool>
```

Recommended layout:

```text
~/.local/bin/tool             # executable or symlink
~/.local/opt/tool/...         # extracted application/archive
~/.local/share/tool/...       # support files/data
```

Ensure `~/.local/bin` exists:

```bash
mkdir -p "$HOME/.local/bin"
```

For downloaded tarballs:

```bash
mkdir -p "$HOME/.local/opt/tool"
tar -xzf /tmp/tool.tar.gz -C "$HOME/.local/opt/tool" --strip-components=1
ln -sfn "$HOME/.local/opt/tool/bin/tool" "$HOME/.local/bin/tool"
```

For single binaries:

```bash
install -m 0755 /tmp/tool "$HOME/.local/bin/tool"
```

**Rules:**

- Package-manager installs may still use system locations because that is expected behavior.
- Homebrew installs may use Homebrew's prefix.
- Manual fallback installers should default to user-local locations.
- Use `sudo` only when explicitly necessary and clearly shown in the menu/dry-run output.
- Add an opt-in flag if system-wide fallback installs are desired later, e.g. `--system-install`.

**PATH requirement:**

If `~/.local/bin` is not in `PATH`, warn the user and show the needed shell snippet:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Do not silently modify shell files unless that behavior is explicitly documented and selected.

---

### 8. Add Stow conflict preflight

Before real stow operations, run:

```bash
stow -d "$SCRIPT_DIR" -t "$HOME" -n -v "$pkg"
```

If conflicts are found:

- show clear error messages,
- suggest backing up files,
- optionally offer `--adopt` only with explicit user confirmation.

Potential flags:

```bash
--no-folding
--restow
--adopt
```

Default should be conservative and not overwrite user files.

---

### 8. Reorder installation flow

Current flow creates the Neovim symlink before stowing configs and installs many system packages after stowing.

Recommended flow:

1. Parse args.
2. Detect OS/distro.
3. Resolve selected groups/packages.
4. Setup package manager.
5. Install required dependencies, including `stow`, `git`, `curl`, etc.
6. Install system packages for selected groups.
7. Run stow preflight.
8. Stow selected dotfile packages.
9. Configure default Neovim symlink.
10. Run extras/post-install hooks.
11. Print summary and next steps.

---

### 9. Improve dry-run reliability

**Critical bug found while beginning implementation:**

Some installer branches still executed real package installs during `--dry-run`, especially direct AUR/helper calls such as `yay -S` / `paru -S` that were outside `_linux_pkg_install()`.

Dry-run must be treated as a hard safety boundary: no package manager, curl installer, npm, pipx, `make install`, symlink, move, or write operation should run when `DRY_RUN=1`.

Dry-run should show every operation that would happen, including:

- package manager installs,
- `brew bundle`,
- `stow` commands,
- symlink creation,
- backup operations,
- downloads from GitHub/npm/curl installers.

Avoid branches where dry-run skips entire sections silently.

---

### 10. Add backup helper

Create a reusable helper:

```bash
backup_path() {
    local path="$1"
    if [[ -e "$path" || -L "$path" ]]; then
        local backup="${path}.backup.$(date +%Y%m%d_%H%M%S)"
        mv "$path" "$backup"
        log_info "Backed up $path to $backup"
    fi
}
```

Use it for Neovim and optional stow conflict resolution.

---

## Phase 3 — Refactor Architecture

### 11. Split `install.sh` into modules

Proposed structure:

```text
install.sh
scripts/
  common.sh
  args.sh
  groups.sh
  ui.sh
  stow.sh
  brew.sh
  nvim.sh
  packages.sh
  installers/
    macos.sh
    arch.sh
    debian.sh
    fedora.sh
```

Responsibilities:

- `args.sh`: parse CLI flags and package/group arguments.
- `groups.sh`: define groups, package lists, defaults, presets.
- `ui.sh`: checkbox menu and prompts.
- `stow.sh`: conflict check, stow, unstow/restow helpers.
- `brew.sh`: Homebrew setup and bundle install.
- `nvim.sh`: Neovim config stowing/default symlink logic.
- `packages.sh`: shared package-install abstraction.
- `installers/*.sh`: distro-specific package names and special cases.

---

### 12. Move package metadata to a declarative manifest

Current package/group information is hardcoded in Bash arrays and installer functions.

Implemented first step: a Bash-native manifest at `scripts/install/manifest.sh` now holds group/package metadata, descriptions, defaults, and group-detail display lines.

Possible Bash-native manifest:

```bash
GROUPS_shell_PACKAGES=(bash zsh starship nushell)
GROUPS_editor_PACKAGES=(nvim-malo nvim-lazy nvim-test nvim-php nvim-astro)
GROUPS_terminal_PACKAGES=(kitty tmux)
```

Better long-term option: YAML or JSON manifest, e.g.:

```yaml
groups:
  shell:
    description: Shell configurations
    stow:
      - bash
      - zsh
      - starship
      - nushell
    packages:
      macos:
        - zsh
        - starship
      arch:
        - zsh
        - starship
      debian:
        - zsh
```

This makes it easier to add/remove packages without editing installer control flow.

---

### 13. Centralize repeated installer logic

Create helpers for:

- sudo prefix,
- GitHub release downloads,
- tarball extraction,
- `.deb` installation,
- npm global installs,
- pipx installs,
- AUR helper fallback,
- package command-name checks.

Examples:

```bash
install_from_github_tarball repo asset_pattern binary_name target_dir
install_npm_global package command_name
install_pipx_tool package command_name
install_aur_or_warn package
```

This reduces repeated code for `lazygit`, `delta`, `bat`, `fastfetch`, etc.

---

### 14. Simplify developer tool installation

`install_dev_tools()` currently has duplication and mixed responsibilities.

Split into smaller functions:

```bash
install_git_tools
install_language_runtimes
install_python_tools
install_node_tools
install_php_tools
install_ai_cli_tools
```

Then call only the functions relevant to selected groups/packages.

---

## Phase 4 — UX Improvements

### 15. Make the textual menu explicit about what will be installed

**Problem:**

The interactive menu currently shows only group descriptions, e.g.:

```text
[ 2] [*] Shell configurations (Bash, Zsh, Starship, Nushell)
[ 3] [*] Neovim configurations (malo, lazy, test, php, astro)
[ 4] [*] Terminal tools (Kitty, Tmux)
```

This is not explicit enough because group selection may trigger multiple kinds of actions:

- stowing dotfile packages,
- installing system packages,
- installing Homebrew packages,
- installing Linux package-manager packages,
- downloading tools from GitHub/npm/pipx,
- creating special symlinks, e.g. `~/.config/nvim`,
- skipping platform-incompatible packages.

It also does not clearly explain current special behavior, such as:

- `shell` installs/stows only the current shell config by default, plus shared shell tools like `starship`;
- `editor` may stow multiple Neovim configs and separately choose the default config;
- `desktop` is macOS-only;
- `linux` is Linux-only;
- Linux Homebrew is used only with `--with-brew`.

**Fix:**

Expand the menu display so each group shows:

1. group name,
2. description,
3. dotfile packages that will be stowed,
4. system tools/dependencies that may be installed,
5. platform notes,
6. special post-install actions.

Example menu format:

```text
[ 3] [*] editor — Neovim configurations
         Stow: nvim-malo, nvim-lazy, nvim-test, nvim-php, nvim-astro
         Installs: neovim, node/npm, yarn, luarocks, python pynvim, tree-sitter-cli
         Post: choose default ~/.config/nvim symlink
         Note: on macOS tools come from Brewfile
```

For the shell group:

```text
[ 2] [*] shell — Shell configurations
         Stow: current shell only by default: $SHELL; always stow starship
         Available: bash, zsh, nushell
         Installs: zsh, starship, zoxide where available
         Tip: pass './install.sh bash zsh' to stow specific shell configs
```

For platform-specific groups:

```text
[ 5] [ ] desktop — macOS desktop environment
         Stow: sketchybar, aerospace, borders
         Platform: macOS only; disabled on Linux
```

```text
[ 6] [ ] linux — Linux window manager
         Stow: i3
         Platform: Linux only; disabled on macOS
```

**Implementation suggestion:**

Add metadata arrays in `groups.sh` or near the existing group definitions:

```bash
declare -A GROUP_STOW_PACKAGES
declare -A GROUP_SYSTEM_PACKAGES_HINT
declare -A GROUP_NOTES
declare -A GROUP_POST_ACTIONS
```

Then render them in `checkbox_menu()` and in the selected-groups summary.

Also update `--list-groups` to show the same details instead of only package names.

**Important:**

The menu should describe the resolved behavior for the current OS and flags. For example:

- On Linux without `--with-brew`, say native package manager will be used.
- On Linux with `--with-brew`, say Homebrew/Brewfile will be used.
- On macOS, say Brewfile will be used.
- For shell config, show the detected current shell and what will be stowed.

---

### 16. Better CLI semantics

Recommended CLI behavior:

```bash
./install.sh                     # interactive
./install.sh --dry-run           # dry-run defaults
./install.sh --minimal           # preset
./install.sh --group shell       # explicit group install
./install.sh --package tmux      # explicit exact package install
./install.sh shell editor        # backwards-compatible group install
./install.sh tmux nvim-malo      # exact package install if names match package dirs
```

Implemented initial support for explicit `--group` and `--package` flags. If a name ever matches both a group and a package, use the explicit flags to disambiguate.

---

### 16. Add machine profiles

Because this repo targets multiple machines, consider profiles:

```text
profiles/
  macbook.yaml
  arch-desktop.yaml
  ubuntu-server.yaml
```

Usage:

```bash
./install.sh --profile macbook
```

Each profile could select groups/packages and default Neovim config.

---

### 17. Add uninstall/restow commands

Possible future commands:

```bash
./install.sh install shell
./install.sh restow shell
./install.sh unstow shell
./install.sh doctor
```

A `doctor` command could check:

- broken symlinks,
- missing commands,
- stow conflicts,
- Homebrew status,
- Neovim default symlink target.

---

## Suggested Immediate Implementation Order

1. Fix `stow -d "$SCRIPT_DIR" -t "$HOME"`.
2. Fix Neovim default symlink.
3. Make `core` not stow `stow`.
4. Fix Linux `--with-brew` / `brew bundle` behavior.
5. Prefer user-local fallback installs for missing binaries instead of `/usr/local/bin` or other system paths.
6. Audit and fix all dry-run bypasses before any further installer changes.
7. Add stow dry-run preflight.
8. Make the textual menu and `--list-groups` explicit about stowed packages, installed tools, platform behavior, and post-install actions.
9. Add real selected-package handling.
10. Reorder install flow.
11. Split script into modules.
12. Move package/group metadata into a manifest.
13. Add profiles and `doctor` command.

---

## Quick Validation Checklist

After fixes, test:

```bash
bash -n install.sh
shellcheck install.sh
./install.sh --dry-run
./install.sh --minimal --dry-run
./install.sh --standard --dry-run
./install.sh --full --dry-run
./install.sh tmux --dry-run
./install.sh nvim-malo --dry-run
./install.sh bash zsh --dry-run
./install.sh --with-brew --dry-run
```

Also test from outside the repo:

```bash
cd /tmp
/path/to/dotfiles/install.sh --dry-run
```

Expected result: all `stow` commands still target the dotfiles repo and `$HOME` correctly.
