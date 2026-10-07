-- Personal look and layout settings shared across machines.

hl.config({
  general = {
    border_size = 4,
    layout = "scrolling",
    -- Omarchy ships resize_on_border = false, which means dragging a window's
    -- edge never resizes it; only SUPER+right-drag does. Enable the usual edge
    -- drag (and corner drag) again.
    resize_on_border = true,
  },
  decoration = {
    rounding = 8,
  },
})
