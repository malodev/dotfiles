return {
	"Exafunction/codeium.vim",
	enabled = function()
		return require("config").is_enabled.codeium
	end,
	event = "BufEnter",
	-- config = function()
	-- 	-- Change '<C-g>' here to any keycode you like.
	-- 	vim.g.codeium_key = "<C-g>"
	-- 	vim.keymap.set("i", "<C-g>", function()
	-- 		return vim.fn["codeium#Accept"]()
	-- 	end, { expr = true, silent = true })
	-- 	vim.keymap.set("i", "<C-l>", function()
	-- 		return vim.fn["codeium#CycleCompletions"](1)
	-- 	end, { expr = true, silent = true })
	-- 	vim.keymap.set("i", "<C-k>", function()
	-- 		return vim.fn["codeium#CycleCompletions"](-1)
	-- 	end, { expr = true, silent = true })
	-- 	vim.keymap.set("i", "<C-;]>", function()
	-- 		return vim.fn["codeium#AcceptNextWord"](1)
	-- 	end, { expr = true, silent = true })
	-- 	vim.keymap.set("i", "<C-x>", function()
	-- 		return vim.fn["codeium#Clear"]()
	-- 	end, { expr = true, silent = true })
	-- end,
}
