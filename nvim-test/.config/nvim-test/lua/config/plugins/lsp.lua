return {
  { 'neovim/nvim-lspconfig',
    dependencies = {
      {
        "folke/lazydev.nvim",
        ft = "lua",
        opts = {
          library = {
            { path = "${3rd}/luv/library", words = { "vim%.uv" }}
          }
        }
      }
    },
    config = function()
      local lsp = require "lspconfig"
      lsp.lua_ls.setup({})
    end
  },
  { "williamboman/mason.nvim",
    config = function()
      require("mason").setup()
    end
  }
}
