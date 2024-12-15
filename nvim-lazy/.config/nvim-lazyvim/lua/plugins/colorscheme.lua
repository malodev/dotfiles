return {
  -- { "shaunsingh/nord.nvim" },
  {
    "catppuccin/nvim",
    name = "catppuccin",
    priority = 1000,
    -- options for catppuccin. This will automatically call `require("catppuccin").setup(opts)`
    --   opts = {
    opts = {
      flavour = "mocha", -- latte, frappe, macchiato, mocha
      background = { -- :h background
        light = "latte",
        dark = "mocha",
      },
      transparent_background = true, -- disables setting the background color.
      styles = { -- Handles the styles of general hi groups (see `:h highlight-args`):
        comments = { "italic" }, -- Change the style of comments
        conditionals = { "italic" },
        loops = {},
        functions = {},
        keywords = { "italic", "bold" },
        strings = { "italic" },
        variables = {},
        numbers = {},
        booleans = {},
        properties = {},
        types = {},
        operators = {},
      },
      integrations = {
        cmp = true,
        treesitter = true,
        telescope = { enabled = true },
        harpoon = true,
      },
    },

    config = function(_, opts)
      require("catppuccin").setup(opts)
      vim.cmd.colorscheme("catppuccin")
    end,
  },
  --
  -- {
  --   "habamax/vim-habamax",
  -- },
  -- Configure LazyVim to load gruvbox

  {
    "LazyVim/LazyVim",
    opts = {
      colorscheme = "catppuccin",
    },
  },
}
