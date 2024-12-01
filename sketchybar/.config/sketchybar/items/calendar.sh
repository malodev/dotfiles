#!/bin/bash

calendar=(
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

sb_date() {
	sketchybar \
		--add item day "$1" --set day update_freq=120 icon.drawing=off padding_right=4 label="$(date '+%a')" \
		--add item date "$1" --set date update_freq=120 icon.drawing=off padding_right=4 label="$(date '+%d' | sed s/^0//)" \
		--add item month "$1" --set month update_freq=120 icon.drawing=off padding_right=4 label="$(date '+%b')"
}

sketchybar --add item calendar right       \
           --set calendar "${calendar[@]}" \
           --subscribe calendar system_woke

sb_date right
