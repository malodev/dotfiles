local lsp_servers = {
	"lua_ls",
	"intelephense",
	"tailwindcss",
	"cssls",
	"bashls",
	"cssls",
	"html",
	"jsonls",
	"ts_ls",
}
return {
	{
		"williamboman/mason.nvim",
		config = function()
			require("mason").setup({
				ui = {
					icons = {
						package_installed = "✓",
						package_pending = "➜",
						package_uninstalled = "✗",
					},
				},
			})
		end,
	},
	{
		"WhoIsSethDaniel/mason-tool-installer.nvim",
		config = function()
			require("mason-tool-installer").setup({
				ensure_installed = {
					"stylua",
					"dprint",
					"prettierd",
					"php-cs-fixer",
					"shfmt",
				},
			})
		end,
	},
	{
		"williamboman/mason-lspconfig.nvim",
		dependencies = {
			{ "hrsh7th/nvim-cmp" },
			{ "hrsh7th/cmp-nvim-lsp" },
		},
		opts = {
			automatic_installation = true,
			ensure_installed = lsp_servers,
		},
		config = function(_, opts)
			require("mason-lspconfig").setup(opts)

			local capabilities = require("cmp_nvim_lsp").default_capabilities()
			require("mason-lspconfig").setup_handlers({
				-- The first entry (without a key) will be the default handler
				-- and will be called for each installed server that doesn't have
				-- a dedicated handler.
				function(server_name) -- default handler (optional)
					require("lspconfig")[server_name].setup({ capabilities = capabilities })
				end,
			})
		end,
	},
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
	},
	{
		"stevearc/conform.nvim",
		opts = {
			formatters_by_ft = {
				-- Conform will run the first available formatter
				-- javascript = { "prettierd", "prettier", stop_after_first = true },
				["javascript"] = { "dprint", { "prettierd", "prettier" } },
				["javascriptreact"] = { "dprint" },
				["typescript"] = { "dprint", { "prettierd", "prettier" } },
				["typescriptreact"] = { "dprint" },
				lua = { "stylua" },
				sh = { "shfmt" },

				php = { "php_cs_fixer" },
			},
			formatters = {
				dprint = {
					condition = function(_, ctx)
						return vim.fs.find({ "dprint.json" }, { path = ctx.filename, upward = true })[1]
					end,
				},
			},
			format_on_save = {
				-- These options will be passed to conform.format()
				timeout_ms = 500,
				lsp_format = "fallback",
			},
		},
		config = function(_, opts)
			local conform = require("conform")
			conform.setup(opts)
			vim.keymap.set({ "n", "v" }, "<leader>cf", conform.format, { desc = "Format file" })
		end,
	},
}
