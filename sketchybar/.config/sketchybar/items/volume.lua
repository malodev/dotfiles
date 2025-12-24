local colors = require("colors")
local icons = require("icons")

-- Fixed slider syntax: width provided as explicit argument (115)
local volume_slider = sbar.add("slider", 115, {
  position = "center", -- Center section
  updates = true,
  label = { drawing = false },
  icon = { drawing = false },
  slider = {
    highlight_color = colors.blue,
    background = {
      height = 6,
      corner_radius = 3,
      color = colors.bg2,
    },
    knob = {
      string = "􀀁",
      drawing = true,
    },
  },
  background = { color = colors.bg1, height = 2, y_offset = -20 },
  padding_left = 10,
  padding_right = 10,
  drawing = false,
  click_script = "osascript -e 'set volume output volume $PERCENTAGE'"
})

local volume_icon = sbar.add("item", "volume.icon", {
  position = "center",
  icon = { string = icons.volume[100], color = colors.icon },
  label = { string = "100%", drawing = false },
})

-- Logic: Hover to show slider
volume_icon:subscribe("mouse.entered", function()
  volume_slider:set({ drawing = true })
end)

volume_icon:subscribe("mouse.exited.global", function()
  volume_slider:set({ drawing = false })
end)

volume_icon:subscribe("volume_change", function(env)
  local volume = tonumber(env.INFO)
  local icon = icons.volume[0]

  if volume > 60 then icon = icons.volume[100]
  elseif volume > 30 then icon = icons.volume[66]
  elseif volume > 10 then icon = icons.volume[33]
  elseif volume > 0 then icon = icons.volume[10]
  end

  volume_icon:set({ icon = icon })
  volume_slider:set({ slider = { percentage = volume } })
end)
