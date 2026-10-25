#!/bin/sh

# @raycast.schemaVersion 1
# @raycast.title Launch PhotoCraft (Agent)
# @raycast.packageName PhotoCraft
# @raycast.mode full
# @raycast.icon 📷
# @raycast.description Launch PhotoCraft with the agent control channel (port 7878) so pi can drive it

exec ~/.local/bin/photocraft-agent
