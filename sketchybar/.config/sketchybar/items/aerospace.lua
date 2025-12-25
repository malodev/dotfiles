local colors = require("colors")
local settings = require("settings")
local app_icons = require("helpers.app_icons")

-- Event to trigger updates
sbar.add("event", "aerospace_workspace_change")

-- Function to convert workspace  sequence number to space id string
local function sid_to_string(sid)
  if sid > 0 and sid < 11 then return tostring(sid % 10) end
  if sid == 11 then return "A" end
  if sid == 12 then return "S" end
  if sid == 13 then return "D" end
  if sid == 14 then return "F" end
  if sid == 15 then return "G" end
  return ""
end

-- Function to redraw app icons
local function update_windows()
  -- Execute AeroSpace command to get windows with a safe delimiter
  sbar.exec("aerospace list-windows --all --format '%{workspace}|%{app-name}'", function(windows)
    local workspace_apps = {}

    -- Parse the output
    for line in windows:gmatch("[^\r\n]+") do
      local workspace, app_name = line:match("^(.-)|(.+)$")

      if workspace and app_name then
        -- Trim whitespace just in case
        workspace = workspace:match("^%s*(.-)%s*$")
        app_name = app_name:match("^%s*(.-)%s*$")

        if not workspace_apps[workspace] then workspace_apps[workspace] = "" end
        -- Append the mapped icon
        local icon = app_icons[app_name] or app_icons["Default"] or ":default:"
        workspace_apps[workspace] = workspace_apps[workspace] .. " " .. icon
      end
    end

    -- Update all space items
    for i = 1, 12 do -- Assuming 10 spaces
      local sid = sid_to_string(i)
      local icon_strip = workspace_apps[sid] or " "

      sbar.animate("tanh", 10, function()
        sbar.set("space." .. sid, { label = icon_strip })
      end)
    end
  end)
end

-- Create the Workspace Items
for sid = 1, 12 do
  local space = sbar.add("item", "space." .. sid_to_string(sid), {
    position = "left", -- Center area (after Front App)
    scroll_texts = true,
    padding_left = sid * -28,
    icon = {
      drawing = true,
      string = sid_to_string(sid),
      font = { family = settings.font.text, style = "Bold", size = 8.0 },
    },
    label = {
      string = "",
      width = settings.item_width,
      font = "sketchybar-app-font:Regular:16.0",
      padding_right = 0,
      padding_left = 0,
      color = colors.text,
    },
    background = {
      color = colors.surface0,
      border_width = 1,
      border_color = colors.transparent,
      height = 49,
      drawing = true,
    },
    width = settings.item_width,
    click_script = "aerospace workspace " .. sid_to_string(sid),
  })

  -- Subscribe to changes
  space:subscribe("aerospace_workspace_change", function(env)
    local selected = env.FOCUSED_WORKSPACE == sid_to_string(sid)
    local color = selected and colors.mauve or colors.surface0
    local border = selected and colors.yellow or colors.transparent

    space:set({
      background = { color = color, border_color = border },
      icon = { color = selected and colors.base or colors.text },
      label = { color = selected and colors.base or colors.text }
    })

    -- Trigger window update on change
    if selected then update_windows() end
  end)
end

-- Periodic refresh loop to handle external changes (open/close apps)
local function periodic_refresh()
  update_windows()
  sbar.delay(5, periodic_refresh)
end

-- Initial update
periodic_refresh()
