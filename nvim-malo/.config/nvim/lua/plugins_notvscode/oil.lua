return {
	"stevearc/oil.nvim",
	-- dependencies = { "echasnovski/mini.icons" },
	dependencies = { "nvim-tree/nvim-web-devicons" }, -- use if prefer nvim-web-devicons
	config = function()
		require("oil").setup({
			columns = { "icon" },
			keymaps = {
				insert = {
					["<C-l>"] = "<cmd>lua require('oil').expand()<CR>",
					["<C-h>"] = false,
					["<M-h>"] = "actions.select_split",
					["g."] = "actions.toogle_hidden",
				},
				view_options = {
					show_hidden = true,
				},
			},
		})
		-- Open parent directory in current window
		vim.keymap.set("n", "-", "<CMD>Oil<CR>", { desc = "Open parent directory in current window" })
		-- Open parent directory in floating window
		vim.keymap.set(
			"n",
			"<leader>l",
			require("oil").toggle_float,
			{ desc = "Oil: Open parent directory in floating window" }
		)
	end,
}
