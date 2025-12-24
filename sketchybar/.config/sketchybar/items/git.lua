local colors = require("colors")
local icons = require("icons")
local settings = require("settings")

local height = 50
local MAX_ROWS = 10
local SCAN_SCRIPT = os.getenv("HOME") .. "/.config/sketchybar/helpers/git_toolkit/git_scan.sh"

--------------------------------------------------------------------------------
-- MAIN BAR ITEMS
--------------------------------------------------------------------------------

local git = sbar.add("item", "git", {
  position = "center",
  padding_left = -186,
  icon = {
    string = "󰊢",
    font = { family = settings.font.nerd, size = settings.icon_size },
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
    y_offset = -100,
  },
  width = settings.item_width,
  updates = true,
  update_freq = 180,
})

local git_label = sbar.add("item", "git.label", {
  position = "center",
  padding_left = -216,
  icon = { drawing = false },
  label = {
    string = "—",
    font = { family = settings.font.text, style = "Regular", size = settings.label_size },
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

--------------------------------------------------------------------------------
-- POPUP ITEMS (created once, updated dynamically)
--------------------------------------------------------------------------------

-- Header
local popup_header = sbar.add("item", "git.popup.header", {
  position = "popup." .. git.name,
  icon = {
    string = "󰊢",
    font = { family = settings.font.nerd, size = 18 },
    color = colors.peach,
  },
  label = {
    string = settings.git.projects_dir:gsub(os.getenv("HOME"), "~"),
    font = { family = settings.font.text, style = "Bold", size = 18 },
    color = colors.text,
  },
  padding_left = 6,
  padding_right = 6,
})

-- Separator
sbar.add("item", "git.popup.sep", {
  position = "popup." .. git.name,
  icon = { drawing = false },
  label = { drawing = false },
  background = { color = colors.surface1, height = 1 },
  padding_left = 6,
  padding_right = 6,
})

-- Pre-create row items (hidden by default)
local rows = {}
for i = 1, MAX_ROWS do
  rows[i] = sbar.add("item", "git.row." .. i, {
    position = "popup." .. git.name,
    drawing = false,
    icon = {
      string = "󰘬",
      font = { family = settings.font.nerd, size = 18 },
      color = colors.green,
      width = 20,
    },
    label = {
      string = "",
      font = { family = settings.font.text, style = "Regular", size = 18 },
      color = colors.text,
    },
    padding_left = 6,
    padding_right = 6,
  })
end

-- Empty state message
local empty_msg = sbar.add("item", "git.popup.empty", {
  position = "popup." .. git.name,
  drawing = false,
  icon = {
    string = "󰋗",
    font = { family = settings.font.nerd, size = 16 },
    color = colors.surface2,
    width = 20,
  },
  label = {
    string = "No repos found",
    font = { family = settings.font.text, style = "Regular", size = 16 },
    color = colors.subtext1,
  },
  padding_left = 6,
  padding_right = 6,
})

--------------------------------------------------------------------------------
-- DATA & STATE
--------------------------------------------------------------------------------

local repos_data = {}  -- Stores parsed repo info

local function parse_line(line)
  local name, path, branch, dirty, ahead, behind, last, slug =
    line:match("^(.-)|(.-)|(.-)|(.-)|(.-)|(.-)|(.-)|(.-)$")
  if not name or name == "" then return nil end
  return {
    name = name,
    path = path,
    branch = branch,
    dirty = dirty == "1",
    ahead = tonumber(ahead) or 0,
    behind = tonumber(behind) or 0,
    last = last,
    slug = slug,
  }
end

--------------------------------------------------------------------------------
-- UPDATE FUNCTIONS
--------------------------------------------------------------------------------

local function update_rows()
  -- Hide all rows first
  for i = 1, MAX_ROWS do
    rows[i]:set({ drawing = false })
  end

  if #repos_data == 0 then
    empty_msg:set({ drawing = true })
    return
  end

  empty_msg:set({ drawing = false })

  -- Show and update rows with data
  for i, repo in ipairs(repos_data) do
    if i > MAX_ROWS then break end

    -- Build status indicators
    local status = ""
    if repo.dirty then status = status .. " ●" end
    if repo.ahead > 0 then status = status .. " ↑" .. repo.ahead end
    if repo.behind > 0 then status = status .. " ↓" .. repo.behind end

    -- Determine color
    local label_color = colors.text
    if repo.dirty then
      label_color = colors.yellow
    elseif repo.ahead > 0 or repo.behind > 0 then
      label_color = colors.peach
    end

    rows[i]:set({
      drawing = true,
      label = {
        string = repo.name .. " (" .. repo.branch .. ")" .. status,
        color = label_color,
      },
    })
  end
end

local function update_chip()
  local total = #repos_data
  local dirty_count = 0

  for _, repo in ipairs(repos_data) do
    if repo.dirty or repo.ahead > 0 or repo.behind > 0 then
      dirty_count = dirty_count + 1
    end
  end

  -- Update icon color
  local icon_color = colors.green
  if dirty_count > 0 then
    icon_color = colors.yellow
  elseif total == 0 then
    icon_color = colors.surface2
  end

  git:set({ icon = { color = icon_color } })
  git_label:set({
    label = {
      string = total > 0 and (total .. " repos") or "—",
      color = dirty_count > 0 and colors.yellow or colors.subtext1,
    },
  })
end

local function refresh()
  local cmd = string.format(
    'PROJECTS_DIR="%s" MAX_REPOS=%d RECENT_DAYS=%d MAX_DEPTH=%d ' ..
    '/bin/bash -lc \'export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin; "%s"\'',
    settings.git.projects_dir:gsub('"', '\\"'),
    settings.git.max_repos,
    settings.git.recent_days,
    settings.git.max_depth or 4,
    SCAN_SCRIPT
  )

  sbar.exec(cmd, function(output)
    repos_data = {}

    if output and output ~= "" then
      for line in output:gmatch("[^\r\n]+") do
        local repo = parse_line(line)
        if repo then
          table.insert(repos_data, repo)
        end
      end
    end

    update_chip()
    update_rows()
  end)
end

--------------------------------------------------------------------------------
-- CLICK HANDLERS
--------------------------------------------------------------------------------

-- Toggle popup
git:subscribe("mouse.clicked", function()
  git:set({ popup = { drawing = "toggle" } })
end)

-- Row click handlers
for i = 1, MAX_ROWS do
  rows[i]:subscribe("mouse.clicked", function(env)
    local repo = repos_data[i]
    if not repo then return end

    if env.BUTTON == "right" then
      -- Open GitHub if available
      if repo.slug and repo.slug ~= "-" then
        sbar.exec("open 'https://github.com/" .. repo.slug .. "'")
      end
    else
      -- Open in terminal
      sbar.exec('open -a Terminal "' .. repo.path:gsub('"', '\\"') .. '"')
      git:set({ popup = { drawing = false } })
    end
  end)
end

--------------------------------------------------------------------------------
-- EVENT SUBSCRIPTIONS
--------------------------------------------------------------------------------

git:subscribe({ "routine", "system_woke" }, function()
  refresh()
end)

--------------------------------------------------------------------------------
-- INITIAL LOAD
--------------------------------------------------------------------------------

refresh()
