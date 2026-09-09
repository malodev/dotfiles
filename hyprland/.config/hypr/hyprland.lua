-- Learn how to configure Hyprland: https://wiki.hypr.land/Configuring/Start/

-- Omarchy's bootstrap keeps path setup out of this user config.
dofile((os.getenv("OMARCHY_PATH") or "/usr/share/omarchy") .. "/default/hypr/bootstrap.lua")

-- Disable all Omarchy default bindings. Add your own in hypr/bindings.lua.
-- omarchy_default_bindings = false
--
-- Or disable only bindings for Omarchy's preinstalled apps/web apps while
-- keeping core window-manager bindings:
-- omarchy_preinstalled_bindings = false

-- Load Omarchy defaults.
require("default.hypr.omarchy")

-- Put your personal overrides in these files. They're loaded after Omarchy's
-- defaults so package updates can improve the defaults without rewriting your
-- ~/.config/hypr files.
require("hypr.monitors")
require("hypr.input")
require("hypr.bindings")
require("hypr.looknfeel")
require("hypr.autostart")

-- Load optional machine-specific workspace and GPU settings.
require("default.hypr.require_optional").module("hypr.hyprland_local")

-- Toggle config flags dynamically.
require("default.hypr.toggles")

-- Add any other personal Hyprland configuration below.
-- o.window("qemu", { workspace = "5" })

-- Keep DaVinci Resolve inside the monitor's usable area.
o.window(
  { class = ".*[Rr]esolve.*", title = "^DaVinci Resolve( Studio)? - .+$" },
  { tile = true, fullscreen = false }
)

-- 1Password creates Settings as a fixed-size floating Electron window and
-- rejects compositor resize requests. Its title changes from "1Password" to
-- "Settings" after mapping, so a static title rule cannot match it reliably.
local function tile_1password_settings(window)
  if window ~= nil
      and window.class == "1password"
      and window.title == "Settings"
      and window.floating then
    hl.dispatch(hl.dsp.window.float({ action = "unset", window = window }))
  end
end

hl.on("window.open", tile_1password_settings)
hl.on("window.title", tile_1password_settings)

-- Apply the correction to Settings if this config is reloaded while it is open.
for _, window in ipairs(hl.get_windows({ class = "^1password$", title = "^Settings$" })) do
  tile_1password_settings(window)
end
