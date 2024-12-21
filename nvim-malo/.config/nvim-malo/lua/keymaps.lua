local opts = { noremap = true, silent = true }
local keymap = vim.keymap

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

local function snippet_stop()
	if vim.snippet then
		vim.snippet.stop()
	end
end

-- Clear search and stop snippet on escape
map({ "i", "n", "s" }, "<esc>", function()
	vim.cmd("noh")
	snippet_stop()
	return "<esc>"
end, { expr = true, desc = "Escape and Clear hlsearch" })

-- better up/down
map({ "n", "x" }, "j", "v:count == 0 ? 'gj' : 'j'", { desc = "Down", expr = true, silent = true })
map({ "n", "x" }, "<Down>", "v:count == 0 ? 'gj' : 'j'", { desc = "Down", expr = true, silent = true })
map({ "n", "x" }, "k", "v:count == 0 ? 'gk' : 'k'", { desc = "Up", expr = true, silent = true })
map({ "n", "x" }, "<Up>", "v:count == 0 ? 'gk' : 'k'", { desc = "Up", expr = true, silent = true })

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

-- move lines around
keymap.set("v", "J", ":m '>+1<CR>gv=gv", opts)
keymap.set("v", "K", ":m '<-2<CR>gv=gv", opts)

-- buffers
map("n", "<S-h>", "<cmd>bprevious<cr>", { desc = "Prev Buffer" })
map("n", "<S-l>", "<cmd>bnext<cr>", { desc = "Next Buffer" })
map("n", "[b", "<cmd>bprevious<cr>", { desc = "Prev Buffer" })
map("n", "]b", "<cmd>bnext<cr>", { desc = "Next Buffer" })
map("n", "<leader>bb", "<cmd>e #<cr>", { desc = "Switch to Other Buffer" })
map("n", "<leader>`", "<cmd>e #<cr>", { desc = "Switch to Other Buffer" })
map("n", "<leader>bd", function()
	Snacks.bufdelete()
end, { desc = "Delete Buffer" })
map("n", "<leader>bo", function()
	Snacks.bufdelete.other()
end, { desc = "Delete Other Buffers" })
map("n", "<leader>bD", "<cmd>:bd<cr>", { desc = "Delete Buffer and Window" })

map("n", "<C-x>", ":bd<CR>", { desc = "Close current buffer" })
map("n", "<leader>bf", ":lua delete_current_file()<CR>", { desc = "Delete current file and close the buffer" })

map("n", "<leader>bp", ":BufferLineTogglePin<CR>", { desc = "Pin current buffer" })

map("n", "<leader>pb", ":BufferLinePick<CR>", { desc = "Pick a buffer by letter" })

map("n", "<C-s>", ":w<CR>", { desc = "Save current buffer" })
map("i", "<C-s>", "<Esc>:w<CR>", { desc = "Save current buffer" })
map("n", "<leader>w", ":wa<CR>", { desc = "Write all buffers" })

-- quit
map("n", "<leader>qq", "<cmd>qa<cr>", { desc = "Quit All" })
map("n", "<leader>qf", ":qa!<CR>", { desc = "Force Quit All" })

-- Clear search, diff update and redraw
-- taken from runtime/lua/_editor.lua
map(
	"n",
	"<leader>ur",
	"<Cmd>nohlsearch<Bar>diffupdate<Bar>normal! <C-L><CR>",
	{ desc = "Redraw / Clear hlsearch / Diff Update" }
)

-- https://github.com/mhinz/vim-galore#saner-behavior-of-n-and-n
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

-- save file
map({ "i", "x", "n", "s" }, "<C-s>", "<cmd>w<cr><esc>", { desc = "Save File" })

-- Run a program to lookup the keyword under the cursor. The name of the program is given with the
-- 'keywordprg' (kp) option (default is ":Man for Neovim").
map("n", "<leader>K", "<cmd>norm! K<cr>", { desc = "Lookup the keyword under the cursor" })

-- better indenting
map("v", "<", "<gv")
map("v", ">", ">gv")

-- commenting
map("n", "gco", "o<esc>Vcx<esc><cmd>normal gcc<cr>fxa<bs>", { desc = "Add Comment Below" })
map("n", "gcO", "O<esc>Vcx<esc><cmd>normal gcc<cr>fxa<bs>", { desc = "Add Comment Above" })

-- lazy
map("n", "<leader>l", "<cmd>Lazy<cr>", { desc = "Lazy" })

-- new file
map("n", "<leader>fn", "<cmd>enew<cr>", { desc = "New File" })

