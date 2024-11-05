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
require("lazy").setup({
	{
		import = "plugins_notvscode",
		cond = function()
			return not vim.g.vscode
		end,
	},
	{ import = "plugins_always", cond = true },
	{
		import = "plugins_vscode",
		cond = function()
			return vim.g.vscode
		end,
	},
}, {
	rocks = {
		enable = true, -- Enable LuaRocks support
		install = true, -- Automatically install missing rocks
		clean = true, -- Automatically clean rocks
		timeout = 300, -- Timeout for LuaRocks operations (in seconds)
		disable = false, -- Do not disable LuaRocks
		hererocks = true, -- Enable Hererocks to manage Lua dependencies
	},
}
)
