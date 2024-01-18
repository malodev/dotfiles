-- palenight
return {
	"nvim-lualine/lualine.nvim",
	dependencies = { "nvim-tree/nvim-web-devicons" },
	config = function()
		require("lualine").setup({
			options = {
				theme = "palenight",
				section_separators = { left = "", right = "" },
				-- section_separators = { "", "" },
				component_separators = { left = "", right = "" },
				icons_enabled = true,
			},
			sections = {
				lualine_a = { { "mode", icons_enabled = true, icon = "" } },
				lualine_b = { "branch" },
				lualine_c = { "filename" },
				lualine_x = { "encoding", "fileformat", "filetype" },
				lualine_y = { "progress" },
				lualine_z = { "location" },
			},
			inactive_sections = {
				lualine_a = { "mode" },
				lualine_b = { "branch" },
				lualine_c = { "filename" },
				lualine_x = { "encoding", "fileformat", "filetype" },
				lualine_y = { "progress" },
				lualine_z = { "location" },
			},
			winbar = {
				lualine_a = {
					{
						"diff",
						diff_color = {
							-- Same color values as the general color option can be used here.
							added = { fg = "#a6e3a1", bg = "#242324" }, -- Changes the diff's added color
							modified = { fg = "#f9e2af", bg = "#242324" }, -- Changes the diff's modified color
							removed = { fg = "#f38ba8", bg = "#242324" }, -- Changes the diff's removed color you
						},
						symbols = { added = " ", modified = "󰿡 ", removed = " " },
					},
				},
				lualine_b = { { "diagnostic", sources = { "nvim_lsp", "vim_lsp" } } },
				lualine_y = { "selectioncount", "searchcount" },
				lualine_z = { { "mode", icons_enabled = true, icon = "" } },
			},
			extensions = {},
		})
	end,
}
