-- palenight
return {
	"nvim-lualine/lualine.nvim",
	dependencies = {
		"nvim-tree/nvim-web-devicons",
		"AndreM222/copilot-lualine",
	},
	config = function()
		local ok_config, config = pcall(require, "config")
		local ok_lualine, lualine = pcall(require, "lualine")
		if not ok_config or not ok_lualine then
			return
		end
		local icons = config.icons
		lualine.setup({
			options = {
				theme = "auto",
				section_separators = { left = "", right = "" },
				-- section_separators = { "", "" },
				-- component_separators = { left = "", right = "" },
				component_separators = { left = "", right = "" },
				icons_enabled = true,
				globalstatus = false,
				ignore_focus = { "NvimTree" },
			},
			sections = {
				lualine_a = { { "mode", icons_enabled = true, icon = "" } },
				lualine_b = { "branch" },
				lualine_c = {
					{
						"diagnostics",
						symbols = {
							error = icons.diagnostics.Error,
							warn = icons.diagnostics.Warn,
							info = icons.diagnostics.Info,
							hint = icons.diagnostics.Hint,
						},
					},
					{ "filetype", icon_only = true, separator = "", padding = { left = 1, right = 0 } },
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
					{
						"diff",
						symbols = {
							added = icons.git.added,
							modified = icons.git.modified,
							removed = icons.git.removed,
						},
						source = function()
							local gitsigns = vim.b.gitsigns_status_dict
							if gitsigns then
								return {
									added = gitsigns.added,
									modified = gitsigns.changed,
									removed = gitsigns.removed,
								}
							end
						end,
					},
				},
				lualine_y = {
					{ "progress", separator = " ", padding = { left = 1, right = 0 } },
					{ "location", padding = { left = 0, right = 1 } },
				},
				lualine_z = {
					function()
						return " " .. os.date("%R")
					end,
				},
			},
			inactive_sections = {
				-- lualine_a = { "mode" },
				-- lualine_b = { "branch" },
				-- lualine_c = { "filename" },
				-- lualine_x = { "copilot", "encoding", "fileformat", "filetype" },
				-- lualine_y = { "progress" },
				-- lualine_z = { "location" },
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
