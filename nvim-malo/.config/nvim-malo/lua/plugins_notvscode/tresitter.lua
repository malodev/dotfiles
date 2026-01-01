return {
  {
    "nvim-treesitter/nvim-treesitter",
    lazy = false,
    build = ":TSUpdate",
    config = function()
      local configs = require("nvim-treesitter.configs")
      ---@diagnostic disable-next-line: missing-fields
      configs.setup({
        ensure_installed = {
          "c",
          "lua",
          "vim",
          "javascript",
          "typescript",
          "tsx",
          "css",
          "html",
          "markdown",
          "markdown_inline",
          "bash",
          "regex",
          "http",
          "xml",
          "graphql",
          "json",
          "dockerfile",
          "astro",
          "php",
          "nu",
        },
        sync_install = false,
        highlight = { enable = true },
        indent = { enable = true },
      })
    end,
  },
  {
    event = { "VeryLazy" },
    "nushell/tree-sitter-nu",
    build = ":TSUpdate nu",
    dependencies = {
      "nvim-treesitter/nvim-treesitter",
    },
  },
}
