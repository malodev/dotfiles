--=============================================================================
-- nvim-lite — Lightweight, Zero-Compile Cross-OS Neovim Configuration
--
-- Designed for Stage 0 bootstrap, SSH sessions, containers, and fast editing
-- across macOS, Linux, and Windows without requiring C compilers (zig/gcc)
-- or heavy plugin downloads.
--
-- Switch between nvim-lite and full daily-driver nvim-malo at any time:
--   dot nvim lite    (default in bootstrap)
--   dot nvim malo    (full IDE config)
--=============================================================================

vim.g.mapleader = " "
vim.g.maplocalleader = "\\"

--=============================================================================
-- 1. OS & Environment Detection
--=============================================================================
local uv = vim.uv or vim.loop
local uname = (uv and uv.os_uname) and uv.os_uname() or {}
local sysname = uname.sysname or ""
local release = uname.release or ""

_G.OS = sysname
_G.IS_MAC = sysname == "Darwin"
_G.IS_LINUX = sysname == "Linux"
_G.IS_WINDOWS = (vim.fn.has("win32") == 1) or (sysname:find("Windows") ~= nil)
_G.IS_WSL = (_G.IS_LINUX and release:lower():find("microsoft") ~= nil) or (vim.fn.has("wsl") == 1)
_G.IS_SSH = (os.getenv("SSH_TTY") ~= nil) or (os.getenv("SSH_CONNECTION") ~= nil)

--=============================================================================
-- 2. Core Editor Options (matching nvim-malo)
--=============================================================================
local opt = vim.opt
opt.expandtab = true
opt.tabstop = 2
opt.softtabstop = 2
opt.shiftwidth = 2
opt.smartindent = true
opt.ignorecase = true
opt.smartcase = true
opt.number = true
opt.relativenumber = true
opt.signcolumn = "yes"
opt.cursorline = true
opt.termguicolors = true
opt.mouse = "a"
opt.mousemodel = "extend"
opt.splitright = true
opt.splitbelow = true
opt.scrolloff = 6
opt.sidescrolloff = 8
opt.updatetime = 200
opt.timeoutlen = 400
opt.undofile = true
opt.swapfile = false
opt.wrap = false
opt.showmode = false
opt.laststatus = 3
opt.autoread = true

-- Netrw clean sidebar defaults (<leader>e)
vim.g.netrw_banner = 0
vim.g.netrw_liststyle = 3
vim.g.netrw_browse_split = 4
vim.g.netrw_altv = 1
vim.g.netrw_winsize = 22

--=============================================================================
-- 3. Cross-OS & SSH Clipboard (OSC 52 support without hangs)
--=============================================================================
opt.clipboard = "unnamedplus"
if _G.IS_WSL and vim.fn.executable("win32yank.exe") == 1 then
  vim.g.clipboard = {
    name = "win32yank-wsl",
    copy = { ["+"] = "win32yank.exe -i --crlf", ["*"] = "win32yank.exe -i --crlf" },
    paste = { ["+"] = "win32yank.exe -o --lf", ["*"] = "win32yank.exe -o --lf" },
    cache_enabled = true,
  }
elseif _G.IS_SSH then
  -- Over SSH, avoid blocking clipboard reads and push yanks via built-in OSC 52
  opt.clipboard = ""
  local ok_osc, osc52 = pcall(require, "vim.ui.clipboard.osc52")
  if ok_osc and osc52 then
    vim.api.nvim_create_autocmd("TextYankPost", {
      group = vim.api.nvim_create_augroup("lite-osc52-yank", { clear = true }),
      callback = function()
        if vim.v.event.operator == "y" or vim.v.event.operator == "d" then
          local lines = vim.fn.getreg('"', 1, true)
          local regtype = vim.fn.getregtype('"')
          pcall(osc52.copy("+"), lines, regtype)
        end
      end,
    })
  end
end

--=============================================================================
-- 4. Nord-Inspired Built-in Theme & Statusline (Zero External Dependencies)
--=============================================================================
pcall(vim.cmd.colorscheme, "habamax")
local hl = function(group, spec)
  vim.api.nvim_set_hl(0, group, spec)
