local colors = require("colors")
local icons = require("icons")
local settings = require("settings")

local height = 50

-- Start network traffic monitor
sbar.exec("killall network_load 2>/dev/null; $CONFIG_DIR/helpers/event_providers/network_load/bin/network_load en0 network_update 2.0 &")

-- Track current traffic values
local current_upload = "0 B/s"
local current_download = "0 B/s"

-- WiFi icon on the vertical bar
local wifi = sbar.add("item", "wifi", {
  position = "center",
  padding_left = -72,
  icon = {
    string = icons.wifi.connected,
    font = { size = settings.icon_size },
    color = colors.blue,
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
})

-- Traffic display below icon (upload)
local wifi_up = sbar.add("item", "wifi.up", {
  position = "center",
  padding_left = -104,
  icon = {
    string = "↑",
    font = { size = 14 },
    color = colors.red,
    padding_right = 0,
  },
  label = {
    string = "0B/s",
    font = {
      family = settings.font.text,
      size = 10,
    },
    color = colors.red,
    padding_left = 2,
  },
  background = {
    color = colors.surface0,
    corner_radius = 9,
    height = height,
    drawing = true,
  },
  width = settings.item_width,
})

-- Traffic display below icon (download)
local wifi_down = sbar.add("item", "wifi.down", {
  position = "center",
  padding_left = -138,
  icon = {
    string = "↓",
    font = { size = 14 },
    color = colors.green,
    padding_right = 0,
  },
  label = {
    string = "0B/s",
    font = {
      family = settings.font.text,
      size = 10,
    },
    color = colors.green,
    padding_left = 2,
  },
  background = {
    color = colors.surface0,
    corner_radius = 9,
    height = height,
    drawing = true,
  },
  width = settings.item_width,
})

-- Popup: Header (SSID)
local popup_header = sbar.add("item", "wifi.popup.header", {
  position = "popup." .. wifi.name,
  icon = {
    string = "􁓤",
    font = { size = 18 },
    color = colors.blue,
  },
  label = {
    string = "Network",
    font = {
      family = settings.font.text,
      style = "Bold",
      size = 18,
    },
    color = colors.text,
    max_chars = 20,
  },
  padding_left = 6,
  padding_right = 6,
})

-- Popup: Status row
local popup_status = sbar.add("item", "wifi.popup.status", {
  position = "popup." .. wifi.name,
  icon = {
    string = "􀆅",
    font = { size = 16 },
    color = colors.green,
  },
  label = {
    string = "Connected",
    font = {
      family = settings.font.text,
      style = "Regular",
      size = 16,
    },
    color = colors.subtext1,
  },
  padding_left = 6,
  padding_right = 6,
})

-- Helper: create info row
local function add_row(name, icon_str, icon_color, label_text)
  return sbar.add("item", name, {
    position = "popup." .. wifi.name,
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

local popup_ip = add_row("wifi.popup.ip", "􀆪", colors.teal, "IP: —")
local popup_router = add_row("wifi.popup.router", "􀤆", colors.peach, "Router: —")

-- Separator
sbar.add("item", "wifi.popup.sep", {
  position = "popup." .. wifi.name,
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

-- Traffic rows
local popup_upload = add_row("wifi.popup.upload", "↑", colors.red, "Upload: 0 B/s")
local popup_download = add_row("wifi.popup.download", "↓", colors.green, "Download: 0 B/s")

-- Handle network traffic updates
wifi_up:subscribe("network_update", function(env)
  local up = env.upload or "0 B/s"
  local down = env.download or "0 B/s"

  current_upload = up
  current_download = down

  -- Dim colors when no traffic
  local up_color = (up == "000 Bps" or up == "0 B/s") and colors.surface2 or colors.red
  local down_color = (down == "000 Bps" or down == "0 B/s") and colors.surface2 or colors.green

  wifi_up:set({
    icon = { color = up_color },
    label = { string = up, color = up_color },
  })
  wifi_down:set({
    icon = { color = down_color },
    label = { string = down, color = down_color },
  })

  -- Update popup traffic display
  popup_upload:set({ label = { string = "Upload: " .. up } })
  popup_download:set({ label = { string = "Download: " .. down } })
end)

-- Check WiFi connection status
local function update_wifi_status()
  sbar.exec("ipconfig getifaddr en0 2>/dev/null", function(ip)
    local connected = ip and ip ~= "" and not ip:find("error")
    wifi:set({
      icon = {
        string = connected and icons.wifi.connected or icons.wifi.disconnected,
        color = connected and colors.blue or colors.red,
      },
    })
    popup_status:set({
      icon = {
        string = connected and "􀆅" or "􀅾",
        color = connected and colors.green or colors.red,
      },
      label = {
        string = connected and "Connected" or "Disconnected",
        color = connected and colors.subtext1 or colors.red,
      },
    })
  end)
end

-- Refresh popup info
local function refresh_popup()
  -- Get network name (try multiple methods)
  sbar.exec([[
    ssid=$(networksetup -getairportnetwork en0 2>/dev/null | sed 's/Current Wi-Fi Network: //')
    if [ -z "$ssid" ] || [ "$ssid" = "You are not associated with an AirPort network." ]; then
      ssid=$(ipconfig getsummary en0 2>/dev/null | awk -F ' SSID : ' '/ SSID : / {print $2}')
    fi
    if [ -z "$ssid" ] || [ "$ssid" = "<redacted>" ]; then
      ssid="Connected"
    fi
    echo "$ssid"
  ]], function(ssid)
    ssid = (ssid or ""):gsub("%s+$", "")
    if ssid == "" then ssid = "Not Connected" end
    popup_header:set({ label = { string = ssid } })
  end)

  -- Get IP
  sbar.exec("ipconfig getifaddr en0 2>/dev/null", function(ip)
    ip = (ip or ""):gsub("%s+$", "")
    if ip == "" then ip = "—" end
    popup_ip:set({ label = { string = "IP: " .. ip } })
  end)

  -- Get Router
  sbar.exec("netstat -nr 2>/dev/null | awk '/default/ {print $2; exit}'", function(router)
    router = (router or ""):gsub("%s+$", "")
    if router == "" then router = "—" end
    popup_router:set({ label = { string = "Router: " .. router } })
  end)

  -- Update traffic in popup
  popup_upload:set({ label = { string = "Upload: " .. current_upload } })
  popup_download:set({ label = { string = "Download: " .. current_download } })

  update_wifi_status()
end

-- Toggle popup on click
wifi:subscribe("mouse.clicked", function(env)
  if env.BUTTON == "right" then
    sbar.exec("open 'x-apple.systempreferences:com.apple.Network-Settings.extension'")
  else
    wifi:set({ popup = { drawing = "toggle" } })
    refresh_popup()
  end
end)

-- Click on IP to copy to clipboard
popup_ip:subscribe("mouse.clicked", function()
  sbar.exec("ipconfig getifaddr en0 2>/dev/null | tr -d '\n' | pbcopy")
  popup_ip:set({ label = { string = "Copied!", color = colors.green } })
  sbar.delay(1, function()
    refresh_popup()
  end)
end)

-- Close popup when mouse exits
popup_download:subscribe("mouse.exited.global", function()
  wifi:set({ popup = { drawing = false } })
end)

-- Subscribe to wifi changes and periodic updates
wifi:subscribe({ "wifi_change", "system_woke" }, function()
  update_wifi_status()
end)

-- Initial update
update_wifi_status()
