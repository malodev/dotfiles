-- File navigation plugins: oil.nvim, yazi
function _G.get_oil_winbar()
	local ok, oil = pcall(require, "oil")
	if not ok then
		return vim.api.nvim_buf_get_name(0)
	end
	local dir = oil.get_current_dir()
	if dir then
		return vim.fn.fnamemodify(dir, ":~")
	else
		return vim.api.nvim_buf_get_name(0)
	end
end

return {
  -- Oil.nvim: Edit file system like a buffer
  {
    "stevearc/oil.nvim",
    opts = {
      win_options = {
        winbar = "%!v:lua.get_oil_winbar()",
      },
      columns = { "icon" },
      keymaps = {
        ["<C-o>"] = { "actions.select", opts = { vertical = true } },
        ["<C-s>"] = { "<CMD>w<CR>", desc = "Save changes" },
        ["<C-.>"] = { "actions.toggle_hidden", desc = "Toggle hidden files" },
      },
      view_options = {
        show_hidden = true,
      },
    },
    keys = {
      { "-", "<cmd>Oil<cr>", desc = "Oil: Open parent directory" },
    },
    config = function(_, opts)
      local detail = false
      local ok, oil = pcall(require, "oil")
      if ok then
        opts.keymaps["gd"] = {
          desc = "Toggle file detail view",
          callback = function()
            detail = not detail
            if detail then
              oil.set_columns({ "icon", "permissions", "size", "mtime" })
            else
              oil.set_columns({ "icon" })
            end
          end,
        }
        oil.setup(opts)
      end
    end,
  },

  -- Yazi: File manager integration
  {
    "mikavilpas/yazi.nvim",
    event = "VeryLazy",
    keys = {
      {
        "<leader>fy",
        function()
          require("yazi").yazi()
        end,
        desc = "Open yazi",
      },
      {
        "_",
        function()
          require("yazi").yazi()
        end,
        desc = "Open yazi",
      },
    },
    opts = {
      open_for_directories = false,
    },
  },
}
