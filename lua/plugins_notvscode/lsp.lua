return {
	-- Completion part
	{
		"L3MON4D3/LuaSnip",
		lazy = false,
		dependencies = {
			"rafamadriz/friendly-snippets",
			"saadparwaiz1/cmp_luasnip",
		},
		config = function()
			local ls = require("luasnip")

			vim.keymap.set({ "i" }, "<C-K>", function()
				ls.expand()
			end, { silent = true })
			vim.keymap.set({ "i", "s" }, "<C-L>", function()
				ls.jump(1)
			end, { silent = true })
			vim.keymap.set({ "i", "s" }, "<C-J>", function()
				ls.jump(-1)
			end, { silent = true })

			vim.keymap.set({ "i", "s" }, "<C-E>", function()
				if ls.choice_active() then
					ls.change_choice(1)
				end
			end, { silent = true })
			require("luasnip.loaders.from_vscode").lazy_load()
		end,
	},
	{
		"hrsh7th/cmp-nvim-lsp",
		lazy = false,
		config = true,
	},
	{
		"zbirenbaum/copilot-cmp",
		config = function()
			require("copilot_cmp").setup({
				fix_pairs = true,
			})
		end,
	},
	{
		"hrsh7th/nvim-cmp",
		dependencies = {
			"hrsh7th/cmp-buffer",
			"hrsh7th/cmp-path",
			"hrsh7th/cmp-cmdline",
			"hrsh7th/cmp-nvim-lua",
		},
		lazy = false,
		config = function()
			local cmp = require("cmp")
			local cmp_select_opts = { behavior = cmp.SelectBehavior.Select }

			cmp.setup({
				sources = cmp.config.sources({
					{ name = "copilot" },
					{ name = "nvim_lsp" },
					{ name = "nvim_lua" },
					{ name = "luasnip" },
					{ name = "buffer" },
					{ name = "path" },
				}),
				mapping = cmp.mapping.preset.insert({
					["<C-\\>"] = cmp.mapping.complete(),
					["<C-u>"] = cmp.mapping.scroll_docs(-4),
					["<C-d>"] = cmp.mapping.scroll_docs(4),
					-- ["<C-f>"] = cmp_action.luasnip_jump_forward(),
					-- ["<C-b>"] = cmp_action.luasnip_jump_backward(),
					["<CR>"] = cmp.mapping.confirm({ select = false }),
					["<Up>"] = cmp.mapping.select_prev_item(cmp_select_opts),
					["<Down>"] = cmp.mapping.select_next_item(cmp_select_opts),
					["<C-p>"] = cmp.mapping(function()
						if cmp.visible() then
							cmp.select_prev_item(cmp_select_opts)
						else
							cmp.complete()
						end
					end),
					["<C-n>"] = cmp.mapping(function()
						if cmp.visible() then
							cmp.select_next_item(cmp_select_opts)
						else
							cmp.complete()
						end
					end),
				}),
				snippet = {
					expand = function(args)
						require("luasnip").lsp_expand(args.body)
					end,
				},
				window = {
					completion = cmp.config.window.bordered(),
					documentation = cmp.config.window.bordered(),
				},
				formatting = {
					fields = { "abbr", "menu", "kind" },
					format = function(entry, item)
						local menu_icon = {
							nvim_lsp = "λ",
							luasnip = "⋗",
							buffer = "Ω",
							path = "🖫",
							nvim_lua = "Π",
						}

						item.menu = menu_icon[entry.source.name]
						return item
					end,
				},
			})
		end,
	},
	-- LSP part
	{
		"williamboman/mason.nvim",
		lazy = false,
		opts = {},
		config = function()
			require("mason").setup({
				ensure_installed = {
					"stylua",
					"prettierd",
					"black",
					"tree-sitter-cli",
				},
			})
		end,
	},
	{
		"williamboman/mason-lspconfig.nvim",
		lazy = false,
		opts = {
			auto_install = true,
			ensure_installed = {
				"html",
				"tailwindcss",
				"ts_ls",
				"eslint",
				"emmet_language_server",
				-- "dockerls",
				-- "docker_compose_language_service",
				"gopls",
				"lua_ls",
				-- "jsonls",
				-- "intelephense",
				-- "yamlls",
				"marksman",
				-- "bashls",
				-- "svelte",
				-- "taplo",
				-- "sqls",
				"basedpyright",
			},
		},
	},
	{
		"neovim/nvim-lspconfig",
		lazy = false,
		config = function()
			local capabilities = require("cmp_nvim_lsp").default_capabilities()
			capabilities.textDocument.foldingRange = {
				dynamicRegistration = false,
				lineFoldingOnly = true,
			}

			-- emmet_language_server
			-- htmx
			-- intelephense
			-- biome
			--
			--
			local lspconfig = require("lspconfig")

			-- local servers = { "html", "tailwindcss", "tsserver", "eslint", "emmet_language_server", "dockerls", "docker_compose_language_service", "lua_ls", "jsonls", "biome", "intelephense", "yamlls", "marksman", "bashls", "svelte", "taplo", "sqls", "pyright", "clangd", "gopls", "rust_analyzer", "vimls" }
			local servers = {
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
			}
			for _, lsp in ipairs(servers) do
				lspconfig[lsp].setup({
					capabilities = capabilities,
				})
			end
			---
			-- UI settings
			---
			local border_style = vim.g.lsp_zero_ui_float_border
			if border_style == nil then
				border_style = "rounded"
			end
			if type(border_style) == "string" then
				vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, { border = border_style })

				vim.lsp.handlers["textDocument/signatureHelp"] =
					vim.lsp.with(vim.lsp.handlers.signature_help, { border = border_style })

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
				vim.lsp.buf.hover,
				{ desc = "Displays hover information about the symbol under the cursor in a floating window" }
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
				"<cmd>lua vim.lsp.buf.code_action()<cr>",
				{ desc = "Selects a code action available at the current cursor position." }
			)
			vim.keymap.set("n", "gl", vim.diagnostic.open_float, { desc = "Show diagnostics in a floating window" })
			vim.keymap.set(
				"n",
				"[d",
				vim.diagnostic.goto_prev,
				{ desc = "Move to the previous diagnostic in the current buffer" }
			)
			vim.keymap.set("n", "]d", vim.diagnostic.goto_next, { desc = "Move to the next diagnostic" })
		end,
	},
	{
		"nvimdev/lspsaga.nvim",
	},
}
