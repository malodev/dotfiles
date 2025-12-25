local colors = require("colors")
local settings = require("settings")
local app_icons = require("helpers.app_icons")

local height = 50
local current_app = ""

local front_app = sbar.add("item", "front_app", {
  position = "left", -- Top of vertical bar
  padding_left = -10,
  display = "active",
  icon = {
    drawing = true,
    font = { family = settings.font.apps, size = 20.0 },
    width = settings.item_width,
    align = "center",
  },
  label = { drawing = false },
  background = {
    color = colors.surface0,
    corner_radius = 8,
    height = height,
    drawing = true,
  },
  popup = {
    align = "center",
    horizontal = false,
    y_offset = 400,
  },
  updates = true,
})

-- App name label below icon
local front_app_label = sbar.add("item", "front_app.label", {
  position = "left",
  icon = { drawing = false },
  padding_left = -17,
  padding_right = 29,
  scroll_texts = true,
  label = {
    string = "—",
    font = {
      family = settings.font.text,
      style = "Regular",
      size = 12,
    },
    color = colors.subtext1,
    max_chars = 6,
    scroll_duration = 100,
    align = "center",
  width = settings.item_width,
  },
  background = {
    color = colors.surface0,
    corner_radius = 8,
    height = height,
    drawing = true,
  },
})

-- Popup: Header (app name)
local popup_header = sbar.add("item", "front_app.popup.header", {
  position = "popup." .. front_app.name,
  icon = {
    string = "App Statistics",
    font = {
      family = settings.font.text,
      style = "Bold",
      size = 16,
    },
    color = colors.text,
    align = "center",
  },
  label = { drawing = false },
  padding_left = 6,
  padding_right = 6,
})

-- Helper: create stat row
local function add_stat_row(name, icon_str, icon_color, label_text)
  return sbar.add("item", name, {
    position = "popup." .. front_app.name,
    icon = {
      string = icon_str,
      font = { size = 16 },
      color = icon_color,
      width = 24,
      padding_right = 0,
    },
    label = {
      string = label_text,
      font = {
        family = settings.font.text,
        style = "Regular",
        size = 14,
      },
      color = colors.text,
      padding_left = 4,
    },
    padding_left = 6,
    padding_right = 6,
  })
end

-- Separator after header
sbar.add("item", "front_app.popup.sep1", {
  position = "popup." .. front_app.name,
  icon = { drawing = false },
  label = { drawing = false },
  background = {
    color = colors.surface1,
    height = 1,
  },
  width = 180,
  padding_left = 6,
  padding_right = 6,
})

-- Stat rows
local popup_cpu = add_stat_row("front_app.popup.cpu", "􀧓", colors.peach, "CPU: —%")
local popup_mem = add_stat_row("front_app.popup.mem", "􀫦", colors.blue, "Memory: — MB")
local popup_threads = add_stat_row("front_app.popup.threads", "􀤑", colors.mauve, "Threads: —")

-- Separator
sbar.add("item", "front_app.popup.sep2", {
  position = "popup." .. front_app.name,
  icon = { drawing = false },
  label = { drawing = false },
  background = {
    color = colors.surface1,
    height = 1,
  },
  width = 180,
  padding_left = 6,
  padding_right = 6,
})

local popup_energy = add_stat_row("front_app.popup.energy", "􀋦", colors.yellow, "Energy: —")
local popup_net_in = add_stat_row("front_app.popup.net_in", "􀄩", colors.green, "Download: —")
local popup_net_out = add_stat_row("front_app.popup.net_out", "􀄫", colors.teal, "Upload: —")

-- Separator
sbar.add("item", "front_app.popup.sep3", {
  position = "popup." .. front_app.name,
  icon = { drawing = false },
  label = { drawing = false },
  background = {
    color = colors.surface1,
    height = 1,
  },
  width = 180,
  padding_left = 6,
  padding_right = 6,
})

