return {
	"stevearc/oil.nvim",
	-- dependencies = { "echasnovski/mini.icons" },
	dependencies = { "nvim-tree/nvim-web-devicons" }, -- use if prefer nvim-web-devicons
	config = function()
		require("oil").setup({
			columns = { "icon" },
			keymaps = {
				insert = {
					["<C-l>"] = "<cmd>lua require('oil').expand()<CR>",
					["<C-h>"] = false,
					["<M-h>"] = "actions.select_split",
					["g."] = "actions.toogle_hidden",
				},
			},
			view_options = {
				-- Show files and directories that start with "."
				show_hidden = true,
				-- This function defines what is considered a "hidden" file
				is_hidden_file = function(name, bufnr)
					local m = name:match("^%.")
					return m ~= nil
				end,
				-- This function defines what will never be shown, even when `show_hidden` is set
				is_always_hidden = function(name, bufnr)
					return false
				end,
				-- Sort file names with numbers in a more intuitive order for humans.
				-- Can be "fast", true, or false. "fast" will turn it off for large directories.
				natural_order = "fast",
				-- Sort file and directory names case insensitive
				case_insensitive = false,
				sort = {
					-- sort order can be "asc" or "desc"
					-- see :help oil-columns to see which columns are sortable
					{ "type", "asc" },
					{ "name", "asc" },
				},
				-- Customize the highlight group for the file name
				highlight_filename = function(entry, is_hidden, is_link_target, is_link_orphan)
					return nil
				end,
			},
		})
		-- Open parent directory in current window
		vim.keymap.set("n", "-", "<CMD>Oil<CR>", { desc = "Open parent directory in current window" })
		-- Open parent directory in floating window
		vim.keymap.set(
			"n",
			"<leader>l",
			require("oil").toggle_float,
			{ desc = "Oil: Open parent directory in floating window" }
		)
	end,
}
