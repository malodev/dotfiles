#!/bin/bash
source "$CONFIG_DIR/colors.sh"
echo "called with $1"
echo "$FOCUSED_WORKSPACE"

if [ "$1" = "$FOCUSED_WORKSPACE" ]; then
    sketchybar --set $NAME background.drawing=on background.color=$Lavender icon.color=$Base
else
    sketchybar --set $NAME background.drawing=on background.color=$Base icon.color=$Lavender
fi

