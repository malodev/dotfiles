local colors = require("colors")
local settings = require("settings")

-- Weather icon on the vertical bar
local weather = sbar.add("item", "weather", {
  position = "center",
  icon = {
    string = "􀇃",
    font = { size = 16 },
    color = colors.yellow,
  },
  label = { drawing = false },
  background = { drawing = false },
  popup = {
    align = "center",
    horizontal = false,
    height = 40,
  },
  padding_left = 5,
  padding_right = 5,
  update_freq = 600,
})

-- Temperature label below icon
local weather_label = sbar.add("item", "weather.label", {
  position = "center",
  icon = { drawing = false },
  label = {
    string = "—°",
    font = {
      family = settings.font.text,
      style = "Regular",
      size = 9,
    },
    color = colors.subtext1,
  },
  background = { drawing = false },
  padding_left = 5,
  padding_right = 5,
})

-- Popup: Header (city + temp)
local popup_header = sbar.add("item", "weather.popup.header", {
  position = "popup." .. weather.name,
  icon = {
    string = "—",
    font = {
      family = settings.font.text,
      style = "Bold",
      size = 18,
    },
    color = colors.text,
    align = "left",
  },
  label = {
    string = "—°C",
    font = {
      family = settings.font.text,
      style = "Bold",
      size = 18,
    },
    color = colors.blue,
    align = "right",
    width = 50,
  },
  padding_left = 6,
  padding_right = 6,
})

-- Popup: Condition
local popup_cond = sbar.add("item", "weather.popup.cond", {
  position = "popup." .. weather.name,
  icon = {
    string = "􀇃",
    font = { size = 16 },
    color = colors.yellow,
  },
  label = {
    string = "—",
    font = {
      family = settings.font.text,
      style = "Regular",
      size = 16,
    },
    color = colors.subtext1,
    max_chars = 20,
  },
  padding_left = 6,
  padding_right = 6,
})

-- Helper: create info row
local function add_row(name, icon_str, icon_color, label_text)
  return sbar.add("item", name, {
    position = "popup." .. weather.name,
    icon = {
      string = icon_str,
      font = { size = 16 },
      color = icon_color,
      width = 20,
      padding_right = 0,
    },
    label = {
      string = label_text,
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
  })
end

local popup_feels = add_row("weather.popup.feels", "􀇬", colors.peach, "Feels: —°C")
local popup_humidity = add_row("weather.popup.humidity", "􀌢", colors.sky, "Humidity: —%")
local popup_wind = add_row("weather.popup.wind", "􀇤", colors.teal, "Wind: — km/h")

-- Separator
sbar.add("item", "weather.popup.sep", {
  position = "popup." .. weather.name,
  icon = { drawing = false },
  label = { drawing = false },
  background = {
    color = colors.surface1,
    height = 1,
  },
  width = 200,
  padding_left = 6,
  padding_right = 6,
})

-- Forecast rows
local popup_h1 = add_row("weather.popup.h1", "􀐫", colors.green, "1h: —")
local popup_h3 = add_row("weather.popup.h3", "􀐫", colors.green, "3h: —")
local popup_h6 = add_row("weather.popup.h6", "􀐫", colors.green, "6h: —")

-- Get weather icon based on condition
local function get_weather_icon(condition)
  local c = (condition or ""):lower()
  if c:find("storm") or c:find("thunder") then
    return "􀇏"
  elseif c:find("rain") or c:find("drizzle") then
    return "􀇈"
  elseif c:find("snow") or c:find("sleet") or c:find("hail") then
    return "􀇇"
  elseif c:find("clear") or c:find("sun") then
    return "􀆮"
  elseif c:find("cloud") or c:find("overcast") then
    return "􀇂"
  elseif c:find("fog") or c:find("mist") then
    return "􀇋"
  else
    return "􀇃"
  end
end

-- Refresh weather data
local function refresh_weather()
  local cmd = [[/opt/homebrew/bin/jq -r '
    def h(i): .weather[0].hourly[i] | "\(.tempC)° \(.weatherDesc[0].value)";
    [
      .nearest_area[0].areaName[0].value,
      .current_condition[0].temp_C,
      .current_condition[0].weatherDesc[0].value,
      .current_condition[0].FeelsLikeC,
      .current_condition[0].humidity,
      .current_condition[0].windspeedKmph,
      h(1), h(3), h(6)
    ] | .[]
  ' /tmp/weather.json 2>/dev/null]]

  -- First fetch the data
  sbar.exec("curl -s 'https://wttr.in/Rovereto?format=j1' -o /tmp/weather.json 2>/dev/null", function()
    -- Then parse it
    sbar.exec(cmd, function(out)
      if not out or out == "" then return end

      local lines = {}
      for line in string.gmatch(out, "[^\r\n]+") do
        table.insert(lines, line)
      end

      if #lines < 9 then return end

      local city = lines[1]
      local temp = lines[2]
      local condition = lines[3]
      local feels = lines[4]
      local humidity = lines[5]
      local wind = lines[6]
      local h1 = lines[7]
      local h3 = lines[8]
      local h6 = lines[9]

      local icon = get_weather_icon(condition)

      -- Update bar icon
      weather:set({ icon = { string = icon } })
      weather_label:set({ label = { string = temp .. "°" } })

      -- Update popup
      popup_header:set({
        icon = { string = city },
        label = { string = temp .. "°C" },
      })
      popup_cond:set({
        icon = { string = icon },
        label = { string = condition },
      })
      popup_feels:set({ label = { string = "Feels: " .. feels .. "°C" } })
      popup_humidity:set({ label = { string = "Humidity: " .. humidity .. "%" } })
      popup_wind:set({ label = { string = "Wind: " .. wind .. " km/h" } })
      popup_h1:set({ label = { string = "1h: " .. h1 } })
      popup_h3:set({ label = { string = "3h: " .. h3 } })
      popup_h6:set({ label = { string = "6h: " .. h6 } })
    end)
  end)
end

-- Toggle popup on click
weather:subscribe("mouse.clicked", function(env)
  if env.BUTTON == "right" then
    sbar.exec("open -a Weather")
  else
    weather:set({ popup = { drawing = "toggle" } })
    refresh_weather()
  end
end)

-- Click on popup header opens Weather app
popup_header:subscribe("mouse.clicked", function()
  sbar.exec("open -a Weather")
end)

-- Close popup when mouse exits
popup_h6:subscribe("mouse.exited.global", function()
  weather:set({ popup = { drawing = false } })
end)

-- Periodic updates
weather:subscribe({ "routine", "system_woke" }, function()
  refresh_weather()
end)

-- Initial fetch
refresh_weather()
