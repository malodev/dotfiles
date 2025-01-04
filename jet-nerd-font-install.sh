#!/bin/bash

mkdir -p ~/.fonts
cd ~/.fonts
FONT_URL="https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/JetBrainsMono.zip"
wget $FONT_URL
filename=${FONT_URL##*/}
extension="${filename##*.}"
filename="${filename%.*}"
mkdir ${filename} && pushd ${filename}
unzip ../${filename}.${extension}
popd
rm ${filename}.${extension}
fc-cache -fv

