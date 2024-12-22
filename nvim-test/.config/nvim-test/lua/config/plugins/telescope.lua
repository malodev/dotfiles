return {
	{
		"nvim-telescope/telescope.nvim",
		tag = "0.1.8",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-lua/popup.nvim",
			"folke/trouble.nvim",
			"nvim-telescope/telescope-media-files.nvim",
			"nvim-tree/nvim-web-devicons",
			{ "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
		},
		config = function()
			require("telescope").setup({
				defaults = {
					mappings = {
						i = {
							["<c-j>"] = require("telescope.actions").cycle_history_next,
							["<c-k>"] = require("telescope.actions").cycle_history_prev,
						},
					},
				},
				pickers = {
					find_files = {
						hidden = true,
						theme = "dropdown",
					},
					grep_string = {
						additional_args = { "--hidden" },
					},
					live_grep = {
						additional_args = { "--hidden" },
					},
				},
				extensions = {
					fzf = {
						fuzzy = true, -- false will only do exact matching
						override_generic_sorter = true, -- override the generic sorter
						override_file_sorter = true, -- override the file sorter
						case_mode = "smart_case", -- or "ignore_case" or "respect_case"
						hidden = true,
					},
				},
			})
			require("telescope").load_extension("fzf")
			local builtin = require("telescope.builtin")
			vim.keymap.set("n", "<leader>ff", builtin.find_files, { desc = "find files" })
			vim.keymap.set("n", "<leader>fg", builtin.live_grep, { desc = "live grep" })
			vim.keymap.set("n", "<leader>fb", builtin.buffers, { desc = "buffers" })
			vim.keymap.set("n", "<leader>fh", builtin.help_tags, { desc = "help tags" })
			vim.keymap.set("n", "<leader>fo", builtin.oldfiles, { desc = "oldfiles" })
			vim.keymap.set("n", "<leader>fw", builtin.lsp_workspace_symbols, { desc = "lsp workspace symbols" })
			vim.keymap.set("n", "<leader>fd", builtin.lsp_document_symbols, { desc = "lsp document symbols" })
			-- vim.keymap.set("n", "<leader>fc", builtin.lsp_code_actions, { desc = "lsp code actions" })
			vim.keymap.set("n", "<leader>fr", builtin.lsp_references, { desc = "lsp references" })
			vim.keymap.set("n", "<leader>fk", builtin.keymaps, { desc = "Find keymaps" })
		end,
	},
}
