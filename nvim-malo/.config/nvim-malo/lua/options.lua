vim.cmd("set expandtab")
vim.cmd("set tabstop=2")
vim.cmd("set softtabstop=2")
vim.cmd("set shiftwidth=2")
vim.cmd("set ignorecase")
vim.cmd("set smartcase")
vim.cmd("set mousemodel=extend")

vim.opt.signcolumn = "yes"

_G.IS_WSL = nil
if pcall(require, "uname") then
  local distro = uname()
  -- print("-------------- TABLE --------------")
  -- print('Sysname', distro.sysname)
  -- print('Nodename', distro.nodename)
  -- print('Release', distro.release)
  -- print('Version', distro.version)
  -- print('Machine', distro.machine)
  _G.OS = distro.sysname
  _G.IS_MAC = OS == "Darwin"
  _G.IS_LINUX = OS == "Linux"
  _G.IS_WINDOWS = OS:find("Windows") and true or false
  _G.IS_WSL = IS_LINUX and distro.release:lower():find("microsoft") and true or false
end

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
end

vim.opt.number = true -- show absolute number
vim.opt.relativenumber = true -- add numbers to each line on the left side

-- highlight yanked text
vim.api.nvim_create_autocmd("TextYankPost", {
  desc = "Highlight when yankink text",
  group = vim.api.nvim_create_augroup("yank-highlight", { clear = true }),
  callback = function()
    vim.highlight.on_yank()
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

  -- Read the HOME environment variable
  local home = os.getenv("HOME")

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
