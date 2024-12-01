#!/bin/bash

volume_slider=(
  script="$PLUGIN_DIR/volume.sh"
  updates=on
  label.drawing=off
  icon.drawing=off
  slider.highlight_color=$BLUE
  slider.background.height=5
  slider.background.corner_radius=3
  slider.background.color=$BACKGROUND_2
  slider.knob=􀀁
  slider.knob.drawing=on
)

volume_icon=(
  script="$PLUGIN_DIR/volume_click.sh"
  updates=on
  #padding_left=10
  padding_right=10
  icon=$VOLUME_100
  icon.width=0
  icon.align=left
  icon.color=$Lavender
  icon.font="$FONT:Regular:14.0"
  label.width=25
  label.align=left
  label.font="$FONT:Regular:14.0"
)

status_bracket=(
  background.color=$BACKGROUND_1
  background.border_color=$BACKGROUND_2
)

sketchybar \
           # --add slider volume right            \
           # --set volume "${volume_slider[@]}"   \
           # --subscribe volume volume_change     \
           #                    mouse.clicked     \
           #                                     \
sketchybar \
           --add item volume_icon right         \
           --set volume_icon "${volume_icon[@]}" \
           --subscribe volume_icon volume_change \
           --subscribe volume_icon mouse.clicked \

