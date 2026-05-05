#!/usr/bin/env bash

# Bash-native declarative install manifest.
# Keeps group/package metadata separate from installer control flow.

declare -A INSTALL_GROUPS=(
    ["core"]=""
    ["shell"]="bash zsh starship nushell"
    ["editor"]="nvim-malo nvim-lazy nvim-test nvim-php nvim-astro"
    ["terminal"]="kitty tmux"
    ["desktop"]="sketchybar aerospace borders"
    ["linux"]="i3"
    ["dev"]="git bat"
    ["extras"]="shell-color-scripts"
)

declare -A GROUP_DESC=(
    ["core"]="Core dependencies (GNU Stow)"
    ["shell"]="Shell configurations (Bash, Zsh, Starship, Nushell)"
    ["editor"]="Neovim configurations (malo, lazy, test, php, astro)"
    ["terminal"]="Terminal tools (Kitty, Tmux)"
    ["desktop"]="Desktop environment (SketchyBar, AeroSpace, Borders)"
    ["linux"]="Linux window manager (i3)"
    ["dev"]="Development tools (Git, Lazygit, Lazydocker, Delta, Bat, LLM)"
    ["extras"]="Extra utilities (Shell color scripts)"
)

# Supported platforms per group: all, macos, linux
declare -A GROUP_PLATFORM=(
    ["core"]="all"
    ["shell"]="all"
    ["editor"]="all"
    ["terminal"]="all"
    ["desktop"]="macos"
    ["linux"]="linux"
    ["dev"]="all"
    ["extras"]="all"
)

INSTALL_ORDER=("core" "shell" "editor" "terminal" "desktop" "linux" "dev" "extras")

SHELL_CONFIG_PACKAGES=("bash" "zsh" "nushell" "fish")

# Some package names do not match their executable names. This map is used when
# deciding whether a package already appears to be installed.
declare -A COMMAND_CHECK_OVERRIDES=(
    ["ripgrep"]="rg"
    ["bottom"]="btm"
    ["fd-find"]="fd"
    ["p7zip"]="7z"
    ["p7zip-full"]="7z"
    ["poppler"]="pdftotext"
    ["poppler-utils"]="pdftotext"
    ["imagemagick"]="magick"
    ["ImageMagick"]="magick"
    ["github-cli"]="gh"
    ["git-delta"]="delta"
    ["golang-go"]="go"
    ["golang"]="go"
    ["python3-pip"]="pip3"
    ["python-pip"]="pip"
    ["base-devel"]="make"
    ["build-essential"]="make"
    ["nodejs"]="node"
    ["node"]="node"
)

NVIM_CONFIG_ORDER=("malo" "lazy" "test" "php" "astro")
DEFAULT_NVIM_KEY="malo"

declare -A NVIM_CONFIGS=(
    ["malo"]="nvim-malo (main - LazyVim based)"
    ["lazy"]="nvim-lazy (pure LazyVim)"
    ["test"]="nvim-test (experimental)"
    ["php"]="nvim-php (PHP development)"
    ["astro"]="nvim-astro (AstroNvim based)"
)

declare -A DEFAULT_GROUPS_DARWIN=(
    ["core"]=1
    ["shell"]=1
    ["editor"]=1
    ["terminal"]=1
    ["desktop"]=1
    ["linux"]=0
    ["dev"]=1
    ["extras"]=0
)

declare -A DEFAULT_GROUPS_LINUX=(
    ["core"]=1
    ["shell"]=1
    ["editor"]=1
    ["terminal"]=1
    ["desktop"]=0
    ["linux"]=0
    ["dev"]=1
    ["extras"]=1
)

# Group detail metadata. Supports placeholders:
#   __CURRENT_SHELL__
#   __PACKAGE_MODE__
#   __HOME__
declare -A GROUP_DETAIL_LINE_1=(
    ["core"]="Dependency: ensures GNU Stow is installed"
    ["shell"]="Stow: current shell by default: __CURRENT_SHELL__; shared: starship"
    ["editor"]="Stow: nvim-malo, nvim-lazy, nvim-test, nvim-php, nvim-astro"
    ["terminal"]="Stow: kitty, tmux"
    ["desktop"]="Stow: sketchybar, aerospace, borders"
    ["linux"]="Stow: i3"
    ["dev"]="Stow: git, bat"
    ["extras"]="Stow/install: shell-color-scripts, fastfetch"
)

declare -A GROUP_DETAIL_LINE_2=(
    ["core"]="Stow: none"
    ["shell"]="Available shell configs: bash, zsh, nushell"
    ["editor"]="Installs: neovim and editor dependencies where applicable via __PACKAGE_MODE__"
    ["terminal"]="Installs: kitty/tmux where applicable via __PACKAGE_MODE__"
    ["desktop"]="Platform: macOS only; disabled on Linux"
    ["linux"]="Platform: Linux only; disabled on macOS"
    ["dev"]="Installs: git/gh/delta/lazygit/lazydocker/uv/llm/bun/go/deno/python helpers where applicable via __PACKAGE_MODE__"
    ["extras"]="Installs: optional tools, preferring user-local fallback locations"
)

declare -A GROUP_DETAIL_LINE_3=(
    ["core"]="Installs: base CLI tools on Linux; Brewfile packages on macOS/full Homebrew path"
    ["shell"]="Installs: zsh/starship/zoxide where applicable via __PACKAGE_MODE__"
    ["editor"]="Post: choose default ~/.config/nvim symlink"
    ["terminal"]=""
    ["desktop"]="Installs: macOS tools via Brewfile"
    ["linux"]=""
    ["dev"]=""
    ["extras"]=""
)

declare -A GROUP_DETAIL_LINE_4=(
    ["core"]=""
    ["shell"]="Tip: pass './install.sh bash zsh' to stow specific shell configs"
    ["editor"]=""
    ["terminal"]=""
    ["desktop"]=""
    ["linux"]=""
    ["dev"]=""
    ["extras"]=""
)
