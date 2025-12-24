local colors = require("colors")
local icons = require("icons")
local settings = require("settings")

local whitelist = { ["Spotify"] = true, ["Music"] = true }

-- Track state
local is_playing = false
local current_artwork_url = ""

-- Media Item (Icon on vertical bar)
local media = sbar.add("item", "media", {
  position = "center",
  icon = {
    string = icons.media.music,
    color = colors.mauve,
    font = { size = 18 },
  },
  label = { drawing = false },
  background = { drawing = false },
  popup = {
    align = "center",
    horizontal = true,
  },
  updates = true,
  update_freq = 5,
})

-- Popup: Cover Art
local cover = sbar.add("item", "media.cover", {
  position = "popup." .. media.name,
  background = {
    image = {
      string = "media.artwork",
      scale = 0.12,
      corner_radius = 7,
    },
    color = colors.transparent,
    height = 60,
    corner_radius = 7,
  },
  icon = { drawing = false },
  label = { drawing = false },
  width = 60,
  padding_left = 3,
  padding_right = 20,
})

-- Popup: Title
local title_item = sbar.add("item", "media.title", {
  position = "popup." .. media.name,
  icon = { drawing = false },
  label = {
    string = "Not Playing",
    font = {
      family = settings.font.text,
      style = "Bold",
      size = 13,
    },
    color = colors.text,
    max_chars = 22,
    scroll_duration = 100,
  },
  padding_left = 0,
  padding_right = 0,
})

-- Popup: Artist
local artist_item = sbar.add("item", "media.artist", {
  position = "popup." .. media.name,
  icon = { drawing = false },
  label = {
    string = "",
    font = {
      family = settings.font.text,
      style = "Regular",
      size = 11,
    },
    color = colors.subtext1,
    max_chars = 22,
  },
  padding_left = 5,
  padding_right = 8,
})

-- Popup: Controls (Previous)
local prev = sbar.add("item", "media.prev", {
  position = "popup." .. media.name,
  icon = {
    string = icons.media.back,
    font = { size = 14 },
    color = colors.text,
  },
  label = { drawing = false },
  background = {
    color = colors.surface1,
    corner_radius = 5,
    height = 24,
  },
  padding_left = 3,
  padding_right = 1,
})

-- Popup: Controls (Play/Pause)
local play_pause = sbar.add("item", "media.play_pause", {
  position = "popup." .. media.name,
  icon = {
    string = icons.media.play,
    font = { size = 14 },
    color = colors.green,
  },
  label = { drawing = false },
  background = {
    color = colors.surface1,
    corner_radius = 5,
    height = 24,
  },
  padding_left = 1,
  padding_right = 1,
})

-- Popup: Controls (Next)
local next_btn = sbar.add("item", "media.next", {
  position = "popup." .. media.name,
  icon = {
    string = icons.media.forward,
    font = { size = 14 },
    color = colors.text,
  },
  label = { drawing = false },
  background = {
    color = colors.surface1,
    corner_radius = 5,
    height = 24,
  },
  padding_left = 1,
  padding_right = 3,
})

-- Click handlers for controls
prev:subscribe("mouse.clicked", function()
  sbar.exec("nowplaying-cli previous")
end)

play_pause:subscribe("mouse.clicked", function()
  sbar.exec("nowplaying-cli togglePlayPause")
end)

next_btn:subscribe("mouse.clicked", function()
  sbar.exec("nowplaying-cli next")
end)

-- Toggle popup on media icon click
media:subscribe("mouse.clicked", function()
  media:set({ popup = { drawing = "toggle" } })
end)

-- Click on cover, title, or artist opens Spotify
cover:subscribe("mouse.clicked", function()
  sbar.exec("open -a Spotify")
end)

title_item:subscribe("mouse.clicked", function()
  sbar.exec("open -a Spotify")
end)

artist_item:subscribe("mouse.clicked", function()
  sbar.exec("open -a Spotify")
end)

-- Close popup when clicking outside (with delay to avoid accidental closes)
local popup_closing = false
next_btn:subscribe("mouse.exited.global", function()
  if not popup_closing then
    popup_closing = true
    sbar.delay(0.3, function()
      media:set({ popup = { drawing = false } })
      popup_closing = false
    end)
  end
end)

-- Cancel close if mouse re-enters
cover:subscribe("mouse.entered", function()
  popup_closing = false
end)

