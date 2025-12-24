local colors = require("colors")
local icons = require("icons")
local settings = require("settings")

local height = 50
local SCAN_SCRIPT = os.getenv("HOME") .. "/.config/sketchybar/helpers/git_toolkit/git_scan.sh"

-- State
local state = {
  rows = {},
  rows_index = {},
  repo_items = {},
  scan_in_flight = false,
}

-- Git icon on the vertical bar
local git = sbar.add("item", "git", {
  position = "center",
  padding_left = -30,
  icon = {
    string = "󰊢",
    font = {
      family = settings.font.nerd,
      size = 16,
    },
    color = colors.peach,
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
  },
  width = settings.item_width,
  update_freq = 180,
})

-- Status label below icon
local git_label = sbar.add("item", "git.label", {
  position = "center",
  padding_left = -55,
  icon = { drawing = false },
  label = {
    string = "—",
    font = {
      family = settings.font.text,
      style = "Regular",
      size = 10,
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

-- Utils
local function split_lines(s)
  local t = {}
  for line in string.gmatch(s or "", "[^\r\n]+") do
    t[#t + 1] = line
  end
  return t
end

local function escape_bash(s)
  return (s or ""):gsub('"', '\\"')
end

local function track(name)
  if not state.rows_index[name] then
    state.rows_index[name] = true
    table.insert(state.rows, name)
  end
end

local function clear_rows()
  for _, name in ipairs(state.rows) do
    sbar.remove(name)
  end
  state.rows, state.rows_index, state.repo_items = {}, {}, {}
end

local function parse(line)
  local n, p, b, d, a, be, la, sl = line:match("^(.-)|(.-)|(.-)|(.-)|(.-)|(.-)|(.-)|(.-)$")
  if not n or n == "" then
    return nil
  end
  return { name = n, path = p, branch = b, dirty = d, ahead = a, behind = be, last = la, slug = sl }
end

-- Open in terminal
local function open_in_terminal(path)
  local cmd = string.format('open -a Terminal "%s"', escape_bash(path))
  sbar.exec(cmd)
end

-- Add repo row to popup
local function add_repo_row(key, rec)
  local row_name = "git.row." .. key
  if state.rows_index[row_name] then
    return state.repo_items[key].row
  end

  local dirty = rec.dirty == "1"
  local ahead = tonumber(rec.ahead or "0") or 0
  local behind = tonumber(rec.behind or "0") or 0

  -- Build status string
  local bits = {}
  if dirty then table.insert(bits, "●") end
  if ahead > 0 then table.insert(bits, "↑" .. ahead) end
  if behind > 0 then table.insert(bits, "↓" .. behind) end
  local status = #bits > 0 and (" " .. table.concat(bits, " ")) or ""

  -- Determine color
  local name_color = colors.text
  if dirty then
    name_color = colors.yellow
  elseif ahead > 0 or behind > 0 then
    name_color = colors.peach
  end

  local row = sbar.add("item", row_name, {
    position = "popup." .. git.name,
    icon = {
      string = "󰘬",
      font = {
        family = settings.font.nerd,
        size = 12,
      },
      color = colors.green,
      width = 20,
    },
    label = {
      string = rec.name .. " (" .. rec.branch .. ")" .. status,
      font = {
        family = settings.font.text,
        style = "Regular",
        size = 12,
      },
      color = name_color,
    },
    width = 220,
    padding_left = 10,
    padding_right = 10,
  })
  track(row_name)

  row:subscribe("mouse.clicked", function(env)
    if env.BUTTON == "right" then
      -- Open in GitHub if available
      if rec.slug and rec.slug ~= "-" then
        sbar.exec("open 'https://github.com/" .. rec.slug .. "'")
      end
    else
      open_in_terminal(rec.path)
      git:set({ popup = { drawing = false } })
    end
  end)

  state.repo_items[key] = { row = row, rec = rec }
  return row
end

-- Refresh popup
local function refresh_popup()
  if state.scan_in_flight then return end
  state.scan_in_flight = true

  local cmd = string.format(
    'PROJECTS_DIR="%s" MAX_REPOS=%d RECENT_DAYS=%d /bin/bash -lc \'export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin; "%s"\'',
    escape_bash(settings.git.projects_dir),
    settings.git.max_repos,
    settings.git.recent_days,
    escape_bash(SCAN_SCRIPT)
  )

  sbar.exec(cmd, function(out)
    state.scan_in_flight = false
    clear_rows()

    if not out or out == "" then
      local empty = "git.row.empty"
      sbar.add("item", empty, {
        position = "popup." .. git.name,
        icon = { drawing = false },
        label = {
          string = "No repos found",
          font = {
            family = settings.font.text,
            size = 12,
          },
          color = colors.subtext1,
          align = "center",
        },
        width = 220,
        padding_left = 10,
        padding_right = 10,
      })
      track(empty)
      return
    end

    local records = {}
    for _, line in ipairs(split_lines(out)) do
      local r = parse(line)
      if r then
        table.insert(records, r)
      end
    end

    for _, r in ipairs(records) do
      add_repo_row(r.name, r)
    end
  end)
end

-- Refresh chip (main icon)
local function refresh_chip()
  if state.scan_in_flight then return end
  state.scan_in_flight = true

  local cmd = string.format(
    'PROJECTS_DIR="%s" MAX_REPOS=%d RECENT_DAYS=%d /bin/bash -lc \'export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin; "%s"\'',
    escape_bash(settings.git.projects_dir),
    settings.git.max_repos,
    settings.git.recent_days,
    escape_bash(SCAN_SCRIPT)
  )

  sbar.exec(cmd, function(out)
    state.scan_in_flight = false

    if not out or out == "" then
      git:set({ icon = { color = colors.surface2 } })
      git_label:set({ label = { string = "—", color = colors.surface2 } })
      return
    end

    local cnt = 0
    local dirty_cnt = 0
    for _, line in ipairs(split_lines(out)) do
      local r = parse(line)
      if r then
        cnt = cnt + 1
        if r.dirty == "1" or (tonumber(r.ahead or "0") or 0) > 0 or (tonumber(r.behind or "0") or 0) > 0 then
          dirty_cnt = dirty_cnt + 1
        end
      end
    end

    -- Update icon color based on status
    local icon_color = colors.green
    if dirty_cnt > 0 then
      icon_color = colors.yellow
    elseif cnt == 0 then
      icon_color = colors.surface2
    end

    git:set({ icon = { color = icon_color } })
    git_label:set({
      label = {
        string = cnt > 0 and (cnt .. " repos") or "—",
        color = dirty_cnt > 0 and colors.yellow or colors.subtext1,
      },
    })
  end)
end

-- Toggle popup on click
git:subscribe("mouse.clicked", function(env)
  if env.BUTTON == "right" then
    sbar.exec("open -a 'GitHub Desktop' 2>/dev/null || open -a Terminal")
  else
    git:set({ popup = { drawing = "toggle" } })
    refresh_popup()
  end
end)

-- Close popup when mouse exits
git:subscribe("mouse.exited.global", function()
  git:set({ popup = { drawing = false } })
end)

-- Periodic updates
git:subscribe({ "routine", "system_woke" }, function()
  refresh_chip()
end)

-- Initial fetch
refresh_chip()
