return {
	{
		"nvim-telescope/telescope.nvim",
		tag = "0.1.5",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-lua/popup.nvim",
			"folke/trouble.nvim",
			"nvim-telescope/telescope-media-files.nvim",
		},
		config = function(_, opts)
			local trouble = require("trouble.providers.telescope")
			require("telescope").setup({
				extensions = {
					media_files = {
						-- filetypes whitelist
						-- defaults to {"png", "jpg", "mp4", "webm", "pdf"}
						-- filetypes = { "png", "webp", "jpg", "jpeg" },
						-- find command (defaults to `fd`)
						find_cmd = "rg",
					},
				},
				defaults = {
					mappings = {
						i = { ["<c-t>"] = trouble.open_with_trouble },
						n = { ["<c-t>"] = trouble.open_with_trouble },
					},
					layout_config = {
						horizontal = {
							preview_cutoff = 0,
						},
					},
				},
			})
			require("telescope").load_extension("fzf")
			require("telescope").load_extension("prosession")
			require("telescope").load_extension("media_files")
			require("telescope").load_extension("noice")
		end,
		keys = {
			{ "<leader>ff", "<cmd>Telescope find_files<CR>", desc = "telescope: find_files" },
			{ "<leader>fg", "<cmd>Telescope live_grep<CR>", desc = "telescope: live_grep" },
			{ "<leader>fb", "<cmd>Telescope buffers<CR>", desc = "telescope: buffers" },
			{ "<leader>fo", "<cmd>Telescope oldfiles<CR>", desc = "telescope: oldfiles" },
			{ "<leader>fc", "<cmd>Telescope command_history<CR>", desc = "telescope: command_history" },
			{ "<leader>pf", "<cmd>Telescope prosession<CR>", desc = "telescope: sessions" },
			{ "<leader>fp", "<cmd>Telescope prosession<CR>", desc = "telescope: sessions" },
			{ "<leader>fi", "<cmd>Telescope media_files<CR>", desc = "telescope: media_files" },
			{ "<leader>fn", "<cmd>Telescope noice<CR>", desc = "telescope: media_files" },
		},
	},
	{ "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
	{
		"nvim-telescope/telescope-ui-select.nvim",
		config = function()
			require("telescope").setup({
				extensions = {
					["ui-select"] = {
						require("telescope.themes").get_dropdown({}),
					},
				},
			})
			require("telescope").load_extension("ui-select")
		end,
	},
	{
		"LukasPietzschmann/telescope-tabs",
		config = function()
			require("telescope").load_extension("telescope-tabs")
			require("telescope-tabs").setup({
				-- Your custom config :^)
			})
		end,
		dependencies = { "nvim-telescope/telescope.nvim" },
	},
}