end
hl("Normal",       { fg = "#D8DEE9", bg = "#2E3440" })
hl("NormalFloat",  { fg = "#D8DEE9", bg = "#3B4252" })
hl("FloatBorder",  { fg = "#88C0D0", bg = "#3B4252" })
hl("CursorLine",   { bg = "#3B4252" })
hl("CursorLineNr", { fg = "#88C0D0", bold = true })
hl("LineNr",       { fg = "#4C566A" })
hl("SignColumn",   { bg = "#2E3440" })
hl("Visual",       { bg = "#434C5E" })
hl("Search",       { fg = "#2E3440", bg = "#88C0D0", bold = true })
hl("IncSearch",    { fg = "#2E3440", bg = "#EBCB8B", bold = true })
hl("StatusLine",   { fg = "#ECEFF4", bg = "#3B4252", bold = true })
hl("StatusLineNC", { fg = "#4C566A", bg = "#2E3440" })
hl("WinSeparator", { fg = "#4C566A", bg = "#2E3440" })
hl("Comment",      { fg = "#616E88", italic = true })
hl("String",       { fg = "#A3BE8C" })
hl("Keyword",      { fg = "#81A1C1", bold = true })
hl("Function",     { fg = "#88C0D0" })
hl("Identifier",   { fg = "#D8DEE9" })
hl("Type",         { fg = "#8FBCBB" })
hl("Constant",     { fg = "#B48EAD" })

vim.o.statusline = " [LITE] %f %m%r%=%{&filetype!=''?&filetype:'plain'} | %l:%c | %p%% "

--=============================================================================
-- 5. Autocommands (Yank Highlight, Relative Number Toggle, Persistent Cursor)
--=============================================================================
local augroup = vim.api.nvim_create_augroup
local autocmd = vim.api.nvim_create_autocmd

autocmd("TextYankPost", {
  group = augroup("lite-yank-highlight", { clear = true }),
  callback = function()
    pcall(vim.hl.on_yank)
  end,
})

local num_toggle = augroup("lite-numbertoggle", { clear = true })
autocmd("InsertEnter", { group = num_toggle, command = "setlocal norelativenumber" })
autocmd("InsertLeave", { group = num_toggle, command = "setlocal relativenumber" })

autocmd({ "BufEnter", "CursorHold", "FocusGained" }, {
  group = augroup("lite-autoread", { clear = true }),
  command = "if mode() != 'c' | checktime | endif",
})

autocmd("BufReadPost", {
  group = augroup("lite-restore-cursor", { clear = true }),
  callback = function()
    local mark = vim.api.nvim_buf_get_mark(0, '"')
    local lcount = vim.api.nvim_buf_line_count(0)
    if mark[1] > 0 and mark[1] <= lcount then
      pcall(vim.api.nvim_win_set_cursor, 0, mark)
    end
  end,
})

-- Enable built-in Treesitter highlighting when a parser is already bundled with Neovim
autocmd("FileType", {
  group = augroup("lite-treesitter", { clear = true }),
  callback = function(ev)
    pcall(vim.treesitter.start, ev.buf)
  end,
})

--=============================================================================
-- 6. Keymaps (matching nvim-malo muscle memory)
--=============================================================================
local map = vim.keymap.set
local silent = { noremap = true, silent = true }

map({ "n", "v" }, "<Space>", "<Nop>", silent)
map("i", "<C-c>", "<Esc>", silent)

-- Wrapped-line movement & H/L line ends
map({ "n", "x" }, "j", "v:count == 0 ? 'gj' : 'j'", { expr = true, silent = true })
map({ "n", "x" }, "k", "v:count == 0 ? 'gk' : 'k'", { expr = true, silent = true })
map("n", "H", "^", silent)
map("n", "L", "$", silent)

-- Clear search highlight on <Esc>
map({ "i", "n" }, "<Esc>", "<Cmd>noh<CR><Esc>", silent)
map("n", "zz", "zz<Cmd>noh<CR>", silent)

-- Move lines up/down (Alt+j / Alt+k)
map("n", "<A-j>", "<Cmd>execute 'move .+' . v:count1<CR>==", silent)
map("n", "<A-k>", "<Cmd>execute 'move .-' . (v:count1 + 1)<CR>==", silent)
map("i", "<A-j>", "<Esc><Cmd>m .+1<CR>==gi", silent)
map("i", "<A-k>", "<Esc><Cmd>m .-2<CR>==gi", silent)
map("v", "<A-j>", ":<C-u>execute \"'<,'>move '>+\" . v:count1<CR>gv=gv", silent)
map("v", "<A-k>", ":<C-u>execute \"'<,'>move '<-\" . (v:count1 + 1)<CR>gv=gv", silent)

-- Save & Quit
map({ "i", "x", "n", "s" }, "<C-s>", "<Cmd>w<CR><Esc>", { desc = "Save file", silent = true })
map("n", "<leader>fn", "<Cmd>enew<CR>", { desc = "New file", silent = true })
map("n", "<leader>qq", "<Cmd>qa<CR>", { desc = "Quit all", silent = true })
map("n", "<leader>qf", "<Cmd>qa!<CR>", { desc = "Force quit all", silent = true })

