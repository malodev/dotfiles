local opts = { noremap = true, silent = true }
local keymap = vim.keymap
local global = vim.g
global.mapleader = " "
global.maplocalleader = " "

-- make CTRL + C behave exactly the same as ESC
opts["desc"] = "Make CTRL + C behave exactly the same as ESC"
keymap.set("i", "<C-c>", "<ESC>", opts)
opts.desc = nil

-- delete one word in insert mode (note that <C-h> sends the same ASCII escape sequence as <C-BS>)
keymap.set("i", "<C-h>", "<C-w>", opts)

-- remap ^ and $ to H and L, respectively
keymap.set("n", "H", "^", opts)
keymap.set("n", "L", "$", opts)

-- open up lazy.nvim UI
-- keymap.set('n', '<leader>l', ':Lazy<CR>', opts)

-- toggle undotree
keymap.set("n", "<C-u>", ":UndotreeToggle<CR>", opts)

-- toggle nvim-tree
-- keymap.set('n', '<C-n>', ':NvimTreeFindFileToggle<CR>', opts)

-- unbind <C-d> for now
-- keymap.set('n', '<C-d>', '<nop>', opts)

-- close the current buffer
keymap.set("n", "<C-x>", ":bd<CR>", opts)

-- quickly switch between buffers
opts["desc"] = "Show previous buffer"
keymap.set("n", "<", ":bp<CR>", opts)
opts["desc"] = "Show next buffer"
keymap.set("n", ">", ":bn<CR>", opts)

-- quickly switch between windows
keymap.set("n", "<C-h>", "<C-w>h", opts)
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
opts.desc = nil

-- open up Themery
-- keymap.set('n', '<leader>t', ':Themery<CR>', opts)

-- replace current word
keymap.set("n", "<leader>s", [[:%s/\<<C-r><C-w>\>/<C-r><C-w>/gI<Left><Left><Left>]])

-- make current file an executable
-- keymap.set('n', '<leader>x', '<cmd>!chmod +x %<CR>', opts)

-- keep cursor at front when appending lines below
keymap.set("n", "J", "mzJ`z", opts)

-- select entire file with CTRL + A
keymap.set("n", "<C-a>", "ggVG", opts)

-- indent and outdent lines quickly
keymap.set("n", "<TAB>", ">>", opts)
keymap.set("n", "<S-TAB>", "<<", opts)

-- search movement keeps cursor in middle
keymap.set("n", "n", "nzzzv", opts)
keymap.set("n", "N", "Nzzzv", opts)

-- vertical movement keeps cursor in middle
keymap.set("n", "<C-j>", "<C-d>zz", opts)
keymap.set("n", "<C-k>", "<C-u>zz", opts)

-- creates a new line below the cursor and goes back into normal mode
keymap.set("n", "<A-CR>j", "o<Esc>", opts)
keymap.set("n", "<S-down>", "V", opts)
keymap.set("n", "<S-up>", "V", opts)
keymap.set("v", "<S-down>", "<down>", opts)
keymap.set("v", "<S-up>", "<up>", opts)

-- enter in insert mode, and insert new line
keymap.set("n", "<A-CR>i", "i<CR>", opts)

-- creates a new line above the cursor and goes back into normal mode
keymap.set("n", "<A-CR>k", "O<Esc>", opts)

-- quick resizing of buffers
keymap.set("n", "<C-up>", ":resize -2<cr>", opts)
keymap.set("n", "<C-down>", ":resize +2<cr>", opts)
keymap.set("n", "<C-left>", ":vertical resize -2<cr>", opts)
keymap.set("n", "<C-Right>", ":vertical resize +2<CR>", opts)

-- Under Windows, the * and + registers are equivalent.
-- For X11 systems, * is the selection, and + is the cut buffer (like clipboard).
-- copy into system clipboard with CTRL + C
keymap.set("v", "<C-c>", '"+y', opts)

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

opts["desc"] = "Search the selected text"
keymap.set('v', '/', "\"fy/\\V<C-R>f<CR>", opts )
opts.desc = nil

-- vertical movement keeps cursor in middle (visual mode)
keymap.set("v", "<C-j>", "<C-d>zz", opts)
keymap.set("v", "<C-k>", "<C-u>zz", opts)

-- prevent incrementing numbers in file (this is actually horrible)
keymap.set("v", "<C-a>", "ggVG", opts)

keymap.set("v", "<C-d>", '"+ygvd', opts)
-- WhichKey mappings
local wk = require("which-key")

wk.register({
  c = {
    name = "ChatGPT",

    g = { "<cmd>ChatGPTRun grammar_correction<CR>", "Grammar Correction (GPT)", mode = { "n", "v" } },
    t = { "<cmd>ChatGPTRun translate<CR>", "Translate (GPT)", mode = { "n", "v" } },
    k = { "<cmd>ChatGPTRun keywords<CR>", "Keywords (GPT)", mode = { "n", "v" } },
    d = { "<cmd>ChatGPTRun docstring<CR>", "Docstring (GPT)", mode = { "n", "v" } },
    a = { "<cmd>ChatGPTRun add_tests<CR>", "Add Tests (GPT)", mode = { "n", "v" } },
    o = { "<cmd>ChatGPTRun optimize_code<CR>", "Optimize Code (GPT)", mode = { "n", "v" } },
    s = { "<cmd>ChatGPTRun summarize<CR>", "Summarize (GPT)", mode = { "n", "v" } },
    f = { "<cmd>ChatGPTRun fix_bugs<CR>", "Fix Bugs (GPT)", mode = { "n", "v" } },
    x = { "<cmd>ChatGPTRun explain_code<CR>", "Explain Code (GPT)", mode = { "n", "v" } },
    r = { "<cmd>ChatGPTRun roxygen_edit<CR>", "Roxygen Edit (GPT)", mode = { "n", "v" } },
    l = { "<cmd>ChatGPTRun code_readability_analysis<CR>", "Code Readability Analysis (GPT)", mode = { "n", "v" } },
  },
}, { prefix = "<leader>" })
