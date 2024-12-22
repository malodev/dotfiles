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
					"black",
					"isort",
					"prettierd",
					"pint",
					"php-cs-fixer",
					"shfmt",
					"prettier",
				},
			})
		end,
	},
	{
		"williamboman/mason-lspconfig.nvim",
		opts = {
			automatic_installation = true,
			ensure_installed = {
				"lua_ls",
				"dprint",
				"intelephense",
				"tailwindcss",
			},
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

				-- Conform will run multiple formatters sequentially
				python = { "isort", "black" },
				-- You can customize some of the format options for the filetype (:help conform.format)
				rust = { "rustfmt", lsp_format = "fallback" },
				php = { { "pint", "php_cs_fixer" } },
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
