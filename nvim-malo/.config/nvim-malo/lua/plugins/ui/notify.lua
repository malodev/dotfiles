-- UI notification and enhancement plugins: Noice, Snacks components, NUI

local function term_nav(dir)
	---@param self snacks.terminal
	return function(self)
		return self:is_floating() and "<c-" .. dir .. ">" or vim.schedule(function()
			vim.cmd.wincmd(dir)
		end)
	end
end

return {
	-- Noice.nvim: Enhanced UI
	{
		"folke/noice.nvim",
		event = "VeryLazy",
		enabled = true,
		opts = {
			lsp = {
				override = {
					["vim.lsp.util.convert_input_to_markdown_lines"] = true,
					["vim.lsp.util.stylize_markdown"] = true,
					["cmp.entry.get_documentation"] = true,
				},
			},
			routes = {
				{
					filter = {
						event = "msg_show",
						any = {
							{ find = "%d+L, %d+B" },
							{ find = "; after #%d+" },
							{ find = "; before #%d+" },
						},
					},
					view = "mini",
				},
			},
			presets = {
				bottom_search = true,
				command_palette = true,
				long_message_to_split = true,
			},
		},
		keys = {
			{ "<leader>sn", "", desc = "+noice" },
			{ "<S-Enter>", function()
				require("noice").redirect(vim.fn.getcmdline())
			end, mode = "c", desc = "Redirect Cmdline" },
			{ "<leader>snl", function()
				require("noice").cmd("last")
			end, desc = "Noice Last Message" },
			{ "<leader>snh", function()
				require("noice").cmd("history")
			end, desc = "Noice History" },
			{ "<leader>sna", function()
				require("noice").cmd("all")
			end, desc = "Noice All" },
			{ "<leader>snd", function()
				require("noice").cmd("dismiss")
			end, desc = "Dismiss All" },
			{ "<leader>snt", function()
				require("noice").cmd("pick")
			end, desc = "Noice Picker" },
			{
				"<c-f>",
				function()
					if not require("noice.lsp").scroll(4) then
						return "<c-f>"
					end
				end,
				silent = true,
				expr = true,
				desc = "Scroll Forward",
				mode = { "i", "n", "s" },
			},
			{
				"<c-b>",
				function()
					if not require("noice.lsp").scroll(-4) then
						return "<c-b>"
					end
				end,
				silent = true,
				expr = true,
				desc = "Scroll Backward",
				mode = { "i", "n", "s" },
			},
		},
		config = function(_, opts)
			local ok, noice = pcall(require, "noice")
			if ok then
				noice.setup(opts)
			end
		end,
	},

	-- NUI: UI component library
	{ "MunifTanjim/nui.nvim", lazy = true },

	-- Snacks.nvim: Modern utilities and components (LazyVim style)
	{
		"folke/snacks.nvim",
		priority = 1000,
		lazy = false,
		---@type snacks.Config
		opts = {
			-- Core features
			bigfile = { enabled = true },
			quickfile = { enabled = true },
			indent = { enabled = true },
			input = { enabled = true },
			scope = { enabled = true },
			scroll = { enabled = true },
			words = { enabled = true },
			toggle = { enabled = true },

			-- UI features
			notifier = {
				enabled = true,
				timeout = 3000,
			},
			statuscolumn = { enabled = true },

			-- Terminal
			terminal = {
				enabled = true,
				win = {
					keys = {
						nav_h = { "<C-h>", term_nav("h"), desc = "Go to Left Window", expr = true, mode = "t" },
						nav_j = { "<C-j>", term_nav("j"), desc = "Go to Lower Window", expr = true, mode = "t" },
						nav_k = { "<C-k>", term_nav("k"), desc = "Go to Upper Window", expr = true, mode = "t" },
						nav_l = { "<C-l>", term_nav("l"), desc = "Go to Right Window", expr = true, mode = "t" },
					},
				},
			},

			-- Dashboard (custom layout with terminal commands)
			dashboard = {
				enabled = true,
				sections = {
					{ section = "header" },
					{
						pane = 2,
						section = "terminal",
						cmd = "colorscript -e square",
						height = 5,
						padding = 1,
					},
					{ section = "keys", gap = 1, padding = 1 },
					{
						pane = 2,
						icon = " ",
						title = "Recent Files",
						section = "recent_files",
						indent = 2,
						padding = 1,
					},
					{ pane = 2, icon = " ", title = "Projects", section = "projects", indent = 2, padding = 1 },
					{
						pane = 2,
						icon = " ",
						title = "Git Status",
						section = "terminal",
						enabled = function()
							return Snacks.git.get_root() ~= nil
						end,
						cmd = "hub status --short --branch --renames",
						height = 5,
						padding = 1,
						ttl = 5 * 60,
						indent = 3,
					},
					{ section = "startup" },
				},
			},

			-- Picker for LSP and files (LazyVim's secret sauce!)
			picker = { enabled = true },

			-- Styles
			styles = {
				notification = {
					wo = { wrap = true },
				},
			},
		},
		init = function()
			vim.api.nvim_create_autocmd("User", {
				pattern = "VeryLazy",
				callback = function()
					_G.Snacks = Snacks or require("snacks")
					-- Setup some globals for debugging
					_G.dd = function(...)
						Snacks.debug.inspect(...)
					end
					_G.bt = function()
						Snacks.debug.backtrace()
					end
					vim.print = _G.dd
				end,
			})
		end,
		keys = {
			-- Notification history
			{ "<leader>n", function()
				Snacks.notifier.show_history()
			end, desc = "Notification History" },
			{ "<leader>un", function()
				Snacks.notifier.hide()
			end, desc = "Dismiss All Notifications" },

			-- Scratch buffers
			{ "<leader>.", function()
				Snacks.scratch()
			end, desc = "Toggle Scratch Buffer" },
			{ "<leader>S", function()
				Snacks.scratch.select()
			end, desc = "Select Scratch Buffer" },

			-- Neovim news
			{
				"<leader>N",
				function()
					Snacks.win({
						file = vim.api.nvim_get_runtime_file("doc/news.txt", false)[1],
						width = 0.6,
						height = 0.6,
						wo = {
							spell = false,
							wrap = false,
							signcolumn = "yes",
							statuscolumn = " ",
							conceallevel = 3,
						},
					})
				end,
				desc = "Neovim News",
			},

			-- Dashboard
			{ "<leader>th", function()
				Snacks.dashboard()
			end, desc = "Dashboard" },

			-- LazyVim-style picker keymaps
			{ "<leader><space>", function()
				Snacks.picker.files()
			end, desc = "Find Files (Root)" },
			{ "<leader>ff", function()
				Snacks.picker.files()
			end, desc = "Find Files" },
			{ "<leader>fg", function()
				Snacks.picker.live_grep()
			end, desc = "Live Grep" },
			{ "<leader>fb", function()
				Snacks.picker.buffers()
			end, desc = "Buffers" },
			{ "<leader>fr", function()
				Snacks.picker.recent()
			end, desc = "Recent Files" },

			-- LSP picker (LazyVim style - replaces lspsaga!)
			{ "gd", function()
				Snacks.picker.lsp_definitions()
			end, desc = "Goto Definition" },
			{ "gr", function()
				Snacks.picker.lsp_references()
			end, desc = "References" },
			{ "gi", function()
				Snacks.picker.lsp_implementations()
			end, desc = "Goto Implementation" },
			{ "gy", function()
				Snacks.picker.lsp_type_definitions()
			end, desc = "Goto Type Definition" },
			{ "<leader>cs", function()
				Snacks.picker.lsp_symbols()
			end, desc = "LSP Symbols" },
			{ "<leader>ca", function()
				Snacks.picker.lsp_code_actions()
			end, mode = { "n", "x" }, desc = "Code Actions" },

			-- Diagnostics picker
			{ "<leader>xd", function()
				Snacks.picker.diagnostics()
			end, desc = "Diagnostics (All)" },
			{ "<leader>xD", function()
				Snacks.picker.diagnostics({ severity = vim.diagnostic.severity.ERROR })
			end, desc = "Diagnostics (Errors)" },
			{ "<leader>xW", function()
				Snacks.picker.diagnostics({ severity = vim.diagnostic.severity.WARN })
			end, desc = "Diagnostics (Warnings)" },

			-- Git picker
			{ "<leader>gf", function()
				Snacks.picker.git_log()
			end, desc = "Git Log File" },
			{ "<leader>gL", function()
				Snacks.picker.git_log({ cwd = true })
			end, desc = "Git Log (All)" },
		},
	},
}
