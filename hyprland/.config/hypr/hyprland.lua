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

-- Keep GIMP always fully opaque (no active/inactive transparency).
o.window({ class = "^gimp$" }, { opaque = true })

-- Super+Ctrl+T (Activity/btop) lands in Omarchy's 875x600 floating default
-- (applied by the floating-window tag, which beats plain class rules), so match
-- that tag too and size it relative to whichever monitor it opens on.
o.window(
  { class = "^org\\.omarchy\\.btop$", tag = "floating-window" },
  { size = { "(monitor_w * 0.6)", "(monitor_h * 0.7)" } }
)

-- JetBrains Toolbox remembers its float position, and it was once parked at
-- x=-880 on a monitor starting at x=0 (invisible, off the left edge).
-- Centering on open keeps it on screen whatever the monitor layout is.
o.window({ class = "^jetbrains-toolbox$" }, { center = true })

-- The update/install "presentation" terminal (org.omarchy.terminal, title
-- Omarchy) otherwise inherits Omarchy's generic 875x600 float, which is too
-- cramped for gum tables and logs (it even warns about missing columns).
-- Same monitor-relative sizing as the btop window above.
o.window(
  { class = "^org\\.omarchy\\.terminal$", tag = "floating-window" },
  { size = { "(monitor_w * 0.6)", "(monitor_h * 0.7)" } }
)
