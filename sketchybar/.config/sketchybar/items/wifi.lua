local colors = require("colors")
local icons = require("icons")
local settings = require("settings")

-- Start network traffic monitor
sbar.exec("killall network_load 2>/dev/null; $CONFIG_DIR/helpers/event_providers/network_load/bin/network_load en0 network_update 2.0 &")

-- WiFi icon on the vertical bar
local wifi = sbar.add("item", "wifi", {
  position = "center",
  icon = {
    string = icons.wifi.connected,
    font = { size = 16 },
    color = colors.blue,
  },
  label = { drawing = false },
  background = { drawing = false },
  popup = {
    align = "center",
    horizontal = false,
  },
  padding_left = 5,
  padding_right = 5,
})

-- Traffic display below icon (upload)
local wifi_up = sbar.add("item", "wifi.up", {
  position = "center",
  icon = {
    string = "↑",
    font = { size = 8 },
    color = colors.red,
    padding_right = 0,
  },
  label = {
    string = "0B/s",
    font = {
      family = settings.font.text,
      size = 8,
    },
    color = colors.subtext1,
    padding_left = 2,
  },
  padding_left = 5,
  padding_right = 5,
  background = { drawing = false },
})

-- Traffic display below icon (download)
local wifi_down = sbar.add("item", "wifi.down", {
  position = "center",
  icon = {
    string = "↓",
    font = { size = 8 },
    color = colors.green,
    padding_right = 0,
  },
  label = {
    string = "0B/s",
    font = {
      family = settings.font.text,
      size = 8,
    },
    color = colors.subtext1,
    padding_left = 2,
  },
  padding_left = 5,
  padding_right = 5,
  background = { drawing = false },
})

-- Popup: SSID header
local popup_ssid = sbar.add("item", "wifi.popup.ssid", {
  position = "popup." .. wifi.name,
  icon = {
    string = "􁓤",
    font = { size = 14 },
    color = colors.blue,
  },
  label = {
    string = "Network",
    font = {
      family = settings.font.text,
      style = "Bold",
      size = 13,
    },
    color = colors.text,
    max_chars = 20,
  },
  width = 220,
  padding_left = 10,
  padding_right = 10,
})

-- Separator
sbar.add("item", "wifi.popup.sep1", {
  position = "popup." .. wifi.name,
  icon = { drawing = false },
  label = { drawing = false },
  background = {
    color = colors.surface1,
    height = 1,
  },
  width = 200,
  padding_left = 10,
  padding_right = 10,
})

-- Popup: Traffic section header
local popup_traffic_header = sbar.add("item", "wifi.popup.traffic_header", {
  position = "popup." .. wifi.name,
  icon = {
    string = "􀙬",
    font = { size = 12 },
    color = colors.peach,
  },
  label = {
    string = "Network Traffic",
    font = {
      family = settings.font.text,
      style = "Semibold",
      size = 11,
    },
    color = colors.subtext1,
  },
  width = 220,
  padding_left = 10,
  padding_right = 10,
})

-- Helper: create info row
local function add_row(name, label_left, icon_str, icon_color)
  return sbar.add("item", name, {
    position = "popup." .. wifi.name,
    icon = {
      string = icon_str or "",
      font = { size = 10 },
      color = icon_color or colors.subtext1,
      width = icon_str and 20 or 0,
    },
    label = {
      string = label_left .. ": —",
      font = {
        family = settings.font.text,
        style = "Regular",
        size = 11,
      },
      color = colors.text,
    },
    width = 220,
    padding_left = 10,
    padding_right = 10,
  })
end

local popup_upload = add_row("wifi.popup.upload", "Upload", "↑", colors.red)
local popup_download = add_row("wifi.popup.download", "Download", "↓", colors.green)

-- Separator
sbar.add("item", "wifi.popup.sep2", {
  position = "popup." .. wifi.name,
  icon = { drawing = false },
  label = { drawing = false },
  background = {
    color = colors.surface1,
    height = 1,
  },
  width = 200,
  padding_left = 10,
  padding_right = 10,
})

-- Network info rows
local popup_ip = add_row("wifi.popup.ip", "IP Address")
local popup_router = add_row("wifi.popup.router", "Router")
local popup_hostname = add_row("wifi.popup.hostname", "Hostname")

-- Track current traffic for popup
local current_upload = "0 B/s"
local current_download = "0 B/s"

-- Handle network traffic updates
wifi_up:subscribe("network_update", function(env)
  local up = env.upload or "0 B/s"
  local down = env.download or "0 B/s"

  current_upload = up
  current_download = down

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
    popup_ssid:set({ label = { string = ssid } })
  end)

  -- Get IP
  sbar.exec("ipconfig getifaddr en0 2>/dev/null", function(ip)
    ip = (ip or ""):gsub("%s+$", "")
    if ip == "" then ip = "—" end
    popup_ip:set({ label = { string = "IP Address: " .. ip } })
  end)

  -- Get Router
  sbar.exec("netstat -nr 2>/dev/null | awk '/default/ {print $2; exit}'", function(router)
    router = (router or ""):gsub("%s+$", "")
    if router == "" then router = "—" end
    popup_router:set({ label = { string = "Router: " .. router } })
  end)

  -- Get Hostname
  sbar.exec("scutil --get ComputerName 2>/dev/null", function(hostname)
    hostname = (hostname or ""):gsub("%s+$", "")
    if hostname == "" then hostname = "—" end
    popup_hostname:set({ label = { string = "Hostname: " .. hostname } })
  end)

  -- Update traffic in popup
  popup_upload:set({ label = { string = "Upload: " .. current_upload } })
  popup_download:set({ label = { string = "Download: " .. current_download } })
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
popup_hostname:subscribe("mouse.exited.global", function()
  wifi:set({ popup = { drawing = false } })
end)

-- Subscribe to wifi changes and periodic updates
wifi:subscribe({ "wifi_change", "system_woke" }, function()
  update_wifi_status()
end)

-- Initial update
update_wifi_status()
