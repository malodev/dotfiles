-- Tools: terminal, session, undo tree, formatting, which-key
return {
	-- Which-key: Keybinding help
	{
		"folke/which-key.nvim",
		event = "VeryLazy",
		opts = {
			preset = "helix",
			delay = function(ctx)
				return ctx.plugin and 0 or 200
			end,
			icons = {
				breadcrumb = "»",
				separator = "→",
				group = "+",
			},
			win = {
				border = "rounded",
				padding = { 1, 2, 1, 2 },
				wo = {
					winblend = 10,
				},
			},
			layout = {
				spacing = 3,
			},
		},
		config = function(_, opts)
			local wk = require("which-key")
			local is_virtual_text_enabled = function()
				return vim.diagnostic.config().virtual_text
			end

			wk.setup(opts)
			wk.add({
				{ "<leader>b", group = "Buffers" },
				{ "<leader>c", group = "Coding Stuff" },
				{ "<leader>d", group = "Debugging" },
				{ "<leader>f", group = "Telescope and force" },
				{ "<leader>g", group = "LSP Go to and git" },
				{ "<leader>h", group = "Gitsign hunk" },
				{ "<leader>m", group = "Markdown" },
				{ "<leader>p", group = "Persistence (session)" },
				{ "<leader>r", group = "Rest client" },
				{ "<leader>u", group = "Toggles" },
				{ "<leader>x", group = "Trouble" },
				{
					mode = { "n", "x" },
					{
						"<leader>uv",
						function()
							vim.diagnostic.config({ virtual_text = not is_virtual_text_enabled() })
						end,
						desc = is_virtual_text_enabled() and "Disable Virtual Text Diagnostic" or "Enable Virtual Text Diagnostic",
						icon = function()
							if is_virtual_text_enabled() then
								return { icon = " ", hl = "DiagnosticInfo" }
							else
								return { icon = " ", hl = "DiagnosticWarn" }
							end
						end,
					},
				},
			}, { prefix = "<leader>" })
		end,
		keys = {
			{
				"<leader>?",
				function()
					require("which-key").show({ global = true })
				end,
				desc = "Which-key global",
			},
		},
	},

	-- Toggleterm: Terminal management
	{
		"akinsho/toggleterm.nvim",
		event = "VimEnter",
		config = function()
			local status_ok, toggleterm = pcall(require, "toggleterm")

			if not status_ok then
				return
			end

			toggleterm.setup({
				size = 30,
				open_mapping = [[<A-t>]],
				shade_filetypes = {},
				shade_terminals = true,
				shading_factor = "1",
				start_in_insert = true,
				persist_size = true,
				direction = "tab",
				float_opts = {
					border = "curved",
				},
			})

			local ok_terminal, terminal = pcall(require, "toggleterm.terminal")
			if not ok_terminal then
				return
			end
			local Terminal = terminal.Terminal
			local hTerm = Terminal:new({
				size = 10,
				direction = "horizontal",
				float_opts = {
					border = "curved",
				},
				on_open = function(term)
					vim.api.nvim_buf_set_keymap(
						term.bufnr,
						"t",
						"<C-k>",
						"<cmd>wincmd k<CR>",
						{ noremap = true, silent = true }
					)
					vim.api.nvim_buf_set_keymap(
						term.bufnr,
						"t",
						"<A-->",
						"<cmd>close<CR>",
						{ noremap = true, silent = true }
					)
				end,
			})
			local floatTerm = Terminal:new({
				direction = "float",
				float_opts = {
					border = "curved",
				},
				on_open = function(term)
					vim.api.nvim_buf_set_keymap(
						term.bufnr,
						"t",
						"<A-i>",
						"<cmd>close<CR>",
						{ noremap = true, silent = true }
					)
				end,
			})

			function _hTerm_toggle()
				hTerm:toggle()
			end
			function _floatTerm_toggle()
				floatTerm:toggle()
			end

			vim.api.nvim_set_keymap(
				"n",
				"<A-->",
				"<cmd>lua _hTerm_toggle()<CR>",
				{ noremap = true, silent = true, desc = "Toggle horizontal terminal" }
			)
			vim.api.nvim_set_keymap(
				"n",
				"<A-i>",
				"<cmd>lua _floatTerm_toggle()<CR>",
				{ noremap = true, silent = true, desc = "Toggle float terminal" }
			)
		end,
	},

	-- Persistence: Session management
	{
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
	},

	-- Undotree: Undo history visualization
	{
		"mbbill/undotree",
		keys = {
			{ "<leader>u", "<cmd>UndotreeToggle<cr>", desc = "Undo tree" },
		},
	},

	-- Format on save: Auto-formatting
	{
		"elentok/format-on-save.nvim",
		event = { "BufReadPre", "BufNewFile" },
		config = function()
			local ok_format, format_on_save = pcall(require, "format-on-save")
			local ok_formatters, formatters = pcall(require, "format-on-save.formatters")
			if not ok_format or not ok_formatters then
				return
			end

			format_on_save.setup({
				exclude_path_patterns = {
					"/node_modules/",
					".local/share/nvim/lazy",
				},
				formatter_by_ft = {
					go = formatters.lsp,
					css = formatters.prettierd,
					html = formatters.prettierd,
					javascript = formatters.prettierd,
					javascriptreact = formatters.prettierd,
					json = formatters.prettierd,
					tyepscript = formatters.prettierd,
					typescriptreact = formatters.prettierd,
					markdown = formatters.prettierd,
					lua = formatters.stylua,
					python = formatters.black,
				},
			})
		end,
	},
}
