vim.cmd("set expandtab")
vim.cmd("set tabstop=2")
vim.cmd("set softtabstop=2")
vim.cmd("set shiftwidth=2")
vim.cmd("set ignorecase")
vim.cmd("set smartcase")
vim.cmd("set mousemodel=extend")

vim.opt.signcolumn = "yes"

_G.IS_WSL = false
local sysname = ""
local release = ""
if pcall(require, "uname") and type(_G.uname) == "function" then
  local distro = _G.uname()
  sysname = distro.sysname or ""
  release = distro.release or ""
elseif (vim.uv or vim.loop) and (vim.uv or vim.loop).os_uname then
  local u = (vim.uv or vim.loop).os_uname()
  sysname = u.sysname or ""
  release = u.release or ""
end
_G.OS = sysname
_G.IS_MAC = sysname == "Darwin"
_G.IS_LINUX = sysname == "Linux"
_G.IS_WINDOWS = (vim.fn.has("win32") == 1) or (sysname:find("Windows") ~= nil)
_G.IS_WSL = (_G.IS_LINUX and release:lower():find("microsoft") ~= nil) or (vim.fn.has("wsl") == 1)

vim.opt.clipboard = "unnamedplus" -- use system clipboard
if IS_WSL then
  vim.g.clipboard = {
    name = "win32yank-wsl",
    copy = {
      ["+"] = "win32yank.exe -i --crlf",
      ["*"] = "win32yank.exe -i --crlf",
    },
    paste = {
      ["+"] = "win32yank.exe -o --lf",
      ["*"] = "win32yank.exe -o --lf",
    },
    cache_enabled = true,
  }
elseif os.getenv("SSH_TTY") ~= nil or os.getenv("SSH_CONNECTION") ~= nil then
  -- SSH session: send yanks to the local clipboard via OSC 52.
  -- OSC 52 reads hang on terminal multiplexers (herdr, tmux), so we use
  -- Neovim's internal registers (no clipboard sync) and only push yanks
  -- out to the system clipboard via the TextYankPost autocmd.
  -- For system clipboard paste, use Cmd+V / Ctrl+Shift+V.
  vim.opt.clipboard = "" -- no automatic sync (avoids broken OSC 52 reads)
  local osc52 = require("clipboard.osc52_bel")

  vim.api.nvim_create_autocmd("TextYankPost", {
    group = vim.api.nvim_create_augroup("osc52-yank", { clear = true }),
    callback = function()
      local reg = vim.v.event.regname == '' and '"' or vim.v.event.regname
      local content = vim.fn.getreg(reg)
      if content ~= '' then
        osc52.send('c', vim.base64.encode(content))
      end
    end,
  })
end

vim.opt.number = true -- show absolute number
vim.opt.relativenumber = true -- add numbers to each line on the left side

-- highlight yanked text
vim.api.nvim_create_autocmd("TextYankPost", {
  desc = "Highlight when yanking text",
  group = vim.api.nvim_create_augroup("yank-highlight", { clear = true }),
  callback = function()
    vim.hl.on_yank()
  end,
})

vim.api.nvim_create_autocmd("FileType", {
  pattern = { "json" },
  callback = function()
    vim.api.nvim_set_option_value("formatprg", "jq", { scope = "local" })
  end,
})

