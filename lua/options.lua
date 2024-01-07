vim.cmd("set expandtab")
vim.cmd("set tabstop=2")
vim.cmd("set softtabstop=2")
vim.cmd("set shiftwidth=2")
vim.g.mapleader = " "
vim.opt.clipboard = "unnamedplus" -- use system clipboard
vim.opt.number = true             -- show absolute number
vim.opt.relativenumber = true     -- add numbers to each line on the left side
local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup

local number_toggle = augroup("numbertoggle", { clear = true })

autocmd({ "InsertLeave" }, {
  pattern = "*",
  command = "setlocal relativenumber",
  group = number_toggle,
})

autocmd({ "InsertEnter" }, {
  pattern = "*",
  command = "setlocal norelativenumber",
  group = number_toggle,
})
