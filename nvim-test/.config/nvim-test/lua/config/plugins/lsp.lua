return {
	{
		"neovim/nvim-lspconfig",
		dependencies = {
			{
				"folke/lazydev.nvim",
				ft = "lua",
				opts = {
					library = {
						{ path = "${3rd}/luv/library", words = { "vim%.uv" } },
					},
				},
			},
			-- { 'saghen/blink.cmp' },
		},
		config = function()
			-- local capabilities = require('blink.cmp').get_lsp_capabilities()
			local capabilities = require("cmp_nvim_lsp").default_capabilities()

			local lsp = require("lspconfig")
			lsp.lua_ls.setup({ capabilities = capabilities })
		end,
	},
	{
		"williamboman/mason.nvim",
		config = function()
			require("mason").setup()
		end,
	},
}