local popup_disk_read = add_stat_row("front_app.popup.disk_read", "􀈔", colors.sky, "Disk Read: — KB/s")
local popup_disk_write = add_stat_row("front_app.popup.disk_write", "􀈎", colors.sapphire, "Disk Write: — KB/s")
local popup_pid = add_stat_row("front_app.popup.pid", "􀍟", colors.overlay1, "PID: —")

-- Refresh app statistics
local function refresh_stats()
  if current_app == "" then return end

  -- Get process stats using ps command
  local ps_cmd = string.format(
    [[ps aux | grep -i "%s" | grep -v grep | head -1 | awk '{printf "%%s|%%s|%%s", $3, $6, $1}']],
    current_app
  )

  sbar.exec(ps_cmd, function(ps_out)
    if not ps_out or ps_out == "" then
      popup_cpu:set({ label = { string = "CPU: N/A" } })
      popup_mem:set({ label = { string = "Memory: N/A" } })
      return
    end

    local cpu, mem_kb, pid = ps_out:match("([^|]+)|([^|]+)|([^|]+)")

    if cpu then
      popup_cpu:set({ label = { string = "CPU: " .. cpu .. "%" } })
    end

    if mem_kb then
      local mem_mb = tonumber(mem_kb)
      if mem_mb then
        mem_mb = math.floor(mem_mb / 1024)
        popup_mem:set({ label = { string = "Memory: " .. mem_mb .. " MB" } })
      end
    end
  end)

  -- Get thread count and PID
  local pid_cmd = string.format(
    [[pgrep -x "%s" | head -1]],
    current_app
  )

  sbar.exec(pid_cmd, function(pid_out)
    if not pid_out or pid_out == "" then
      -- Try partial match
      local partial_cmd = string.format([[pgrep -i "%s" | head -1]], current_app)
      sbar.exec(partial_cmd, function(partial_out)
        if partial_out and partial_out ~= "" then
          local pid = partial_out:gsub("%s+", "")
          popup_pid:set({ label = { string = "PID: " .. pid } })
          fetch_detailed_stats(pid)
        else
          popup_pid:set({ label = { string = "PID: N/A" } })
        end
      end)
      return
    end

    local pid = pid_out:gsub("%s+", "")
    popup_pid:set({ label = { string = "PID: " .. pid } })
    fetch_detailed_stats(pid)
  end)
end

