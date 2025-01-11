-- lazy install
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
	vim.fn.system({
		"git",
		"clone",
		"--filter=blob:none",
		"https://github.com/folke/lazy.nvim.git",
		"--branch=stable", -- latest stable release
		lazypath,
	})
end
vim.opt.rtp:prepend(lazypath)
vim.g.mapleader = " "
vim.g.maplocalleader = " "
require("lazy").setup({
	{
		import = "plugins_notvscode",
		cond = function()
			return true
			-- return not vim.g.vscode
		end,
	},
	{ import = "plugins_always", cond = true },
	{
		import = "plugins_vscode",
		cond = function()
			return vim.g.vscode
		end,
	},
	{
		"folke/snacks.nvim",
		priority = 1000,
		lazy = false,
		opts = {},
		config = function(_, opts)
			local notify = vim.notify
			require("snacks").setup(opts)
			-- HACK: restore vim.notify after snacks setup and let noice.nvim take over
			-- this is needed to have early notifications show up in noice history
			vim.notify = notify
		end,
	},
}, {
	rocks = {
		hererocks = true, -- Enable Hererocks to manage Lua dependencies
	},
	install = {
		colorscheme = { "catppuccin" },
	},
	ui = {
		border = "rounded",
	},
})
