#!/bin/sh

# @raycast.schemaVersion 1
# @raycast.title Launch SoundCraft (Agent)
# @raycast.packageName SoundCraft
# @raycast.mode full
# @raycast.icon 🎚️
# @raycast.description Launch SoundCraft with the agent control channel (port 7801) so pi can drive it

exec ~/.local/bin/soundcraft-agent
