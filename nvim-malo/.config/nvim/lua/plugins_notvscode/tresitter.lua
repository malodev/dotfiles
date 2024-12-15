return {
  "nvim-treesitter/nvim-treesitter",
  build = ":TSUpdate",
  dependencies = {
    -- Additional Nushell parser
    { "nushell/tree-sitter-nu", build = ":TSUpdate nu" },
  },

  config = function()
    local configs = require("nvim-treesitter.configs")
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
        "nu"
      },
      sync_install = false,
      highlight = { enable = true },
      indent = { enable = true },
    })
  end,
}
