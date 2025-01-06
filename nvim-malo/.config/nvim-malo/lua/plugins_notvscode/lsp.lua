---@diagnostic disable: missing-fields
local lsp_language_servers = {
	"html",
	"tailwindcss",
	"ts_ls",
	"eslint",
	"emmet_language_server",
	"lua_ls",
	"jsonls",
	"biome",
	"gopls",
	"basedpyright",
	"marksman",
	"astro",
	"remark_ls",
	"harper_ls",
	"intelephense",
	"denols",
	"sqlls",
	"bashls",
}
vim.diagnostic.config({ virtual_text = false })
return {

	-- LSP part
	{
		"williamboman/mason.nvim",
		lazy = false,
		opts = {},
		config = function()
			---@diagnostic disable-next-line: missing-fields
			require("mason").setup({
				ui = {
					icons = {
						package_installed = "✓",
						package_pending = "➜",
						package_uninstalled = "✗",
					},
					border = "rounded",
				},
			})
		end,
	},
	{
		"WhoIsSethDaniel/mason-tool-installer.nvim",
		lazy = false,
		config = function()
			require("mason-tool-installer").setup({
				ensure_installed = {
					"stylua",
					"tree-sitter-cli",
					"shfmt",
					"dprint",
					"prettierd",
					"prettier",
					"black",
					"isort",
					"pint",
					"php-cs-fixer",
				},
			})
		end,
	},
	{
		"williamboman/mason-lspconfig.nvim",
		dependencies = {
			{
				"hrsh7th/nvim-cmp",
				enabled = not useBlink,
			},
			{ "saghen/blink.cmp", enabled = useBlink },
		},
		opts = {
			automatic_installation = true,
			ensure_installed = lsp_language_servers,
		},
		config = function(_, opts)
			require("mason-lspconfig").setup(opts)
			local useBlink = require("config").is_enabled.blink

			local capabilities

			if useBlink then
				capabilities = require("blink.cmp").get_lsp_capabilities()
			else
				capabilities = require("cmp_nvim_lsp").default_capabilities()
			end

			capabilities.textDocument.foldingRange = {
				dynamicRegistration = false,
				lineFoldingOnly = true,
			}
			require("mason-lspconfig").setup_handlers({
				-- The first entry (without a key) will be the default handler
				-- and will be called for each installed server that doesn't have
				-- a dedicated handler.
				function(server_name) -- default handler (optional)
					require("lspconfig")[server_name].setup({
						position_encoding = "utf-8",
						capabilities = capabilities,
					})
				end,
				["harper_ls"] = function()
					local lspconfig = require("lspconfig")
					lspconfig.harper_ls.setup({
						position_encoding = "utf-8",
						settings = {
							["harper-ls"] = {
								userDictPath = "~/.local/share/dict.txt",
								fileDictPath = "~/.harper/",
								linters = {
									spell_check = true,
									spelled_numbers = false,
									an_a = true,
									sentence_capitalization = false,
									unclosed_quotes = true,
									wrong_quotes = false,
									long_sentences = true,
									repeated_words = true,
									spaces = true,
									matcher = true,
									correct_number_suffix = true,
									number_suffix_capitalization = true,
									multiple_sequential_pronouns = true,
									linking_verbs = false,
									avoid_curses = true,
									terminating_conjunctions = true,
								},
							},
						},
					})
				end,
				["denols"] = function()
					local lspconfig = require("lspconfig")
					lspconfig.denols.setup({
						capabilities = capabilities,
						root_dir = lspconfig.util.root_pattern("deno.json", "deno.jsonc"),
					})
				end,
				["ts_ls"] = function()
					local lspconfig = require("lspconfig")
					lspconfig.ts_ls.setup({
						capabilities = capabilities,
						root_dir = lspconfig.util.root_pattern("package.json"),
						single_file_support = false,
					})
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
		},
		lazy = false,
		config = function()
			---
			-- UI settings
			---
			local border_style = vim.g.lsp_zero_ui_float_border
			if border_style == nil then
				border_style = "rounded"
			end
			if type(border_style) == "string" then
				vim.diagnostic.config({
					float = { border = border_style },
				})
			end
			local signs = vim.g.lsp_zero_ui_signcolumn
			if (signs == nil and vim.o.signcolumn == "auto") or signs == 1 or signs == true then
				vim.o.signcolumn = "yes"
			end
			vim.keymap.set(
				"n",
				"K",
				"<cmd>Lspsaga hover_doc<cr>",
				{ desc = "Lspsaga: Displays hover information about the symbol under the cursor in a floating window" }
			)
			vim.keymap.set(
				"n",
				"<leader>gd",
				vim.lsp.buf.definition,
				{ desc = " Jumps to the definition of the symbol under the cursor" }
			)
			vim.keymap.set(
				"n",
				"<leader>gr",
				vim.lsp.buf.references,
				{ desc = "Lists all the references to the symbol under the cursor in the quickfix window." }
			)
			vim.keymap.set(
				"n",
				"<leader>ca",
				vim.lsp.buf.code_action,
				{ desc = "Selects a code action available at the current cursor position." }
			)
			vim.keymap.set(
				"n",
				"gD",
				"<cmd>lua vim.lsp.buf.declaration()<cr>",
				{ desc = "Jumps to the declaration of the symbol under the cursor" }
			)
			vim.keymap.set(
				"n",
				"gi",
				"<cmd>lua vim.lsp.buf.implementation()<cr>",
				{ desc = "Lists all the implementations for the symbol under the cursor in the quickfix window" }
			)
			vim.keymap.set(
				"n",
				"go",
				"<cmd>lua vim.lsp.buf.type_definition()<cr>",
				{ desc = "Jumps to the definition of the type of the symbol under the cursor." }
			)
			vim.keymap.set(
				"n",
				"<F2>",
				vim.lsp.buf.rename,
				{ desc = "Renames all references to the symbol under the cursor" }
			)
			vim.keymap.set(
				{ "n", "x", "i" },
				"<F3>",
				"<cmd>lua vim.lsp.buf.format({async = true})<cr><ESC>zzi",
				{ desc = "Format code in current buffer" }
			)
			vim.keymap.set(
				{ "n", "x" },
				"<F3>",
				"<cmd>lua vim.lsp.buf.format({async = true})<cr>zz",
				{ desc = "Format code in current buffer" }
			)
			vim.keymap.set(
				"n",
				"<F4>",
				"<cmd>Lspsaga code_action<cr>",
				{ desc = "Selects a code action available at the current cursor position." }
			)
			vim.keymap.set(
				"n",
				"gl",
				"<cmd>Lspsaga show_line_diagnostics<cr>",
				{ desc = "Show diagnostics in a floating window" }
			)
			vim.keymap.set(
				"n",
				"[d",
				"<cmd>lua vim.diagnostic.jump({ count = -1, float = true })<cr>",
				{ desc = "Move to the previous diagnostic in the current buffer" }
			)
			vim.keymap.set(
				"n",
				"]d",
				"<cmd>lua vim.diagnostic.jump({ count = 1, float = true })<cr>",
				{ desc = "Move to the next diagnostic" }
			)
		end,
	},
	{
		"nvimdev/lspsaga.nvim",
		after = "nvim-lspconfig",
		config = function()
			require("lspsaga").setup({
				code_action_lightbulb = {
					enable = true,
					enable_in_insert = true,
					sign = true,
					sign_priority = 20,
					virtual_text = true,
				},
				ui = {
					border_style = "round",
				},
			})
		end,
	},
}