if not vim.g.vscode then
  local autocmd = vim.api.nvim_create_autocmd
  local augroup = vim.api.nvim_create_augroup

  -- Read the home directory portably across Unix and Windows
  local home = os.getenv("HOME") or os.getenv("USERPROFILE") or ((vim.uv or vim.loop) and (vim.uv or vim.loop).os_homedir()) or ""
  home = home:gsub("\\", "/")

  -- the following lines are for relative number to be disabled in insert mode
  local number_toggle = augroup("numbertoggle", { clear = true })

  -- set filetype for .http and .rest to http
  autocmd({ "BufNewFile", "BufRead" }, {
    pattern = "*.http",
    command = "set filetype=http",
  })
  --
  -- set filetype for .denoflare to jsonc
  autocmd({ "BufNewFile", "BufRead" }, {
    pattern = "*.denoflare",
    command = "set filetype=jsonc",
  })

  autocmd({ "InsertLeave" }, {
    pattern = "*",
    command = "setlocal relativenumber",
    group = number_toggle,
  })

  autocmd({ "InsertEnter" }, {
    pattern = "*",
    command = "setlocal norelativenumber",
    group = number_toggle,
  })

  -- auto-reload files when modified externally
  -- https://unix.stackexchange.com/a/383044
  vim.o.autoread = true
  autocmd({ "BufEnter", "CursorHold", "CursorHoldI", "FocusGained" }, {
    command = "if mode() != 'c' | checktime | endif",
    pattern = { "*" },
  })

  -- Autocmd commands
  -- -- Persistent Folds
  -- local save_fold = augroup("Persistent Folds", { clear = true })
  -- autocmd("BufWinLeave", {
  -- 	pattern = "*.*",
  -- 	callback = function()
  -- 		vim.cmd.mkview()
  -- 	end,
  -- 	group = save_fold,
  -- })
  -- autocmd("BufWinEnter", {
  -- 	pattern = "*.*",
  -- 	callback = function()
  -- 		vim.cmd.loadview({ mods = { emsg_silent = true } })
  -- 	end,
  -- 	group = save_fold,
  -- })

  -- Persistent Cursor
  autocmd("BufReadPost", {
    callback = function()
      local mark = vim.api.nvim_buf_get_mark(0, '"')
      local lcount = vim.api.nvim_buf_line_count(0)
      if mark[1] > 0 and mark[1] <= lcount then
        pcall(vim.api.nvim_win_set_cursor, 0, mark)
      end
    end,
  })

  -- Cursor Line on each window
  autocmd({ "InsertLeave", "WinEnter" }, {
    callback = function()
      local ok, cl = pcall(vim.api.nvim_win_get_var, 0, "auto-cursorline")
      if ok and cl then
        vim.wo.cursorline = true
        vim.api.nvim_win_del_var(0, "auto-cursorline")
      end
    end,
  })
  autocmd({ "InsertEnter", "WinLeave" }, {
    callback = function()
      local cl = vim.wo.cursorline
      if cl then
        vim.api.nvim_win_set_var(0, "auto-cursorline", cl)
        vim.wo.cursorline = false
      end
    end,
  })

  -- Set filetype for i3 config files
  autocmd({ "BufRead", "BufNewFile" }, {
    pattern = home .. "/.config/i3/*.conf",
    callback = function()
      vim.bo.filetype = "i3config"
    end,
  })

  function _G.set_terminal_keymaps()
    local opts = { noremap = true, silent = true, buffer = 0 }
    vim.keymap.set("t", "<C-a>", "<A-Down>i", opts)
    vim.keymap.set("t", "<C-e>", "<A-Up>", opts)
    -- vim.keymap.set("t", "<esc>", [[<C-\><C-n>]], opts)
    vim.keymap.set("t", "jk", [[<C-\><C-n>]], opts)
    vim.keymap.set("t", "<C-h>", [[<Cmd>wincmd h<CR>]], opts)
    vim.keymap.set("t", "<C-j>", [[<Cmd>wincmd j<CR>]], opts)
    vim.keymap.set("t", "<C-k>", [[<Cmd>wincmd k<CR>]], opts)
    vim.keymap.set("t", "<C-l>", [[<Cmd>wincmd l<CR>]], opts)
    vim.keymap.set("t", "<C-w>", [[<C-\><C-n><C-w>]], opts)
  end

  -- if you only want these mappings for toggle term use term://*toggleterm#* instead
  vim.cmd("autocmd! TermOpen term://* lua set_terminal_keymaps()")
end
