return {
	"folke/persistence.nvim",
	event = "BufReadPre",
	config = function()
		local ok, persistence = pcall(require, "persistence")
		if not ok then
			return
		end
		persistence.setup({
			options = { "buffers", "curdir", "tabpages", "winsize", "help", "globals", "skiprtp" },
		})
	end,
	keys = {
		{
			"<leader>ps",
			function()
				require("persistence").load()
			end,
			desc = "Restore Session",
		},
		{
			"<leader>pl",
			function()
				require("persistence").load({ last = true })
			end,
			desc = "Restore Last Session",
		},
		{
			"<leader>pd",
			function()
				require("persistence").stop()
			end,
			desc = "Don't Save Current Session",
		},
	},
}