map("n", "<leader>xl", "<cmd>lopen<cr>", { desc = "Location List" })
map("n", "<leader>xq", "<cmd>copen<cr>", { desc = "Quickfix List" })

map("n", "[q", vim.cmd.cprev, { desc = "Previous Quickfix" })
map("n", "]q", vim.cmd.cnext, { desc = "Next Quickfix" })

-- diagnostic
local diagnostic_goto = function(next, severity)
	local go = next and vim.diagnostic.goto_next or vim.diagnostic.goto_prev
	severity = severity and vim.diagnostic.severity[severity] or nil
	return function()
		go({ severity = severity })
	end
end
map("n", "<leader>cd", vim.diagnostic.open_float, { desc = "Line Diagnostics" })
map("n", "]d", diagnostic_goto(true), { desc = "Next Diagnostic" })
map("n", "[d", diagnostic_goto(false), { desc = "Prev Diagnostic" })
map("n", "]e", diagnostic_goto(true, "ERROR"), { desc = "Next Error" })
map("n", "[e", diagnostic_goto(false, "ERROR"), { desc = "Prev Error" })
map("n", "]w", diagnostic_goto(true, "WARN"), { desc = "Next Warning" })
map("n", "[w", diagnostic_goto(false, "WARN"), { desc = "Prev Warning" })

-- stylua: ignore start

-- toggle optionS
Snacks.toggle.option("spell", { name = "Spelling" }):map("<leader>us")
Snacks.toggle.option("wrap", { name = "Wrap" }):map("<leader>uw")
Snacks.toggle.option("relativenumber", { name = "Relative Number" }):map("<leader>uL")
Snacks.toggle.diagnostics():map("<leader>ud")
Snacks.toggle.line_number():map("<leader>ul")
Snacks.toggle.option("conceallevel", { off = 0, on = vim.o.conceallevel > 0 and vim.o.conceallevel or 2, name = "Conceal Level" }):map("<leader>uc")
Snacks.toggle.option("showtabline", { off = 0, on = vim.o.showtabline > 0 and vim.o.showtabline or 2, name = "Tabline" }):map("<leader>uA")
Snacks.toggle.treesitter():map("<leader>uT")
Snacks.toggle.option("background", { off = "light", on = "dark" , name = "Dark Background" }):map("<leader>ub")
Snacks.toggle.dim():map("<leader>uD")
Snacks.toggle.animate():map("<leader>ua")
Snacks.toggle.indent():map("<leader>ug")
Snacks.toggle.scroll():map("<leader>uS")
Snacks.toggle.profiler():map("<leader>dpp")
Snacks.toggle.profiler_highlights():map("<leader>dph")

if vim.lsp.inlay_hint then
  Snacks.toggle.inlay_hints():map("<leader>uh")
end

-- lazygit
if vim.fn.executable("lazygit") == 1 then
  map("n", "<leader>gg", function() Snacks.lazygit() end, { desc = "Lazygit (cwd)" })
  map("n", "<leader>gf", function() Snacks.lazygit.log_file() end, { desc = "Lazygit Current File History" })
  map("n", "<leader>gL", function() Snacks.lazygit.log() end, { desc = "Lazygit Log (cwd)" })
end

map("n", "<leader>gb", function() Snacks.git.blame_line() end, { desc = "Git Blame Line" })
map({ "n", "x" }, "<leader>gB", function() Snacks.gitbrowse() end, { desc = "Git Browse (open)" })
map({"n", "x" }, "<leader>gY", function()
  Snacks.gitbrowse({ open = function(url) vim.fn.setreg("+", url) end, notify = false })
end, { desc = "Git Browse (copy)" })

-- highlights under cursor
map("n", "<leader>ui", vim.show_pos, { desc = "Inspect Pos" })
map("n", "<leader>uI", "<cmd>InspectTree<cr>", { desc = "Inspect Tree" })

-- floating terminal
map("n", "<leader>tt", function() Snacks.terminal() end, { desc = "Terminal (cwd)" })

-- Terminal Mappings
map("t", "<C-/>", "<cmd>close<cr>", { desc = "Hide Terminal" })
map("t", "<c-_>", "<cmd>close<cr>", { desc = "which_key_ignore" })

-- windows
map("n", "<leader>w", "<c-w>", { desc = "Windows", remap = true })
map("n", "<leader>-", "<C-W>s", { desc = "Split Window Below", remap = true })
map("n", "<leader>|", "<C-W>v", { desc = "Split Window Right", remap = true })
map("n", "<leader>wd", "<C-W>c", { desc = "Delete Window", remap = true })
Snacks.toggle.zoom():map("<leader>wm"):map("<leader>uZ")
Snacks.toggle.zen():map("<leader>uz")

