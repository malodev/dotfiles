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

hl.unbind("SUPER + SHIFT + R")
o.bind("SUPER + SHIFT + R", "Screen recording", "omarchy-capture-screenrecording --stop-recording || omarchy-menu toggle trigger.capture.screenrecord")

-- This keyboard has no PRINT key, so move the OCR text extraction to a real one.
-- SUPER+SHIFT+O is Obsidian and SUPER+CTRL+O is taken, so SUPER+ALT+O it is.
-- Language list comes from OMARCHY_OCR_LANGS (eng+ita), set in hyprland_local.lua.
hl.unbind("SUPER + CTRL + PRINT")
o.bind("SUPER + ALT + O", "Extract text (OCR) from screenshot", "omarchy-capture-text")

-- Same stranded PRINT row: the color picker lived on SUPER+PRINT.
hl.unbind("SUPER + PRINT")
o.bind("SUPER + ALT + P", "Color picker", "pkill hyprpicker || hyprpicker -a")

-- Quattro leaves SUPER+SHIFT+T free; use it for the Voxtype toggle and keep
-- upstream's SUPER+CTRL+T Activity binding untouched.
o.bind("SUPER + SHIFT + T", "Toggle Voxtype mode", "voxtype-mode-toggle")


-- Scrolling/dwindle navigation. SUPER+L toggles the active workspace's
-- layout, so shared keys must behave on both layout types. The native
-- scrolling layout accepts: move ±col, colresize, fit, focus, promote,
-- consume, expel, consume_or_expel, swapcol, center, fit_into_view.
-- dwindle accepts: togglesplit, swapsplit, rotatesplit, movetoroot, preselect.
-- movewindowto exists in neither (it belonged to the old external plugin).
-- Run the scrolling dispatcher on scrolling workspaces, the dwindle one on
-- dwindle workspaces, and nothing where a layout has no equivalent.
-- Pure Lua via the query API: a subprocess (io.popen + hyprctl) here would
-- deadlock the compositor, since Hyprland's main thread would wait on the
-- child while the child waits on Hyprland's IPC socket.
local function for_layout(scrolling, dwindle)
  return function()
    local ws = hl.get_active_workspace()
    local dispatcher = (ws and ws.tiled_layout == "scrolling") and scrolling or dwindle
    if dispatcher then hl.dispatch(dispatcher) end
  end
end

hl.unbind("SUPER + J") -- was toggle window split (dwindle-only)
o.bind("SUPER + J", "Toggle window split", for_layout(
  nil, -- scrolling has no split concept
  hl.dsp.layout("togglesplit")
))

hl.unbind("SUPER + comma") -- was dismiss last notification
o.bind("SUPER + comma", "Move scrolling column left", for_layout(
  hl.dsp.layout("move -col"),
  nil
))
o.bind("SUPER + period", "Move scrolling column right", for_layout(
  hl.dsp.layout("move +col"),
  nil
))

-- Window swapping uses the cross-layout dispatcher, valid on every layout.
-- SUPER+SHIFT+UP/DOWN keep Omarchy's identical upstream defaults.
hl.unbind("SUPER + SHIFT + comma") -- was dismiss all notifications
o.bind("SUPER + SHIFT + comma", "Move window left", hl.dsp.window.swap({ direction = "l" }))
o.bind("SUPER + SHIFT + period", "Move window right", hl.dsp.window.swap({ direction = "r" }))

-- Replace Omarchy's HEY shortcuts with Google web apps.
hl.unbind("SUPER + SHIFT + C")
o.bind("SUPER + SHIFT + C", "Google Calendar", { webapp = "https://calendar.google.com/" })

hl.unbind("SUPER + SHIFT + E")
o.bind("SUPER + SHIFT + E", "Gmail", { webapp = "https://mail.google.com/" })

hl.unbind("SUPER + SHIFT + ALT + E")
o.bind("SUPER + SHIFT + ALT + E", "New Gmail email", {
  webapp = "https://mail.google.com/mail/u/0/#compose",
})
