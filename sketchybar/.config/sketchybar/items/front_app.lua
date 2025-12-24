local colors = require("colors")
local settings = require("settings")
local app_icons = require("helpers.app_icons")

local front_app = sbar.add("item", "front_app", {
  position = "left", -- Top of vertical bar
  display = "active",
  icon = { 
    drawing = true, 
    font = { family = settings.font.apps, size = 20.0 } 
  },
  label = { 
    drawing = true, 
    font = { style = "Bold" },
    padding_left = 5
  },
  background = { color = colors.surface0 },
  updates = true,
})

front_app:subscribe("front_app_switched", function(env)
  local icon = app_icons[env.INFO] or ":default:"
  front_app:set({
    icon = { string = icon },
    label = { string = env.INFO }
  })
end)
