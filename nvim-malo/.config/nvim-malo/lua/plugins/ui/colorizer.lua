return {
	"catgoose/nvim-colorizer.lua",
	enabled = function()
		local ok_config, config = pcall(require, "config")
		return ok_config and config.is_enabled.nvchad_colorizer or false
	end,
	event = "BufReadPre",
	opts = { -- set to setup table
		filetypes = { "*" },
		user_default_options = {
			names = true, -- "Name" codes like Blue or blue
			RGB = true, --      #523 hex codes
			RRGGBB = true, --   #345621 hex codes
			RRGGBBAA = true, -- #55887788 hex codes
			AARRGGBB = true, -- 0x88558877 hex codes
			rgb_fn = true, -- CSS rgb(44, 69, 44)  and rgba(55, 69, 55, 0.3) functions
			hsl_fn = true, -- CSS hsl(180, 50%, 50%) and hsla(180, 50%, 50%, 0.3) functions
			css = true, -- Enable all CSS features: rgb_fn, hsl_fn, names, RGB, RRGGBB
			css_fn = true, -- Enable all CSS *functions*: rgb_fn, hsl_fn
			-- Highlighting mode. 'background'|'foreground'|'virtualtext'
			mode = "background", -- Set the display mode
			-- Tailwind colors. boolean|'normal'|'lsp'|'both'. True is same as normal
			tailwind = "both", -- Enable tailwind colors text-purple-500
			-- parsers can contain values used in |user_default_options|
			sass = { enable = false, parsers = { "css" } }, -- Enable sass colors
			-- Virtualtext character to use
			virtualtext = "■■",
			-- Display virtualtext inline with color
			virtualtext_inline = true,
			-- Virtualtext highlight mode: 'background'|'foreground'
			virtualtext_mode = "foreground",
			-- update color values even if buffer is not focused
			-- example use: cmp_menu, cmp_docs
			always_update = false,
		},
		-- all the sub-options of filetypes apply to buftypes
		buftypes = {},
		-- Boolean | List of usercommands to enable
		user_commands = true, -- Enable all or some usercommands
	},
	config = function(_, opts)
		local ok, colorizer = pcall(require, "colorizer")
		if ok then
			colorizer.setup(opts)
		end
	end,
}
