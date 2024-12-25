return {
    'nvim-lualine/lualine.nvim',
    dependencies = { 'nvim-tree/nvim-web-devicons' },
    opts = {
      options = {
        theme = 'catppuccin',
        section_separators = { left = '', right = '' },
        component_separators = { left = '', right = '' }
      },
      sections = {
        lualine_a = { 'mode' },
        lualine_b = { 'branch', 'diff', 'diagnostics' },
        lualine_c = { 'filename' },
        lualine_x = { { 'copilot', show_colors = true, show_loading = true } ,'encoding', 'fileformat', 'filetype' }, -- I added copilot here
        lualine_y = { 'progress' },
        lualine_z = { 'location' }
      }
    }
}
