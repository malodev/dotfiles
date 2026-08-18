-- Personal keybinding overrides shared across machines.
-- Omarchy's unchanged default application bindings are intentionally not duplicated.

-- Workspaces 11-20: SUPER+CTRL+[1-0], with SHIFT to move the active window.
-- Use physical keycodes to match and replace Omarchy 4's numbered bar-panel bindings.
for index = 1, 10 do
  local key = "code:" .. tostring(index + 9)
  local workspace = tostring(index + 10)
  hl.unbind("SUPER + CTRL + " .. key)
  o.bind(
    "SUPER + CTRL + " .. key,
    "Switch to workspace " .. workspace,
    hl.dsp.focus({ workspace = workspace })
  )
  o.bind(
    "SUPER + CTRL + SHIFT + " .. key,
    "Move window to workspace " .. workspace,
    hl.dsp.window.move({ workspace = workspace })
  )
end

-- Restore legacy actions that replace Omarchy 4 defaults.
hl.unbind("SUPER + SHIFT + S") -- was Google Maps
o.bind("SUPER + SHIFT + S", "Screenshot", "omarchy-capture-screenshot")

hl.unbind("SUPER + CTRL + T") -- was Activity/btop
o.bind("SUPER + CTRL + T", "Toggle Voxtype translate mode", "voxtype-translate-toggle")

-- Scrolling-layout navigation.
hl.unbind("SUPER + comma") -- was dismiss last notification
o.bind("SUPER + comma", "Move scrolling column left", hl.dsp.layout("move -col"))
o.bind("SUPER + period", "Move scrolling column right", hl.dsp.layout("move +col"))

hl.unbind("SUPER + SHIFT + comma") -- was dismiss all notifications
o.bind("SUPER + SHIFT + comma", "Move window left", hl.dsp.layout("movewindowto l"))
o.bind("SUPER + SHIFT + period", "Move window right", hl.dsp.layout("movewindowto r"))

hl.unbind("SUPER + SHIFT + UP") -- was swap window up
o.bind("SUPER + SHIFT + UP", "Move window up", hl.dsp.layout("movewindowto u"))

hl.unbind("SUPER + SHIFT + DOWN") -- was swap window down
o.bind("SUPER + SHIFT + DOWN", "Move window down", hl.dsp.layout("movewindowto d"))
