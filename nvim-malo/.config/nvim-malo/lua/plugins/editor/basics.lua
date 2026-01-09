-- Basic editing plugins
return {
	{
		"windwp/nvim-ts-autotag",
		event = "InsertEnter",
		opts = {},
	},
	{
		"numToStr/Comment.nvim",
		opts = {},
		lazy = false,
	},
	{
		"lukas-reineke/indent-blankline.nvim",
		main = "ibl",
		event = "VeryLazy",
		config = function()
			local ok_ibl_hooks, hooks = pcall(require, "ibl.hooks")
			local ok_ibl, ibl = pcall(require, "ibl")
			if not ok_ibl or not ok_ibl_hooks then
				return
			end

			local highlight = {
				"RainbowRed",
				"RainbowYellow",
				"RainbowBlue",
				"RainbowOrange",
				"RainbowGreen",
				"RainbowViolet",
				"RainbowCyan",
			}

			hooks.register(hooks.type.HIGHLIGHT_SETUP, function()
				vim.api.nvim_set_hl(0, "RainbowRed", { fg = "#E06C75" })
				vim.api.nvim_set_hl(0, "RainbowYellow", { fg = "#E5C07B" })
				vim.api.nvim_set_hl(0, "RainbowBlue", { fg = "#61AFEF" })
				vim.api.nvim_set_hl(0, "RainbowOrange", { fg = "#D19A66" })
				vim.api.nvim_set_hl(0, "RainbowGreen", { fg = "#98C379" })
				vim.api.nvim_set_hl(0, "RainbowViolet", { fg = "#C678DD" })
				vim.api.nvim_set_hl(0, "RainbowCyan", { fg = "#56B6C2" })
			end)

			vim.g.rainbow_delimiters = { highlight = highlight }
			ibl.setup({
				scope = { highlight = highlight },
			})
			hooks.register(hooks.type.SCOPE_HIGHLIGHT, hooks.builtin.scope_highlight_from_extmark)
		end,
	},
	{
		"monaqa/dial.nvim",
		event = "VeryLazy",
		config = function()
			local augend = require("dial.augend")
			require("dial.config").augends:register_group({
				default = {
					augend.integer.alias.decimal_int,
					augend.date.alias["%Y-%m-%d"],
					augend.date.alias["%d/%m/%y"],
					augend.date.alias["%d/%m/%Y"],
					augend.date.alias["%H:%M"],
					augend.constant.alias.bool,
					augend.integer.alias.hex,
					augend.hexcolor.new({ case = "lower" }),
					augend.constant.new({ elements = { "let", "const" } }),
				},
			})
			vim.keymap.set("n", "<C-=>", function()
				require("dial.map").manipulate("increment", "normal")
			end, { desc = "Increment" })
			vim.keymap.set("n", "<C-->", function()
				require("dial.map").manipulate("decrement", "normal")
			end, { desc = "Decrement" })
		end,
	},
	{
		"js-everts/cmp-tailwind-colors",
		enabled = function()
			local ok_config, config = pcall(require, "config")
			return ok_config and not config.is_enabled.blink or false
		end,
		dependencies = { "hrsh7th/nvim-cmp" },
		config = function()
			require("cmp-tailwind-colors").setup({
				enable_alpha = true,
			})
		end,
	},
}
