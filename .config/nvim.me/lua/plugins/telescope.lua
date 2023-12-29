return {
  {
    'nvim-telescope/telescope.nvim',
    tag = '0.1.5',
    dependencies = {
      'nvim-lua/plenary.nvim',
      "folke/trouble.nvim",
    },
--    opts = {
--      defaults = {
--        mappings = {
--          i = { ["<c-t>"] = require("trouble.providers.telescope").open_with_trouble },
--          n = { ["<c-t>"] = require("trouble.providers.telescope").open_with_trouble },
--        },
--      },
--
--    },
    config = function()
 --     require("telescope").setup(opts)
      require('telescope').load_extension('fzf')
    end,
    keys = {
      { "<leader>ff", "<cmd>Telescope find_files<CR>", desc = "telescope: find_files" },
      { "<leader>fg", "<cmd>Telescope live_grep<CR>",  desc = "telescope: live_grep" },
      { "<leader>fb", "<cmd>Telescope buffers<CR>",    desc = "telescope: buffers" },
      { "<leader>fo", "<cmd>Telescope oldfiles<CR>",   desc = "telescope: oldfiles" },

    },
  },
  { 'nvim-telescope/telescope-fzf-native.nvim', build = 'make' },
  {
    'nvim-telescope/telescope-ui-select.nvim',
    config = function()
      require("telescope").setup {
        extensions = {
          ["ui-select"] = {
            require("telescope.themes").get_dropdown {
            }
          }
        }
      }
      require("telescope").load_extension("ui-select")
    end

  }
}
