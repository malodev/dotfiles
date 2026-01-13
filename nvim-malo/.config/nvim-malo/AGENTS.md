# AGENTS.md

Neovim configuration (LazyVim-inspired) using lazy.nvim plugin manager with modular structure. Managed with GNU Stow.

## Build/Lint/Test Commands

### Formatting (Required for all Lua changes)

```bash
cd nvim-malo/.config/nvim-malo
stylua .                # Format all files
stylua path/to/file.lua # Format specific file
stylua --check .        # Verify without changes
```

**Format config**: 2 spaces, 120 column width (see `stylua.toml`)

### Verification

```bash
nvim                         # Check for errors
:LspInfo                     # LSP status
:checkhealth                  # Diagnostics
:Lazy sync                   # Update plugins
:Snacks notifier.show_history() # Logs
```

**No traditional tests** - verification is interactive.

## Code Style Guidelines

### Import Style

```lua
local ok, module = pcall(require, "module_name")
if not ok then return end

local ok_config, config = pcall(require, "config")
local useFeature = ok_config and config.is_enabled.feature_name or false
```

### Plugin Specification Pattern

```lua
return {
  {
    "author/plugin-name",
    lazy = false,  -- or event = "VeryLazy", cmd = "CommandName"
    dependencies = { { "other/plugin", cond = some_condition } },
    opts = { ... },
    config = function(_, opts)
      local ok, plugin = pcall(require, "plugin")
      if not ok then return end
      plugin.setup(opts)
    end,
  },
}
```

### Keymaps

```lua
local map = require("keymaps.util").safe_keymap_set
local opts = { noremap = true, silent = true }
local function tc(t1, t2) return vim.tbl_extend("force", t1, t2) end

map("n", "<leader>ff", "<cmd>Telescope find_files<cr>", { desc = "Find files" })
map("i", "<C-s>", "<Esc>:w<CR>", tc(opts, { desc = "Save" }))
```

**Pattern**: Always use `safe_keymap_set`, never `vim.keymap.set` directly.

### Autocmds

```lua
vim.api.nvim_create_autocmd("TextYankPost", {
  desc = "Highlight when yanking text",
  group = vim.api.nvim_create_augroup("yank-highlight", { clear = true }),
  callback = function() vim.highlight.on_yank() end,
})
```

### Naming Conventions

- **Files**: `kebab-case.lua` (e.g., `basics.lua`, `statusline.lua`)
- **Variables**: `snake_case` for Lua, `camelCase` for TS/JS
- **Functions**: `snake_case`
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `IS_MAC`, `IS_WSL`)
- **Plugin names**: `kebab-case` in spec, original name for require

### Error Handling

```lua
local ok, module = pcall(require, "module_name")
if not ok then return end

local success, result = pcall(vim.api.nvim_buf_get_var, 0, "var_name")
if success then -- use result end
```

### Feature Flags

```lua
local ok_config, config = pcall(require, "config")
local useFeature = ok_config and config.is_enabled.feature_name or false
return { "plugin/name", enabled = useFeature }
```

**Available flags**: `blink`, `codeium`, `neogit`, `telescope_tabs`, `bufferline`, `nvchad_colorizer`, `norcalli_colorizer`, `chatgpt`

### LSP Configuration

```lua
-- Add servers to lsp_language_servers list (lua/plugins/core/lsp.lua)
local lsp_language_servers = { "html", "tailwindcss", "ts_ls", -- add here }
```

Mason auto-installs these servers.

### Lua Patterns

```lua
local message = "Hello " .. name           -- String concat (.. not +)
table.insert(list, item)                  -- Table ops
if condition then end                      -- Explicit bool (avoid: if x == true)
local lower = text:lower()                 -- String ops (lowercase)
```

### Theme

```lua
-- Default: rose-pine (moon), alternatives: catppuccin (mocha), kanagawa (dragon)
vim.api.nvim_set_hl(0, "Group", { fg = "color", bg = "bg" })
```

## Anti-Patterns to Avoid

1. **No bare `require`** - Always wrap in `pcall`
2. **No direct `vim.keymap.set`** - Use `safe_keymap_set` wrapper
3. **Don't skip feature flags** - Always check `config.is_enabled`
4. **Don't hardcode OS paths** - Use `IS_MAC`, `IS_LINUX`, `IS_WSL` globals
5. **Don't add deprecation suppressions** - Fix underlying issues (only `client.supports_method` is suppressed)

## When in Doubt

1. Check similar files in same category
2. Follow existing patterns exactly
3. Run `stylua` to verify formatting
4. Test in nvim: check errors, run `:checkhealth`

## Plugin Organization

The configuration uses a modular plugin structure managed by lazy.nvim:

### Active Plugin Directories

- **`lua/plugins/`** - Main plugin directory (active for non-VSCode)
  - `core/` - LSP, completion, treesitter
  - `editor/` - Editing enhancements
  - `ui/` - Statusline, tabs, theme
  - `navigation/` - Files, finders
  - `git/` - Git tools
  - `ai/` - AI completion & chat
  - `dev/` - Debugging, REST
  - `markdown/` - Markdown plugins
  - `tools/` - Terminal, session, etc.

- **`lua/plugins_always/`** - Plugins that load in both VSCode and standalone Neovim

- **`lua/plugins_vscode/`** - Plugins that only load when running in VSCode Neovim

### Inactive/Directories (Reference Only)

- **`lua/plugins_notvscode/`** - **DEACTIVATED** - Old plugin configurations kept for reference after reorganization
  - This directory is completely disabled (`cond = false` in `lazy-init.lua`)
  - Contains previous plugin configurations that have been migrated to the new `lua/plugins/` structure
  - **Do NOT add new plugins here** - use `lua/plugins/` instead

### Plugin Loading Order

1. `plugins/` loads for standalone Neovim
2. `plugins_always/` always loads
3. `plugins_vscode/` loads only when `vim.g.vscode` is true
4. `plugins_notvscode/` never loads (disabled)

## Key Files

- `init.lua` - Entry point (deprecation suppression)
- `options.lua` - Options, autocmds, OS detection
- `lazy-init.lua` - lazy.nvim setup with plugin import configuration
- `keymaps/util.lua` - `safe_keymap_set` function
- `config/init.lua` - Feature flags and icons
- `stylua.toml` - Formatter config (2 spaces, 120 cols)
