-- init.lua
-- Main Entry Point

-- Must require "sketchybar" to get the global sbar variable
-- when running as a standalone Lua script
sbar = require("sketchybar")

local colors = require("colors")
local settings = require("settings")

sbar.begin_config()

-- Register custom events
sbar.add("event", "media_change")

-- 1. Bar Configuration
sbar.bar({
  height = 65, -- Width (since bar is vertical)
  position = "right", -- Vertical Layout
  y_offset = 50, -- must clear the menu bar or the bar draws over it. Menu bar
  -- height on this display is 50px (check with:
  --   osascript -e 'tell application "System Events" to get size of menu bar 1
  --                 of application process "Finder"'
  -- => "2294, 50"). The first item then starts ~12px lower, level with the
  -- top edge of a `yabai -m window --grid 1:1:0:0:1:1` window.
  margin = 10,
  corner_radius = 9,
  blur_radius = 0, -- was 20: blur is the most expensive thing the bar composites
  padding_left = 10,
  padding_right = 10,
  color = colors.transparent,
  shadow = false, -- was true: one more shadow per redraw
  sticky = true,
  -- topmost: "window" (kCGFloatingWindowLevel) sits above app windows but
  -- BELOW system panels. Do not use `true`/on (= kCGStatusWindowLevel, the
  -- "all" level): that paints the bar over Control Centre and the
  -- notification history. Do not use false either (= kCGBackstopMenuLevel):
  -- the bar renders but is invisible. See bar_manager_set_topmost().
  topmost = "window",
})

-- 2. Default Item Settings
sbar.default({
  icon = {
    font = {
      family = settings.font.nerd,
      style = "Regular",
      size = 16.0,
    },
    color = colors.icon,
    padding_left = 4,
    padding_right = 4,
  },
  label = {
    font = {
      family = settings.font.text,
      style = "Semibold",
      size = 14.0,
    },
    color = colors.label,
    padding_left = 4,
    padding_right = 4,
  },
  background = {
    corner_radius = 9,
    padding_left = 2,
    padding_right = 2,
  },
  popup = {
    background = {
      border_width = 2,
      corner_radius = 11,
      border_color = colors.popup.border,
      color = colors.popup.bg,
      shadow = { drawing = true },
    },
  },
})

-- 3. Load Modules (Order matters: Top -> Bottom)

-- Top Section
require("items.apple")
require("items.front_app")

-- Center Section (Workspaces)
-- Spaces strip for the native Mission Control spaces, driven by yabai
-- signals (see items/yabai_spaces.lua).
require("items.yabai_spaces")

-- DISABLED: items.aerospace shells out to the `aerospace` binary, which is not
-- installed, from a 5s periodic_refresh loop — it logged "sh: aerospace:
-- command not found" every 5 seconds and drew 12 animated space items.
-- Re-enable only if AeroSpace comes back (it creates the same space.* ids as
-- items/yabai_spaces.lua, so only one of the two may be active).
-- require("items.aerospace")
require("items.media")
require("items.volume")
require("items.wifi")
require("items.weather")
require("items.git")
-- DISABLED: items.cpu spawns the cpu_load event-provider helper, which pushes
-- an event every 2 seconds. Re-enable for the CPU label popup.
-- require("items.cpu")

-- Bottom Section
require("items.widgets") -- Battery, Clock

sbar.end_config()

-- 4. Final Update
-- sbar.exec("sketchybar --update")

sbar.event_loop()
