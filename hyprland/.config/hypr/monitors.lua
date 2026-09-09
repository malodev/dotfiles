-- General monitor defaults shared across machines.
-- Machine-specific outputs live in monitors_local.lua (gitignored).

local omarchy_gdk_scale = 1
local omarchy_monitor_scale = 1

hl.env("GDK_SCALE", tostring(omarchy_gdk_scale))
hl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })

require("default.hypr.require_optional").module("hypr.monitors_local")
