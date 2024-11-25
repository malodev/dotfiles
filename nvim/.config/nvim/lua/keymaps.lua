local opts = { noremap = true, silent = true }
local keymap = vim.keymap

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

keymap.set({ "n", "v" }, "<Space>", "<Nop>", opts)

local function tc(t1, t2)
	-- Create a new table to avoid modifying the original tables
	local mergedTable = {}

	-- First, copy all the key-value pairs from the first table to the mergedTable
	for key, value in pairs(t1) do
		mergedTable[key] = value
	end

	-- Then, iterate over the second table and add its key-value pairs to the mergedTable
	-- If a key already exists, its value will be overwritten by the value from t2
	for key, value in pairs(t2) do
		mergedTable[key] = value
	end

	return mergedTable
end

keymap.set({ "n", "v" }, "<Space>", "<Nop>", opts)

-- make CTRL + C behave exactly the same as ESC
keymap.set("i", "<C-c>", "<ESC>", tc(opts, { desc = "Make CTRL + C behave exactly the same as ESC" }))

-- delete one word in insert mode (note that <C-h> sends the same ASCII escape sequence as <C-BS>)
-- keymap.set("i", "<C-h>", "<C-w>", opts)
--
--
-- remap ^ and $ to H and L, respectively
keymap.set("n", "H", "^", tc(opts, { desc = "H goes to the beginning of line" }))
keymap.set("n", "L", "$", tc(opts, { desc = "L goes to the end of line" }))

-- open up lazy.nvim UI
-- keymap.set('n', '<leader>l', ':Lazy<CR>', opts)

-- toggle undotree
keymap.set("n", "<F5>", vim.cmd.UndotreeToggle, opts)

-- toggle nvim-tree
-- keymap.set('n', '<C-n>', ':NvimTreeFindFileToggle<CR>', opts)

-- unbind <C-d> for now
-- keymap.set('n', '<C-d>', '<nop>', opts)

-- close the current buffer
keymap.set("n", "<C-x>", ":bd<CR>", opts)
keymap.set(
	"n",
	"<leader>bf",
	-- ":call delete(expand('%')) | bd!<CR>",
	":lua delete_current_file()<CR>",
	tc(opts, { desc = "Delete current file and close the buffer" })
)

-- quickly switch between buffers
opts["desc"] = "Show previous buffer"
keymap.set("n", "<", ":bp<CR>", tc(opts, { desc = "Show previous buffer" }))
opts["desc"] = "Show next buffer"
keymap.set("n", ">", ":bn<CR>", tc(opts, { desc = "Show next buffer" }))

-- quickly switch between windows
keymap.set("n", "<C-j>", "<C-w>j", opts)
keymap.set("n", "<C-k>", "<C-w>k", opts)
keymap.set("n", "<C-BS>", "<C-w>h", opts)
keymap.set("n", "<C-l>", "<C-w>l", opts)

-- Toogle pin current buffer
opts["desc"] = "Pin current buffer"
keymap.set("n", "<leader>bp", ":BufferLineTogglePin<CR>", opts)

-- Pick a buffer
opts["desc"] = "Pick a buffer by letter"
keymap.set("n", "<leader>pb", ":BufferLinePick<CR>", opts)

-- save current buffer
opts["desc"] = "Save current buffer"
keymap.set("n", "<C-s>", ":w<CR>", opts)
keymap.set("i", "<C-s>", "<Esc>:w<CR>", opts)

-- write to all buffers
opts["desc"] = "Write all buffers"
keymap.set("n", "<leader>w", ":wa<CR>", opts)

-- quit all buffers
opts["desc"] = "Quit all buffers"
keymap.set("n", "<leader>q", ":qa<CR>", opts)

-- force quit all buffers
opts["desc"] = "Force quit all buffers"
keymap.set("n", "<leader>fq", ":qa!<CR>", opts)

-- clear search term when centering the cursor
opts["desc"] = "Clear search term when centering the cursor"
keymap.set("n", "zz", "zz:noh<CR>", opts)

-- toggle transparency
-- opts["desc"] = "Toggle transparency"
-- keymap.set("n", "<C-t>", ":TransparentToggle<CR>", opts)

-- open up Themery
-- keymap.set('n', '<leader>t', ':Themery<CR>', opts)

-- replace current word
keymap.set(
	"n",
	"<leader>s",
	[[:%s/<C-r><C-w>/<C-r><C-w>/gI<Left><Left><Left>]],
	tc(opts, { desc = "Search and replace current word" })
)

-- make current file an executable
-- keymap.set('n', '<leader>x', '<cmd>!chmod +x %<CR>', opts)

-- keep cursor at front when appending lines below
keymap.set("n", "J", "mzJ`z", opts)

-- select entire file with CTRL + A
keymap.set("n", "<C-a>", "ggVG", opts)

-- indent and outdent lines quickly
-- keymap.set("n", "<TAB>", ">>", opts)
-- keymap.set("n", "<S-TAB>", "<<", opts)

keymap.set("n", "<TAB>", ":bnext<CR>", opts)
keymap.set("n", "<S-TAB>", ":bprevious<CR>", opts)

-- search movement keeps cursor in middle
keymap.set("n", "n", "nzzzv", opts)
keymap.set("n", "N", "Nzzzv", opts)

