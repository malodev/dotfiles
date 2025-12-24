local colors = require("colors")
local icons = require("icons")
local settings = require("settings")

local whitelist = { ["Spotify"] = true, ["Music"] = true }

-- Media Item (Icon Only on Bar)
local media = sbar.add("item", "media", {
  position = "center",
  icon = { string = icons.media.music, color = colors.mauve },
  label = { drawing = false }, -- Hide label on bar
  background = { drawing = false },
  popup = { align = "right" }, -- Align popup for vertical bar
  updates = true,
  update_freq = 3, -- Poll every 3 seconds
  click_script = "sketchybar --set media popup.drawing=toggle"
})

-- Popup: Cover Art
local cover = sbar.add("item", {
  position = "popup." .. media.name,
  background = { image = { string = "media.artwork", scale = 0.8 } },
  icon = { drawing = false },
  label = { drawing = false },
  align = "center"
})

-- Popup: Title
local title_item = sbar.add("item", {
  position = "popup." .. media.name,
  icon = { drawing = false },
  label = { string = "Not Playing", width = 150, align = "center", font = { style = "Bold" } },
  width = 160,
  align = "center"
})

-- Popup: Artist
local artist_item = sbar.add("item", {
  position = "popup." .. media.name,
  icon = { drawing = false },
  label = { string = "", width = 150, align = "center", color = colors.subtext1, font = { size = 11 } },
  width = 160,
  align = "center"
})

-- Popup: Controls Container (Vertical stack is standard for Sketchybar popups without advanced layout)
-- But we can try to make them look compact.

-- Controls
local prev = sbar.add("item", {
  position = "popup." .. media.name,
  icon = { string = icons.media.back },
  label = { drawing = false },
  click_script = "nowplaying-cli previous",
  width = 50,
  align = "center"
})

local play_pause = sbar.add("item", {
  position = "popup." .. media.name,
  icon = { string = icons.media.play_pause },
  label = { drawing = false },
  click_script = "nowplaying-cli togglePlayPause",
  width = 50,
  align = "center"
})

local next = sbar.add("item", {
  position = "popup." .. media.name,
  icon = { string = icons.media.next },
  label = { drawing = false },
  click_script = "nowplaying-cli next",
  width = 50,
  align = "center"
})


-- Logic
local function update_media()
  -- Fetch Cover Art (Spotify only)
  sbar.exec("osascript -e 'tell application \"Spotify\" to get artwork url of current track'", function(url)
    if url and url ~= "" and not url:find("error") then
      sbar.exec("curl -s -o /tmp/cover.jpg " .. url, function()
        cover:set({ background = { image = "/tmp/cover.jpg" } })
      end)
    else
      cover:set({ background = { image = "media.artwork" } })
    end
  end)

  -- Use formatted command for simpler parsing
  sbar.exec("nowplaying-cli get title artist playbackRate", function(out)
      local lines = {}
      for line in string.gmatch(out, "[^\r\n]+") do
          table.insert(lines, line)
      end

      if #lines >= 2 then
          local title = lines[1]
          local artist = lines[2]
          local rate = tonumber(lines[3]) or 0
          local playing = (rate > 0)

          media:set({
              drawing = true,
              icon = { color = playing and colors.green or colors.mauve }
          })
          title_item:set({ label = title })
          artist_item:set({ label = artist })

           if playing then
              play_pause:set({ icon = icons.media.pause })
            else
              play_pause:set({ icon = icons.media.play })
            end
      else
           -- Not playing or error
           media:set({ drawing = true, icon = { color = colors.mauve } })
           title_item:set({ label = "Not Playing" })
           artist_item:set({ label = "" })
           cover:set({ background = { image = "media.artwork" } })
      end
  end)
end

media:subscribe({ "routine", "media_change", "system_woke" }, update_media)
-- Also run on load
update_media()
