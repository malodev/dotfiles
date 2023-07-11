---@type MappingsTable
local M = {}

M.general = {
  n = {
    [";"] = { ":", "enter command mode", opts = { nowait = true } },
    ["<leader>pv"] = { ":Explore<cr>", "open file Explore (netrw)"},
  },
}
-- more keybinds!

return M
