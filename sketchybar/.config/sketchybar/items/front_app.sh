#!/bin/bash
echo "front_app called with $SENDER"
sketchybar --add item front_app left \
           --set front_app       background.color=$Mouve \
                                 icon.color=$Yellow \
                                 icon.font="sketchybar-app-font:Regular:20.0" \
                                 label.drawing=off \
                                 script="$PLUGIN_DIR/front_app.sh"            \
           --subscribe front_app front_app_switched
