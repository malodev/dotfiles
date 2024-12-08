return {
  "nvim-treesitter/nvim-treesitter",
  build = ":TSUpdate",
  dependencies = {
    -- Additional Nushell parser
    { "nushell/tree-sitter-nu", build = ":TSUpdate nu" },

    { "nvim-treesitter/playground" },

  },

  config = function()
    local configs = require("nvim-treesitter.configs")
    configs.setup({
      modules = {},
      auto_install = true,
      ignore_install = {},
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
        "nu"
      },
      sync_install = false,
      highlight = { enable = true },
      indent = { enable = true },
      playground = {
        enable = true,
        updatetime = 25,
        persist_queries = false,
      },
    })
  end
}
