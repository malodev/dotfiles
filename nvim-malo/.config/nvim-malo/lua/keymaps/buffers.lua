-- Buffer keymaps
local map = require("keymaps.util").safe_keymap_set

-- Buffer navigation
map("n", "<C-h>", "<cmd>bprevious<cr>", { desc = "Prev Buffer" })
map("n", "<C-l>", "<cmd>bnext<cr>", { desc = "Next Buffer" })
map("n", "[b", "<cmd>bprevious<cr>", { desc = "Prev Buffer" })
map("n", "]b", "<cmd>bnext<cr>", { desc = "Next Buffer" })
map("n", "<leader>bb", "<cmd>e #<cr>", { desc = "Switch to Other Buffer" })
map("n", "<leader>`", "<cmd>e #<cr>", { desc = "Switch to Other Buffer" })

-- Close buffer
map("n", "<C-q>", ":bd<CR>", { desc = "Close current buffer" })

-- Buffer delete actions
map("n", "<leader>bf", ":lua delete_current_file()<CR>", { desc = "Delete current file and close the buffer" })
map("n", "<leader>bl", "<cmd>BufferLineCloseLeft<CR>", { desc = "BufferLine: Close Left" })
map("n", "<leader>br", "<cmd>BufferLineCloseRight<CR>", { desc = "BufferLine: Close Right" })
map("n", "<leader>bp", "<cmd>BufferLineTogglePin<CR>", { desc = "Toggle Pin current buffer" })
map("n", "<leader>bc", "<cmd>BufferLinePick<CR>", { desc = "Choose a buffer by letter" })
map("n", "<leader>bD", "<cmd>bd<cr>", { desc = "Delete Buffer and Window" })

-- Snacks buffer delete
map("n", "<leader>bd", function()
  Snacks.bufdelete()
end, { desc = "Delete Buffer" })
map("n", "<leader>ba", function()
  Snacks.bufdelete.all()
end, { desc = "Delete All Buffer" })
map("n", "<leader>bo", function()
  Snacks.bufdelete.other()
end, { desc = "Delete Other Buffer" })