-- creates a new line below the cursor and goes back into normal mode
keymap.set("n", "<S-Down>", "V", opts)
keymap.set("n", "<S-Up>", "V", opts)
keymap.set("i", "<S-Down>", "<Esc>V", opts)
keymap.set("i", "<S-Up>", "<Esc>V", opts)
keymap.set("v", "<S-Down>", "<Down>", opts)
keymap.set("v", "<S-Up>", "<Up>", opts)

keymap.set("n", "<S-Left>", "v<Left>", opts)
keymap.set("n", "<S-Right>", "v<Right>", opts)
keymap.set("i", "<S-Left>", "<Esc>v", opts)
keymap.set("i", "<S-Right>", "<Esc>v", opts)
keymap.set("v", "<S-Left>", "<Left>", opts)
keymap.set("v", "<S-Right>", "<Right>", opts)

keymap.set("n", "<S-End>", "v$", opts)

-- quick resizing of buffers
keymap.set("n", "<C-up>", ":resize +2<cr>", opts)
keymap.set("n", "<C-down>", ":resize -2<cr>", opts)
keymap.set("n", "<C-left>", ":vertical resize -2<cr>", opts)
keymap.set("n", "<C-Right>", ":vertical resize +2<CR>", opts)

-- Under Windows, the * and + registers are equivalent.
-- For X11 systems, * is the selection, and + is the cut buffer (like clipboard).
-- copy into system clipboard with CTRL + C
keymap.set("v", "<C-c>", '"+y', opts)

keymap.set("n", "<A-'>", 'ci"', tc({ desc = 'change text between "' }, opts))

-- copy into host system clipboard with <leader>y
keymap.set("v", "<leader>y", '"*y', opts)

-- prevent x from copying over Vim clipboard
keymap.set("n", "x", '"_x', opts)

-- indent and outdent lines in visual mode
keymap.set("v", "<TAB>", "<S->>gv", opts)
keymap.set("v", "<S-TAB>", "<S-<>gv", opts)

-- the greatest remap ever (Primeagen)
keymap.set("v", "<leader>p", '"_dP', opts)

-- move lines around
keymap.set("v", "J", ":m '>+1<CR>gv=gv", opts)
keymap.set("v", "K", ":m '<-2<CR>gv=gv", opts)
keymap.set("n", "<A-J>", ":m .+1<CR>==")
keymap.set("n", "<A-K>", ":m .-2<CR>==")
keymap.set("i", "<A-J>", ":m .+1<CR>==gi")
keymap.set("i", "<A-K>", ":m .-2<CR>==gi")

opts["desc"] = "Search the selected text"
keymap.set("v", "/", '"fy/\\V<C-R>f<CR>', opts)

keymap.set("n", "<C-d>", "<C-d>zz", tc(opts, { desc = "Down and recenter" }))
keymap.set("n", "<C-u>", "<C-u>zz", tc(opts, { desc = "Up and recenter" }))
-- vertical movement keeps cursor in middle (visual mode)
keymap.set("v", "<C-j>", "<C-d>zz", opts)
keymap.set("v", "<C-k>", "<C-u>zz", opts)

-- prevent incrementing numbers in file (this is actually horrible)
keymap.set("v", "<C-a>", "ggVG", opts)

keymap.set("v", "<C-d>", '"+ygvd', opts)

-- noice mappings
keymap.set("n", "<leader>nl", function()
	require("noice").cmd("last")
end, tc(opts, { desc = "Show the last message" }))

keymap.set("n", "<leader>nh", function()
	require("noice").cmd("history")
end, tc(opts, { desc = "Show the message history" }))

keymap.set("n", "<leader>nn", function()
	require("noice").cmd("dismiss")
end, tc(opts, { desc = "Dismiss all visible messages" }))

keymap.set("n", "<leader>nt", function()
	require("noice").cmd("telescope")
end, tc(opts, { desc = "Telescope messages" }))

keymap.set("n", "<leader>nx", function()
	require("noice").cmd("disable")
end, tc(opts, { desc = "Disable noice" }))

keymap.set("n", "<leader>ne", function()
	require("noice").cmd("enable")
end, tc(opts, { desc = "Enable noice" }))

-- my mappings for custom commands
keymap.set("n", "<leader>ms", "!!slugify<CR>", tc(opts, { desc = "Slugify the line" }))

-- noice mappings
keymap.set("n", "<leader>nl", function()
	require("noice").cmd("last")
end, tc(opts, { desc = "Show the last message" }))

keymap.set("n", "<leader>nh", function()
	require("noice").cmd("history")
end, tc(opts, { desc = "Show the message history" }))

keymap.set("n", "<leader>nd", function()
	require("noice").cmd("dismiss")
end, tc(opts, { desc = "Dismiss all visible messages" }))

keymap.set("n", "<leader>nt", function()
	require("noice").cmd("telescope")
end, tc(opts, { desc = "Dismiss all visible messages" }))

keymap.set("n", "<leader>nx", function()
	require("noice").cmd("disable")
end, tc(opts, { desc = "Dismiss all visible messages" }))

keymap.set("n", "<leader>ne", function()
	require("noice").cmd("enable")
end, tc(opts, { desc = "Dismiss all visible messages" }))
-- my mappings for custom commands
keymap.set("n", "<leader>ms", "!!slugify<CR>", tc(opts, { desc = "Slugify the line" }))

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
		{ "<leader>n", group = "Noice" },
		{ "<leader>p", group = "Persistence (session)" },
		{ "<leader>r", group = "Rest client" },
		{ "<leader>t", group = "Toggles" },
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
