return {
	"nvim-treesitter/nvim-treesitter",
	build = ":TSUpdate",
	config = function()
		local configs = require("nvim-treesitter.configs")
		configs.setup({
			modules = {},
			auto_install = true,
			ignore_install = {},
			ensure_installed = {
				"c",
				"lua",
				"javascript",
				"typescript",
				"tsx",
				"css",
				"html",
				"bash",
				"regex",
				"http",
				"xml",
				"json",
				"php",
			},
			sync_install = false,
			highlight = { enable = true },
			indent = { enable = true },
			playground = {
				enable = true,
				updatetime = 25,
				persist_queries = false,
			},
		})
	end,
}
