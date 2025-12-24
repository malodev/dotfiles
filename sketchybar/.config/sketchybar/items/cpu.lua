local colors = require("colors")
local icons = require("icons")
local settings = require("settings")

local height = 50

-- Start the cpu_load event provider
sbar.exec("killall cpu_load 2>/dev/null; $CONFIG_DIR/helpers/event_providers/cpu_load/bin/cpu_load cpu_update 2.0")

-- Register the custom event
sbar.add("event", "cpu_update")

-- CPU icon on the vertical bar
local cpu = sbar.add("item", "cpu", {
  position = "center",
  padding_left = -224,
  icon = {
    string = icons.cpu,
    font = {
      family = settings.font.nerd,
      size = settings.icon_size,
    },
    color = colors.blue,
  },
  label = { drawing = false },
  background = {
    color = colors.surface0,
    corner_radius = 9,
    height = height,
    drawing = true,
  },
  popup = {
    align = "center",
    horizontal = true,
  },
  width = settings.item_width,
})

-- CPU percentage label below icon
local cpu_label = sbar.add("item", "cpu.label", {
  position = "center",
  padding_left = -254,
  icon = { drawing = false },
  label = {
    string = "—",
    font = {
      family = settings.font.text,
      style = "Regular",
      size = settings.label_size,
    },
    color = colors.subtext1,
    align = "center",
    max_chars = 6,
  },
  background = {
    color = colors.surface0,
    corner_radius = 9,
    height = height,
    drawing = true,
  },
  width = settings.item_width,
})

-- Popup: User load
local user_item = sbar.add("item", "cpu.user", {
  position = "popup." .. cpu.name,
  icon = {
    string = "User",
    font = {
      family = settings.font.text,
      style = "Regular",
      size = 11,
    },
    color = colors.subtext1,
    width = 50,
  },
  label = {
    string = "0%",
    font = {
      family = settings.font.text,
      style = "Bold",
      size = 12,
    },
    color = colors.blue,
  },
  padding_left = 10,
  padding_right = 5,
})

-- Popup: System load
local sys_item = sbar.add("item", "cpu.sys", {
  position = "popup." .. cpu.name,
  icon = {
    string = "Sys",
    font = {
      family = settings.font.text,
      style = "Regular",
      size = 11,
    },
    color = colors.subtext1,
    width = 40,
  },
  label = {
    string = "0%",
    font = {
      family = settings.font.text,
      style = "Bold",
      size = 12,
    },
    color = colors.peach,
  },
  padding_left = 5,
  padding_right = 10,
})

-- Get color based on load percentage
local function get_load_color(load)
  if load > 80 then
    return colors.red
  elseif load > 60 then
    return colors.peach
  elseif load > 30 then
    return colors.yellow
  else
    return colors.blue
  end
end

-- Subscribe to cpu_update event
cpu:subscribe("cpu_update", function(env)
  local total = tonumber(env.total_load) or 0
  local user = tonumber(env.user_load) or 0
  local sys = tonumber(env.sys_load) or 0

  local color = get_load_color(total)

  -- Update main icon
  cpu:set({
    icon = { color = color },
  })

  -- Update label
  cpu_label:set({
    label = {
      string = total .. "%",
      color = color,
    },
  })

  -- Update popup items
  user_item:set({
    label = { string = user .. "%" },
  })

  sys_item:set({
    label = { string = sys .. "%" },
  })
end)

-- Toggle popup on click
cpu:subscribe("mouse.clicked", function(env)
  if env.BUTTON == "right" then
    sbar.exec("open -a 'Activity Monitor'")
  else
    cpu:set({ popup = { drawing = "toggle" } })
  end
end)

-- Close popup when mouse exits
cpu:subscribe("mouse.exited.global", function()
  cpu:set({ popup = { drawing = false } })
end)
