-- Completion configuration
-- Merges main completion engine (blink.cmp) with AI completion (copilot, codeium)
local useBlink = function()
  local ok_config, config = pcall(require, "config")
  return ok_config and config.is_enabled.blink or false
end
local has_nvim_011 = vim.fn.has("nvim-0.11") == 1
local blink_sources = { "lsp", "path", "snippets", "buffer", "copilot" }
if has_nvim_011 then
  table.insert(blink_sources, "codecompanion")
end

local copilot_node_command = function()
  local ok_config, config = pcall(require, "config")
  return ok_config and config.copilot_node_command or "node"
end

return {
  -- ============================================================================
  -- Copilot.lua (required for both blink.cmp and standalone usage)
  -- - When using blink.cmp: acts as LSP backend for blink-cmp-copilot (UI disabled)
  -- - When using standalone: provides full Copilot UI (panel/suggestions)
  -- ============================================================================
  {
    "zbirenbaum/copilot.lua",
    dependencies = { "zbirenbaum/copilot-cmp", "AndreM222/copilot-lualine" },
    event = "InsertEnter",
    opts = function()
      -- Disable Copilot's own UI when using blink.cmp (avoid conflicts)
      if useBlink() then
        return {
          panel = { enabled = false },
          suggestion = { enabled = false },
          filetypes = {
            yaml = true,
            markdown = true,
            help = false,
            gitcommit = true,
            gitrebase = true,
            hgcommit = false,
            svn = false,
            cvs = false,
            ["."] = false,
          },
          copilot_node_command = copilot_node_command(),
          server_opts_overrides = {},
        }
      end
      -- Enable full UI when using standalone
      return {
        panel = {
          enabled = true,
          auto_refresh = false,
          keymap = {
            jump_prev = "[[",
            jump_next = "]]",
            accept = "<CR>",
            refresh = "gr",
            open = "<M-CR>",
          },
          layout = {
            position = "bottom",
            ratio = 0.4,
          },
        },
        suggestion = {
          enabled = true,
          auto_trigger = false,
          hide_during_completion = true,
          debounce = 75,
          keymap = {
            accept = "<M-l>",
            accept_word = false,
            accept_line = false,
            next = "<C-]>",
            prev = "<C-[>",
            dismiss = "<C-q>",
          },
        },
        filetypes = {
          yaml = true,
          markdown = true,
          help = false,
          gitcommit = true,
          gitrebase = true,
          hgcommit = false,
          svn = false,
          cvs = false,
          ["."] = false,
        },
        copilot_node_command = copilot_node_command(),
        server_opts_overrides = {},
      }
    end,
  },

  -- ============================================================================
  -- Option 1: blink.cmp (modern completion engine with Copilot integration)
  -- ============================================================================
  {
    "saghen/blink.cmp",
    enabled = useBlink,
    event = "InsertEnter",
    dependencies = {
      "rafamadriz/friendly-snippets",
      "giuxtaposition/blink-cmp-copilot",
      {
        "L3MON4D3/LuaSnip",
        version = "v2.*",
        build = "make install_jsregexp",
      },
      { "olimorris/codecompanion.nvim", enabled = has_nvim_011 },
    },
    version = "*",

    ---@module 'blink.cmp'
    ---@type blink.cmp.Config
    opts = {
      keymap = {
        preset = "enter",
        ["<C-c>"] = {
          function(cmp)
            cmp.show({ providers = { "copilot" } })
          end,
        },
      },
      appearance = {
        nerd_font_variant = "mono",
        kind_icons = {
          Copilot = "",
          Text = "",
          Method = "",
          Function = "",
          Constructor = "",
          Field = "",
          Variable = "",
          Class = "",
          Interface = "",
          Module = "",
          Property = "",
          Unit = "",
          Value = "",
          Enum = "",
          Keyword = "",
          Snippet = "",
          Color = "",
          File = "",
          Reference = "",
          Folder = "",
          EnumMember = "",
          Constant = "",
          Struct = "",
          Event = "",
          Operator = "",
          TypeParameter = "",
        },
      },
      completion = {
        trigger = {
          prefetch_on_insert = false,
          show_in_snippet = true,
          show_on_keyword = true,
          show_on_trigger_character = true,
          show_on_blocked_trigger_characters = function()
            if vim.api.nvim_get_mode().mode == "c" then
              return {}
            end
            return { " ", "\n", "\t" }
          end,
          show_on_accept_on_trigger_character = true,
          show_on_insert_on_trigger_character = true,
          show_on_x_blocked_trigger_characters = { "'", '"', "(" },
        },
        list = {
          selection = {
            preselect = function(_)
              return false
            end,
            auto_insert = function(_)
              return true
            end,
          },
        },
        menu = {
          border = "rounded",
        },
        documentation = {
          window = {
            min_width = 10,
            max_width = 80,
            max_height = 20,
            border = "rounded",
            winblend = 0,
            winhighlight = "Normal:BlinkCmpDoc,FloatBorder:BlinkCmpDocBorder,EndOfBuffer:BlinkCmpDoc",
            scrollbar = true,
            direction_priority = {
              menu_north = { "e", "w", "n", "s" },
              menu_south = { "e", "w", "s", "n" },
            },
          },
          auto_show = true,
          auto_show_delay_ms = 500,
        },
        ghost_text = { enabled = false },
      },
      sources = {
        default = blink_sources,
        providers = {
          copilot = {
            name = "copilot",
            module = "blink-cmp-copilot",
            score_offset = 100,
            async = true,
            transform_items = function(_, items)
              local ok_blink_types, blink_types = pcall(require, "blink.cmp.types")
              if not ok_blink_types then
                return items
              end
              local CompletionItemKind = blink_types.CompletionItemKind
              local kind_idx = #CompletionItemKind + 1
              CompletionItemKind[kind_idx] = "Copilot"
              for _, item in ipairs(items) do
                item.kind = kind_idx
              end
              return items
            end,
          },
        },
      },
    },
    opts_extend = { "sources.default" },
  },

  -- ============================================================================
  -- Codeium: Free AI completion (independent, works with either option above)
  -- ============================================================================
  {
    "Exafunction/codeium.nvim",
    enabled = function()
      local ok_config, config = pcall(require, "config")
      return ok_config and config.is_enabled.codeium or false
    end,
    dependencies = {
      "nvim-lua/plenary.nvim",
    },
    event = "InsertEnter",
    config = function()
      local ok, codeium = pcall(require, "codeium")
      if not ok then
        return
      end
      codeium.setup({
        enable_chat = true,
        enable_cmp_source = false,
        virtual_text = {
          enabled = true,
          manual = false,
          filetypes = {},
          default_filetype_enabled = true,
          idle_delay = 75,
          virtual_text_priority = 65535,
          map_keys = true,
          accept_fallback = "<Tab>",
          key_bindings = {
            accept = "<Tab>",
            accept_word = "<C-;>",
            accept_line = "<C-'>",
            clear = false,
            next = "<C-.>",
            prev = "<C-,>",
          },
        },
      })
    end,
  },
}
