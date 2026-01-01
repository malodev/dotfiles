return {
	"olimorris/codecompanion.nvim",
	dependencies = {
		"nvim-lua/plenary.nvim",
		"nvim-treesitter/nvim-treesitter",
	},
	config = function()
		local ok_codecompanion, codecompanion = pcall(require, "codecompanion")
		local ok_adapters, adapters = pcall(require, "codecompanion.adapters")
		if not ok_codecompanion or not ok_adapters then
			return
		end
		codecompanion.setup({
			adapters = {
				llama3 = function()
					return adapters.extend("ollama", {
						name = "llama3", -- Give this adapter a different name to differentiate it from the default ollama adapter
						schema = {
							model = {
								default = "llama3:latest",
							},
							num_ctx = {
								default = 16384,
							},
							num_predict = {
								default = -1,
							},
						},
					})
				end,
			},
		})
	end,
}
