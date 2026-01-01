return {
	"nvimtools/none-ls.nvim",
	event = "VeryLazy",
	config = function()
		local ok_null_ls, null_ls = pcall(require, "null-ls")
		local ok_rpc, rpc = pcall(require, "null-ls.rpc")
		if not ok_null_ls or not ok_rpc then
			return
		end

		-- Override the problematic flush function
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
