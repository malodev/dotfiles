---@diagnostic disable: missing-fields
local lsp_language_servers = {
  "html",
  "tailwindcss",
  "ts_ls",
  "eslint",
  "emmet_language_server",
  "lua_ls",
  "jsonls",
  "biome",
  "gopls",
  "basedpyright",
  "marksman",
  "astro",
  "harper_ls",
  "intelephense",
  "denols",
  "sqlls",
  "bashls",
}
vim.diagnostic.config({ virtual_text = false })
local ok_config, config = pcall(require, "config")
local useBlink = ok_config and config.is_enabled.blink or false
return {

  -- LSP part
  {
    "williamboman/mason.nvim",
    lazy = false,
    opts = {},
    config = function()
      local ok, mason = pcall(require, "mason")
      if not ok then
        return
      end
      ---@diagnostic disable-next-line: missing-fields
      mason.setup({
        ui = {
          icons = {
            package_installed = "✓",
            package_pending = "➜",
            package_uninstalled = "✗",
          },
          border = "rounded",
        },
      })
    end,
  },
  {
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    lazy = false,
    config = function()
      local ok, mason_tool_installer = pcall(require, "mason-tool-installer")
      if not ok then
        return
      end

      -- Build ensure_installed list, conditionally including PHP tools
      local ensure_installed = {
        "tree-sitter-cli",
        "shfmt",
        "dprint",
        "prettierd",
        "prettier",
        "black",
        "isort",
      }

      -- Only add PHP tools if PHP is installed
      if vim.fn.executable("php") == 1 then
        table.insert(ensure_installed, "pint")
        table.insert(ensure_installed, "php-cs-fixer")
      end

      mason_tool_installer.setup({
        ensure_installed = ensure_installed,
      })
    end,
  },
  {
    "williamboman/mason-lspconfig.nvim",
    dependencies = {
      {
        "hrsh7th/nvim-cmp",
        enabled = not useBlink,
      },
      { "saghen/blink.cmp", enabled = useBlink },
    },
    opts = {
      automatic_installation = true,
      ensure_installed = lsp_language_servers,
      automatic_enable = true, -- This replaces setup_handlers for basic setups
    },
    config = function(_, opts)
      -- Set up capabilities first
      local capabilities

      if useBlink then
        local ok_blink, blink = pcall(require, "blink.cmp")
        if ok_blink then
          capabilities = blink.get_lsp_capabilities()
        else
          capabilities = vim.lsp.protocol.make_client_capabilities()
        end
      else
        local ok_cmp, cmp_nvim_lsp = pcall(require, "cmp_nvim_lsp")
        if ok_cmp then
          capabilities = cmp_nvim_lsp.default_capabilities()
        else
          capabilities = vim.lsp.protocol.make_client_capabilities()
        end
      end

      capabilities.textDocument.foldingRange = {
        dynamicRegistration = false,
        lineFoldingOnly = true,
      }
      -- Configure servers using vim.lsp.config() BEFORE mason-lspconfig.setup()
      -- This is the new way in Neovim 0.11+

      -- Lua LS
      vim.lsp.config("lua_ls", {
        cmd = { "lua-language-server" },
        root_markers = {
          ".luarc.json",
          ".luarc.jsonc",
          ".luacheckrc",
          ".stylua.toml",
          "stylua.toml",
          "selene.toml",
          "selene.yml",
          ".git",
        },
        capabilities = capabilities,
        settings = {
          Lua = {
            hint = {
              enable = true,
            },
            diagnostics = {
              globals = { "vim" },
            },
            workspace = {
              library = {
                [vim.fn.expand("$VIMRUNTIME/lua")] = true,
                [vim.fn.expand("$VIMRUNTIME/lua/vim/lsp")] = true,
              },
            },
          },
        },
      })
			-- Stylua LSP - DISABLE (v2.0+ removed --lsp flag, use separate stylua-lsp instead)
			vim.lsp.config("stylua", {
				cmd = { "echo", "stylua LSP is disabled" },
			})

      -- TypeScript/JavaScript
      vim.lsp.config("ts_ls", {
        cmd = { "typescript-language-server", "--stdio" },
        root_markers = { "package.json" },
        single_file_support = false,
        capabilities = capabilities,
        settings = {
          typescript = {
            inlayHints = {
              includeInlayParameterNameHints = "all",
              includeInlayParameterNameHintsWhenArgumentMatchesName = true,
              includeInlayVariableTypeHintsWhenTypeMatchesName = true,
              includeInlayFunctionParameterTypeHints = true,
              includeInlayVariableTypeHints = true,
              includeInlayPropertyDeclarationTypeHints = true,
              includeInlayFunctionLikeReturnTypeHints = true,
              includeInlayEnumMemberValueHints = true,
            },
          },
          javascript = {
            inlayHints = {
              includeInlayVariableTypeHintsWhenTypeMatchesName = true,
              includeInlayParameterNameHints = "all",
              includeInlayParameterNameHintsWhenArgumentMatchesName = false,
              includeInlayFunctionParameterTypeHints = true,
              includeInlayVariableTypeHints = true,
              includeInlayPropertyDeclarationTypeHints = true,
              includeInlayFunctionLikeReturnTypeHints = true,
              includeInlayEnumMemberValueHints = true,
            },
          },
        },
      })

      -- Basedpyright
      vim.lsp.config("basedpyright", {
        cmd = { "basedpyright-langserver", "--stdio" },
        capabilities = capabilities,
        settings = {
          basedpyright = {
            analysis = {
              typeCheckingMode = "off",
              inlayHints = {
                variableTypes = true,
                callArgumentNames = true,
                functionReturnTypes = true,
                genericTypes = true,
              },
            },
          },
        },
      })

      -- Harper LS
      vim.lsp.config("harper_ls", {
        cmd = { "harper-ls", "--stdio" },
        capabilities = capabilities,
        settings = {
          ["harper-ls"] = {
            userDictPath = "~/.local/share/dict.txt",
            fileDictPath = "~/.harper/",
            linters = {
              spell_check = true,
              spelled_numbers = false,
              an_a = true,
              sentence_capitalization = false,
              unclosed_quotes = true,
              wrong_quotes = false,
              long_sentences = true,
              repeated_words = true,
              spaces = true,
              matcher = true,
              correct_number_suffix = true,
              number_suffix_capitalization = true,
              multiple_sequential_pronouns = true,
              linking_verbs = false,
              avoid_curses = true,
              terminating_conjunctions = true,
            },
          },
        },
      })

      -- Deno
      vim.lsp.config("denols", {
        cmd = { "deno", "lsp" },
        root_markers = { "deno.json", "deno.jsonc" },
        capabilities = capabilities,
      })

      -- Bash LS
      vim.lsp.config("bashls", {
        cmd = { "bash-language-server", "start" },
        filetypes = { "bash", "sh", "zsh" },
        capabilities = capabilities,
      })

      -- HTML
      vim.lsp.config("html", {
        cmd = { "vscode-html-language-server", "--stdio" },
        filetypes = { "html", "templ", "svg" },
        capabilities = capabilities,
      })

      -- Now setup mason-lspconfig
      -- automatic_enable will call vim.lsp.enable() for installed servers
      local ok_mason_lsp, mason_lspconfig = pcall(require, "mason-lspconfig")
      if ok_mason_lsp then
        mason_lspconfig.setup(opts)
      end
    end,
  },
  {
    "neovim/nvim-lspconfig",
    dependencies = {
      {
        "folke/lazydev.nvim",
        ft = "lua",
        opts = {
          library = {
            { path = "${3rd}/luv/library", words = { "vim%.uv" } },
          },
        },
      },
    },
    lazy = false,
    config = function()
      ---
      -- UI settings
      ---
      local border_style = vim.g.lsp_zero_ui_float_border
      if border_style == nil then
        border_style = "rounded"
      end
      if type(border_style) == "string" then
        vim.diagnostic.config({
          float = { border = border_style },
        })
      end
      local signs = vim.g.lsp_zero_ui_signcolumn
      if (signs == nil and vim.o.signcolumn == "auto") or signs == 1 or signs == true then
        vim.o.signcolumn = "yes"
      end
      vim.keymap.set(
        "n",
        "K",
        "<cmd>Lspsaga hover_doc<cr>",
        { desc = "Lspsaga: Displays hover information about the symbol under the cursor in a floating window" }
      )
      vim.keymap.set(
        "n",
        "<leader>ca",
        vim.lsp.buf.code_action,
        { desc = "Selects a code action available at the current cursor position." }
      )
      vim.keymap.set(
        "n",
        "<leader>cr",
        vim.lsp.buf.rename,
        { desc = "Renames all references to the symbol under the cursor" }
      )
      vim.keymap.set("n", "<leader>ci", "<cmd>LspInfo<cr>", { desc = "Lsp Info" })
      vim.keymap.set(
        "n",
        "gd",
        vim.lsp.buf.definition,
        { desc = " Jumps to the definition of the symbol under the cursor" }
      )
      vim.keymap.set(
        "n",
        "gr",
        vim.lsp.buf.references,
        { desc = "Lists all the references to the symbol under the cursor in the quickfix window." }
      )
      vim.keymap.set(
        "n",
        "gD",
        vim.lsp.buf.declaration,
        { desc = "Jumps to the declaration of the symbol under the cursor" }
      )
      vim.keymap.set("n", "gK", function()
        return vim.lsp.buf.signature_help()
      end, { desc = "Displays signature help for the symbol under the cursor" })
      vim.keymap.set(
        "n",
        "gy",
        vim.lsp.buf.type_definition,
        { desc = "Jumps to the definition of the type of the symbol under the cursor" }
      )
      vim.keymap.set(
        "n",
        "gi",
        "<cmd>lua vim.lsp.buf.implementation()<cr>",
        { desc = "Lists all the implementations for the symbol under the cursor in the quickfix window" }
      )
      vim.keymap.set(
        "n",
        "go",
        "<cmd>lua vim.lsp.buf.type_definition()<cr>",
        { desc = "Jumps to the definition of the type of the symbol under the cursor." }
      )
      vim.keymap.set(
        "n",
        "<F2>",
        vim.lsp.buf.rename,
        { desc = "Renames all references to the symbol under the cursor" }
      )
      vim.keymap.set(
        { "n", "x", "i" },
        "<F3>",
        "<cmd>lua vim.lsp.buf.format({async = true})<cr><ESC>zzi",
        { desc = "Format code in current buffer" }
      )
      vim.keymap.set(
        { "n", "x" },
        "<F3>",
        "<cmd>lua vim.lsp.buf.format({async = true})<cr>zz",
        { desc = "Format code in current buffer" }
      )
      vim.keymap.set(
        "n",
        "<F4>",
        "<cmd>Lspsaga code_action<cr>",
        { desc = "Selects a code action available at the current cursor position." }
      )
      vim.keymap.set(
        "n",
        "gl",
        "<cmd>Lspsaga show_line_diagnostics<cr>",
        { desc = "Show diagnostics in a floating window" }
      )
      vim.keymap.set(
        "n",
        "[d",
        "<cmd>lua vim.diagnostic.jump({ count = -1, float = true })<cr>",
        { desc = "Move to the previous diagnostic in the current buffer" }
      )
      vim.keymap.set(
        "n",
        "]d",
        "<cmd>lua vim.diagnostic.jump({ count = 1, float = true })<cr>",
        { desc = "Move to the next diagnostic" }
      )
    end,
  },
  {
    "nvimdev/lspsaga.nvim",
    enabled = true,
    after = "nvim-lspconfig",
    config = function()
      require("lspsaga").setup({
        lightbulb = {
          enable = false,
        },
      })
    end,
  },
}
