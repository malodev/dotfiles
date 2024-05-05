return {
	"nvim-tree/nvim-tree.lua",
	version = "*",
	lazy = false,
	dependencies = {
		"nvim-tree/nvim-web-devicons",
	},
	config = function()
		require("nvim-tree").setup({})
	end,
	keys = {
		{ "<C-n>", "<cmd>NvimTreeToggle<CR><C-W><C-W>", desc = "Toogle nvim-tree" },
		{ "<C-b>", "<cmd>NvimTreeFindFile<CR>", desc = "Show the current buffer in NvimTree" },
		{ "<leader>e", "<cmd>NvimTreeFocus<CR>", desc = "Focus on NvimTree" },
	},
}
