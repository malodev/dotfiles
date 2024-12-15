#!/bin/bash

# if called without arguments
if [ "$#" -eq 1 ]; then
  name="$1"
  # check if there is the named distribution
  if [ "$(fd -d 1 -t l nvim-$name ~/.config/ | wc -l)" -ne 1 ]; then
    echo "Distribution $name not found"
    echo "Available distributions:"
    fd -d 1 -t l nvim- ~/.config/ | sed 's/.*\///' | sed 's/nvim-//' | uniq | sort
    exit 1
  fi
else
  echo "Usage: $0 [<neovim-distribution-name>]"
  # list the available nvim distributions
  echo "Available distributions:"
  fd -d 1 -t l nvim- ~/.config/ | sed 's/.*\///' | sed 's/nvim-//' | uniq | sort
  exit 1
fi

#
#
#
cd ~/.local/share
ln -sfn nvim-$name nvim

cd ~/.local/state
ln -sfn nvim-$name nvim

cd ~/.cache/
ln -sfn nvim-$name nvim

cd ~/.config/
ln -sfn nvim-$name nvim
