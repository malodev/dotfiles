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
  popup = {
    align = "center",
    horizontal = false,
    y_offset = -300,
  },
  updates = true,
})

--------------------------------------------------------------------------------
-- CALENDAR POPUP
--------------------------------------------------------------------------------

local MAX_EVENTS = settings.calendar.max_events
local CALENDAR_SCRIPT = os.getenv("HOME") .. "/.config/sketchybar/helpers/calendar/get_events.sh"
local CALENDARS = settings.calendar.calendars
local DAYS_AHEAD = settings.calendar.days_ahead

-- Popup header
local cal_header = sbar.add("item", "date.popup.header", {
  position = "popup." .. date.name,
  icon = {
    string = "󰃭",
    font = { family = settings.font.nerd, size = 18 },
    color = colors.blue,
  },
  label = {
    string = "Upcoming Events",
    font = { family = settings.font.text, style = "Bold", size = 18 },
    color = colors.text,
  },
  padding_left = 6,
  padding_right = 6,
})

-- Separator
sbar.add("item", "date.popup.sep", {
  position = "popup." .. date.name,
  icon = { drawing = false },
  label = { drawing = false },
  background = { color = colors.surface1, height = 1 },
  width = 400,
  padding_left = 6,
  padding_right = 6,
})

-- Pre-create event rows (hidden by default)
local event_rows = {}
for i = 1, MAX_EVENTS do
  event_rows[i] = sbar.add("item", "date.event." .. i, {
    position = "popup." .. date.name,
    drawing = false,
    icon = {
      string = "󰥔",
      font = { family = settings.font.nerd, size = 16 },
      color = colors.peach,
      width = 20,
    },
    label = {
      string = "",
      font = { family = settings.font.text, style = "Regular", size = 16 },
      color = colors.text,
    },
    padding_left = 6,
    padding_right = 6,
  })
end

-- Empty/loading state
local cal_empty = sbar.add("item", "date.popup.empty", {
  position = "popup." .. date.name,
  drawing = true,
  icon = {
    string = "󰋗",
    font = { family = settings.font.nerd, size = 14 },
    color = colors.surface2,
    width = 20,
  },
  label = {
    string = "Loading...",
    font = { family = settings.font.text, style = "Regular", size = 14 },
    color = colors.subtext1,
  },
  padding_left = 6,
  padding_right = 6,
})

-- Event data storage
local events_data = {}

local function update_calendar_rows()
  -- Hide all rows first
  for i = 1, MAX_EVENTS do
    event_rows[i]:set({ drawing = false })
  end

  if #events_data == 0 then
    cal_empty:set({ drawing = true, label = { string = "No upcoming events" } })
    return
  end

  cal_empty:set({ drawing = false })

  for i, event in ipairs(events_data) do
    if i > MAX_EVENTS then break end

    local icon_color = colors.peach

    -- Highlight "today" events differently
    if event.datetime:find("today") then
      icon_color = colors.green
    elseif event.datetime:find("tomorrow") then
      icon_color = colors.blue
    end

    -- Format: "Title • datetime"
    local display = event.title .. " • " .. event.datetime

    event_rows[i]:set({
      drawing = true,
      icon = { color = icon_color },
      label = {
        string = display,
        color = colors.text,
      },
    })
  end
end

local function refresh_calendar()
  cal_empty:set({ drawing = true, label = { string = "Loading..." } })

  -- Pass settings as environment variables to the script
  local cmd = string.format(
    "MAX_EVENTS=%d DAYS_AHEAD=%d CALENDARS='%s' %s",
    MAX_EVENTS, DAYS_AHEAD, CALENDARS, CALENDAR_SCRIPT
  )

  -- Use io.popen instead of sbar.exec for different permission inheritance
  local handle = io.popen(cmd)
  local output = handle:read("*a")
  handle:close()
  print(output)

  events_data = {}

  if output and output ~= "" and not output:match("NO_EVENTS") then
    for line in output:gmatch("[^\r\n]+") do
      -- Format: "datetime|title"
      local datetime, title = line:match("^(.+)|(.+)$")
      if datetime and title then
        table.insert(events_data, {
          datetime = datetime,
          title = title,
        })
      end
    end
  end

  update_calendar_rows()
end

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
  else
    date:set({ popup = { drawing = "toggle" } })
    refresh_calendar()
  end
end)

-- Close popup when mouse exits
cal_empty:subscribe("mouse.exited.global", function()
  date:set({ popup = { drawing = false } })
end)
