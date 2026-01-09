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
    import = "plugins",
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
  install = {
    colorscheme = { "catppuccin" },
  },
  ui = {
    border = "rounded",
  },
})