-- Fetch and update Spotify artwork
local function update_spotify_artwork()
  -- Check if Spotify is running first
  sbar.exec([[pgrep -x Spotify]], function(pid)
    if not pid or pid == "" then
      return
    end
    -- Spotify is running, get artwork URL
    sbar.exec([[osascript -e 'tell application "Spotify"
      if player state is playing then
        return artwork url of current track
      else
        return ""
      end if
    end tell' 2>/dev/null]], function(url)
      url = (url or ""):gsub("%s+", "")
      if url ~= "" and url ~= current_artwork_url then
        current_artwork_url = url
        -- Download artwork to temp file
        sbar.exec("curl -s -o /tmp/spotify_cover.jpg '" .. url .. "'", function()
          cover:set({
            background = {
              image = {
                string = "/tmp/spotify_cover.jpg",
                scale = 0.12,
                corner_radius = 7,
              },
            },
          })
        end)
      end
    end)
  end)
end

-- Update media info using osascript (more reliable for Spotify)
local function update_media_info()
  -- Check if Spotify is running first
  sbar.exec([[pgrep -x Spotify]], function(pid)
    if not pid or pid == "" then
      -- Spotify not running
      media:set({
        drawing = true,
        icon = { color = colors.mauve },
      })
      title_item:set({ label = { string = "Not Playing" } })
      artist_item:set({ label = { string = "" } })
      play_pause:set({
        icon = {
          string = icons.media.play,
          color = colors.green,
        },
      })
      is_playing = false
      return
    end

    -- Get Spotify info via osascript
    sbar.exec([[osascript -e 'tell application "Spotify"
      set trackName to name of current track
      set artistName to artist of current track
      set playerStatus to player state as string
      return trackName & "|||" & artistName & "|||" & playerStatus
    end tell' 2>/dev/null]], function(out)
      out = out or ""
      local parts = {}
      for part in string.gmatch(out, "[^|]+") do
        -- Skip empty parts from |||
        if part ~= "" then
          table.insert(parts, part)
        end
      end

      if #parts >= 3 then
        local title = parts[1]:gsub("^%s+", ""):gsub("%s+$", "")
        local artist = parts[2]:gsub("^%s+", ""):gsub("%s+$", "")
        local state = parts[3]:gsub("^%s+", ""):gsub("%s+$", "")
        is_playing = (state == "playing")

        -- Update bar icon color
        media:set({
          drawing = true,
          icon = { color = is_playing and colors.green or colors.mauve },
        })

        -- Update popup info
        title_item:set({ label = { string = title } })
        artist_item:set({ label = { string = artist } })

        -- Update play/pause button
        play_pause:set({
          icon = {
            string = is_playing and icons.media.pause or icons.media.play,
            color = is_playing and colors.peach or colors.green,
          },
        })

        -- Fetch Spotify artwork if playing
        if is_playing then
          update_spotify_artwork()
        end
      else
        -- Error or no track
        media:set({
          drawing = true,
          icon = { color = colors.mauve },
        })
        title_item:set({ label = { string = "Not Playing" } })
        artist_item:set({ label = { string = "" } })
        play_pause:set({
          icon = {
            string = icons.media.play,
            color = colors.green,
          },
        })
        is_playing = false
      end
    end)
  end)
end

-- Subscribe to media change event (from SketchyBar)
media:subscribe("media_change", function(env)
  if whitelist[env.INFO.app] then
    local playing = (env.INFO.state == "playing")
    is_playing = playing

    -- Update bar icon
    media:set({
      drawing = true,
      icon = { color = playing and colors.green or colors.mauve },
    })

    -- Update popup info
    title_item:set({ label = { string = env.INFO.title or "Unknown" } })
    artist_item:set({ label = { string = env.INFO.artist or "" } })

    -- Update play/pause button
    play_pause:set({
      icon = {
        string = playing and icons.media.pause or icons.media.play,
        color = playing and colors.peach or colors.green,
      },
    })

    -- Fetch Spotify artwork
    if playing and env.INFO.app == "Spotify" then
      update_spotify_artwork()
    end
  end
end)

-- Also poll periodically for state changes (backup)
media:subscribe("routine", function()
  update_media_info()
end)

-- System wake handler
media:subscribe("system_woke", function()
  sbar.delay(2, update_media_info)
end)

-- Initial update
update_media_info()
