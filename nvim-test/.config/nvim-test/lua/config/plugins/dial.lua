return {
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
					augend.date.alias["%H:%M"],
					augend.constant.alias.bool,
					augend.integer.alias.hex,
					augend.integer.alias.hex,
					augend.hexcolor.new({
						case = "lower",
					}),
					augend.constant.new({ elements = { "let", "const" } }),
				},
			})
			vim.keymap.set("n", "<C-=>", function()
				require("dial.map").manipulate("increment", "normal")
			end, { desc = "Increment symbol under cursor" })
			vim.keymap.set("n", "<C-->", function()
				require("dial.map").manipulate("decrement", "normal")
			end, { desc = "Increment symbol under cursor" })
			vim.keymap.set("n", "g<C-=>", function()
				require("dial.map").manipulate("increment", "gnormal")
			end)
			vim.keymap.set("n", "g<C-->", function()
				require("dial.map").manipulate("decrement", "gnormal")
			end)
			vim.keymap.set("v", "<C-=>", function()
				require("dial.map").manipulate("increment", "visual")
			end)
			vim.keymap.set("v", "<C-->", function()
				require("dial.map").manipulate("decrement", "visual")
			end)
			vim.keymap.set("v", "g<C-=>", function()
				require("dial.map").manipulate("increment", "gvisual")
			end)
			vim.keymap.set("v", "g<C-->", function()
				require("dial.map").manipulate("decrement", "gvisual")
			end)
		end,
		-- test dial 1 #000000 0x000000 25/12/2024 25/12/24 2024-12-25
	},
}
