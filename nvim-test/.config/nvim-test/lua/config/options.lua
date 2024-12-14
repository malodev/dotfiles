local set = vim.opt

set.expandtab = true
set.tabstop = 2
set.softtabstop = 2
set.shiftwidth = 2
set.ignorecase = true
set.smartcase = true
set.mousemodel = "extend"

-- vim.cmd [[hi @function.buildin.lua guifg=yellow ]]
-- vim.cmd [[hi @comment guifg=yellow ]]

vim.keymap.set("n", "<Space>", "<Nop>", { silent = true, remap = false })
vim.g.mapleader = " "
vim.g.maplocalleader = "\\"

vim.opt.clipboard = "unnamedplus" -- use system clipboard
vim.opt.number = true -- show absolute number
vim.opt.relativenumber = true -- add numbers to each line on the left side

-- highligh yanked text
vim.api.nvim_create_autocmd('TextYankPost', {
  desc = 'Highlight when yanking text',
  group = vim.api.nvim_create_augroup('yank-highlight', { clear = true }),
  callback = function()
	  vim.highlight.on_yank()
  end,
})

print("OPTIONS")
