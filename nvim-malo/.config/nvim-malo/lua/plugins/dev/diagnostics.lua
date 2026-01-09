-- Diagnostics and outline: Trouble, Outline, Hover
return {
	-- Trouble: Diagnostics viewer
	{
		"folke/trouble.nvim",
		cmd = "Trouble",
		keys = {
			{
				"<leader>xx",
				"<cmd>Trouble diagnostics toggle<cr>",
				desc = "Diagnostics (Trouble)",
			},
			{
				"<leader>xX",
				"<cmd>Trouble diagnostics toggle filter.buf=0<cr>",
				desc = "Buffer Diagnostics (Trouble)",
			},
			{
				"<leader>cs",
				"<cmd>Trouble symbols toggle focus=false<cr>",
				desc = "Symbols (Trouble)",
			},
			{
				"<leader>cl",
				"<cmd>Trouble lsp toggle focus=false win.position=right<cr>",
				desc = "LSP Definitions / references / ... (Trouble)",
			},
			{
				"<leader>xL",
				"<cmd>Trouble loclist toggle<cr>",
				desc = "Location List (Trouble)",
			},
			{
				"<leader>xQ",
				"<cmd>Trouble qflist toggle<cr>",
				desc = "Quickfix List (Trouble)",
			},
		},
		opts = {},
	},

	-- Outline: Code outline
	{
		"hedyhli/outline.nvim",
		cmd = { "Outline", "OutlineOpen" },
		keys = {
			{ "<leader>o", "<cmd>Outline<CR>", desc = "Toggle outline" },
		},
		opts = {},
	},

	-- Hover: Enhanced hover
	{
		"lewis6991/hover.nvim",
		event = "VeryLazy",
		config = function()
			local ok, hover = pcall(require, "hover")
			if not ok then
				return
			end
			hover.setup({
				init = function()
					pcall(require, "hover.providers.lsp")
					pcall(require, "hover.providers.diagnostic")
					pcall(require, "hover.providers.fold_preview")
					pcall(require, "hover.providers.dictionary")
				end,
			})

			-- Mouse support
			vim.keymap.set("n", "<MouseMove>", hover.hover_mouse, { desc = "hover.nvim (mouse)" })
			vim.o.mousemoveevent = true
		end,
	},
}
