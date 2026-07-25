-- lazy install
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable", -- latest stable release
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)
vim.g.mapleader = " "
vim.g.maplocalleader = " "
require("lazy").setup({
  {
    name = "plugins",
    import = function()
      -- Load the curated plugin entrypoint instead of scanning every top-level file.
      -- This avoids loading optional machine-local symlinks like plugins/theme.lua.
      return require("plugins")
    end,
    cond = function()
      return not vim.g.vscode
    end,
  },
  { import = "plugins_always", cond = true },
  {
    import = "plugins_vscode",
    cond = function()
      return vim.g.vscode
    end,
  },
  {
    import = "plugins_notvscode",
    cond = false,
  },
}, {
  rocks = {
    hererocks = true, -- Enable Hererocks to manage Lua dependencies
  },
  git = {
    -- Some plugins (notably copilot.lua) include large generated assets.
    -- The default 120s timeout can kill checkout mid-way on slower networks/filesystems.
    timeout = 300,
  },
  install = {
    colorscheme = { "catppuccin" },
  },
  ui = {
    border = "rounded",
  },
})
