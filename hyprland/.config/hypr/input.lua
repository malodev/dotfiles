-- Personal input settings shared across machines.

hl.config({
  input = {
    kb_layout = "us",
    kb_options = "compose:caps",
    repeat_rate = 40,
    repeat_delay = 1100,
    numlock_by_default = true,
    touchpad = {
      scroll_factor = 0.4,
    },
  },
})

-- Omarchy defaults already provide the terminal-specific touchpad scroll rules
-- that were present in the legacy input.conf.
