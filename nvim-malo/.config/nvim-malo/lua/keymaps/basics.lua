-- Basic keymaps: movement, editing, windows
local map = require("keymaps.util").safe_keymap_set
local opts = { noremap = true, silent = true }
local function tc(t1, t2)
	return vim.tbl_extend("force", t1, t2)
end

-- Leader key
map({ "n", "v" }, "<Space>", "<Nop>", { desc = "Leader key" })

-- Make CTRL + C behave exactly the same as ESC
map("i", "<C-c>", "<ESC>", tc(opts, { desc = "Make CTRL + C behave exactly the same as ESC" }))

-- Better up/down
map({ "n", "x" }, "j", "v:count == 0 ? 'gj' : 'j'", { desc = "Down", expr = true, silent = true })
map({ "n", "x" }, "<Down>", "v:count == 0 ? 'gj' : 'j'", { desc = "Down", expr = true, silent = true })
map({ "n", "x" }, "k", "v:count == 0 ? 'gk' : 'k'", { desc = "Up", expr = true, silent = true })
map({ "n", "x" }, "<Up>", "v:count == 0 ? 'gk' : 'k'", { desc = "Up", expr = true, silent = true })

-- H and L for beginning/end of line
map("n", "H", "^", tc(opts, { desc = "H goes to the beginning of line" }))
map("n", "L", "$", tc(opts, { desc = "L goes to the end of line" }))

-- Clear search and stop snippet on escape
local function snippet_stop()
	if vim.snippet then
		vim.snippet.stop()
	end
end

map({ "i", "n", "s" }, "<esc>", function()
	vim.cmd("noh")
	snippet_stop()
	return "<esc>"
end, { expr = true, desc = "Escape and Clear hlsearch" })

-- Clear search term when centering the cursor
opts["desc"] = "Clear search term when centering the cursor"
map("n", "zz", "zz:noh<CR>", opts)

-- Resize window using '<ctrl>+arrow keys'
map("n", "<C-Up>", "<cmd>resize +2<cr>", { desc = "Increase Window Height" })
map("n", "<C-Down>", "<cmd>resize -2<cr>", { desc = "Decrease Window Height" })
map("n", "<C-Left>", "<cmd>vertical resize -2<cr>", { desc = "Decrease Window Width" })
map("n", "<C-Right>", "<cmd>vertical resize +2<cr>", { desc = "Increase Window Width" })

-- Move Lines
map("n", "<A-j>", "<cmd>execute 'move .+' . v:count1<cr>==", { desc = "Move Down" })
map("n", "<A-k>", "<cmd>execute 'move .-' . (v:count1 + 1)<cr>==", { desc = "Move Up" })
map("i", "<A-j>", "<esc><cmd>m .+1<cr>==gi", { desc = "Move Down" })
map("i", "<A-k>", "<esc><cmd>m .-2<cr>==gi", { desc = "Move Up" })
map("v", "<A-j>", ":<C-u>execute \"'<,'>move '>+\" . v:count1<cr>gv=gv", { desc = "Move Down" })
map("v", "<A-k>", ":<C-u>execute \"'<,'>move '<-\" . (v:count1 + 1)<cr>gv=gv", { desc = "Move Up" })

-- Save file
map({ "i", "x", "n", "s" }, "<C-s>", "<cmd>w<cr><esc>", { desc = "Save File" })
map("n", "<C-s>", ":w<CR>", { desc = "Save current buffer" })
map("i", "<C-s>", "<Esc>:w<CR>", { desc = "Save current buffer" })
map("n", "<D-s>", ":w<CR>", { desc = "Save current buffer" })
map("i", "<D-s>", "<Esc>:w<CR>", { desc = "Save current buffer" })

-- Select all
map("n", "<C-a>", "ggVG", opts)
map("v", "<C-a>", "ggVG", tc(opts, { desc = "Select all" }))

-- Search movement keeps cursor in middle
map("n", "n", "nzzzv", opts)
map("n", "N", "Nzzzv", opts)

-- Saner behavior of n and N
map("n", "n", "'Nn'[v:searchforward].'zv'", { expr = true, desc = "Next Search Result" })
map("x", "n", "'Nn'[v:searchforward]", { expr = true, desc = "Next Search Result" })
map("o", "n", "'Nn'[v:searchforward]", { expr = true, desc = "Next Search Result" })
map("n", "N", "'nN'[v:searchforward].'zv'", { expr = true, desc = "Prev Search Result" })
map("x", "N", "'nN'[v:searchforward]", { expr = true, desc = "Prev Search Result" })
map("o", "N", "'nN'[v:searchforward]", { expr = true, desc = "Prev Search Result" })

-- Add undo break-points
map("i", ",", ",<c-g>u")
map("i", ".", ".<c-g>u")
map("i", ";", ";<c-g>u")

-- Better indenting
map("v", "<", "<gv")
map("v", ">", ">gv")

-- Commenting
map("n", "gco", "o<esc>Vcx<esc><cmd>normal gcc<cr>fxa<bs>", { desc = "Add Comment Below" })
map("n", "gcO", "O<esc>Vcx<esc><cmd>normal gcc<cr>fxa<bs>", { desc = "Add Comment Above" })

-- Surround composition keymap (React interpolation)
map(
	"n",
	"<leader>c`",
	'<Plug>(nvim-surround-change)"`<Plug>(nvim-surround-normal)a`{',
	{ desc = "React: change string to interpolation" }
)