-- Fetch detailed stats for a PID
function fetch_detailed_stats(pid)
  if not pid or pid == "" then return end

  -- Thread count
  local thread_cmd = string.format([[ps -M %s 2>/dev/null | wc -l | tr -d ' ']], pid)
  sbar.exec(thread_cmd, function(thread_out)
    if thread_out and thread_out ~= "" then
      local threads = tonumber(thread_out)
      if threads then
        threads = threads - 1 -- Subtract header line
        if threads < 0 then threads = 0 end
        popup_threads:set({ label = { string = "Threads: " .. threads } })
      end
    end
  end)

  -- Energy impact (using powermetrics alternative - simple estimation based on CPU)
  local energy_cmd = string.format([[ps -o %%cpu -p %s 2>/dev/null | tail -1 | tr -d ' ']], pid)
  sbar.exec(energy_cmd, function(energy_out)
    if energy_out and energy_out ~= "" then
      local cpu = tonumber(energy_out)
      if cpu then
        local impact = "Low"
        if cpu > 50 then
          impact = "High"
        elseif cpu > 20 then
          impact = "Medium"
        end
        popup_energy:set({ label = { string = "Energy: " .. impact } })
      end
    end
  end)

  -- Disk I/O using iostat per process (approximation via fs_usage sampling)
  -- Using a simpler approach with activity from /proc alternative
  local io_cmd = string.format(
    [[ioreg -c IOMedia -r 2>/dev/null | head -5 | grep -o 'Statistics.*' || echo ""]],
    pid
  )

  -- Network stats - get total bytes using nettop (sum all matching processes)
  -- Use awk to extract bytes_in, unit_in, bytes_out, unit_out from end of line
  local net_cmd = string.format(
    [[nettop -l 1 -P -k state,interface 2>/dev/null | grep -i "%s" | awk '{print $(NF-9), $(NF-8), $(NF-7), $(NF-6)}']],
    current_app
  )
  sbar.exec(net_cmd, function(net_out)
    -- Helper to parse bytes with units (B, KiB, MiB, GiB)
    local function parse_bytes(num_str, unit_str)
      local num = tonumber(num_str) or 0
      local unit = (unit_str or ""):upper()
      if unit == "GIB" or unit == "GB" then
        return num * 1073741824
      elseif unit == "MIB" or unit == "MB" then
        return num * 1048576
      elseif unit == "KIB" or unit == "KB" then
        return num * 1024
      else
        return num
      end
    end

    -- Format bytes to human readable
    local function format_bytes(num)
      if num >= 1073741824 then
        return string.format("%.1f GB", num / 1073741824)
      elseif num >= 1048576 then
        return string.format("%.1f MB", num / 1048576)
      elseif num >= 1024 then
        return string.format("%.1f KB", num / 1024)
      else
        return string.format("%.0f B", num)
      end
    end

    if net_out and net_out ~= "" then
      local total_in = 0
      local total_out = 0

      -- Parse each line: "11 MiB 1080 KiB" format
      for line in net_out:gmatch("[^\r\n]+") do
        local in_val, in_unit, out_val, out_unit = line:match("([%d%.]+)%s+(%S+)%s+([%d%.]+)%s+(%S+)")
        if in_val and in_unit and out_val and out_unit then
          total_in = total_in + parse_bytes(in_val, in_unit)
          total_out = total_out + parse_bytes(out_val, out_unit)
        end
      end

      popup_net_in:set({ label = { string = "Download: " .. format_bytes(total_in) } })
      popup_net_out:set({ label = { string = "Upload: " .. format_bytes(total_out) } })
    else
      popup_net_in:set({ label = { string = "Download: 0 B" } })
      popup_net_out:set({ label = { string = "Upload: 0 B" } })
    end
  end)

  -- Disk read/write (using basic estimation)
  local disk_cmd = string.format(
    [[lsof -p %s 2>/dev/null | grep REG | wc -l | tr -d ' ']],
    pid
  )
  sbar.exec(disk_cmd, function(disk_out)
    if disk_out and disk_out ~= "" then
      local files = tonumber(disk_out) or 0
      popup_disk_read:set({ label = { string = "Open Files: " .. files } })
      popup_disk_write:set({ label = { string = "Disk: Active" } })
    end
  end)
end

-- Track current app
front_app:subscribe("front_app_switched", function(env)
  local icon = app_icons[env.INFO] or ":default:"
  current_app = env.INFO
  front_app:set({
    icon = { string = icon },
  })
  front_app_label:set({
    label = { string = env.INFO }
  })
end)

-- Toggle popup on click
front_app:subscribe("mouse.clicked", function(env)
  if env.BUTTON == "right" then
    -- Right-click: open Activity Monitor filtered to app
    sbar.exec("open -a 'Activity Monitor'")
  else
    front_app:set({ popup = { drawing = "toggle" } })
    refresh_stats()
  end
end)

-- Also allow clicking the label to toggle
front_app_label:subscribe("mouse.clicked", function(env)
  front_app:set({ popup = { drawing = "toggle" } })
  refresh_stats()
end)

-- Close popup when mouse exits
popup_pid:subscribe("mouse.exited.global", function()
  front_app:set({ popup = { drawing = false } })
end)

-- Click on header opens Activity Monitor
popup_header:subscribe("mouse.clicked", function()
  sbar.exec("open -a 'Activity Monitor'")
  front_app:set({ popup = { drawing = false } })
end)
