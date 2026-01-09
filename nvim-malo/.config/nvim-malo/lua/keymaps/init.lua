-- Main keymaps entry point
-- Load all keymap sections

local safe_keymap_set = require("keymaps.util").safe_keymap_set
local map = safe_keymap_set

-- Load all sections
require("keymaps.basics")
require("keymaps.buffers")
require("keymaps.search")
require("keymaps.git")
require("keymaps.terminal")
require("keymaps.which-key")
