local colors = require("colors")
local icons = require("icons")
local settings = require("settings")

local height = 50
-- 1. Battery
local battery_label = sbar.add("item", "battery.label", {
  position = "right",
  icon = { drawing = false },
  label = {
    string = "—",
    font = { family = settings.font.text, style = "Regular", size = settings.label_size },
    color = colors.subtext1,
    align = "center",
    width = settings.item_width,
  },
  background = {
    color = colors.surface0,
    corner_radius = 9,
    height = height,
    drawing = true,
  },
})
-- Battery icon
local battery = sbar.add("item", "battery", {
  position = "right",
  padding_right = -22,
  update_freq = 120,
  icon = { font = { size = 18.0 },
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
  popup = {
    align = "center",
    horizontal = false,
    y_offset = -100,
  },
})

-- Helper: create battery popup row
local function add_battery_row(name, icon_str, icon_color, label_text)
  return sbar.add("item", name, {
    position = "popup." .. battery.name,
    icon = {
      string = icon_str,
      font = { size = 16 },
      color = icon_color,
      width = 20,
    },
    label = {
      string = label_text,
      font = {
        family = settings.font.text,
        style = "Regular",
        size = 14,
      },
      color = colors.text,
    },
    padding_left = 6,
    padding_right = 6,
  })
end

-- Popup: Header (percentage)
local popup_percent = sbar.add("item", "battery.popup.percent", {
  position = "popup." .. battery.name,
  icon = {
    string = icons.battery[100],
    font = { size = 18 },
    color = colors.green,
  },
  label = {
    string = "—%",
    font = {
      family = settings.font.text,
      style = "Bold",
      size = 18,
    },
    color = colors.text,
    width = 60,
    align = "right",
  },
  padding_left = 6,
  padding_right = 6,
})

-- Popup rows
local popup_source = add_battery_row("battery.popup.source", "􀋦", colors.blue, "Source: —")
local popup_time = add_battery_row("battery.popup.time", "􀐫", colors.peach, "Time: —")
local popup_health = add_battery_row("battery.popup.health", "􀛓", colors.teal, "Health: —")
local popup_cycles = add_battery_row("battery.popup.cycles", "􀊧", colors.mauve, "Cycles: —")

-- Refresh battery info
local function refresh_battery()
  sbar.exec("pmset -g batt", function(batt_info)
    local icon = icons.battery[0]
    local color = colors.red
    local percent = "—"
    local charge_num = 0

    local found, _, charge = batt_info:find("(%d+)%%")
    if found then
      charge_num = tonumber(charge)
      percent = charge .. "%"

      if charge_num > 90 then icon = icons.battery[100]; color = colors.green
      elseif charge_num > 60 then icon = icons.battery[75]; color = colors.teal
      elseif charge_num > 30 then icon = icons.battery[50]; color = colors.yellow
      elseif charge_num > 10 then icon = icons.battery[25]; color = colors.peach
      end
    end

    local source = "Battery"
    if batt_info:find("AC Power") then
      icon = icons.battery.charging
      color = colors.green
      source = "AC Power"
    end

    -- Get time remaining
    local time_remaining = "—"
    local _, _, time_str = batt_info:find("(%d+:%d+) remaining")
    if time_str then
      time_remaining = time_str
    elseif batt_info:find("charged") then
      time_remaining = "Charged"
    elseif batt_info:find("charging") then
      time_remaining = "Charging"
    elseif batt_info:find("finishing charge") then
      time_remaining = "Finishing"
    end

    battery:set({ icon = { string = icon, color = color } })
    battery_label:set({ label = { string = percent, color = color } })

    -- Update popup
    popup_percent:set({
      icon = { string = icon, color = color },
      label = { string = percent },
    })
    popup_source:set({ label = { string = "Source: " .. source } })
    popup_time:set({ label = { string = "Time: " .. time_remaining } })
  end)

  -- Get health and cycle count from system_profiler
  sbar.exec("system_profiler SPPowerDataType 2>/dev/null | grep -E 'Condition|Cycle Count'", function(out)
    if not out or out == "" then return end

    local health = "—"
    local cycles = "—"

    local _, _, h = out:find("Condition: (%w+)")
    if h then health = h end

    local _, _, c = out:find("Cycle Count: (%d+)")
    if c then cycles = c end

    popup_health:set({ label = { string = "Health: " .. health } })
    popup_cycles:set({ label = { string = "Cycles: " .. cycles } })
  end)
end

battery:subscribe({"routine", "power_source_change", "system_woke"}, function()
  refresh_battery()
end)

-- Toggle popup on click
battery:subscribe("mouse.clicked", function(env)
  if env.BUTTON == "right" then
    sbar.exec("open 'x-apple.systempreferences:com.apple.preference.battery'")
  else
    battery:set({ popup = { drawing = "toggle" } })
    refresh_battery()
  end
end)

-- Close popup when mouse exits
popup_cycles:subscribe("mouse.exited.global", function()
  battery:set({ popup = { drawing = false } })
end)

-- 2. Clock
local clock = sbar.add("item", "clock", {
  position = "right",
  update_freq = 30,
  icon = { drawing = false },
  label = {
    font = { style = "Bold", size = 16.0 },
    align = "center",
    width = settings.item_width,
  },
  background = {
    color = colors.surface0,
    corner_radius = 9,
    height = height,
    drawing = true,
  },
})

clock:subscribe({"routine", "system_woke"}, function()
  clock:set({ label = os.date("%H:%M") })
end)

-- Clock date
local date = sbar.add("item", "date", {
  position = "right",
  padding_right = -20,
  icon = { drawing = false },
  label = {
    string = os.date("%a %d"),
    font = { size = 16.0, style = "Semibold" },
    color = colors.subtext1,
    align = "center",
    width = settings.item_width,
  },
  background = {
    color = colors.surface0,
    corner_radius = 9,
    height = height,
    drawing = true,
  },
})

local function open_calendar()
  sbar.exec("open -a 'Calendar'")
end

clock:subscribe("mouse.clicked", function(env)
  if env.BUTTON == "right" then
    open_calendar()
  end
end)

date:subscribe("mouse.clicked", function(env)
  if env.BUTTON == "right" then
    open_calendar()
  end
end)
