-- Native macOS Spaces indicator, driven by yabai.
--
-- yabai runs in float layout purely as a space mover (see ~/.config/yabai/yabairc),
-- so this shows the real Mission Control spaces: 10 of them, labelled 1-9 and 0
-- to match the alt+N / shift+alt+N bindings in ~/.config/skhd/skhdrc.
--
-- Updates are event-driven: yabai signals fire a sketchybar event (one jq
-- pipeline per change) instead of this item polling on a timer. The 30s
-- safety refresh only covers changes yabai emits no signal for.

local colors = require("colors")
local settings = require("settings")
local app_icons = require("helpers.app_icons")

local COUNT = 10
local EVENT = "yabai_spaces_update"

sbar.add("event", EVENT)

-- Everything that can change the strip. Verified empirically against yabai
-- 7.1.25 (each event registered with a file-writing action, then the actions
-- below performed): space_changed, window_created, window_destroyed,
-- window_focused, application_launched/terminated/... all fire.
-- NOTE: window_moved does NOT fire when yabai itself moves a window between
-- spaces (only for user drags), which is why the periodic refresh below is
-- not optional — it is the only thing that catches a `--space N` move made
-- without `--focus`.
-- remove-then-add with a fixed label keeps this idempotent across config
-- reloads instead of stacking duplicate signals in yabai.
local signals = {
  "space_changed",
  "space_created",
  "space_destroyed",
  "window_created",
  "window_destroyed",
  "window_focused",
  "application_launched",
  "application_terminated",
  "application_hidden",
  "application_visible",
  "display_changed",
  "mission_control_enter",
  "mission_control_exit",
}

for _, ev in ipairs(signals) do
  local label = "sketchybar_spaces_" .. ev
  sbar.exec('yabai -m signal --remove ' .. label .. " 2>/dev/null")
  sbar.exec('yabai -m signal --add event=' .. ev .. " label=" .. label ..
    ' action="sketchybar --trigger ' .. EVENT .. '"')
end

local QUERY = [[
yabai -m query --spaces | jq -r '.[] | "s|\(.index)|\(."has-focus")"'
yabai -m query --windows | jq -r '.[] | "w|\(.space)|\(.app)"'
]]

local MAX_ICONS = 2 -- the item is 65px wide (settings.item_width) and the number
-- icon eats ~14px of that, which fits two app icons and not three (tested at
-- 16pt and 14pt: a third is always clipped at the bar edge). Extra windows are
-- dropped rather than drawn off the edge — widen the bar's `height` together
-- with settings.item_width if you want room for more.

local function space_label(i)
  return tostring(i % 10) -- 10 -> "0"
end

local items = {}

for i = 1, COUNT do
  local id = space_label(i)
  items[i] = sbar.add("item", "space." .. id, {
    position = "left",
    padding_left = i * -28,
    icon = {
      drawing = true,
      string = id,
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
    click_script = "yabai -m space --focus " .. i,
  })
end

local function update()
  sbar.exec(QUERY, function(out)
    local focused, apps = nil, {}

    for line in out:gmatch("[^\r\n]+") do
      local kind, a, b = line:match("^(%a)|([^|]*)|(.*)$")
      if kind == "s" and b == "true" then
        focused = tonumber(a)
      elseif kind == "w" then
        local index = tonumber(a)
        if index then
          apps[index] = apps[index] or {}
          apps[index][#apps[index] + 1] =
            (app_icons[b] or app_icons["Default"] or ":default:")
        end
      end
    end

    for i = 1, COUNT do
      local icons = apps[i] or {}
      local strip = ""
      for k = 1, math.min(#icons, MAX_ICONS) do
        strip = strip .. icons[k]
      end

      local selected = (focused == i)
      items[i]:set({
        label = {
          string = strip ~= "" and strip or " ",
          color = selected and colors.base or colors.text,
        },
        icon = { color = selected and colors.base or colors.text },
        background = {
          color = selected and colors.mauve or colors.surface0,
          border_color = selected and colors.yellow or colors.transparent,
        },
      })
    end
  end)
end

-- A single invisible subscriber: any change re-renders the whole strip, and
-- one subscriber means one jq pipeline per event instead of ten.
local updater = sbar.add("item", "spaces.updater", { drawing = false })
updater:subscribe(EVENT, update)

-- Safety net: catches cross-space moves that emit no signal (see above).
-- Two jq spawns per run, which is why it can be this lazy.
local function periodic_refresh()
  update()
  sbar.delay(15, periodic_refresh)
end

periodic_refresh()
