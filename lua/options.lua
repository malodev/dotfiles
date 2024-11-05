vim.cmd("set expandtab")
vim.cmd("set tabstop=2")
vim.cmd("set softtabstop=2")
vim.cmd("set shiftwidth=2")
vim.cmd("set ignorecase")
vim.cmd("set smartcase")
vim.cmd("set mousemodel=extend")

vim.keymap.set("n", "<Space>", "<Nop>", { silent = true, remap = false })
vim.g.mapleader = " "
vim.g.maplocalleader = " "
vim.opt.clipboard = "unnamedplus" -- use system clipboard
vim.opt.number = true -- show absolute number
vim.opt.relativenumber = true -- add numbers to each line on the left side

if not vim.g.vscode then
	local autocmd = vim.api.nvim_create_autocmd
	local augroup = vim.api.nvim_create_augroup

	-- Read the HOME environment variable
	local home = os.getenv("HOME")

	-- the following lines are for relative number to be disabled in insert mode
	local number_toggle = augroup("numbertoggle", { clear = true })

	autocmd({ "InsertLeave" }, {
		pattern = "*",
		command = "setlocal relativenumber",
		group = number_toggle,
	})

	autocmd({ "InsertEnter" }, {
		pattern = "*",
		command = "setlocal norelativenumber",
		group = number_toggle,
	})

	-- auto-reload files when modified externally
	-- https://unix.stackexchange.com/a/383044
	vim.o.autoread = true
	autocmd({ "BufEnter", "CursorHold", "CursorHoldI", "FocusGained" }, {
		command = "if mode() != 'c' | checktime | endif",
		pattern = { "*" },
	})

	-- Autocmd commands
	-- -- Persistent Folds
	-- local save_fold = augroup("Persistent Folds", { clear = true })
	-- autocmd("BufWinLeave", {
	-- 	pattern = "*.*",
	-- 	callback = function()
	-- 		vim.cmd.mkview()
	-- 	end,
	-- 	group = save_fold,
	-- })
	-- autocmd("BufWinEnter", {
	-- 	pattern = "*.*",
	-- 	callback = function()
	-- 		vim.cmd.loadview({ mods = { emsg_silent = true } })
	-- 	end,
	-- 	group = save_fold,
	-- })

	-- Persistent Cursor
	autocmd("BufReadPost", {
		callback = function()
			local mark = vim.api.nvim_buf_get_mark(0, '"')
			local lcount = vim.api.nvim_buf_line_count(0)
			if mark[1] > 0 and mark[1] <= lcount then
				pcall(vim.api.nvim_win_set_cursor, 0, mark)
			end
		end,
	})

	-- Cursor Line on each window
	autocmd({ "InsertLeave", "WinEnter" }, {
		callback = function()
			local ok, cl = pcall(vim.api.nvim_win_get_var, 0, "auto-cursorline")
			if ok and cl then
				vim.wo.cursorline = true
				vim.api.nvim_win_del_var(0, "auto-cursorline")
			end
		end,
	})
	autocmd({ "InsertEnter", "WinLeave" }, {
		callback = function()
			local cl = vim.wo.cursorline
			if cl then
				vim.api.nvim_win_set_var(0, "auto-cursorline", cl)
				vim.wo.cursorline = false
			end
		end,
	})

	-- Set filetype for i3 config files
	autocmd({ "BufRead", "BufNewFile" }, {
		pattern = home .. "/.config/i3/*.conf",
		callback = function()
			vim.bo.filetype = "i3config"
		end,
	})

	function _G.set_terminal_keymaps()
		local opts = { noremap = true, silent = true, buffer = 0 }
		vim.keymap.set("t", "<C-a>", "<A-Down>i", opts)
		vim.keymap.set("t", "<C-e>", "<A-Up>", opts)
		vim.keymap.set("t", "<esc>", [[<C-\><C-n>]], opts)
		vim.keymap.set("t", "jk", [[<C-\><C-n>]], opts)
		vim.keymap.set("t", "<C-h>", [[<Cmd>wincmd h<CR>]], opts)
		vim.keymap.set("t", "<C-j>", [[<Cmd>wincmd j<CR>]], opts)
		vim.keymap.set("t", "<C-k>", [[<Cmd>wincmd k<CR>]], opts)
		vim.keymap.set("t", "<C-l>", [[<Cmd>wincmd l<CR>]], opts)
		vim.keymap.set("t", "<C-w>", [[<C-\><C-n><C-w>]], opts)
	end

	-- if you only want these mappings for toggle term use term://*toggleterm#* instead
	vim.cmd("autocmd! TermOpen term://* lua set_terminal_keymaps()")

	vim.api.nvim_create_autocmd("BufEnter", {
		nested = true,
		callback = function()
			local api = require("nvim-tree.api")

			-- Only 1 window with nvim-tree left: we probably closed a file buffer
			if #vim.api.nvim_list_wins() == 1 and api.tree.is_tree_buf() then
				-- Required to let the close event complete. An error is thrown without this.
				vim.defer_fn(function()
					-- close nvim-tree: will go to the last hidden buffer used before closing
					api.tree.toggle({ find_file = true, focus = true })
					-- re-open nivm-tree
					api.tree.toggle({ find_file = true, focus = true })
					-- nvim-tree is still the active window. Go to the previous window.
					vim.cmd("wincmd p")
				end, 0)
			end
		end,
	})

	local nvimTreeFocusOrToggle = function()
		local nvimTree = require("nvim-tree.api")
		local currentBuf = vim.api.nvim_get_current_buf()
		local currentBufFt = vim.api.nvim_buf_get_option(currentBuf, "filetype")
		if currentBufFt == "NvimTree" then
			vim.cmd("wincmd w")
		else
			nvimTree.tree.focus()
		end
	end

	-- vim.keymap.set("n", "<leader>tn", nvimTreeFocusOrToggle)
	vim.keymap.set("n", "<A-n>", nvimTreeFocusOrToggle)

	-- -- Set vim.g.nvimtree_was_open to 1 when the NvimTree window is opened
	-- vim.cmd("autocmd FileType NvimTree let g:nvimtree_was_open = 1")
	--
	-- -- Set vim.g.nvimtree_was_open to 0 when the NvimTree window is closed
	-- vim.cmd("autocmd BufWinLeave NvimTree let g:nvimtree_was_open = 0")
	--
	-- -- Function to save the variable
	-- function _G.save_nvimtree_state()
	-- 	local file = io.open(vim.fn.stdpath("data") .. "/nvimtree_was_open.txt", "w")
	-- 	if file then
	-- 		file:write(vim.g.nvimtree_was_open)
	-- 		file:close()
	-- 		-- vim.api.nvim_echo(
	-- 		-- 	{ { "Save State to " .. vim.fn.stdpath("data") .. "/nvimtree_was_open.txt", "DiagnosticInfo" } },
	-- 		-- 	true,
	-- 		-- 	{}
	-- 		-- )
	-- 	end
	-- end
	--
	-- -- Function to load the variable
	-- function _G.load_nvimtree_state()
	-- 	local file = io.open(vim.fn.stdpath("data") .. "/nvimtree_was_open.txt", "r")
	-- 	if file then
	-- 		vim.g.nvimtree_was_open = file:read("*a")
	-- 		-- vim.api.nvim_echo({ { "Load State: " .. vim.g.nvimtree_was_open, "DiagnosticInfo" } }, true, {})
	--
	-- 		file:close()
	-- 		if vim.g.nvimtree_was_open == "1" then
	-- 			local api = require("nvim-tree.api")
	-- 			api.tree.open()
	-- 			-- vim.cmd("NvimTreeOpen")
	-- 			-- vim.cmd("wincmd w")
	-- 		end
	-- 	end
	-- end
end
