return {
	"lewis6991/hover.nvim",
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
		vim.keymap.set("n", "<MouseMove>", hover.hover_mouse, { desc = "hover.nvim (mouse)" })
		vim.o.mousemoveevent = true
	end,
}
