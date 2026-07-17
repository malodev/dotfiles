-- Theme configuration: Rose Pine (default), Catppuccin, Kanagawa
vim.keymap.set("n", "<leader>tk", "<cmd>colorscheme kanagawa-dragon<cr>")
vim.keymap.set("n", "<leader>tc", "<cmd>colorscheme catppuccin<cr>")
vim.keymap.set("n", "<leader>tr", "<cmd>colorscheme rose-pine-moon<cr>")

return {
  -- Rose Pine (default theme)
  {
    "rose-pine/neovim",
    name = "rose-pine",
    lazy = false,
    priority = 1000,
    config = function()
      local ok, rose_pine = pcall(require, "rose-pine")
      if not ok then
        return
      end
      rose_pine.setup({
        variant = "moon", -- auto, main, moon, dawn
        dark_variant = "main",
        dim_inactive_windows = false,
        extend_background_behind_borders = true,
        enable = {
          terminal = true,
          legacy_highlights = true,
          migrations = true,
        },
        styles = {
          bold = true,
          italic = true,
          transparency = true,
        },
        groups = {
          border = "muted",
          link = "iris",
          panel = "surface",
          error = "love",
          hint = "iris",
          info = "foam",
          note = "pine",
          todo = "rose",
          warn = "gold",
          git_add = "foam",
          git_change = "rose",
          git_delete = "love",
          git_dirty = "rose",
          git_ignore = "muted",
          git_merge = "iris",
          git_rename = "pine",
          git_stage = "iris",
          git_text = "rose",
          git_untracked = "subtle",
          h1 = "iris",
          h2 = "foam",
          h3 = "rose",
          h4 = "gold",
          h5 = "pine",
          h6 = "foam",
        },
        highlight_groups = {},
        before_highlight = function(_group, _highlight, _palette)
          -- Disable all undercurls
        end,
      })

      vim.api.nvim_set_hl(0, "LineNrAbove", { fg = "grey" })
      vim.api.nvim_set_hl(0, "LineNr", { fg = "orange" })
      vim.api.nvim_set_hl(0, "LineNrBelow", { fg = "grey" })

      vim.cmd.colorscheme("rose-pine")
    end,
  },

  -- Catppuccin
  {
    "catppuccin/nvim",
    name = "catppuccin",
    opts = {
      flavour = "mocha", -- latte, frappe, macchiato, mocha
      background = {
        light = "latte",
        dark = "mocha",
      },
      transparent_background = true,
      styles = {
        comments = { "italic" },
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
      custom_highlights = function(colors)
        return {
          LineNrAbove = { fg = colors.overlay0 },
          LineNr = { fg = colors.peach, bold = true },
          LineNrBelow = { fg = colors.overlay0 },
          SignColumn = { bg = colors.none },
        }
      end,
      integrations = {
        cmp = true,
        treesitter = true,
        telescope = { enabled = true },
        harpoon = true,
      },
    },
    config = function(_, opts)
      local ok, catppuccin = pcall(require, "catppuccin")
      if ok then
        catppuccin.setup(opts)
      end
    end,
  },

  -- Kanagawa
  {
    "rebelot/kanagawa.nvim",
    config = function()
      local ok, kanagawa = pcall(require, "kanagawa")
      if not ok then
        return
      end
      kanagawa.setup({
        compile = false,
        undercurl = true,
        commentStyle = { italic = true },
        functionStyle = {},
        keywordStyle = { italic = true },
        statementStyle = { bold = true },
        typeStyle = {},
        transparent = true,
        dimInactive = true,
        terminalColors = true,
        colors = {
          palette = {},
          theme = { wave = {}, lotus = {}, dragon = {}, all = {} },
        },
        overrides = function(_colors)
          return {}
        end,
        theme = "dragon",
        background = {
          dark = "dragon",
          light = "lotus",
        },
      })
    end,
  },
}
