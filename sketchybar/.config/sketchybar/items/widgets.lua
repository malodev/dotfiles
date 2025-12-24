local colors = require("colors")
local icons = require("icons")
local settings = require("settings")

-- 1. Battery
local battery = sbar.add("item", "battery", {
  position = "right",
  update_freq = 120,
  icon = { font = { size = 18.0 } },
  label = { drawing = false },
})

battery:subscribe({"routine", "power_source_change", "system_woke"}, function()
  sbar.exec("pmset -g batt", function(batt_info)
    local icon = icons.battery[0]
    local color = colors.red
    
    local found, _, charge = batt_info:find("(%d+)%%")
    if found then
      local charge_num = tonumber(charge)
      
      if charge_num > 90 then icon = icons.battery[100]; color = colors.green
      elseif charge_num > 60 then icon = icons.battery[75]; color = colors.teal
      elseif charge_num > 30 then icon = icons.battery[50]; color = colors.yellow
      elseif charge_num > 10 then icon = icons.battery[25]; color = colors.peach
      end
    end

    if batt_info:find("AC Power") then
      icon = icons.battery.charging
      color = colors.green
    end

    battery:set({ icon = { string = icon, color = color } })
  end)
end)

-- 2. Clock
local clock = sbar.add("item", "clock", {
  position = "right",
  update_freq = 30,
  icon = { drawing = false },
  label = { 
    font = { style = "Bold", size = 12.0 }, 
    align = "center",
    padding_left = 5 -- replaced padding_top
  },
  padding_left = 5 -- replaced padding_top
})

clock:subscribe({"routine", "system_woke"}, function()
  clock:set({ label = os.date("%H:%M") })
end)

local date = sbar.add("item", "date", {
  position = "right",
  icon = { drawing = false },
  label = { 
    string = os.date("%a %d"),
    font = { size = 10.0, style = "Semibold" },
    color = colors.subtext1,
    align = "center"
  },
  padding_right = 10, -- replaced padding_bottom
})
