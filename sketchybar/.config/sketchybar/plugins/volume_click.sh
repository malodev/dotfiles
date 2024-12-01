#!/bin/bash

WIDTH=100

toggle_devices() {
  which SwitchAudioSource >/dev/null || exit 0
  source "$CONFIG_DIR/colors.sh"

  args=(--remove '/volume.device\.*/' --set "$NAME" popup.drawing=toggle)
  COUNTER=0
  CURRENT="$(SwitchAudioSource -t output -c)"
  while IFS= read -r device; do
    COLOR=$GREY
    if [ "${device}" = "$CURRENT" ]; then
      COLOR=$WHITE
    fi
    args+=(--add item volume.device.$COUNTER popup."$NAME" \
           --set volume.device.$COUNTER label="${device}" \
                                        label.color="$COLOR" \
                 click_script="SwitchAudioSource -s \"${device}\" && sketchybar --set /volume.device\.*/ label.color=$GREY --set \$NAME label.color=$WHITE --set $NAME popup.drawing=off")
    COUNTER=$((COUNTER+1))
  done <<< "$(SwitchAudioSource -a -t output)"

  sketchybar -m "${args[@]}" > /dev/null
}

source "$CONFIG_DIR/icons.sh"
source "$CONFIG_DIR/colors.sh"
COLOR=$Mauve
volume_change() {
  echo "Changing volume" $INFO
  case $INFO in
    [6-9][0-9]|100) ICON=$VOLUME_100
    ;;
    [3-5][0-9]) ICON=$VOLUME_66; COLOR=$Lavender
    ;;
    [1-2][0-9]) ICON=$VOLUME_33; COLOR=$Overlay2
    ;;
    [1-9]) ICON=$VOLUME_10; COLOR=$Overlay0
    ;;
    0) ICON=$VOLUME_0; COLOR=$Surface2
    ;;
    *) ICON=$VOLUME_100; COLOR=$Mauve
  esac
  echo "Volume:" $INFO $ICON $COLOR
  sketchybar --set volume_icon icon=$ICON icon.color=$COLOR
             

}

case "$SENDER" in
  "volume_change") volume_change
  ;;
  "mouse.clicked") toggle_devices
  ;;
esac

