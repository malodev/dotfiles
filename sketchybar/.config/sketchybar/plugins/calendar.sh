#!/bin/bash

echo "calendar.sh called for $NAME with $SENDER"

if [ "$NAME" = "time" ]; then
  sketchybar --set $NAME label="$(date '+%H:%M')"
fi

if [ "$NAME" = "day" ]; then
  sketchybar --set $NAME label="$(date '+%a')"
fi

if [ "$NAME" = "date" ]; then
  sketchybar --set $NAME label="$(date '+%d' | sed s/^0//)"
fi

if [ "$NAME" = "month" ]; then
  sketchybar --set $NAME label="$(date '+%b')"
fi


