-- Terminal keymaps
local map = require("keymaps.util").safe_keymap_set

-- Floating terminal
map("n", "<leader>tt", function()
	Snacks.terminal()
end, { desc = "Terminal (cwd)" })

-- Terminal mappings
map("t", "<C-/>", "<cmd>close<cr>", { desc = "Hide Terminal" })
map("t", "<c-_>", "<cmd>close<cr>", { desc = "which_key_ignore" })

-- Terminal cursor movement
map("t", "<C-A>", [[<C-\>|]], { desc = "Terminal beginning of line" })
map("t", "<C-E>", [[<C-\>$]], { desc = "Terminal end of line" })