-- tabs
map("n", "<leader><tab>l", "<cmd>tablast<cr>", { desc = "Last Tab" })
map("n", "<leader><tab>o", "<cmd>tabonly<cr>", { desc = "Close Other Tabs" })
map("n", "<leader><tab>f", "<cmd>tabfirst<cr>", { desc = "First Tab" })
map("n", "<leader><tab><tab>", "<cmd>tabnew<cr>", { desc = "New Tab" })
map("n", "<leader><tab>]", "<cmd>tabnext<cr>", { desc = "Next Tab" })
map("n", "<leader><tab>d", "<cmd>tabclose<cr>", { desc = "Close Tab" })
map("n", "<leader><tab>[", "<cmd>tabprevious<cr>", { desc = "Previous Tab" })

-- Define the function to delete the current file with confirmation
function _G.delete_current_file()
	-- Get the name of the current file
	local file = vim.fn.expand("%")
	-- Ask for confirmation
	local confirm = vim.fn.confirm("Do you really want to delete " .. file .. "?", "&Yes\n&No", 2)

	if confirm == 1 then
		-- If confirmed, delete the file
		os.remove(file)
		-- Close the buffer without saving
		vim.api.nvim_command("bdelete!")
		print("File deleted: " .. file)
	else
		print("Operation cancelled.")
	end
end

local function tc(t1, t2)
	return vim.tbl_extend("force", t1, t2)
end

map({ "n", "v" }, "<Space>", "<Nop>", { desc = "remap space to no operation" })

-- make CTRL + C behave exactly the same as ESC
map("i", "<C-c>", "<ESC>", tc(opts, { desc = "Make CTRL + C behave exactly the same as ESC" }))

-- delete one word in insert mode (note that <C-h> sends the same ASCII escape sequence as <C-BS>)
-- map("i", "<C-h>", "<C-w>", opts)
--
--
-- remap ^ and $ to H and L, respectively
map("n", "H", "^", tc(opts, { desc = "H goes to the beginning of line" }))
map("n", "L", "$", tc(opts, { desc = "L goes to the end of line" }))

-- open up lazy.nvim UI
-- map('n', '<leader>l', ':Lazy<CR>', opts)

-- toggle undotree
map("n", "<F5>", vim.cmd.UndotreeToggle, opts)

-- toggle nvim-tree
-- map('n', '<C-n>', ':NvimTreeFindFileToggle<CR>', opts)

-- unbind <C-d> for now
-- map('n', '<C-d>', '<nop>', opts)


-- clear search term when centering the cursor
opts["desc"] = "Clear search term when centering the cursor"
map("n", "zz", "zz:noh<CR>", opts)

-- replace current word
map(
	"n",
	"<leader>ss",
	[[:%s/<C-r><C-w>/<C-r><C-w>/gI<Left><Left><Left>]],
	tc(opts, { desc = "Search and replace current word" })
)

-- make current file an executable
-- map('n', '<leader>x', '<cmd>!chmod +x %<CR>', opts)

-- keep cursor at front when appending lines below
-- map("n", "J", "mzJ`z", opts)

-- select entire file with CTRL + A
map("n", "<C-a>", "ggVG", opts)

-- indent and outdent lines quickly
-- map("n", "<TAB>", ">>", opts)
-- map("n", "<S-TAB>", "<<", opts)

map("n", "<TAB>", ":bnext<CR>", opts)
map("n", "<S-TAB>", ":bprevious<CR>", opts)

-- search movement keeps cursor in middle
map("n", "n", "nzzzv", opts)
map("n", "N", "Nzzzv", opts)

-- Shift arrow keys to select and extend selection
-- go in visual line mode and extend selection when moving up and down
map("n", "<S-Down>", "V", { desc= "Enter in visual line mode" })
map("n", "<S-Up>", "V", { desc= "Enter in visual line mode" })
map("i", "<S-Down>", "<Esc>V", { desc= "Exit insert mode and enter in visual line mode" })
map("i", "<S-Up>", "<Esc>V", { desc= "Exit insert mode and enter in visual line mode" })
map("v", "<S-Down>", "<Down>", { desc= "When in visual line mode move down" })
map("v", "<S-Up>", "<Up>", { desc= "When in visual line mode move up" })

-- go in visual mode and extend selection when moving left and right
map("n", "<S-Left>", "v<Left>", { desc= "Enter in visual mode and move left" })
map("n", "<S-Right>", "v<Right>", { desc= "Enter in visual mode and move right" })
map("i", "<S-Left>", "<Esc>v", { desc= "Exit insert mode and enter in visual mode" })
map("i", "<S-Right>", "<Esc>v", { desc= "Exit insert mode and enter in visual mode" })
map("v", "<S-Left>", "<Left>", { desc= "When in visual mode move left" })
map("v", "<S-Right>", "<Right>", { desc= "When in visual mode move right" })

