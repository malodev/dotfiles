return {
	"folke/trouble.nvim",
	dependencies = { "nvim-tree/nvim-web-devicons" },
	opts = {},
	keys = {
		{ "<leader>xx", "<cmd>lua require('trouble').toggle()<CR>" },
		{ "<leader>xw", "<cmd>lua require('trouble').toggle('workspace_diagnostics')<CR>" },
		{ "<leader>xd", "<cmd>lua require('trouble').toggle('document_diagnostics')<CR>" },
		{ "<leader>xq", "<cmd>lua require('trouble').toggle('quickfix')<CR>" },
		{ "<leader>xl", "<cmd>lua require('trouble').toggle('loclist')<CR>" },
		{ "gR", "<cmd>lua require('trouble').toggle('lsp_references')<CR>" },
	},
	config = function()
		vim.keymap.set("n", "<leader>tt", "<cmd>TroubleToggle<cr>", { silent = true, noremap = true })
	end,
}
