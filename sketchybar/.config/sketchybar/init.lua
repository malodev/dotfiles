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
  height = 65,         -- Width (since bar is vertical)
  position = "right",  -- Vertical Layout
  y_offset = 10,
  margin = 10,
  corner_radius = 9,
  blur_radius = 20,
  padding_left = 10,
  padding_right = 10,
  color = colors.transparent,
  shadow = true,
  sticky = true,
  topmost = true,
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
      size = 13.0,
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
    }
  }
})

-- 3. Load Modules (Order matters: Top -> Bottom)

-- Top Section
require("items.apple")
require("items.front_app")

-- Center Section (Workspaces)
require("items.aerospace")
require("items.media")
require("items.volume")
require("items.wifi")
require("items.weather")
require("items.git")
require("items.cpu")

-- Bottom Section
require("items.widgets") -- Battery, Clock


sbar.end_config()

-- 4. Final Update
-- sbar.exec("sketchybar --update")

sbar.event_loop()
