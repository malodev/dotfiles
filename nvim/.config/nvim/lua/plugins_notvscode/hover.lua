return {
	"lewis6991/hover.nvim",
	config = function()
		require("hover").setup({
			init = function()
				require("hover.providers.lsp")
				require("hover.providers.diagnostic")
				require("hover.providers.fold_preview")
				require("hover.providers.dictionary")
			end,
		})
		-- Setup keymaps
		-- vim.keymap.set("n", "K", require("hover").hover, { desc = "hover.nvim" })
		-- vim.keymap.set("n", "gK", require("hover").hover_select, { desc = "hover.nvim (select)" })
		-- vim.keymap.set("n", "<C-p>", function()
		-- 	require("hover").hover_switch("previous")
		-- end, { desc = "hover.nvim (previous source)" })
		-- vim.keymap.set("n", "<C-n>", function()
		-- 	require("hover").hover_switch("next")
		-- end, { desc = "hover.nvim (next source)" })

		-- Mouse support
		vim.keymap.set("n", "<MouseMove>", require("hover").hover_mouse, { desc = "hover.nvim (mouse)" })
		vim.o.mousemoveevent = true
	end,
}
