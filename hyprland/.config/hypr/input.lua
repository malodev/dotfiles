-- Personal input settings shared across machines.

hl.config({
  input = {
    kb_layout = "us",
    -- CapsLock is disabled everywhere except as Compose (compose:caps).
    kb_options = "compose:caps",
    repeat_rate = 40,
    repeat_delay = 1100,
    numlock_by_default = true,
    touchpad = {
      -- macOS-style: scrolling moves the content with the fingers.
      natural_scroll = true,
      scroll_factor = 0.55,
    },
    -- Scroll acceleration curve: precise at slow finger speed, faster on flicks,
    -- which is the part a flat scroll_factor cannot express. An empty
    -- scroll_points is Omarchy's flat curve. Format is "<step> <x0> <y0> ...".
    scroll_points = "0.2 0.0 0.1 0.5 0.15 1.0 0.2 2.0 0.25",
  },
})

-- Keyboard mapping is per keyboard, not per machine, so the Alt/Win swap is not
-- set here. An Apple board already sends Super from Command and Alt from
-- Option: nothing to do. A PC board has Win and Alt in those two positions, so
-- it needs `altwin:swap_alt_win` to put Super on the key beside Space and Alt on
-- the one above it. Setting the option here would invert Command and Option on
-- an Apple keyboard, so it belongs in the machine layer
-- (hypr/hyprland_local.lua), which loads after this file.

-- Three fingers swipe through workspaces and four fingers take the active
-- window along, with the direction macOS uses: fingers left go forward.
-- Hyprland rejects a second gesture on the same fingers and direction, so
-- Omarchy's bindings are unset before they are replaced.
hl.gesture({ fingers = 3, direction = "left", action = "unset" })
hl.gesture({ fingers = 3, direction = "right", action = "unset" })
hl.gesture({ fingers = 3, direction = "left", action = function() hl.dispatch(hl.dsp.focus({ workspace = "r+1" })) end })
hl.gesture({ fingers = 3, direction = "right", action = function() hl.dispatch(hl.dsp.focus({ workspace = "r-1" })) end })
hl.gesture({ fingers = 4, direction = "left", action = "unset" })
hl.gesture({ fingers = 4, direction = "right", action = "unset" })
hl.gesture({ fingers = 4, direction = "left", action = function() hl.dispatch(hl.dsp.window.move({ workspace = "r+1" })) end })
hl.gesture({ fingers = 4, direction = "right", action = function() hl.dispatch(hl.dsp.window.move({ workspace = "r-1" })) end })

-- Omarchy defaults already provide the terminal-specific touchpad scroll rules
-- that were present in the legacy input.conf.
