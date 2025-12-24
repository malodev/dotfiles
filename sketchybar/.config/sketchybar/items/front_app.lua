local colors = require("colors")
local settings = require("settings")
local app_icons = require("helpers.app_icons")

local height = 50
local front_app = sbar.add("item", "front_app", {
  position = "left", -- Top of vertical bar
  padding_left = -10,
  display = "active",
  icon = {
    drawing = true,
    font = { family = settings.font.apps, size = 20.0 },
    width = settings.item_width,
    align = "center",
  },
  label = { drawing = false },
  background = {
    color = colors.surface0,
    corner_radius = 8,
    height = height,
    drawing = true,
  },
  updates = true,
})

-- Song title label below icon
local front_app_label = sbar.add("item", "front_app.label", {
  position = "left",
  icon = { drawing = false },
  padding_left = -17,
  padding_right = 29,
  scroll_texts = true,
  label = {
    string = "—",
    font = {
      family = settings.font.text,
      style = "Regular",
      size = 12,
    },
    color = colors.subtext1,
    max_chars = 6,
    scroll_duration = 100,
    align = "center",
  width = settings.item_width,
  },
  background = {
    color = colors.surface0,
    corner_radius = 8,
    height = height,
    drawing = true,
  },
})

front_app:subscribe("front_app_switched", function(env)
  local icon = app_icons[env.INFO] or ":default:"
  front_app:set({
    icon = { string = icon },
  })
  front_app_label:set({
    label = { string = env.INFO }
  })
end)
