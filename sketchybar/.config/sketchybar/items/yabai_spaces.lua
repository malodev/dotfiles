-- Native macOS Spaces indicator, driven by yabai.
--
-- yabai runs in float layout purely as a space mover (see ~/.config/yabai/yabairc),
-- so this shows the real Mission Control spaces: 10 of them, labelled 1-9 and 0
-- to match Option+N (native "Switch to Desktop 1..10" symbolic hotkeys) and the
-- Karabiner-Elements rule that moves a window to Desktop N
-- (~/.config/karabiner/karabiner.json).
--
-- Updates come from two event sources:
--   * sketchybar's own `space_change` -> instant highlight, no yabai query
--   * yabai signals -> authoritative icon strip + highlight (slower, corrects)
-- The 15s safety refresh only covers changes neither source emits a signal for.

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

-- Register every signal in ONE shell invocation, sequentially.
--
-- This used to be two separate sbar.exec calls per event (remove, then add).
-- sbar.exec is fire-and-forget — sketchybar forks the command and never waits —
-- so all 26 processes raced each other. Whenever a `remove` was scheduled after
-- its own `add`, it deleted the signal it had just created.
-- Measured on this machine: the concurrent form left 5 of 13 signals alive, and
-- the live config had 0 (`yabai -m signal --list` -> []). With no signals the
-- strip only ever moved on the 15s periodic refresh — that is the "highlight is
-- unusably slow" symptom.
-- One `sh -c` running remove;add per event makes each pair atomic, and
-- remove-then-add keeps the whole thing idempotent across config reloads.
local cmds = {}
for _, ev in ipairs(signals) do
  local label = "sketchybar_spaces_" .. ev
  cmds[#cmds + 1] = "yabai -m signal --remove " .. label .. " 2>/dev/null; " ..
    "yabai -m signal --add event=" .. ev .. " label=" .. label ..
    ' action="sketchybar --trigger ' .. EVENT .. '"'
end
sbar.exec(table.concat(cmds, "; "))

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

-- Highlight-only redraw. Kept separate from the icon redraw so the native
-- `space_change` path can move the highlight without paying for the yabai
-- queries at all.
local function set_highlight(focused)
  for i = 1, COUNT do
    local selected = (focused == i)
    items[i]:set({
      icon = { color = selected and colors.base or colors.text },
      background = {
        color = selected and colors.mauve or colors.surface0,
        border_color = selected and colors.yellow or colors.transparent,
      },
    })
  end
end

local function set_icons(apps, focused)
  for i = 1, COUNT do
    local icons = apps[i] or {}
    local strip = ""
    for k = 1, math.min(#icons, MAX_ICONS) do
      strip = strip .. icons[k]
    end
    items[i]:set({
      label = {
        string = strip ~= "" and strip or " ",
        color = (focused == i) and colors.base or colors.text,
      },
    })
  end
end

local generation = 0

local function update()
  generation = generation + 1
  local gen = generation

  sbar.exec(QUERY, function(out)
    -- A newer update started while this one was in flight. Its reply is the
    -- fresher one, so drop this stale result instead of letting it overwrite
    -- the strip — out-of-order replies were a second way the highlight could
    -- end up on the wrong space.
    if gen ~= generation then return end

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

    -- yabai errored, is restarting, or returned nothing usable: keep what is
    -- already on screen. `focused == nil` used to fall through to
    -- `selected = false` for all ten items, which blanked the highlight
    -- entirely — the "sometimes it just doesn't highlight" symptom.
    if not focused then return end

    set_icons(apps, focused)
    set_highlight(focused)
  end)
end

-- A single invisible subscriber: any change re-renders the whole strip, and
-- one subscriber means one jq pipeline per event instead of ten.
local updater = sbar.add("item", "spaces.updater", { drawing = false })

-- space_change carries the new space ordinal as INFO = {"display-1": N}.
--
-- NOTE: SbarLua runs every event env value through json_to_lua_table
-- (src/sketchybar.c, callback_function), so INFO does NOT arrive as the string
-- `{"display-1": 9}` — it arrives as a Lua table. Matching it as a string
-- silently never fires, which is why this must be read as a table.
local function focused_from_info(info)
  if type(info) ~= "table" then return nil end
  for _, v in pairs(info) do
    local n = tonumber(v)
    if n then return n end
  end
  return nil
end

-- Fast path — sketchybar's own `space_change`, which macOS posts well before
-- yabai notices. Measured after `yabai -m space --focus N` on this machine:
--   sketchybar space_change : +280ms
--   yabai space_changed     : +428ms
-- The highlight needs no yabai query and does not depend on yabai having
-- caught up with `has-focus` yet. Icons are deliberately left alone: switching
-- spaces does not move windows, so the icon strip cannot have changed.
updater:subscribe({ EVENT, "space_change" }, function(env)
  if env.SENDER == "space_change" then
    local idx = focused_from_info(env.INFO)
    if idx then
      -- Invalidate any yabai query still in flight: it read `has-focus`
      -- before yabai caught up, so its reply is stale by definition and would
      -- otherwise land right after this and drag the highlight back to the
      -- space we just left.
      generation = generation + 1
      set_highlight(idx)
    end
  else
    update()
  end
end)

-- Safety net: catches cross-space moves that emit no signal (see above).
-- Two jq spawns per run, which is why it can be this lazy.
local function periodic_refresh()
  update()
  sbar.delay(15, periodic_refresh)
end

periodic_refresh()
