#!/bin/bash

# Check the arguments
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <backup-neovim-distribution-name>"
  # list the available backup names
  ls -d ~/dotfiles/nvim-* | sed 's/.*\///' | sed 's/nvim-//' |uniq | sort
  exit 1
fi

# Backup nvim
# keep only two backups
rm -rf ~/.local/share/nvim-$1.bak-1
rm -rf ~/.local/state/nvim-$1.bak-1
if [ -d ~/.local/share/nvim-$1.bak ]; then
  mv ~/.local/share/nvim-$1.bak ~/.local/share/nvim-$1.bak-1
fi
if [ -d ~/.local/state/nvim-$1.bak ]; then
  mv ~/.local/state/nvim-$1.bak ~/.local/state/nvim-$1.bak-1
fi

mv ~/.local/share/nvim ~/.local/share/nvim-$1.bak
mv ~/.local/state/nvim ~/.local/state/nvim-$1.bak

