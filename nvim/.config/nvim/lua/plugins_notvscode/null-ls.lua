return {
	"nvimtools/none-ls.nvim",
	event = "VeryLazy",
	config = function()
		local null_ls = require("null-ls")

		-- Override the problematic flush function
		local rpc = require("null-ls.rpc")
		rpc.flush = function() end -- Replace with empty function
		null_ls.setup({
			sources = {
				null_ls.builtins.formatting.stylua,
				null_ls.builtins.formatting.prettierd,
			},
			update_in_insert = false,
			debug = false,
		})
		vim.keymap.set("n", "<leader>gf", "<cmd>lua vim.lsp.buf.format()<CR>", { noremap = true })
	end,
}
