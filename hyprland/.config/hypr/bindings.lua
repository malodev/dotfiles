-- Personal keybinding overrides shared across machines.
-- Omarchy's unchanged default application bindings are intentionally not duplicated.

-- Omarchy 4's workspace digits are written as `code:N` key specs, but on the
-- installed Hyprland (0.56.2) those register with keycode=0 and an empty key:
-- dead binds no keystroke can trigger. That is why SUPER+[1-0] stopped
-- switching workspaces. Bind by key symbol instead -- this board is a us
-- layout, so the digit row maps 1:1 and the behaviour is identical. Both loops
-- can be deleted once upstream `code:` binds actually resolve.

-- Workspaces 1-10 (TV): SUPER+[1-0], SHIFT moves the active window.
for index = 1, 10 do
	local digit = tostring(index % 10) -- 1..9, then 0
	o.bind("SUPER + " .. digit, "Switch to workspace " .. index, hl.dsp.focus({ workspace = tostring(index) }))
	o.bind(
		"SUPER + SHIFT + " .. digit,
		"Move window to workspace " .. index,
		hl.dsp.window.move({ workspace = tostring(index) })
	)
end

-- Workspaces 11-20 (portrait): SUPER+CTRL+[1-0], SHIFT moves the window.
for index = 1, 10 do
	local digit = tostring(index % 10)
	local workspace = tostring(index + 10)
	-- still drop Omarchy's numbered bar-panel bind for the same slot
	hl.unbind("SUPER + CTRL + code:" .. tostring(index + 9))
	o.bind("SUPER + CTRL + " .. digit, "Switch to workspace " .. workspace, hl.dsp.focus({ workspace = workspace }))
	o.bind(
		"SUPER + CTRL + SHIFT + " .. digit,
		"Move window to workspace " .. workspace,
		hl.dsp.window.move({ workspace = workspace })
	)
end

-- Restore legacy actions that replace Omarchy 4 defaults.
hl.unbind("SUPER + SHIFT + S") -- was Google Maps
o.bind("SUPER + SHIFT + S", "Screenshot", "omarchy-capture-screenshot")

hl.unbind("SUPER + SHIFT + R")
o.bind(
	"SUPER + SHIFT + R",
	"Screen recording",
	"omarchy-capture-screenrecording --stop-recording || omarchy-menu toggle trigger.capture.screenrecord"
)

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
		if dispatcher then
			hl.dispatch(dispatcher)
		end
	end
end

hl.unbind("SUPER + J") -- was toggle window split (dwindle-only)
o.bind(
	"SUPER + J",
	"Toggle window split",
	for_layout(
		nil, -- scrolling has no split concept
		hl.dsp.layout("togglesplit")
	)
)

hl.unbind("SUPER + comma") -- was dismiss last notification
o.bind("SUPER + comma", "Move scrolling column left", for_layout(hl.dsp.layout("move -col"), nil))
o.bind("SUPER + period", "Move scrolling column right", for_layout(hl.dsp.layout("move +col"), nil))

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

-- T3 Code snapshots shortcut
hl.bind("CTRL + SHIFT + 2", hl.dsp.global("com.t3tools.T3Code:capture-window"))

-- Chromium's Tab Search chord is a hardcoded browser accelerator: it is not in
-- chrome://extensions/shortcuts (that page only lists extension commands) and
-- Chromium has no shortcut editor for its own commands, so Ctrl+Shift+A cannot
-- be changed inside the browser. Alias it instead: Alt+E sends Ctrl+Shift+A to
-- the focused Chromium window and is handed back to any other window, so the
-- chord is only spent on a browser. Note that inside Chromium Alt+E is its own
-- menu shortcut, and this replaces it there.
local function is_chromium(window)
	if window == nil or window.class == nil then
		return false
	end

	-- PWAs report their own class, e.g. chrome-chatgpt.com__-Profile_3.
	return window.class == "chromium" or window.class:sub(1, 7) == "chrome-"
end

o.bind("ALT + E", "Search browser tabs", function()
	local window = hl.get_active_window()
	if is_chromium(window) then
		hl.dispatch(hl.dsp.send_shortcut({ mods = "CTRL SHIFT", key = "A", window = "address:" .. window.address }))
	elseif window ~= nil then
		-- Hand the chord back to whatever is focused, so binding it here does not
		-- take Alt+E away from every other application.
		hl.dispatch(hl.dsp.pass({ window = "address:" .. window.address }))
	end
end)
