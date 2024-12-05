return {
	{
		"nvim-telescope/telescope.nvim",
		-- tag = "0.1.5",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-lua/popup.nvim",
			"folke/trouble.nvim",
			"nvim-telescope/telescope-media-files.nvim",
			"nvim-telescope/telescope-smart-history.nvim",
		},
		config = function()
			local open_with_trouble = require("trouble.sources.telescope").open

			-- Use this to add more results without clearing the trouble list
			-- local add_to_trouble = require("trouble.sources.telescope").add

			require("telescope").setup({
				pickers = {
					find_files = {
						file_ignore_patterns = {
							"node_modules",
							".git",
							".DS_Store",
							".venv",
							".pytest_cache",
							".mypy_cache",
							".idea",
							".vscode",
						},
						hidden = true,
					},
					live_grep = {
						file_ignore_patterns = {
							"node_modules",
							".git",
							".DS_Store",
							".venv",
							".pytest_cache",
							".mypy_cache",
							".idea",
							".vscode",
						},
						additional_args = function(_)
							return { "--hidden" }
						end,
						-- hidden = true,
					},
				},
				extensions = {
					"fzf",
					prosession = {
						path = vim.fn.stdpath("data") .. "/prosession",
						ignore = {
							"node_modules",
							".git",
						},
					},
					smart_history = {
						path = vim.fn.stdpath("data") .. "/telescope_smart_history.sqlite3",
					},
					"rest",
					noice = {
						layout_config = {
							preview_width = 0.65,
						},
					},
					media_files = {
						-- filetypes whitelist
						-- defaults to {"png", "jpg", "mp4", "webm", "pdf"}
						-- filetypes = { "png", "webp", "jpg", "jpeg" },
						-- find command (defaults to `fd`)
						find_cmd = "rg",
					},
				},
				defaults = {
					history = {
						path = vim.fn.stdpath("data") .. "/telescope_history.sqlite3",
						limit = 100,
					},
					mappings = {
						i = {
							["<c-t>"] = open_with_trouble,
							["<c-j>"] = require("telescope.actions").cycle_history_next,
							["<c-k>"] = require("telescope.actions").cycle_history_prev,
						},
						n = { ["<c-t>"] = open_with_trouble },
					},
					layout_config = {
						horizontal = {
							preview_cutoff = 0,
						},
					},
				},
			})
			require("telescope").load_extension("smart_history")
			require("telescope").load_extension("fzf")
			require("telescope").load_extension("prosession")
			require("telescope").load_extension("media_files")
			require("telescope").load_extension("noice")
			require("telescope").load_extension("rest")
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
			{ "<leader>fn", "<cmd>Telescope noice<CR>", desc = "telescope: noice" },
			{ "<leader>fr", "<cmd>Telescope rest select_env<CR>", desc = "telescope: select rest env" },
			{ "<leader>/", "<cmd>Telescope current_buffer_fuzzy_find<cr>", desc = "Buffer search" },
			-- { "<leader>fc", "<cmd>Telescope git_commits<cr>", desc = "Commits" },
			{ "<C-p>", "<cmd>Telescope git_files<cr>", desc = "Git files" },
			-- { "<leader>fh", "<cmd>Telescope help_tags<cr>", desc = "Help" },
			{ "<leader>fj", "<cmd>Telescope command_history<cr>", desc = "History" },
			{ "<leader>fk", "<cmd>Telescope keymaps<cr>", desc = "Keymaps" },
			{ "<leader>fl", "<cmd>Telescope lsp_references<cr>", desc = "Lsp References" },
			{ "<leader>fs", "<cmd>Telescope grep_string<cr>", desc = "Grep String" },
			{ "<leader>ft", "<cmd>Telescope treesitter<cr>", desc = "Treesitter" },
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
		cond = function()
			return require("config").is_enabled.telescope_tabs
		end,
		config = function()
			require("telescope").load_extension("telescope-tabs")
			require("telescope-tabs").setup({
				-- Your custom config :^)
			})
		end,
		dependencies = { "nvim-telescope/telescope.nvim" },
	},
}
