return {
	"ggandor/leap.nvim",
	opts = {
		highlight_unlabeled_phase_one_targets = true,
	},
	config = function(_, opts)
		local leap = require("leap")
		for k, v in pairs(opts) do
			leap.opts[k] = v
		end
		-- Add 'custom' mappings
		vim.keymap.set({ "n", "x", "o" }, "f", "<Plug>(leap-forward)", { desc = "Leap Forward" })
		vim.keymap.set({ "n", "x", "o" }, "F", "<Plug>(leap-backward)", { desc = "Leap Backward" })
		vim.keymap.set({ "n", "x", "o" }, "gF", "<Plug>(leap-from-window)", { desc = "Leap From Window" })
		-- vim.keymap('n', '<leader>l', '<cmd>lua require("leap").leap()<CR>', { noremap = true, silent = true })
	end,
}
