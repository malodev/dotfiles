# dotfiles

<!--toc:start-->

- [dotfiles](#dotfiles)
  - [Installation](#installation)
    - [Quick Start](#quick-start)
    - [Usage Modes](#usage-modes)
    - [Installation Groups](#installation-groups)
    - [What It Does](#what-it-does)
    - [Package Installation by Platform](#package-installation-by-platform)
    - [Binary Installation Reference](#binary-installation-reference)
      - [Not Installed by the Script](#not-installed-by-the-script)
    - [Manual Stow vs Install Script](#manual-stow-vs-install-script)
    - [Requirements](#requirements)
    - [Manual Installation with Stow (configs only)](#manual-installation-with-stow-configs-only)
  - [Inspiration](#inspiration)
  <!--toc:end-->

Clone the repo using:

```sh
git clone https://github.com/malodev/dotfiles ~/.dotfiles
cd ~/.dotfiles
```

## Installation

### Quick Start

Run the interactive installer:

```sh
./install.sh
```

This launches an interactive menu where you can select which groups of configurations to install.

### Usage Modes

```sh
./install.sh                  # Interactive menu (default)
./install.sh --dry-run        # Preview what would be installed
./install.sh --list-groups    # List available groups
./install.sh shell editor     # Install specific groups
./install.sh --minimal        # Preset: core + shell + terminal + dev
./install.sh --standard       # Preset: core + shell + editor + terminal + system-info
./install.sh --full           # Preset: everything
./install.sh --with-brew      # Enable Homebrew on Linux
./install.sh --user-local     # Install everything as current user (no sudo required)
./install.sh --lightweight    # Optimise for constrained machines (minimal prompt, etc.)
```

Flags can be combined, e.g. `./install.sh --dry-run --minimal` to preview a minimal install.

### Constrained / Shared Hosting

For machines where `sudo` is unavailable (shared hosting, restricted VPS), use:

```sh
./install.sh --user-local --lightweight --minimal
```

| Flag | What it does |
|------|--------------|
| `--user-local` | Skips `sudo apt/dnf/pacman`. Installs stow from source to `~/.local`. All CLI tools installed to `~/.local/bin`. |
| `--lightweight` | Creates a persistent marker (`~/.config/dotfiles-lightweight.enabled`). On shell startup, switches to a minimal starship config (no `git_status`, no `python` version detection, 500ms timeout). |
| `--minimal` | Installs only core + shell + terminal + dev groups (no GUI, no editor). |

The `--user-local` flag also handles machines where the login shell is `/bin/false`
or `/usr/sbin/nologin` — the script auto-detects a usable shell (`bash` → `zsh` → `sh`)
instead of skipping shell config stow.

### Installation Groups

| Group      | Packages                                              | Notes        |
| ---------- | ----------------------------------------------------- | ------------ |
| `core`     | GNU Stow                                              | Always installed |
| `shell`    | Bash, Zsh, Starship, Nushell                          |              |
| `editor`   | nvim-malo, nvim-lazy, nvim-test, nvim-php, nvim-astro |              |
| `terminal` | Kitty, Tmux                                           |              |
| `desktop`  | SketchyBar, AeroSpace, Borders                        | macOS only   |
| `linux`    | i3                                                    | Linux only   |
| `dev`      | Git, Lazygit, Lazydocker, Delta, Bat, LLM             |              |
| `extras`   | Shell color scripts                                   |              |

You can also install individual packages directly: `./install.sh bash zsh nvim-malo`

### Machine-Specific vs Shared Settings

Some config files need machine-specific values (API keys, model preferences, file paths).
These are split into a **tracked** base and a **gitignored** local override:

| Config | Tracked (shared) | Local (per-machine) |
|--------|------------------|---------------------|
| **Pi** | `pi/.pi/agent/settings.json.template` | `~/.pi/agent/settings.json` |
| **Git** | `git/.gitconfig` | `~/.gitconfig_local` |
| **Shell** | `bash/.bashrc`, `zsh/.zshrc` (sources `_local`) | `~/.bashrc_local`, `~/.zshrc_local` |

- **Pi settings**: template is copied to `~/.pi/agent/settings.json` on first install.
  Pi auto-updates `lastChangelogVersion`; you add `defaultModel`/`defaultProvider` there.
- **Git**: `~/.gitconfig` includes `~/.gitconfig_local`. Use it for `safe.directory`:
  `git config --file ~/.gitconfig_local --add safe.directory /path`
- **Shell**: external tools (deno, nvm, etc.) that write to `~/.zshrc`/`~/.bashrc` are
  auto-relocated to `_local` files during install (see `relocate_shell_configs_to_local`).

See also:
- `scripts/init-pi-settings.sh` — initialize pi settings from template
- `scripts/import-pi-settings.sh` — review and import new keys from active settings into template
- `scripts/extract-shell-local-overrides.sh` — extract machine-specific lines from shell rc files to `_local`

### What It Does

The install script does more than just symlink configs — it also installs the underlying packages and binaries:

1. **Detects your OS** (macOS, Arch Linux, Ubuntu/Debian, Fedora)
2. **Installs the package manager** and system packages (see [Package Installation by Platform](#package-installation-by-platform))
3. **Installs CLI tools** — fzf, ripgrep, bat, fd, lsd, jq, yazi, curl, wget, etc.
4. **Installs shell/terminal tools** — zsh, tmux, kitty, carapace, starship, zoxide
5. **Installs Neovim + editor dependencies** — neovim, build tools (make, gcc), nodejs, npm, yarn, luarocks, python-pynvim, tree-sitter-cli
6. **Installs dev tools** — git, gh, git-delta, lazygit, go, deno, pip, composer, hub
7. **Symlinks config files** to your home directory using GNU Stow
8. **Sets up the default Neovim config** (`nvim-malo`) with an interactive selector

### Package Installation by Platform

#### macOS

On macOS, **Homebrew** is the primary package manager. The script installs Homebrew if missing, then runs `brew bundle` from the [Brewfile](Brewfile) to install all CLI tools, apps, and fonts.

#### Linux

On Linux, **the native package manager is preferred** — the script uses `pacman` (Arch), `apt` (Debian/Ubuntu), or `dnf` (Fedora) to install packages directly. Homebrew is **not used on Linux by default**. If you pass `--with-brew`, the script will install and use Homebrew on Linux as well, but this is opt-in only.

For tools not available in the system repos, the script falls back to official install scripts or prebuilt binaries from GitHub releases (e.g., lazygit, git-delta, deno on Debian/Ubuntu).

> On Arch Linux, `yay` or `paru` are used when available as AUR helpers, falling back to `pacman` for official repos.
>
> On **Debian/Ubuntu**, tools like `fzf`, `ripgrep`, `fd`, `lsd`, and `bat` are **not** installed
> via `apt` (which ships outdated versions). The script downloads the latest binaries from
> GitHub releases into `~/.local/bin`. Ensure `~/.local/bin` is early in your `$PATH`.

### Binary Installation Reference

The following tables show how each tool is installed per platform. On macOS, most tools come from the [Brewfile](Brewfile). On Linux, the native package manager is always preferred.

#### Core (always installed)

| Tool | macOS | Arch Linux | Debian/Ubuntu | Fedora |
| ---- | ----- | ---------- | ------------- | ------ |
| **GNU Stow** | `brew install` | `pacman -S stow` | `apt-get install stow`¹ | `dnf install stow` |

> ¹ On Debian/Ubuntu without sudo (or with `--user-local`), Stow is built from
> source into `~/.local` via `./configure --prefix=$HOME/.local && make install`.
> Requires `make` and `perl` (standard on Debian).

#### CLI Tools (installed automatically)

| Tool | macOS | Arch Linux | Debian/Ubuntu | Fedora |
| ---- | ----- | ---------- | ------------- | ------ |
| **fzf** | Brewfile | `pacman -S fzf` | GitHub release (latest) | `dnf install fzf` |
| **ripgrep** | Brewfile | `pacman -S ripgrep` | GitHub release (latest) | `dnf install ripgrep` |
| **bat** | Brewfile | `pacman -S bat` | GitHub release (latest) | `dnf install bat` |
| **fd** | Brewfile | `pacman -S fd` | GitHub release (latest) | `dnf install fd-find` |
| **lsd** | Brewfile | `pacman -S lsd` | GitHub release (latest) | `dnf install lsd` |
| **jq** | Brewfile | `pacman -S jq` | `apt-get install jq` | `dnf install jq` |
| **yazi** | Brewfile | AUR (`yay -S yazi`) | Not in repos | Not in repos |
| **gdu** | Brewfile | `pacman -S gdu` | Not in repos | Not in repos |
| **bottom** | Brewfile | `pacman -S bottom` | Not in repos | Not in repos |
| **procs** | Brewfile | `pacman -S procs` | Not in repos | Not in repos |
| **curl, wget** | Brewfile | `pacman -S curl wget` | `apt-get install curl wget` | `dnf install curl wget` |
| **ffmpeg** | Brewfile | `pacman -S ffmpeg` | `apt-get install ffmpeg` | `dnf install ffmpeg` |
| **imagemagick** | Brewfile | `pacman -S imagemagick` | `apt-get install imagemagick` | `dnf install ImageMagick` |

> Tools marked "Not in repos" on Debian/Ubuntu or Fedora will show a warning. Use `--with-brew` or install them manually.

#### Shell & Terminal (shell/terminal groups)

| Tool | macOS | Arch Linux | Debian/Ubuntu | Fedora |
| ---- | ----- | ---------- | ------------- | ------ |
| **zsh** | Brewfile | `pacman -S zsh` | `apt-get install zsh` | `dnf install zsh` |
| **tmux** | Brewfile | `pacman -S tmux` | `apt-get install tmux` | `dnf install tmux` |
| **kitty** | Brewfile (cask) | `pacman -S kitty` | `apt-get install kitty` | `dnf install kitty` |
| **carapace** | Brewfile | AUR (`yay -S carapace-bin`) | Not in repos | Not in repos |
| **Starship** | Brewfile | `pacman -S starship` | `apt-get install` or `curl -sS https://starship.rs/install.sh \| sh` | `dnf install starship` |
| **Zoxide** | Brewfile | `pacman -S zoxide` | `curl -sSfL .../zoxide/.../install.sh \| sh` | `dnf install zoxide` |

#### Editor — Neovim & Dependencies (editor group)

| Tool | macOS | Arch Linux | Debian/Ubuntu | Fedora |
| ---- | ----- | ---------- | ------------- | ------ |
| **Neovim** | Brewfile | `pacman -S neovim` | `apt-get install neovim` (warns if < 0.9) | `dnf install neovim` |
| **Build tools** (make, gcc) | Brewfile | `pacman -S base-devel cmake` | `apt-get install build-essential cmake` | `dnf install gcc gcc-c++ make cmake` |
| **Node.js + npm** | Brewfile | `pacman -S nodejs npm` | `apt-get install nodejs npm` | `dnf install nodejs npm` |
| **Yarn** | Brewfile | `pacman -S yarn` | `npm install -g yarn` | `npm install -g yarn` |
| **Luarocks** | Brewfile | `pacman -S luarocks` | `apt-get install luarocks` | `dnf install luarocks` |
| **python-pynvim** | Brewfile | `pacman -S python-pynvim` | `apt-get install python3-pynvim` | `dnf install python3-pynvim` |
| **tree-sitter-cli** | Brewfile | `npm install -g tree-sitter-cli` | `npm install -g tree-sitter-cli` | `npm install -g tree-sitter-cli` |

> Mason (Neovim plugin) automatically downloads LSP servers, formatters, and linters (lua-language-server, prettierd, stylua, shfmt, etc.) on first use. The tools above are the **system-level dependencies** that Mason and Neovim plugins need to function.

#### Dev Tools (dev group)

| Tool | macOS | Arch Linux | Debian/Ubuntu | Fedora |
| ---- | ----- | ---------- | ------------- | ------ |
| **Git** | Brewfile | `pacman -S git` | `apt-get install git` | `dnf install git` |
| **GitHub CLI (gh)** | Brewfile | `pacman -S github-cli` | Official apt repo | `dnf install gh` |
| **git-delta** | Brewfile | `pacman -S git-delta` | GitHub release binary | `dnf install git-delta` |
| **Lazygit** | Brewfile | AUR (`yay -S lazygit`) | GitHub release binary | `dnf copr` repo |
| **Lazydocker** | Brewfile | AUR (`yay -S lazydocker`) | GitHub release binary | GitHub release binary |
| **Go** | Brewfile | `pacman -S go` | `go.dev` tarball (latest) | `dnf install golang` |
| **Deno** | Brewfile | Official installer | Official installer | Official installer |
| **uv** | Brewfile | Official installer | Official installer | Official installer |
| **Bun** | Brewfile | Official installer | Official installer | Official installer |
| **LLM (SimonW)** | Brewfile | `pipx install llm` | `pipx install llm` (or `uv tool install`) | `pipx install llm` |
| **Node.js** | Brewfile | `pacman -S nodejs npm` | `deb.nodesource.com` LTS | `dnf install nodejs npm` |
| **Hub** | Brewfile | AUR (`yay -S hub`) | GitHub release binary | `dnf install hub` |
| **Python packages** (basedpyright, black, isort) | Brewfile | `pip install --user` | `pip3 install --user` | `pip3 install --user` |

#### Extras (extras group)

| Tool | macOS | Arch Linux | Debian/Ubuntu | Fedora |
| ---- | ----- | ---------- | ------------- | ------ |
| **Fastfetch** | Brewfile | AUR (`yay -S fastfetch-git`) or GitHub binary | GitHub release binary | `dnf install fastfetch` |
| **Shell color scripts** | `make install` (from source) | `make install` (from source) | `make install` (from source) | `make install` (from source) |

#### Not Installed by the Script

The following are only available via the Brewfile (macOS or `--with-brew`):

| Category | Tools |
| -------- | ----- |
| macOS apps | `visual-studio-code`, `karabiner-elements`, `aerospace`, `amethyst`, `sketchybar`, `borders` |
| Fonts | `font-hack-nerd-font`, `font-sketchybar-app-font` |
| Misc | `utf8proc`, `git-lfs`, `git-credential-libsecret`, `reattach-to-user-namespace`, `vscode-langservers-extracted`, `nushell`, `urlview`, `w3m`, `lynx`, `viu` |

### Manual Stow vs Install Script

> **Important:** Running `stow` manually **only creates symlinks** for configuration files. It does **not** install any packages or binaries. If you use manual stow, you are responsible for installing the tools yourself (e.g., Neovim, Starship, Kitty, fzf, ripgrep, etc.).
>
> The `install.sh` script handles both — it installs the required software **and** symlinks the configs.

### Requirements

- **Bash 4.0+** is required (for associative array support)
- macOS ships with Bash 3.x — install a newer version first: `brew install bash`
- Then run: `/opt/homebrew/bin/bash ./install.sh`

### Manual Installation with Stow (configs only)

If you already have the required tools installed and just want to symlink the config files, you can use [GNU Stow](https://www.gnu.org/software/stow/) directly:

```sh
# Symlink selected packages (recommended; review host-specific packages first)
stow bash git pi

# Symlink another specific package's config
stow <package_name>

# Example: symlink just the Neovim config
stow nvim-malo

# Shared Pi client configuration (local or remote machine)
stow pi
```

The R9700 service manager (`pi-inference-host`) is GPU-host-only and lives outside this
repo, in `~/Develop/MACHINE_LEARNING/local-models/pi-inference-host/` — see
`local-models/PI_INFERENCE_CONTROL_PLANE.md` for its deployment. New remote inference
clients need outbound HTTPS only; use `scripts/pi-inference-client-setup` for dry-run-first
Stow deployment, private bearer installation, and end-to-end verification.

Run these from the `~/.dotfiles` directory. This **only creates symlinks** — no packages or binaries are installed.

### Baking Configs for a Shared Machine

If you bootstrap a shared machine (e.g., root on a server) with your configs but don't
want to leave your personal dotfiles repo behind, you can convert the stow symlinks into
real files and remove the repo:

```sh
cd ~/.dotfiles
./scripts/unstow-as-real.sh          # Convert all, delete repo
./scripts/unstow-as-real.sh bash zsh # Convert only bash + zsh
./scripts/unstow-as-real.sh --dry-run # Preview
```

This copies the content through each symlink, turning it into a standalone file, then
deletes `~/.dotfiles`. The configs stay functional, your personal repo is gone.

## Inspiration

The inspiration for this configuration comes from

- [dreamsofcode-io/dotfiles](https://github.com/dreamsofcode-io/dotfiles)
- [typecraft-dev/dotfiles](https://github.com/typecraft-dev/dotfiles)
- [never-lose-your-configs-again](https://learn.typecraft.dev/tutorial/never-lose-your-configs-again/)
