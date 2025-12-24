local colors = require("colors")
local settings = require("settings")
local app_icons = require("helpers.app_icons")

-- Event to trigger updates
sbar.add("event", "aerospace_workspace_change")

-- Function to redraw app icons
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
    for i = 1, 10 do -- Assuming 10 spaces
      local sid = tostring(i)
      local icon_strip = workspace_apps[sid] or " —"

      sbar.animate("tanh", 10, function()
        sbar.set("space." .. sid, { label = icon_strip })
      end)
    end
  end)
end

-- Create the Workspace Items
for sid = 1, 10 do
  local space = sbar.add("item", "space." .. sid, {
    position = "left", -- Center area (after Front App)
    icon = {
      string = tostring(sid),
      font = { family = settings.font.text, style = "Bold", size = 18.0 },
      padding_left = 6,
      padding_right = 6,
    },
    label = {
      string = " —",
      font = "sketchybar-app-font:Regular:16.0",
      padding_right = 8,
      color = colors.text,
      width = "dynamic",
    },
    background = {
      color = colors.surface0,
      border_width = 1,
      border_color = colors.transparent,
      height = 35,
      drawing = true,
    },
    -- Fixed paddings: padding_top/bottom are invalid
    padding_left = 2,
    padding_right = 2,
    click_script = "aerospace workspace " .. sid,
  })

  -- Subscribe to changes
  space:subscribe("aerospace_workspace_change", function(env)
    local selected = env.FOCUSED_WORKSPACE == tostring(sid)
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
