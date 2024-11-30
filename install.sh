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
brew bundle --file=~/dotfiles/Brewfile
brew install -q "font-symbols-only-nerd-font"
# Check for Kitty.app and install if we don't have it
# if test ! $(which kitty); then
#   curl -L https://sw.kovidgoyal.net/kitty/installer.sh | sh /dev/stdin
# fi

stow nvim
stow kitty
stow tmux
stow starship
stow nushell
stow zsh

# get os (linux or macos)
os=$(uname -s)

# if os is macos do specific actions for macos
if [ $os = "Darwin" ]; then
  stow sketchybar-omerxx
  stow aerospace
fi

if [ $os = "Linux" ]; then
  stow i3
fi




