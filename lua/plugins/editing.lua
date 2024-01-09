return {
	{
		"windwp/nvim-autopairs", -- plugin 1
		event = { "InsertEnter" },
		config = function()
			local npairs_status_ok, npairs = pcall(require, "nvim-autopairs")
			if not npairs_status_ok then
				return
			end

			npairs.setup({})
		end,
	},
	{
		"windwp/nvim-ts-autotag", -- plugin 2
		event = { "InsertEnter" },

		config = function()
			local autotag_status_ok, autotag = pcall(require, "nvim-ts-autotag")

			if not autotag_status_ok then
				return
			end

			autotag.setup({})
		end,
	},
	{
		"numToStr/Comment.nvim",
		opts = {
			-- add any options here
		},
		lazy = false,
	},
	{
		"lukas-reineke/indent-blankline.nvim",
		main = "ibl",
		config = function()
			local highlight = {
				"RainbowRed",
				"RainbowYellow",
				"RainbowBlue",
				"RainbowOrange",
				"RainbowGreen",
				"RainbowViolet",
				"RainbowCyan",
			}
			local spc_highlight = {
				"CursorColumn",
				"Whitespace",
			}

			local hooks = require("ibl.hooks")
			-- create the highlight groups in the highlight setup hook, so they are reset
			-- every time the colorscheme changes
			hooks.register(hooks.type.HIGHLIGHT_SETUP, function()
				vim.api.nvim_set_hl(0, "RainbowRed", { fg = "#E06C75" })
				vim.api.nvim_set_hl(0, "RainbowYellow", { fg = "#E5C07B" })
				vim.api.nvim_set_hl(0, "RainbowBlue", { fg = "#61AFEF" })
				vim.api.nvim_set_hl(0, "RainbowOrange", { fg = "#D19A66" })
				vim.api.nvim_set_hl(0, "RainbowGreen", { fg = "#98C379" })
				vim.api.nvim_set_hl(0, "RainbowViolet", { fg = "#C678DD" })
				vim.api.nvim_set_hl(0, "RainbowCyan", { fg = "#56B6C2" })
			end)

			require("ibl").setup({
				-- indent = { highlight = highlight, char = "" },
				indent = { highlight = highlight, char = "" },
				whitespace = {
					highlight = spc_highlight,
					remove_blankline_trail = false,
				},
				scope = { enabled = false },
			})
		end,
	},
	{
		"dhruvasagar/vim-prosession",
		dependencies = {
			"tpope/vim-obsession",
		},
	},
	{
		"norcalli/nvim-colorizer.lua",
		config = function()
			require("colorizer").setup({
				"*", -- Highlight all files, but customize some others.
				css = { names = true, css = true }, -- Enable parsing rgb(...) functions in css.
				html = { names = false, css = true }, -- Disable parsing "names" like Blue or Gray
			})
		end,
	},
}
