#!/bin/bash

# if called without arguments
if [ "$#" -eq 0 ]; then
  name=""
# Check the arguments
elif [ "$#" -eq 1 ]; then
  name="-$1"
else
  echo "Usage: $0 <backup-neovim-distribution-name>"
  # list the available backup names
  ls -d ~/.local/share/nvim-*.bak | sed 's/.*\///' | sed 's/\.bak//' | sed 's/nvim-//' | uniq | sort
  exit 1
fi

# Restore nvim

if [ -d ~/.local/share/nvim$name ]; then
  rm -rf ~/.local/share/nvim$name
fi

if [ -d ~/.local/state/nvim ]; then
  rm -rf ~/.local/state/nvim
fi

mv ~/.local/share/nvim-"$1".bak ~/.local/share/nvim
mv ~/.local/state/nvim-"$1".bak ~/.local/state/nvim
# mv ~/.cache/nvim ~/.cache/nvim.bak
