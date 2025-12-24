local colors = require("colors")
local icons = require("icons")

local apple = sbar.add("item", "apple", {
  position = "left", -- Top of vertical bar
  icon = { string = icons.apple, color = colors.text },
  label = { drawing = false },
  -- padding_bottom removed (invalid property)
  padding_right = 10,
  click_script = "sketchybar --set $NAME popup.drawing=toggle"
})

sbar.add("item", {
  position = "popup." .. apple.name,
  label = { string = "Preferences" },
  icon = { string = icons.prefs },
  click_script = "open -a 'System Settings'; sketchybar --set apple popup.drawing=off"
})

sbar.add("item", {
  position = "popup." .. apple.name,
  label = { string = "Activity Monitor" },
  icon = { string = icons.activity },
  click_script = "open -a 'Activity Monitor'; sketchybar --set apple popup.drawing=off"
})

sbar.add("item", {
  position = "popup." .. apple.name,
  label = { string = "Lock Screen" },
  icon = { string = icons.lock },
  click_script = "pmset displaysleepnow; sketchybar --set apple popup.drawing=off"
})
