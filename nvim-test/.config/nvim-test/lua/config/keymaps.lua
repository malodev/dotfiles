-- From LazyVim
-- Wrapper around vim.keymap.set that will
-- not create a keymap if a lazy key handler exists.
-- It will also set `silent` to true by default.
---@diagnostic disable-next-line: redefined-local
local function safe_keymap_set(mode, lhs, rhs, opts)
	local keys = require("lazy.core.handler").handlers.keys
	---@cast keys LazyKeysHandler
	local modes = type(mode) == "string" and { mode } or mode

	---@param m string
	modes = vim.tbl_filter(function(m)
		return not (keys.have and keys:have(lhs, m))
	end, modes)

	-- do not create the keymap if a lazy keys handler exists
	if #modes > 0 then
		opts = opts or {}
		opts.silent = opts.silent ~= false
		if opts.remap and not vim.g.vscode then
			---@diagnostic disable-next-line: no-unknown
			opts.remap = nil
		end
		vim.keymap.set(modes, lhs, rhs, opts)
	end
end

local map = safe_keymap_set

map("n", "-", "<CMD>Oil<CR>", { desc = "Open parent directory" })

-- quit
map("n", "<leader>qq", "<cmd>qa<cr>", { desc = "Quit All" })
map("n", "<leader>qf", ":qa!<CR>", { desc = "Force Quit All" })
map("n", "<leader>qw", ":wa<CR>:qa<CR>", { desc = "Write all buffers and quit" })

-- buffers
map("n", "<leader>bb", "<cmd>e #<cr>", { desc = "Switch to Other Buffer" })
map("n", "<leader>`", "<cmd>e #<cr>", { desc = "Switch to Other Buffer" })

-- Shift arrow keys to select and extend selection
-- go in visual line mode and extend selection when moving up and down
map("n", "<S-Down>", "V", { desc = "Enter in visual line mode" })
map("n", "<S-Up>", "V", { desc = "Enter in visual line mode" })
map("i", "<S-Down>", "<Esc>V", { desc = "Exit insert mode and enter in visual line mode" })
map("i", "<S-Up>", "<Esc>V", { desc = "Exit insert mode and enter in visual line mode" })
map("v", "<S-Down>", "<Down>", { desc = "When in visual line mode move down" })
map("v", "<S-Up>", "<Up>", { desc = "When in visual line mode move up" })

-- go in visual mode and extend selection when moving left and right
map("n", "<S-Left>", "v<Left>", { desc = "Enter in visual mode and move left" })
map("n", "<S-Right>", "v<Right>", { desc = "Enter in visual mode and move right" })
map("i", "<S-Left>", "<Esc>v", { desc = "Exit insert mode and enter in visual mode" })
map("i", "<S-Right>", "<Esc>v", { desc = "Exit insert mode and enter in visual mode" })
map("v", "<S-Left>", "<Left>", { desc = "When in visual mode move left" })
map("v", "<S-Right>", "<Right>", { desc = "When in visual mode move right" })

map("n", "<S-End>", "v$", { desc = "Enter in visual mode and move to end of line" })

-- Under Windows, the * and + registers are equivalent.
-- For X11 systems, * is the selection, and + is the cut buffer (like clipboard).
-- copy into system clipboard with CTRL + C
map("v", "<C-c>", '"+y', { desc = "" })

map("n", "<A-'>", 'ci"', { desc = "" })

-- copy into host system clipboard with <leader>y
map("v", "<leader>y", '"*y', { desc = "" })

-- prevent x from copying over Vim clipboard
map("n", "x", '"_x', { desc = "" })

-- indent and outdent lines in visual mode
map("v", "<TAB>", "<S->>gv", { desc = "" })
map("v", "<S-TAB>", "<S-<>gv", { desc = "" })

-- the greatest remap ever (Primeagen)
map("v", "<leader>p", '"_dP', { desc = "" })

map("n", "<leader>c<leader>x", "<cmd>source %<CR>")
map("n", "<leader>cx", ":.lua<CR>")
map("v", "<leader>cx", ":lua<CR>")

-- WhichKey mappings
local wk = require("which-key")
wk.add({
	{ "<leader>", group = "<leader>" },
	{ "<leader>c", group = "Code" },
	{ "<leader>f", group = "Find" },
	{ "<leader>g", group = "Git and LSP functions" },
	{ "<leader>q", group = "Quit" },
	{ "<leader>u", group = "Toggles" },
	{ "gr", group = "LSP functions" },
	{ "gra", desc = "LSP action" },
	{ "gri", desc = "LSP implementation" },
	{ "grn", desc = "LSP rename" },
	{ "grr", desc = "LSP reference" },

	{
		"<leader>b",
		group = "Buffers",
		expand = function()
			return require("which-key.extras").expand.buf()
		end,
	},
	{
		"<leader>w",
		group = "Windows",
		expand = function()
			return require("which-key.extras").expand.win()
		end,
	},
	{ "<C-s>", "<cmd>w<CR>", desc = "Save buffer", mode = { "n", "v", "i" } },
})
-- print("KEYMAPS")
