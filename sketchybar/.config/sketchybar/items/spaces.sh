##### Adding Mission Control Space Indicators #####
# Let's add some mission control spaces:
# https://felixkratz.github.io/SketchyBar/config/components#space----associate-mission-control-spaces-with-an-item
# to indicate active and available mission control spaces.

# SPACE_ICONS=("1" "2" "3" "4" "5" "6" "7" "8" "9" "10")
# for i in "${!SPACE_ICONS[@]}"
# do
#   sid="$(($i+1))"
#   space=(
#     space="$sid"
#     icon="${SPACE_ICONS[i]}"
#     icon.padding_left=7
#     icon.padding_right=7
#     background.color=0x40ffffff
#     background.corner_radius=5
#     background.height=25
#     label.drawing=off
#     script="$PLUGIN_DIR/space.sh"
#     #click_script="yabai -m space --focus $sid"
#   )
#   sketchybar --add space space."$sid" left --set space."$sid" "${space[@]}"
# done
echo "Spaces Called: $ITEM_DIR/spaces.sh"

sketchybar --add item space_separator left    \
           --set space_separator \
           icon="" \
           icon.color=$Overlay1                  \
           icon.font="Hack Nerd Font:Regular:16.0" \
           icon.padding_left=4                   \
           label.drawing=off                     \
           background.drawing=off                \
           background.padding_left=5              \
           background.padding_right=5            \
           script="$PLUGIN_DIR/space_windows.sh" \
           --subscribe space_separator space_windows_change

RED=0xffed8796
#SPACE_ICONS=("1" "2" "3" "4" "5" "6" "7" "8" "9" "10")
# Extend to support up to 20 spaces
SPACE_ICONS=("1" "2" "3" "4" "5" "6" "7" "8" "9" "10" "11" "12" "13" "14" "15" "16" "17" "18" "19" "20")

# Key codes for number keys 1-0 on keyboard
KEY_CODES=(18 19 20 21 23 22 26 28 25 29)

for i in "${!SPACE_ICONS[@]}"
do
  sid="$(($i+1))"
  # Determine which method to use based on space number
  if [ $sid -le 10 ]; then
    # Use Option+number for spaces 1-10
    key_index=$(($sid - 1))
    click_script="osascript -e 'tell application \"System Events\" to key code ${KEY_CODES[$key_index]} using option down'"
  else
    # For spaces 11-20, use Ctrl+Option+number
    # We map spaces 11-20 to keys 1-0 (with Ctrl+Option modifier)
    new_index=$(( ($sid - 11) % 10 ))
    click_script="osascript -e 'tell application \"System Events\" to key code ${KEY_CODES[$new_index]} using {control down, option down}'"
  fi
  space=(
    space="$sid"
    label="${SPACE_ICONS[i]}"
		label.padding_left=0 \
		label.padding_right=6 \
		icon.font="$FONT:Bold:18.0" \
		label.font="$FONT_APPS:18.0" \
		label.highlight_color=$Yellow \
		background.color=$Mauve \
		background.corner_radius=5 \
		background.height=35 \
    background.padding_right=15 \
    background.padding_left=0 \
		background.drawing=off \
		icon="${SPACE_ICONS[i]}" \
    icon.highlight_color=$Yellow \
    icon.padding_left=6 \
    icon.padding_right=0 \
    script="$PLUGIN_DIR/space.sh"
    click_script="$click_script"
    #click_script="yabai -m space --focus $sid"
  )
  sketchybar --add space space."$sid" left --set space."$sid" "${space[@]}"
done

echo "Script: $PLUGIN_DIR/space_windows.sh"

