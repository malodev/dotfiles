#!/bin/bash

source "$CONFIG_DIR/icons.sh"
source "$CONFIG_DIR/colors.sh"

BATTERY_INFO="$(pmset -g batt)"
PERCENTAGE=$(echo "$BATTERY_INFO" | grep -Eo "\d+%" | cut -d% -f1)
CHARGING=$(echo "$BATTERY_INFO" | grep 'AC Power')

if [ $PERCENTAGE == "" ]; then
  exit 0
fi

DRAWING=on
COLOR=$Green
case ${PERCENTAGE} in
  9[0-9]|100) ICON=$BATTERY_100;
  ;;
  [6-8][0-9]) ICON=$BATTERY_75; COLOR=$Teal 
  ;;
  [3-5][0-9]) ICON=$BATTERY_50; COLOR=$Yellow
  ;;
  [1-2][0-9]) ICON=$BATTERY_25; COLOR=$Peach
  ;;
  *) ICON=$BATTERY_0; COLOR=$Red
esac

if [[ $CHARGING != "" ]]; then
  ICON=$BATTERY_CHARGING
  DRAWING=on
fi

echo "Plugin battery.sh called by $SENDER"
echo "Battery:" $NAME $PERCENTAGE $ICON $COLOR 

sketchybar --set $NAME drawing=$DRAWING icon="$ICON" icon.color=$COLOR
