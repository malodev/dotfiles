return {
	{
		"iamcco/markdown-preview.nvim",
		build = "cd app && npm install",
		-- using npm to install rather than the vim function leads to significantly faster startup time
		init = function()
			vim.g.mkdp_filetypes = { "markdown" }
		end,
		config = function()
			vim.g.mkdp_port = 19400
			vim.keymap.set("n", "<leader>mm", "<Plug>MarkdownPreview", { desc = " Start Markdown Preview" })
			vim.keymap.set("n", "<leader>mh", "<Plug>MarkdownPreviewStop", { desc = " Halt Markdown Preview" })
			vim.keymap.set("n", "<leader>mt", "<Plug>MarkdownPreviewToggle", { desc = " Start Markdown Preview" })
		end,
	},
}
