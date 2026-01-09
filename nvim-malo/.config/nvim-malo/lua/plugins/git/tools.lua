-- Git tools: neogit, diffview, lazygit
return {
	-- Diffview: Git diff viewer
	{
		"sindrets/diffview.nvim",
		cmd = { "DiffviewOpen", "DiffviewFileHistory" },
		config = function()
			local ok_actions, actions = pcall(require, "diffview.actions")
			local ok_diffview, diffview = pcall(require, "diffview")
			if not ok_diffview or not ok_actions then
				return
			end

			diffview.setup({
				diff_binaries = false,
				enhanced_diff_hl = false,
				git_cmd = { "git" },
				hg_cmd = { "hg" },
				use_icons = true,
				show_help_hints = true,
				watch_index = true,
				icons = {
					folder_closed = "",
					folder_open = "",
				},
				signs = {
					fold_closed = "",
					fold_open = "",
					done = "✓",
				},
				view = {
					default = {
						layout = "diff2_horizontal",
						disable_diagnostics = false,
						winbar_info = false,
					},
					merge_tool = {
						layout = "diff3_horizontal",
						disable_diagnostics = true,
						winbar_info = true,
					},
					file_history = {
						layout = "diff2_horizontal",
						disable_diagnostics = false,
						winbar_info = false,
					},
				},
				file_panel = {
					listing_style = "tree",
					tree_options = {
						flatten_dirs = true,
						folder_statuses = "only_folded",
					},
					win_config = {
						position = "left",
						width = 35,
						win_opts = {},
					},
				},
				default_args = {
					DiffviewOpen = {},
					DiffviewFileHistory = {},
				},
			})
		end,
	},

	-- Neogit: Magit-like Git interface
	{
		"NeogitOrg/neogit",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"sindrets/diffview.nvim",
			"nvim-telescope/telescope.nvim",
		},
		cmd = "Neogit",
		config = true,
		enabled = function()
			local ok_config, config = pcall(require, "config")
			return ok_config and config.is_enabled.neogit or false
		end,
	},

	-- LazyGit: Lazygit integration
	{
		"kdheepak/lazygit.nvim",
		lazy = true,
		cmd = {
			"LazyGit",
			"LazyGitConfig",
			"LazyGitCurrentFile",
			"LazyGitFilter",
			"LazyGitFilterCurrentFile",
		},
		dependencies = {
			"nvim-lua/plenary.nvim",
		},
		keys = {
			{ "<leader>lg", "<cmd>LazyGit<cr>", desc = "LazyGit" },
		},
	},
}
