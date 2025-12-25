local colors = require("colors")
local icons = require("icons")
local settings = require("settings")

local height = 50
local apple = sbar.add("item", "apple", {
  position = "left", -- Top of vertical bar
  icon = {
    string = icons.apple,
    color = colors.text,
    font = { family = settings.font.apps, size = 20.0 },
    width = settings.item_width,
    align = "center",
  },
  label = { drawing = false },
  background = {
    color = colors.surface0,
    corner_radius = 9,
    height = height,
    drawing = true,
  },
  width = settings.item_width,
  -- padding_bottom removed (invalid property)
  click_script = "sketchybar --set $NAME popup.drawing=toggle"
})

sbar.add("item", {
  position = "popup." .. apple.name,
  icon = {
    string = icons.prefs,
    font = { size = 16 },
    color = colors.blue,
    width = 20,
    padding_right = 0,
  },
  label = {
    string = "Preferences",
    font = {
      family = settings.font.text,
      style = "Regular",
      size = 16,
    },
    color = colors.text,
    padding_left = 2,
  },
  padding_left = 6,
  padding_right = 6,
  click_script = "open -a 'System Settings'; sketchybar --set apple popup.drawing=off"
})

sbar.add("item", {
  position = "popup." .. apple.name,
  icon = {
    string = icons.activity,
    font = { size = 16 },
    color = colors.green,
    width = 20,
    padding_right = 0,
  },
  label = {
    string = "Activity Monitor",
    font = {
      family = settings.font.text,
      style = "Regular",
      size = 16,
    },
    color = colors.text,
    padding_left = 2,
  },
  padding_left = 6,
  padding_right = 6,
  click_script = "open -a 'Activity Monitor'; sketchybar --set apple popup.drawing=off"
})

sbar.add("item", {
  position = "popup." .. apple.name,
  icon = {
    string = icons.lock,
    font = { size = 16 },
    color = colors.peach,
    width = 20,
    padding_right = 0,
  },
  label = {
    string = "Lock Screen",
    font = {
      family = settings.font.text,
      style = "Regular",
      size = 16,
    },
    color = colors.text,
    padding_left = 2,
  },
  padding_left = 6,
  padding_right = 6,
  click_script = "pmset displaysleepnow; sketchybar --set apple popup.drawing=off"
})
