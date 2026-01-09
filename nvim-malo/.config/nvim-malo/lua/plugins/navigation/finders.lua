-- Telescope and FZF finder plugins
return {
	{
		"nvim-telescope/telescope.nvim",
		tag = "0.1.8",
		event = "VeryLazy",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-lua/popup.nvim",
			"folke/trouble.nvim",
			"nvim-telescope/telescope-media-files.nvim",
			"nvim-tree/nvim-web-devicons",
			{ "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
			"andrew-george/telescope-themes",
		},
		config = function()
			local ok_telescope, telescope = pcall(require, "telescope")
			local ok_actions, actions = pcall(require, "telescope.actions")
			if not ok_telescope or not ok_actions then
				return
			end

			telescope.setup({
				defaults = {
					path_display = { "truncate" },
					dynamic_preview_title = true,
					mappings = {
						i = {
							["<c-j>"] = actions.cycle_history_next,
							["<c-k>"] = actions.cycle_history_prev,
						},
					},
					layout_strategy = "vertical",
					layout_config = {
						center = {
							width = function(_, max_columns)
								local percentage = 0.8
								local max = 70
								return math.min(math.floor(percentage * max_columns), max)
							end,
							height = function(_, _, max_lines)
								local percentage = 0.8
								local min = 25
								return math.max(math.floor(percentage * max_lines), min)
							end,
							preview_cutoff = 0,
						},
						vertical = {
							width = 0.9,
							height = 0.9,
							preview_height = 0.5,
							preview_cutoff = 1,
						},
					},
				},
				pickers = {
					find_files = {
						hidden = true,
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
						fuzzy = true,
						override_generic_sorter = true,
						override_file_sorter = true,
						case_mode = "smart_case",
						hidden = true,
					},
				},
			})
			telescope.load_extension("fzf")
			telescope.load_extension("media_files")
			telescope.load_extension("themes")

			local builtin = require("telescope.builtin")
			vim.keymap.set("n", "<leader>fb", builtin.buffers, { desc = "buffers" })
			vim.keymap.set("n", "<leader>fd", builtin.lsp_document_symbols, { desc = "lsp document symbols" })
			vim.keymap.set("n", "<leader>ff", builtin.find_files, { desc = "find files" })
			vim.keymap.set("n", "<leader>fg", builtin.live_grep, { desc = "live grep" })
			vim.keymap.set("n", "<leader>fh", builtin.help_tags, { desc = "help tags" })
			vim.keymap.set("n", "<leader>fk", builtin.keymaps, { desc = "Find keymaps" })
			vim.keymap.set("n", "<leader>fo", builtin.oldfiles, { desc = "oldfiles" })
			vim.keymap.set("n", "<leader>fr", builtin.lsp_references, { desc = "lsp references" })
			vim.keymap.set("n", "<leader>tp", ":Telescope themes<CR>", { noremap = true, silent = true, desc = "Theme Switcher" })
			vim.keymap.set("n", "<leader>fw", builtin.lsp_workspace_symbols, { desc = "lsp workspace symbols" })
		end,
		keys = {
			{ "<C-p>", "<cmd>Telescope git_files<cr>", desc = "Git files" },
			{ "<leader>/", "<cmd>Telescope current_buffer_fuzzy_find<cr>", desc = "Buffer search" },
			{ "<leader>fc", "<cmd>Telescope command_history<CR>", desc = "command_history" },
			{ "<leader>fe", "<cmd>Telescope rest select_env<CR>", desc = "Select rest env" },
			{ "<leader>fi", "<cmd>Telescope media_files<CR>", desc = "media_files" },
			{ "<leader>fl", "<cmd>Telescope lsp_references<cr>", desc = "Lsp References" },
			{ "<leader>fs", "<cmd>Telescope grep_string<cr>", desc = "Grep String" },
			{ "<leader>ft", "<cmd>Telescope treesitter<cr>", desc = "Treesitter" },
		},
	},
	{
		"nvim-telescope/telescope-ui-select.nvim",
		config = function()
			local ok_telescope, telescope = pcall(require, "telescope")
			local ok_themes, themes = pcall(require, "telescope.themes")
			if not ok_telescope or not ok_themes then
				return
			end
			telescope.setup({
				extensions = {
					["ui-select"] = {
						themes.get_dropdown({}),
					},
				},
			})
			telescope.load_extension("ui-select")
		end,
	},
	{
		"LukasPietzschmann/telescope-tabs",
		enabled = function()
			local ok_config, config = pcall(require, "config")
			return ok_config and config.is_enabled.telescope_tabs or false
		end,
		config = function()
			local ok_telescope, telescope = pcall(require, "telescope")
			local ok_telescope_tabs, telescope_tabs = pcall(require, "telescope-tabs")
			if not ok_telescope or not ok_telescope_tabs then
				return
			end
			telescope.load_extension("telescope-tabs")
			telescope_tabs.setup({})
		end,
		dependencies = { "nvim-telescope/telescope.nvim" },
	},
}
