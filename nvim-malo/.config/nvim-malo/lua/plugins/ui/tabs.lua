-- Bufferline configuration
return {
  {
    "akinsho/bufferline.nvim",
    version = "*",
    dependencies = "nvim-tree/nvim-web-devicons",
    enabled = function()
      local ok_config, config = pcall(require, "config")
      return ok_config and config.is_enabled.bufferline or false
    end,
    event = "VeryLazy",
    config = function()
      vim.opt.termguicolors = true
      local ok, bufferline = pcall(require, "bufferline")
      if not ok then
        return
      end
      bufferline.setup({
        options = {
          indicator = {
            icon = "", -- this should be omitted if indicator style is not 'icon'
            style = "underline", -- 'icon' | 'underline' | 'none',
          },
          separator_style = { "", "" },
          diagnostics = "nvim_lsp",
          ---@diagnostic disable-next-line: unused-local
          diagnostics_indicator = function(count, _level, diagnostics_dict, _context)
            local s = " "
            for e, n in pairs(diagnostics_dict) do
              local sym = e == "error" and " " or (e == "warning" and " " or " ")
              s = s .. n .. sym
            end
            return s
          end,
          offsets = {
            {
              filetype = "NvimTree",
              text = "Explorer",
              text_align = "center",
              separator = true,
            },
          },
          groups = {
            items = {
              require("bufferline.groups").builtin.pinned:with({ icon = "" }),
            },
          },
        },
        highlights = {
          indicator_selected = {
            fg = "#aff17e",
            bg = "#000000",
          },
          separator = {
            fg = "#333333",
            bg = "#000000",
          },
        },
      })
    end,
  },
}