-- Buffers
map("n", "<C-h>", "<Cmd>bprevious<CR>", { desc = "Prev buffer", silent = true })
map("n", "<C-l>", "<Cmd>bnext<CR>", { desc = "Next buffer", silent = true })
map("n", "[b", "<Cmd>bprevious<CR>", { desc = "Prev buffer", silent = true })
map("n", "]b", "<Cmd>bnext<CR>", { desc = "Next buffer", silent = true })
map("n", "<leader>bb", "<Cmd>e #<CR>", { desc = "Switch to other buffer", silent = true })
map("n", "<leader>`", "<Cmd>e #<CR>", { desc = "Switch to other buffer", silent = true })
map("n", "<C-q>", "<Cmd>bd<CR>", { desc = "Close buffer", silent = true })
map("n", "<leader>bd", "<Cmd>bd<CR>", { desc = "Delete buffer", silent = true })

-- Windows & Splits
map("n", "<leader>-", "<C-W>s", { desc = "Split window below", remap = true })
map("n", "<leader>|", "<C-W>v", { desc = "Split window right", remap = true })
map("n", "<leader>wd", "<C-W>c", { desc = "Delete window", remap = true })
map("n", "<C-Up>", "<Cmd>resize +2<CR>", silent)
map("n", "<C-Down>", "<Cmd>resize -2<CR>", silent)
map("n", "<C-Left>", "<Cmd>vertical resize -2<CR>", silent)
map("n", "<C-Right>", "<Cmd>vertical resize +2<CR>", silent)

-- Indenting & Clipboard
map("v", "<", "<gv", silent)
map("v", ">", ">gv", silent)
map("v", "<Tab>", ">gv", silent)
map("v", "<S-Tab>", "<gv", silent)
map("n", "x", '"_x', silent)
map("v", "<leader>p", '"_dP', silent)
map("n", "<leader>ss", [[:%s/\<<C-r><C-w>\>/<C-r><C-w>/gI<Left><Left><Left>]], { desc = "Replace word under cursor" })

-- File Explorer (<leader>e) & Quick Ripgrep Search (<leader>fg)
map("n", "<leader>e", "<Cmd>Lexplore<CR>", { desc = "Toggle file explorer", silent = true })
if vim.fn.executable("rg") == 1 then
  opt.grepprg = "rg --vimgrep --smart-case --hidden -g '!.git'"
  opt.grepformat = "%f:%l:%c:%m"
end
map("n", "<leader>fg", function()
  local q = vim.fn.input("Grep > ")
  if q ~= "" then
    vim.cmd("silent grep! " .. vim.fn.shellescape(q))
    vim.cmd("copen")
  end
end, { desc = "Grep with ripgrep into quickfix" })

-- FZF file picker (<leader>ff or <leader><Space>) if fzf is installed
local function fzf_find_file()
  if vim.fn.executable("fzf") == 0 then
    local f = vim.fn.input("File > ", "", "file")
    if f ~= "" then vim.cmd("edit " .. vim.fn.fnameescape(f)) end
    return
  end
  local tmp = vim.fn.tempname()
  local buf = vim.api.nvim_create_buf(false, true)
  local width = math.floor(vim.o.columns * 0.8)
  local height = math.floor(vim.o.lines * 0.7)
  local win = vim.api.nvim_open_win(buf, true, {
    relative = "editor",
    width = width,
    height = height,
    row = math.floor((vim.o.lines - height) / 2),
    col = math.floor((vim.o.columns - width) / 2),
    style = "minimal",
    border = "rounded",
    title = " Find File (fzf) ",
    title_pos = "center",
  })
  local cmd = vim.fn.executable("fd") == 1
      and string.format("fd --type f --hidden --exclude .git | fzf --reverse > %s", vim.fn.shellescape(tmp))
    or string.format("fzf --reverse > %s", vim.fn.shellescape(tmp))
  vim.fn.termopen(cmd, {
    on_exit = function()
      if vim.api.nvim_win_is_valid(win) then vim.api.nvim_win_close(win, true) end
      if vim.api.nvim_buf_is_valid(buf) then vim.api.nvim_buf_delete(buf, { force = true }) end
      if vim.fn.filereadable(tmp) == 1 then
        local lines = vim.fn.readfile(tmp)
        vim.fn.delete(tmp)
        if lines[1] and lines[1] ~= "" then
          vim.cmd("edit " .. vim.fn.fnameescape(lines[1]))
        end
      end
    end,
  })
  vim.cmd("startinsert")
end

map("n", "<leader>ff", fzf_find_file, { desc = "Find files (fzf)" })
map("n", "<leader><Space>", fzf_find_file, { desc = "Find files (fzf)" })
