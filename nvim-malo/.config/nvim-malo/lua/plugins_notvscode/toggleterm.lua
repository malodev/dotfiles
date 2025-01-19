return {
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

		local Terminal = require("toggleterm.terminal").Terminal
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

		local lazygit = Terminal:new({
			cmd = "lazygit",
			dir = "git_dir",
			direction = "float",
			float_opts = {
				border = "double",
			},
			-- function to run on opening the terminal
			on_open = function(term)
				vim.cmd("startinsert!")
				vim.api.nvim_buf_set_keymap(
					term.bufnr,
					"t",
					"<A-q>",
					"<cmd>close<CR>",
					{ noremap = true, silent = true }
				)
			end,
			-- function to run on closing the terminal
			on_close = function(_)
				vim.cmd("startinsert!")
			end,
		})

		function _hTerm_toggle()
			hTerm:toggle()
		end
		function _floatTerm_toggle()
			floatTerm:toggle()
		end
		function _lazygit_toggle()
			lazygit:toggle()
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
}