map("n", "<S-End>", "v$", { desc= "Enter in visual mode and move to end of line" })



-- Under Windows, the * and + registers are equivalent.
-- For X11 systems, * is the selection, and + is the cut buffer (like clipboard).
-- copy into system clipboard with CTRL + C
map("v", "<C-c>", '"+y', opts)

map("n", "<A-'>", 'ci"', tc({ desc = 'change text between "' }, opts))

-- copy into host system clipboard with <leader>y
map("v", "<leader>y", '"*y', opts)

-- prevent x from copying over Vim clipboard
map("n", "x", '"_x', opts)

-- indent and outdent lines in visual mode
map("v", "<TAB>", "<S->>gv", opts)
map("v", "<S-TAB>", "<S-<>gv", opts)

-- the greatest remap ever (Primeagen)
map("v", "<leader>p", '"_dP', opts)


opts["desc"] = "Search the selected text"
map("v", "/", '"fy/\\V<C-R>f<CR>', opts)

map("n", "<C-d>", "<C-d>zz", tc(opts, { desc = "Down and recenter" }))
map("n", "<C-u>", "<C-u>zz", tc(opts, { desc = "Up and recenter" }))
-- vertical movement keeps cursor in middle (visual mode)
map("v", "<C-j>", "<C-d>zz", opts)
map("v", "<C-k>", "<C-u>zz", opts)

-- prevent incrementing numbers in file (this is actually horrible)
map("v", "<C-a>", "ggVG", opts)

map("v", "<C-d>", '"+ygvd', opts)

-- my mappings for custom commands
map("n", "<leader>ms", "!!slugify<CR>", tc(opts, { desc = "Slugify the line" }))

-- my mappings for custom commands
map("n", "<leader>ms", "!!slugify<CR>", tc(opts, { desc = "Slugify the line" }))

-- keymap.set("t", "<C-A>", [[<C-\>|]], tc(opts, { desc = "Terminal beginning of line" }))
-- keymap.set("t", "<C-E>", [[<C-\>$]], tc(opts, { desc = "Terminal beginning of line" }))
-- ChatGPT mappings
if not vim.g.vscode then
	-- WhichKey mappings
	local wk = require("which-key")
	wk.add({
		{ "<leader>b", group = "Buffers" },
		{ "<leader>c", group = "ChatGPT" },
		{ "<leader>d", group = "Debugging" },
		{ "<leader>f", group = "Telescope and force" },
		{ "<leader>g", group = "LSP Go to and git" },
		{ "<leader>h", group = "Gitsign hunk" },
		{ "<leader>m", group = "Markdown" },
		{ "<leader>p", group = "Persistence (session)" },
		{ "<leader>r", group = "Rest client" },
		{ "<leader>u", group = "Toggles" },
		{ "<leader>x", group = "Trouble" },
		{
			mode = { "n", "v" },
			{ "<leader>ca", "<cmd>ChatGPTRun add_tests<CR>", desc = "Add Tests (GPT)" },
			{ "<leader>cd", "<cmd>ChatGPTRun docstring<CR>", desc = "Docstring (GPT)" },
			{ "<leader>cf", "<cmd>ChatGPTRun fix_bugs<CR>", desc = "Fix Bugs (GPT)" },
			{ "<leader>cg", "<cmd>ChatGPTRun grammar_correction<CR>", desc = "Grammar Correction (GPT)" },
			{ "<leader>ck", "<cmd>ChatGPTRun keywords<CR>", desc = "Keywords (GPT)" },
			{ "<leader>cl", "<cmd>ChatGPTRun code_readability_analysis<CR>", desc = "Code Readability Analysis (GPT)" },
			{ "<leader>co", "<cmd>ChatGPTRun optimize_code<CR>", desc = "Optimize Code (GPT)" },
			{ "<leader>cr", "<cmd>ChatGPTRun roxygen_edit<CR>", desc = "Roxygen Edit (GPT)" },
			{ "<leader>cs", "<cmd>ChatGPTRun summarize<CR>", desc = "Summarize (GPT)" },
			{ "<leader>ct", "<cmd>ChatGPTRun translate<CR>", desc = "Translate (GPT)" },
			{ "<leader>cx", "<cmd>ChatGPTRun explain_code<CR>", desc = "Explain Code (GPT)" },
		},
	}, { prefix = "<leader>" })
end
