local colors = require("colors")
local icons = require("icons")
local settings = require("settings")

-- Volume icon on the vertical bar
local volume_icon = sbar.add("item", "volume.icon", {
  position = "center",
  icon = {
    string = icons.volume[100],
    font = { size = 18 },
    color = colors.blue,
  },
  label = { drawing = false },
  background = { drawing = false },
  popup = {
    align = "center",
    horizontal = true,
  },
})

-- Popup: Volume percentage label
local volume_percent = sbar.add("item", "volume.percent", {
  position = "popup." .. volume_icon.name,
  icon = { drawing = false },
  label = {
    string = "100%",
    font = {
      family = settings.font.text,
      style = "Bold",
      size = 12,
    },
    color = colors.text,
    width = 45,
    align = "center",
  },
  padding_left = 10,
  padding_right = 5,
})

-- Popup: Volume slider
local volume_slider = sbar.add("slider", "volume.slider", 150, {
  position = "popup." .. volume_icon.name,
  slider = {
    highlight_color = colors.blue,
    background = {
      height = 6,
      corner_radius = 3,
      color = colors.surface1,
    },
    knob = {
      string = "􀀁",
      drawing = true,
    },
  },
  background = {
    color = colors.transparent,
    height = 6,
  },
  padding_left = 5,
  padding_right = 10,
  click_script = 'osascript -e "set volume output volume $PERCENTAGE"',
})

-- Get icon based on volume level
local function get_volume_icon(volume)
  if volume > 60 then
    return icons.volume[100]
  elseif volume > 30 then
    return icons.volume[66]
  elseif volume > 10 then
    return icons.volume[33]
  elseif volume > 0 then
    return icons.volume[10]
  else
    return icons.volume[0]
  end
end

-- Update volume display
local function update_volume(volume)
  local icon = get_volume_icon(volume)
  local lead = volume < 10 and "0" or ""

  volume_icon:set({ icon = { string = icon } })
  volume_percent:set({ label = { string = lead .. volume .. "%" } })
  volume_slider:set({ slider = { percentage = volume } })
end

-- Subscribe to volume changes
volume_icon:subscribe("volume_change", function(env)
  local volume = tonumber(env.INFO) or 0
  update_volume(volume)
end)

-- Toggle popup on click
volume_icon:subscribe("mouse.clicked", function(env)
  if env.BUTTON == "right" then
    sbar.exec("open /System/Library/PreferencePanes/Sound.prefpane")
  else
    volume_icon:set({ popup = { drawing = "toggle" } })
  end
end)

-- Scroll to change volume (trackpad two-finger scroll)
volume_icon:subscribe("mouse.scrolled", function(env)
  local delta = tonumber(env.SCROLL_DELTA) or 0
  if delta == 0 then return end

  -- Normalize large trackpad deltas (they can be 10-100+)
  local direction = delta > 0 and 1 or -1
  local step = math.min(math.abs(delta), 10)
  local change = direction * step

  -- Get current volume and set new
  sbar.exec("osascript -e 'output volume of (get volume settings)'", function(current)
    local cur_vol = tonumber(current) or 50
    local new_vol = cur_vol + change
    if new_vol > 100 then new_vol = 100 end
    if new_vol < 0 then new_vol = 0 end
    sbar.exec("osascript -e 'set volume output volume " .. new_vol .. "'")
    -- Manually update the display since volume_change event may not fire
    update_volume(new_vol)
  end)
end)

-- Close popup when mouse exits
volume_slider:subscribe("mouse.exited.global", function()
  volume_icon:set({ popup = { drawing = false } })
end)

-- Initial volume fetch
sbar.exec('osascript -e "output volume of (get volume settings)"', function(vol)
  local volume = tonumber(vol) or 50
  update_volume(volume)
end)
