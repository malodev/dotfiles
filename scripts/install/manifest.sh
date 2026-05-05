#!/usr/bin/env bash

# Bash-native declarative install manifest.
# Keeps group/package metadata separate from installer control flow.

declare -A INSTALL_GROUPS=(
    ["core"]=""
    ["shell"]="bash zsh starship nushell"
    ["editor"]="nvim-malo nvim-lazy"
    ["editor-alt"]="nvim-test nvim-php nvim-astro"
    ["terminal"]="tmux"
    ["gui-terminal"]="kitty"
    ["desktop"]="sketchybar aerospace borders"
    ["linux"]="i3"
    ["dev"]="git bat"
    ["system-info"]=""
)

declare -A GROUP_DESC=(
    ["core"]="Core dependencies (GNU Stow)"
    ["shell"]="Shell configurations (Bash, Zsh, Starship, Nushell)"
    ["editor"]="Primary Neovim configurations (malo, lazy)"
    ["editor-alt"]="Alternative Neovim configurations (test, php, astro)"
    ["terminal"]="SSH-safe terminal tools (Tmux, Urlview, Kitty terminfo)"
    ["gui-terminal"]="GUI terminal emulator (Kitty)"
    ["desktop"]="Desktop environment (SketchyBar, AeroSpace, Borders)"
    ["linux"]="Linux window manager (i3)"
    ["dev"]="Development tools (Git, Lazygit, Lazydocker, Delta, Bat, LLM)"
    ["system-info"]="System information tools (Fastfetch)"
)

# Supported platforms per group: all, macos, linux
declare -A GROUP_PLATFORM=(
    ["core"]="all"
    ["shell"]="all"
    ["editor"]="all"
    ["editor-alt"]="all"
    ["terminal"]="all"
    ["gui-terminal"]="all"
    ["desktop"]="macos"
    ["linux"]="linux"
    ["dev"]="all"
    ["system-info"]="all"
)

INSTALL_ORDER=("core" "shell" "terminal" "dev" "editor" "editor-alt" "gui-terminal" "desktop" "linux" "system-info")

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
    ["terminal"]=1
    ["dev"]=1
    ["editor"]=1
    ["editor-alt"]=0
    ["gui-terminal"]=1
    ["desktop"]=1
    ["linux"]=0
    ["system-info"]=0
)

declare -A DEFAULT_GROUPS_LINUX=(
    ["core"]=1
    ["shell"]=1
    ["terminal"]=1
    ["dev"]=1
    ["editor"]=1
    ["editor-alt"]=0
    ["gui-terminal"]=0
    ["desktop"]=0
    ["linux"]=0
    ["system-info"]=1
)

# Group detail metadata. Supports placeholders:
#   __CURRENT_SHELL__
#   __PACKAGE_MODE__
#   __HOME__
declare -A GROUP_DETAIL_LINE_1=(
    ["core"]="Dependency: ensures GNU Stow is installed"
    ["shell"]="Stow: current shell by default: __CURRENT_SHELL__; shared: starship"
    ["terminal"]="Stow: tmux"
    ["dev"]="Stow: git, bat"
    ["editor"]="Stow: nvim-malo, nvim-lazy"
    ["editor-alt"]="Stow: nvim-test, nvim-php, nvim-astro"
    ["gui-terminal"]="Stow: kitty"
    ["desktop"]="Stow: sketchybar, aerospace, borders"
    ["linux"]="Stow: i3"
    ["system-info"]="Install: fastfetch"
)

declare -A GROUP_DETAIL_LINE_2=(
    ["core"]="Stow: none"
    ["shell"]="Available shell configs: bash, zsh, nushell"
    ["terminal"]="Installs: tmux/urlview/kitty-terminfo where applicable via __PACKAGE_MODE__"
    ["dev"]="Installs: git/gh/delta/lazygit/lazydocker/uv/llm/bun/go/deno/python helpers where applicable via __PACKAGE_MODE__"
    ["editor"]="Installs: neovim/editor dependencies and shell-color-scripts for nvim-malo dashboard"
    ["editor-alt"]="Installs: neovim and editor dependencies where applicable via __PACKAGE_MODE__"
    ["gui-terminal"]="Installs: kitty GUI terminal where applicable via __PACKAGE_MODE__"
    ["desktop"]="Platform: macOS only; disabled on Linux"
    ["linux"]="Platform: Linux only; disabled on macOS"
    ["system-info"]="Installs: fastfetch, preferring user-local fallback locations"
)

declare -A GROUP_DETAIL_LINE_3=(
    ["core"]="Installs: base CLI tools on Linux; Brewfile packages on macOS/full Homebrew path"
    ["shell"]="Installs: zsh/starship/zoxide where applicable via __PACKAGE_MODE__"
    ["terminal"]="Remote note: installs kitty terminfo only, not the full kitty GUI app"
    ["dev"]=""
    ["editor"]="Post: choose default ~/.config/nvim symlink"
    ["editor-alt"]="Post: choose default ~/.config/nvim symlink if selected"
    ["gui-terminal"]="Remote note: only needed on local GUI workstations"
    ["desktop"]="Installs: macOS tools via Brewfile"
    ["linux"]=""
    ["system-info"]=""
)

declare -A GROUP_DETAIL_LINE_4=(
    ["core"]=""
    ["shell"]="Tip: pass './install.sh bash zsh' to stow specific shell configs"
    ["terminal"]=""
    ["dev"]=""
    ["editor"]=""
    ["editor-alt"]=""
    ["gui-terminal"]=""
    ["desktop"]=""
    ["linux"]=""
    ["system-info"]=""
)
