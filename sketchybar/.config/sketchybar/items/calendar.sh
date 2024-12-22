#!/bin/bash

time=(
  icon=cal                     
  icon.color=$BLACK
  icon.font="$FONT:$Base:12.0" 
  icon.padding_left=5          
  icon.padding_right=5         
  icon.drawing=off             
  label.color=$Base
  label.padding_left=5         
  label.padding_right=5        
  background.color=$Lavender
  background.height=29         
  background.corner_radius=11
  update_freq=30
  script="$PLUGIN_DIR/calendar.sh"
)

date_item_common=(
  update_freq=60
  icon.drawing=off
  icon.drawing=off
  padding_right=4
  script="$PLUGIN_DIR/calendar.sh"
)
  
date_item() {
  sketchybar --add item "$1" "$2" --set "$1" label="$3" "${date_item_common[@]}" --subscribe "$1" system_woke  
}

sb_date() {
  date_item day "$1" "$(date '+%a')"
  date_item date "$1" "$(date '+%d' | sed s/^0//)"
  date_item month "$1" "$(date '+%b')"
}

sketchybar --add item time right       \
           --set time "${time[@]}" \
           --subscribe time system_woke

sb_date right script="$PLUGIN_DIR/calendar.sh"
