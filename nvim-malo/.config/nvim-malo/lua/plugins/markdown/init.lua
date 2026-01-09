-- Markdown plugins: Obsidian and preview
return {
	-- Obsidian: Note-taking
	{
		"epwalsh/obsidian.nvim",
		version = "*",
		lazy = true,
		event = {
			"BufReadPre " .. vim.fn.expand("~") .. "/Nextcloud/Obsidian/MalosVault/**.md",
			"BufNewFile " .. vim.fn.expand("~") .. "/Nextcloud/Obsidian/MalosVault/**.md",
		},
		dependencies = {
			"nvim-lua/plenary.nvim",
		},
		opts = {
			workspaces = {
				{
					name = "personal",
					path = "~/Nextcloud/Obsidian/MalosVault",
				},
			},
			templates = {
				subdir = "Tools/Templates",
				date_format = "%Y-%m-%d",
				time_format = "%H:%M",
			},
		},
	},

	-- Peek: Markdown preview
	{
		"toppair/peek.nvim",
		event = "VeryLazy",
		build = "deno task --quiet build:fast",
		config = function()
			local peek = require("peek")

			peek.setup({
				auto_load = true,
				close_on_bdelete = true,
				syntax = true,
				theme = "dark",
				update_on_change = true,
				app = "webview",
				filetype = { "markdown" },
				throttle_at = 200000,
				throttle_time = "auto",
			})

			vim.api.nvim_create_user_command("PeekOpen", function()
				if not peek.is_open() then
					peek.open()
				end
			end, {})

			vim.api.nvim_create_user_command("PeekClose", function()
				if peek.is_open() then
					peek.close()
				end
			end, {})

			vim.keymap.set("n", "<leader>mp", "<cmd>PeekOpen<cr>", { desc = "Peek Open" })
			vim.keymap.set("n", "<leader>mc", "<cmd>PeekClose<cr>", { desc = "Peek Close" })
		end,
	},

	-- Render markdown: Better display
	{
		"MeanderingProgrammer/render-markdown.nvim",
		dependencies = { "nvim-treesitter/nvim-treesitter", "echasnovski/mini.nvim" },
		opts = {
			preset = "obsidian",
		},
	},

	-- Markdown preview: Alternative preview
	{
		"iamcco/markdown-preview.nvim",
		cmd = { "MarkdownPreviewToggle", "MarkdownPreview", "MarkdownPreviewStop" },
		build = "bash -c 'cd app && yarn install'",
		init = function()
			vim.g.mkdp_filetypes = { "markdown" }
		end,
		ft = { "markdown" },
		config = function()
			vim.g.mkdp_auto_start = 0
			vim.g.mkdp_port = ""
			vim.keymap.set("n", "<leader>mm", "<Plug>MarkdownPreview", { desc = "Markdown Preview" })
		end,
	},
}
