-- palenight
return {
	"nvim-lualine/lualine.nvim",
	dependencies = {
		"nvim-tree/nvim-web-devicons",
		"AndreM222/copilot-lualine",
	},
	config = function()
		require("lualine").setup({
			options = {
				theme = "palenight",
				section_separators = { left = "", right = "" },
				-- section_separators = { "", "" },
				component_separators = { left = "", right = "" },
				icons_enabled = true,
				globalstatus = false,
				ignore_focus = { "NvimTree" },
			},
			sections = {
				lualine_a = { { "mode", icons_enabled = true, icon = "" } },
				lualine_b = { "branch" },
				lualine_c = {
					"filename",
					-- {
					-- 	require("noice").api.statusline.mode.get,
					-- 	cond = require("noice").api.statusline.mode.has,
					-- 	color = { fg = "#ff9e64" },
					-- },
				},
				lualine_x = {
					{
						"rest",
						icon = "",
						fg = "#428890",
					},
					{ "copilot", show_colors = true, show_loading = true },
					"encoding",
					"fileformat",
					"filetype",
				},
				lualine_y = { "progress" },
				lualine_z = { "location" },
			},
			inactive_sections = {
				lualine_a = { "mode" },
				lualine_b = { "branch" },
				lualine_c = { "filename" },
				lualine_x = { "copilot", "encoding", "fileformat", "filetype" },
				lualine_y = { "progress" },
				lualine_z = { "location" },
			},
			-- winbar = {
			-- 	lualine_a = {
			-- 		{
			-- 			"diff",
			-- 			diff_color = {
			-- 				-- same color values as the general color option can be used here.
			-- 				added = { fg = "#a6e3a1", bg = "#242324" }, -- changes the diff's added color
			-- 				modified = { fg = "#f9e2af", bg = "#242324" }, -- changes the diff's modified color
			-- 				removed = { fg = "#f38ba8", bg = "#242324" }, -- changes the diff's removed color you
			-- 			},
			-- 			symbols = { added = " ", modified = "󰿡 ", removed = " " },
			-- 		},
			-- 	},
			-- 	lualine_c = { "hostname" },
			-- 	-- lualine_c = { { "diagnostic", sources = { "nvim_lsp", "vim_lsp" } } },
			-- 	lualine_y = { "selectioncount", "searchcount" },
			-- 	lualine_z = { { "mode", icons_enabled = true, icon = "" } },
			-- },
			extensions = {},
		})
	end,
}
