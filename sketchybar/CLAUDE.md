# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a SketchyBar configuration repository using the SbarLua framework. SketchyBar is a macOS status bar application, and this config uses Lua instead of shell scripts for better maintainability.

## Key Commands

```bash
# Restart SketchyBar to apply config changes
brew services restart sketchybar

# Test bar updates without restart
sketchybar --update
sketchybar --reload

# View SketchyBar logs for debugging
log stream --predicate 'process == "sketchybar"'
tail -f /opt/homebrew/var/log/sketchybar/sketchybar.err.log
tail -f /opt/homebrew/var/log/sketchybar/sketchybar.out.log

# Verify font installation
sketchybar --add item icon.test right
sketchybar --set icon.test label.font="sketchybar-app-font:Regular:18.0" label="figma"
```

## Architecture

### Bar Layout

The bar is vertical instead of horizontal as in typical SketchyBar configurations.
This brings some challenges, that have to be handled with care.

### Entry Points

- `sketchybarrc` - Shell entry point that loads the Lua configuration
- `helpers/init.lua` - Sets up SbarLua package path and compiles C helpers
- `init.lua` - Main Lua entry, loads bar config, defaults, and items

### Configuration Flow

1. `sketchybarrc` requires `helpers` then `init`
2. `helpers/init.lua` adds SbarLua to package.cpath
3. `init.lua` calls `sbar.begin_config()`, loads modules, then `sbar.event_loop()`

### Active Configurations

There are multiple config directories - the active one is `.config/sketchybar/`. Others (`sketchybar-new/`, `sketchybar-old/`, `sketchybar-ai-old/`) are experiments or backups.
The `sketchybar-new/` directory is a working configuration used for reference and inspiration.
The `sketchybar-ai-old/` MUST be ignored
The `sketchybar-old/` is the previous configuration based on shell scripts instead of Lua.

### Module Structure

- `colors.lua` - Tokyo Night color scheme with alpha helper function
- `settings.lua` - Global settings (paddings, font config via `helpers/default_font.lua`)
- `bar.lua` / `default.lua` - Bar appearance and default item styling
- `items/` - Individual widgets (apple, front_app, aerospace, media, volume, weather, etc.)
- `items/widgets/` - Right-side widgets (battery, cpu, wifi, volume, music, weather, git_toolkit)
- `helpers/app_icons.lua` - App name to icon mappings for sketchybar-app-font

### Item Pattern

Items follow this pattern:
```lua
local colors = require("colors")
local settings = require("settings")

local my_item = sbar.add("item", "item_name", {
    position = "left" | "center" | "right",
    icon = { ... },
    label = { ... },
    background = { ... },
})

my_item:subscribe("event_name", function(env)
    -- Update logic
end)
```

### Event System

- `aerospace_workspace_change` - Custom event from AeroSpace window manager
- `media_change` - Media player state changes
- Standard SketchyBar events: `mouse.clicked`, `routine`, `system_woke`, etc.

## Important Customizations

When modifying:
- `items/aerospace_workspaces.lua` - Update `WORKSPACE_LAYOUT` for monitor arrangement
- WiFi widgets - Update network interface (find with `networksetup -listallhardwareports`)
- Weather widgets - Update location coordinates

## Dependencies

- SbarLua framework at `~/.local/share/sketchybar_lua/`
- Fonts: SF Pro, SF Mono, Victor Mono Nerd Font, sketchybar-app-font
- CLI tools: `switchaudio-osx`, `nowplaying-cli` (for media widgets)
- AeroSpace window manager (for workspace integration)
