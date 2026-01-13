-- Lualine statusline configuration
return {
  "nvim-lualine/lualine.nvim",
  event = "VeryLazy",
  dependencies = {
    "nvim-tree/nvim-web-devicons",
    "AndreM222/copilot-lualine",
  },
  config = function()
    local ok_config, config = pcall(require, "config")
    local ok_lualine, lualine = pcall(require, "lualine")
    if not ok_config or not ok_lualine then
      return
    end
    local icons = config.icons
    local inactive_colors = { fg = "#EB9A97", bg = "#393552" }
    lualine.setup({
      options = {
        theme = "rose-pine",
        section_separators = { left = "", right = "" },
        component_separators = { left = "", right = "" },
        icons_enabled = true,
        globalstatus = false,
        ignore_focus = { "NvimTree" },
      },
      sections = {
        lualine_a = { { "mode", icons_enabled = true, icon = "" } },
        lualine_b = { "branch" },
        lualine_c = {
          {
            "diagnostics",
            symbols = {
              error = icons.diagnostics.Error,
              warn = icons.diagnostics.Warn,
              info = icons.diagnostics.Info,
              hint = icons.diagnostics.Hint,
            },
          },
          { "filetype", icon_only = true, separator = "", padding = { left = 1, right = 0 } },
          "filename",
        },
        lualine_x = {
          {
            "rest",
            icon = "",
            fg = "#428890",
          },
          { "copilot", show_colors = true, show_loading = true },
          "encoding",
          "fileformat",
          "filetype",
          {
            "diff",
            symbols = {
              added = icons.git.added,
              modified = icons.git.modified,
              removed = icons.git.removed,
            },
            source = function()
              local gitsigns = vim.b.gitsigns_status_dict
              if gitsigns then
                return {
                  added = gitsigns.added,
                  modified = gitsigns.changed,
                  removed = gitsigns.removed,
                }
              end
            end,
          },
        },
        lualine_y = {
          { "progress", separator = " ", padding = { left = 1, right = 0 } },
          { "location", padding = { left = 0, right = 1 } },
        },
        lualine_z = {
          require("opencode").statusline,
          function()
            return " " .. os.date("%R")
          end,
        },
      },
      inactive_sections = {
        lualine_c = {
          {
            "filetype",
            icon_only = true,
            separator = "",
            padding = { left = 1, right = 0 },
            color = inactive_colors,
          },
          { "filename", color = inactive_colors },
        },
        lualine_y = {
          {
            "progress",
            separator = " ",
            padding = { left = 1, right = 0 },
            color = inactive_colors,
          },
          {
            "location",
            padding = { left = 0, right = 1 },
            color = inactive_colors,
          },
        },
        lualine_z = {
          {
            require("opencode").statusline,
            color = inactive_colors,
          },
        },
      },
      extensions = {},
    })
  end,
}
