return {
	{
		"akinsho/bufferline.nvim",
		version = "*",
		dependencies = "nvim-tree/nvim-web-devicons",
		config = function()
			vim.opt.termguicolors = true
			require("bufferline").setup({
				options = {
          indicator = {
                icon = ' ', -- this should be omitted if indicator style is not 'icon'
                style = 'icon' -- 'icon' | 'underline' | 'none',
            },
          -- show_tab_indicators = true,
          separator_style = {'', ''} , -- "slant" | "slope" | "thick" | "thin" | { 'any', 'any' },
					diagnostics = "nvim_lsp",
					---@diagnostic disable-next-line: unused-local
					diagnostics_indicator = function(count, level, diagnostics_dict, context)
						local s = " "
						for e, n in pairs(diagnostics_dict) do
							local sym = e == "error" and " " or (e == "warning" and " " or "")
							s = s .. n .. sym
						end
						return s
					end,
					offsets = {
						{
							filetype = "NvimTree",
							text = "Explorer",
							text_align = "center",
							separator = true,
						},
					},
					groups = {
						items = {
							require("bufferline.groups").builtin.pinned:with({ icon = "" }),
						},
					},
				},
        highlights = {
            indicator_selected = {
                fg = '#aff17e',
                bg = '#000000',
            },
            separator = {
                fg = '#333333',
                bg = '#000000',
            },
        }
			})
		end,
	},
}
