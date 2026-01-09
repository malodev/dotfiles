-- Search keymaps
local map = require("keymaps.util").safe_keymap_set
local opts = { noremap = true, silent = true }

-- Search in visual mode
map("v", "/", '"fy/\\V<C-R>f<CR>', opts)
