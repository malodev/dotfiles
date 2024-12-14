#!/bin/bash

# check for homebrew and install if we don't have it
if test ! $(which brew); then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# update homebrew recipes
brew update

# check for any missing brews
brew upgrade

# install all our dependencies with bundle
brew bundle
# brew bundle --file=~/dotfiles/Brewfile
# Check for Kitty.app and install if we don't have it
# if test ! $(which kitty); then
#   curl -L https://sw.kovidgoyal.net/kitty/installer.sh | sh /dev/stdin
# fi

stow -v nvim
stow -v kitty
stow -v tmux
stow -v starship
stow -v nushell
stow -v zsh

# get os (linux or macos)
os=$(uname -s)

echo "Specific configs for $os"

# if os is macos do specific actions for macos
if [ $os = "Darwin" ]; then
  stow -v sketchybar
  stow -v aerospace
fi

if [ $os = "Linux" ]; then
  stow -v i3
fi

if ! [ -x /usr/local/bin/colorscript ]; then
  mkdir -p ~/.local/src
  cd ~/.local/src/
  rm -rf shell-color-scripts
  git clone https://gitlab.com/dwt1/shell-color-scripts.git
  cd shell-color-scripts
  sudo make install
  # optional for zsh completion
  sudo cp completions/_colorscript /usr/share/zsh/site-functions
  cd ~
fi
