-- File navigation plugins: oil.nvim, yazi
return {
	-- Oil.nvim: Edit file system like a buffer
	{
		"stevearc/oil.nvim",
		opts = {
			view_options = {
				show_hidden = true,
			},
		},
		keys = {
			{ "-", "<cmd>Oil<cr>", desc = "Oil: Open parent directory" },
		},
		config = function(_, opts)
			local ok, oil = pcall(require, "oil")
			if ok then
				oil.setup(opts)
			end
		end,
	},

	-- Yazi: File manager integration
	{
		"mikavilpas/yazi.nvim",
		event = "VeryLazy",
		keys = {
			{
				"<leader>fy",
				function()
					require("yazi").yazi()
				end,
				desc = "Open yazi",
			},
			{
				"_",
				function()
					require("yazi").yazi()
				end,
				desc = "Open yazi",
			},
		},
		opts = {
			open_for_directories = false,
		},
	},
}
