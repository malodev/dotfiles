#!/bin/bash
echo "space_windows.sh called with $SENDER"
if [ "$SENDER" = "space_windows_change" ]; then

  space="$(echo "$INFO" | jq -r '.space')"
  apps="$(echo "$INFO" | jq -r '.apps | keys[]')"
  echo "============"
  echo "Space: $space"
  echo "Apps: $apps"
  echo "============"

  icon_strip=""
  if [ "${apps}" != "" ]; then
    while read -r app
    do
      icon_strip+=" $($CONFIG_DIR/plugins/icon_map_fn.sh "$app")"
    done <<< "${apps}"
  else
    icon_strip="—"
  fi
  echo "Icon Strip: $icon_strip"
  sketchybar --set space.$space label="$icon_strip"
fi
