return {
	{
		"nvim-telescope/telescope.nvim",
		tag = "0.1.5",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"folke/trouble.nvim",
		},
		config = function(_, opts)
			local trouble = require("trouble.providers.telescope")
			require("telescope").setup({

				defaults = {
					mappings = {
						i = { ["<c-t>"] = trouble.open_with_trouble },
						n = { ["<c-t>"] = trouble.open_with_trouble },
					},
				},
			})
			require("telescope").load_extension("fzf")
      require('telescope').load_extension('prosession')
		end,
		keys = {
			{ "<leader>ff", "<cmd>Telescope find_files<CR>", desc = "telescope: find_files" },
			{ "<leader>fg", "<cmd>Telescope live_grep<CR>", desc = "telescope: live_grep" },
			{ "<leader>fb", "<cmd>Telescope buffers<CR>", desc = "telescope: buffers" },
			{ "<leader>fo", "<cmd>Telescope oldfiles<CR>", desc = "telescope: oldfiles" },
			{ "<leader>fc", "<cmd>Telescope command_history <CR>", desc = "telescope: oldfiles" },
			{ "<leader>pf", "<cmd>Telescope prosession <CR>", desc = "telescope: sessions" },
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
}
