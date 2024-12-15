return {
	-- {
	-- 	"windwp/nvim-autopairs", -- plugin 1
	-- 	event = { "InsertEnter" },
	-- 	opts = {},
	-- },
	{
		"windwp/nvim-ts-autotag", -- plugin 2
		event = "InsertEnter",
		opts = {},
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
	-- {
	-- 	"dhruvasagar/vim-prosession",
	-- 	dependencies = {
	-- 		"tpope/vim-obsession",
	-- 	},
	-- },
	{
		"monaqa/dial.nvim",
		config = function()
			local augend = require("dial.augend")
			require("dial.config").augends:register_group({
				default = {
					augend.integer.alias.decimal_int,
					augend.date.alias["%Y-%m-%d"],
					augend.date.alias["%d/%m/%y"],
					augend.date.alias["%d/%m/%Y"],
					augend.integer.alias.hex,
					augend.hexcolor.new({
						case = "lower",
					}),
					augend.constant.new({ elements = { "let", "const" } }),
				},
			})
			vim.keymap.set("n", "<C-p>", function()
				require("dial.map").manipulate("increment", "normal")
			end, { desc = "Increment symbol under cursor" })
			vim.keymap.set("n", "<C-o>", function()
				require("dial.map").manipulate("decrement", "normal")
			end, { desc = "Increment symbol under cursor" })
			vim.keymap.set("n", "g<C-p>", function()
				require("dial.map").manipulate("increment", "gnormal")
			end)
			vim.keymap.set("n", "g<C-o>", function()
				require("dial.map").manipulate("decrement", "gnormal")
			end)
			vim.keymap.set("v", "<C-p>", function()
				require("dial.map").manipulate("increment", "visual")
			end)
			vim.keymap.set("v", "<C-o>", function()
				require("dial.map").manipulate("decrement", "visual")
			end)
			vim.keymap.set("v", "g<C-p>", function()
				require("dial.map").manipulate("increment", "gvisual")
			end)
			vim.keymap.set("v", "g<C-o>", function()
				require("dial.map").manipulate("decrement", "gvisual")
			end)
		end,
	},
	{
		"js-everts/cmp-tailwind-colors",
		dependencies = { "hrsh7th/nvim-cmp" },
		config = function()
			require("cmp-tailwind-colors").setup({
				enable_alpha = true, -- requires pumblend > 0.
			})
		end,
	},
}
