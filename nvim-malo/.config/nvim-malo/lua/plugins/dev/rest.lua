-- REST clients: kulala.nvim
return {
	-- REST.nvim: REST client (disabled in favor of kulala)
	{
		"rest-nvim/rest.nvim",
		enabled = false,
		dependencies = {
			"nvim-treesitter/nvim-treesitter",
			opts = function(_, opts)
				opts.ensure_installed = opts.ensure_installed or {}
				table.insert(opts.ensure_installed, "http")
			end,
		},
	},

	-- Kulala: Modern REST client
	{
		"mistweaverco/kulala.nvim",
		ft = { "http", "rest" },
		keys = {
			{ "<leader>Rs", desc = "Send request" },
			{ "<leader>Ra", desc = "Send all requests" },
			{ "<leader>Rb", desc = "Open scratchpad" },
		},
		opts = {
			global_keymaps = true,
		},
	},
}
