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
SPACE_ICONS=("1" "2" "3" "4" "5" "6" "7" "8" "9" "10")
for i in "${!SPACE_ICONS[@]}"
do
  sid="$(($i+1))"
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
    #click_script="yabai -m space --focus $sid"
  )
  sketchybar --add space space."$sid" left --set space."$sid" "${space[@]}"
done

echo "Script: $PLUGIN_DIR/space_windows.sh"