-- Alt quote change text between quotes
map("n", "<A-'>", 'ci"', tc(opts, { desc = "Change text between quotes" }))

-- Slugify the line
map("n", "<leader>ms", "!!slugify<CR>", tc(opts, { desc = "Slugify the line" }))

-- Replace current word
map("n", "<leader>ss", [[:%s/<C-r><C-w>/<C-r><C-w>/gI<Left><Left><Left>]], tc(opts, { desc = "Search and replace current word" }))

-- Delete current file function
function _G.delete_current_file()
	local file = vim.fn.expand("%")
	local confirm = vim.fn.confirm("Do you really want to delete " .. file .. "?", "&Yes\n&No", 2)

	if confirm == 1 then
		os.remove(file)
		vim.api.nvim_command("bdelete!")
		print("File deleted: " .. file)
	else
		print("Operation cancelled.")
	end
end

-- New file
map("n", "<leader>fn", "<cmd>enew<cr>", { desc = "New File" })

-- Quit
map("n", "<leader>qq", "<cmd>qa<cr>", { desc = "Quit All" })
map("n", "<leader>qf", ":qa!<CR>", { desc = "Force Quit All" })

-- Windows
map("n", "<leader>-", "<C-W>s", { desc = "Split Window Below", remap = true })
map("n", "<leader>|", "<C-W>v", { desc = "Split Window Right", remap = true })
map("n", "<leader>wd", "<C-W>c", { desc = "Delete Window", remap = true })

-- Tabs
map("n", "<leader><tab>l", "<cmd>tablast<cr>", { desc = "Last Tab" })
map("n", "<leader><tab>o", "<cmd>tabonly<cr>", { desc = "Close Other Tabs" })
map("n", "<leader><tab>f", "<cmd>tabfirst<cr>", { desc = "First Tab" })
map("n", "<leader><tab><tab>", "<cmd>tabnew<cr>", { desc = "New Tab" })
map("n", "<leader><tab>]", "<cmd>tabnext<cr>", { desc = "Next Tab" })
map("n", "<leader><tab>d", "<cmd>tabclose<cr>", { desc = "Close Tab" })
map("n", "<leader><tab>[", "<cmd>tabprevious<cr>", { desc = "Previous Tab" })

-- Shift arrow selection
map("n", "<S-Down>", "V", { desc = "Enter in visual line mode" })
map("n", "<S-Up>", "V", { desc = "Enter in visual line mode" })
map("i", "<S-Down>", "<Esc>V", { desc = "Exit insert mode and enter in visual line mode" })
map("i", "<S-Up>", "<Esc>V", { desc = "Exit insert mode and enter in visual line mode" })
map("v", "<S-Down>", "<Down>", { desc = "When in visual line mode move down" })
map("v", "<S-Up>", "<Up>", { desc = "When in visual line mode move up" })
map("n", "<S-Left>", "v<Left>", { desc = "Enter in visual mode and move left" })
map("n", "<S-Right>", "v<Right>", { desc = "Enter in visual mode and move right" })
map("i", "<S-Left>", "<Esc>v", { desc = "Exit insert mode and enter in visual mode" })
map("i", "<S-Right>", "<Esc>v", { desc = "Exit insert mode and enter in visual mode" })
map("v", "<S-Left>", "<Left>", { desc = "When in visual mode move left" })
map("v", "<S-Right>", "<Right>", { desc = "When in visual mode move right" })
map("n", "<S-End>", "v$", { desc = "Enter in visual mode and move to end of line" })

-- Ctrl+j/k for vertical selection (does not conflict with Alt+j/k which moves lines)
map("n", "<C-j>", "V", { desc = "Enter in visual line mode" })
map("n", "<C-k>", "V", { desc = "Enter in visual line mode" })
map("i", "<C-j>", "<Esc>V", { desc = "Exit insert mode and enter in visual line mode" })
map("i", "<C-k>", "<Esc>V", { desc = "Exit insert mode and enter in visual line mode" })
map("v", "<C-j>", "<Down>", { desc = "When in visual line mode move down" })
map("v", "<C-k>", "<Up>", { desc = "When in visual line mode move up" })

-- Clipboard
map("v", "<C-c>", '"+y', opts)
map("v", "<leader>y", '"*y', opts)
map("n", "x", '"_x', opts)
map("v", "<leader>p", '"_dP', opts)

-- Visual mode indent
map("v", "<TAB>", "<S->>gv", opts)
map("v", "<S-TAB>", "<S-<>gv", opts)

-- Quickfix
map("n", "<leader>xl", "<cmd>lopen<cr>", { desc = "Location List" })
map("n", "<leader>xq", "<cmd>copen<cr>", { desc = "Quickfix List" })
map("n", "[q", vim.cmd.cprev, { desc = "Previous Quickfix" })
map("n", "]q", vim.cmd.cnext, { desc = "Next Quickfix" })

-- Lazy
map("n", "<leader>ll", "<cmd>Lazy<cr>", { desc = "Lazy" })

-- Undotree
map("n", "<F5>", vim.cmd.UndotreeToggle, opts)

-- Lookup keyword
map("n", "<leader>K", "<cmd>norm! K<cr>", { desc = "Lookup the keyword under the cursor" })

-- Redraw / Clear hlsearch / Diff Update
map("n", "<leader>ur", "<Cmd>nohlsearch<Bar>diffupdate<Bar>normal! <C-L><CR>", { desc = "Redraw / Clear hlsearch / Diff Update" })
