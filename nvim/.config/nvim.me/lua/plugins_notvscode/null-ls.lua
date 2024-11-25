return {
	"nvimtools/none-ls.nvim",
	event = "VeryLazy",
	config = function()
		local null_ls = require("null-ls")

		null_ls.setup({
			sources = {
				null_ls.builtins.formatting.stylua,
				null_ls.builtins.formatting.prettierd,
			},
		})
		vim.keymap.set("n", "<leader>gf", "<cmd>lua vim.lsp.buf.format()<CR>", { noremap = true })
	end,
}
