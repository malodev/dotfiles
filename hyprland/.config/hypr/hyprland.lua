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

-- 1Password 8 is Electron, and its utility windows (Settings, the unlock and
-- passkey prompts) are created with resizable = false: they declare a fixed
-- size and ignore compositor geometry, so neither a size rule nor a manual
-- resize can make one bigger. Omarchy tags every 1Password window
-- floating-window and hands it 875x600 (default/hypr/apps/system.lua), which a
-- fixed-size dialog simply discards. The main window does take a size, so it
-- gets one chosen for a password list, and Settings -- which the app clamps --
-- is tiled instead of being left as an immovable postage stamp.
local ONEPASSWORD_CLASSES = { "1password", "com.onepassword.OnePassword" }

local function is_1password(window)
  for _, class in ipairs(ONEPASSWORD_CLASSES) do
    if window.class == class then
      return true
    end
  end
  return false
end

-- Registered after Omarchy's defaults. Matching on the tag as well as the class
-- is what makes the override stick: a rule that only matches the class loses to
-- the tag's own size, whatever the order.
o.window(
  { tag = "floating-window", class = "^(1[pP]assword|com\\.onepassword\\.OnePassword)$" },
  { size = { "(monitor_w * 0.5)", "(monitor_h * 0.7)" } }
)

-- Settings is created resizable = false: it declares a fixed size, so the size
-- rule above is clamped away and dragging its edge does nothing. Its title only
-- becomes "Settings" after mapping, so a static title rule cannot match it; it
-- has to be tiled from the title event instead, which is the one lever left.
--
-- Quick Access is deliberately a small palette, so it is left alone: tiling it
-- turns a search box into a full-workspace sheet.
local function untile_1password_settings(window)
  if window ~= nil
      and window.title == "Settings"
      and window.floating
      and is_1password(window) then
    hl.dispatch(hl.dsp.window.float({ action = "unset", window = window }))
  end
end

hl.on("window.open", untile_1password_settings)
hl.on("window.title", untile_1password_settings)

-- Apply the correction if this config is reloaded while Settings is open.
for _, window in ipairs(hl.get_windows({ class = "^(1[pP]assword|com\\.onepassword\\.OnePassword)$", title = "^Settings$" })) do
  untile_1password_settings(window)
end

-- Window rules that were only in the working copy when my stash parked them.
o.window({ class = "^gimp$" }, { opaque = true })
o.window(
  { class = "^org\\.omarchy\\.btop$", tag = "floating-window" },
  { size = { "(monitor_w * 0.6)", "(monitor_h * 0.7)" } }
)
o.window({ class = "^jetbrains-toolbox$" }, { center = true })
o.window(
  { class = "^org\\.omarchy\\.terminal$", tag = "floating-window" },
  { size = { "(monitor_w * 0.6)", "(monitor_h * 0.7)" } }
)
