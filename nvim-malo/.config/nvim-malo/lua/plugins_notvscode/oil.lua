-- Declare a global function to retrieve the current directory
function _G.get_oil_winbar()
	local dir = require("oil").get_current_dir()
	if dir then
		return vim.fn.fnamemodify(dir, ":~")
	else
		-- If there is no current directory (e.g. over ssh), just show the buffer name
		return vim.api.nvim_buf_get_name(0)
	end
end

return {
	"stevearc/oil.nvim",
	dependencies = { "echasnovski/mini.nvim" },
	-- dependencies = { "nvim-tree/nvim-web-devicons" }, -- use if prefer nvim-web-devicons
	config = function()
		local detail = false
		require("oil").setup({
			win_options = {
				winbar = "%!v:lua.get_oil_winbar()",
			},
			columns = { "icon" },
			keymaps = {
				["<C-o>"] = { "actions.select", opts = { vertical = true } },
				["<C-s>"] = { "<CMD>w<CR>", desc = "Save changes" },
				["<C-.>"] = { "actions.toggle_hidden", desc = "Toggle hidden files" },
				["gd"] = {
					desc = "Toggle file detail view",
					callback = function()
						detail = not detail
						if detail then
							require("oil").set_columns({ "icon", "permissions", "size", "mtime" })
						else
							require("oil").set_columns({ "icon" })
						end
					end,
				},
			},
			view_options = {
				show_hidden = true,
			},
		})
		-- Open parent directory in current window
		vim.keymap.set("n", "-", "<CMD>Oil<CR>", { desc = "Open parent directory in current window" })
		-- Open parent directory in floating window
		vim.keymap.set(
			"n",
			"<leader>fl",
			require("oil").toggle_float,
			{ desc = "Oil: Open parent directory in floating window" }
		)
	end,
}
