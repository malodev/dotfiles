#!/bin/bash

# if called without arguments
if [ "$#" -eq 0 ]; then
  name=""
# Check the arguments
elif [ "$#" -eq 1 ]; then
  name="-$1"
else
  echo "Usage: $0 [<backup-neovim-distribution-name>]"
  # list the available backup names
  ls -d ~/.config/nvim* | sed 's/.*\///' | sed 's/nvim-//' |uniq | sort
  exit 1
fi

# Backup nvim
# keep only two backups
rm -rf ~/.local/share/nvim$name.bak-1
rm -rf ~/.local/state/nvim$name.bak-1
rm -rf ~/.cache/nvim$name.bak-1
if [ -d ~/.local/share/nvim$name.bak ]; then
  mv ~/.local/share/nvim$name.bak ~/.local/share/nvim$name.bak-1
fi

if [ -d ~/.local/state/nvim$name.bak ]; then
  mv ~/.local/state/nvim$name.bak ~/.local/state/nvim$name.bak-1
fi

if [ -d ~/.cache/nvim$name.bak ]; then
  mv ~/.cache/nvim$name.bak ~/.cache/nvim$name.bak-1 
fi

# back up
mv ~/.local/share/nvim$name{,.bak}
mv ~/.local/state/nvim$name{,.bak}
mv ~/.cache/nvim$name{,.bak}


