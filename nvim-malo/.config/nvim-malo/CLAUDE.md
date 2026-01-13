# CLAUDE.md - nvim-malo Configuration

This file provides guidance to Claude Code (claude.ai/code) when working with the **nvim-malo Neovim configuration**.

## Overview

This is a modern Neovim configuration inspired by LazyVim, using:
- **lazy.nvim** for plugin management
- **Modular plugin structure** organized by category
- **snacks.nvim** as the primary LSP UI layer (replaces lspsaga)
- **blink.cmp** for fast completion
- **Rose Pine** as the default theme

## Architecture

### Entry Point
**`init.lua`** → loads `options.lua`, `lazy-init.lua`, `keymaps/`

### Plugin Loading
**`lazy-init.lua`** → imports from:
- `lua/plugins/` - Main plugins (non-VSCode)
- `lua/plugins_always/` - Cross-platform plugins
- `lua/plugins_vscode/` - VSCode-specific plugins

### Plugin Organization

The new modular structure organizes plugins into categories:

```
lua/plugins/
├── core/           # LSP, completion, treesitter
├── editor/         # Editing enhancements (surround, pairs, etc.)
├── ui/             # Statusline, tabs, theme, notifications
├── navigation/     # Files, finders (telescope, fzf, oil, yazi)
├── git/            # Git tools (neogit, gitsigns, lazygit)
├── ai/             # AI completion & chat (copilot, codeium, claudecode)
├── dev/            # Debugging, REST client, diagnostics
├── markdown/       # Markdown plugins
└── tools/          # Terminal, session management, which-key
```

### Keymaps Structure

Keymaps are split into focused files in `lua/keymaps/`:
- `init.lua` - Entry point that loads all sections
- `basics.lua` - Movement, editing, windows, tabs
- `buffers.lua` - Buffer navigation and management
- `search.lua` - Search keymaps
- `git.lua` - Git integration keymaps
- `terminal.lua` - Terminal keymaps
- `which-key.lua` - Toggle maps and diagnostic navigation

## Critical Rule: Preserve Custom Configurations

**⚠️ ALWAYS preserve custom user configurations during refactoring.**

When refactoring or restructuring, you MUST:
1. **Search git history** for old custom configurations before replacing
2. **Compare carefully** - custom configs often differ from defaults
3. **When in doubt, ASK the user** with options and consequences

### Custom Configurations That Must Be Preserved

These files contain USER CUSTOMIZATIONS that must not be lost:

| File | Custom Details |
|------|----------------|
| `plugins/ui/notify.lua` | **Dashboard** has custom sections: `colorscript -e square`, Recent Files, Projects, Git Status with `hub status --short --branch --renames` |
| `plugins/ui/theme.lua` | Default theme is **Rose Pine Moon** (not Catppuccin) |
| `plugins/ui/statusline.lua` | Theme is **"rose-pine"** (not "auto") |
| `plugins/navigation/files.lua` | Oil has `view_options = { show_hidden = true }` |
| `plugins/ai/chat.lua` | ClaudeCode with `<leader>a*` prefix keymaps |

### When Custom Config Can't Be Automatically Preserved

If you cannot determine if a configuration is custom or default:

1. **Check git history** for previous versions
2. **Search the codebase** for similar patterns
3. **STOP and ASK the user**

#### How to Ask (Template)

```
I found [old_config] with [details]. I need to [action].

Options:
1. [Option A] - [Consequence: what happens]
2. [Option B] - [Consequence: what happens]
3. [Option C] - [Consequence: what happens]

Which would you prefer?
```

#### Example

```
I found an old alpha.lua dashboard config with custom sections and a colorscript command.

Options:
1. Keep alpha.nvim - Maintains exact old setup, but adds another plugin
2. Migrate to snacks.dashboard - Need to recreate custom sections manually
3. Use defaults - Simpler, but loses your custom "colorscript" and git status sections

Which would you prefer?
```

### Checklist Before Refactoring

- [ ] Searched git history for old versions
- [ ] Compared old vs new configs
- [ ] Identified all custom settings
- [ ] Created backup plan
- [ ] Asked user about ambiguous configs

## Important Conventions

### 1. Plugin Specs
- All plugin specs return a Lua table
- Use `event = "VeryLazy"` for UI plugins
- Use `event = "InsertEnter"` for completion plugins
- Use `event = "LspAttach"` for LSP-related plugins
- Always wrap config in pcall for safety:

```lua
config = function()
    local ok, plugin = pcall(require, "plugin")
    if not ok then
        return
    end
    plugin.setup(opts)
end,
```

### 2. Keymaps
- Use the `safe_keymap_set` wrapper from keymaps
- Don't create keymaps if lazy.nvim has a handler for them
- Always include `{ desc = "..." }` for which-key integration

```lua
local map = safe_keymap_set
map("n", "<leader>xf", "<cmd>SomeCmd<cr>", { desc = "Description" })
```

### 3. Feature Flags
Check `lua/config/init.lua` for conditional features:
- `config.is_enabled.blink` - Use blink.cmp instead of nvim-cmp
- `config.is_enabled.codeium` - Enable Codeium AI completion

### 4. LSP Configuration
- **DO NOT** use deprecated `client.supports_method`
- LSP keymaps use `snacks.picker` for UI (not lspsaga)
- Standard LSP functions are `vim.lsp.buf.*`
- Configured in `lua/plugins/core/lsp.lua`

### 5. Theme
- Default: **Rose Pine Moon** variant
- Alternatives: Catppuccin, Kanagawa
- Theme switching: `<leader>tr`, `<leader>tc`, `<leader>tk`
- Configured in `lua/plugins/ui/theme.lua`

## File Locations

When the user asks about specific functionality:

| Feature | File Location |
|---------|---------------|
| LSP servers & capabilities | `plugins/core/lsp.lua` |
| Completion (blink/nvim-cmp) | `plugins/core/completion.lua` |
| Treesitter | `plugins/core/treesitter.lua` |
| Theme (Rose Pine, Catppuccin) | `plugins/ui/theme.lua` |
| Statusline | `plugins/ui/statusline.lua` |
| Tab line | `plugins/ui/tabs.lua` |
| Dashboard | `plugins/ui/dashboard.lua` |
| Notifications | `plugins/ui/notify.lua` (Noice + Snacks) |
| File navigation | `plugins/navigation/finders.lua`, `plugins/navigation/files.lua` |
| Git integration | `plugins/git/integration.lua`, `plugins/git/tools.lua` |
| AI completion | `plugins/ai/completion.lua` |
| AI chat | `plugins/ai/chat.lua` |
| Terminal | `plugins/tools/init.lua` |
| Session management | `plugins/tools/init.lua` |
| Which-key | `plugins/tools/init.lua` |
| Editor basics | `plugins/editor/basics.lua` |
| Keymaps | `lua/keymaps/*.lua` |
| Options | `lua/options.lua` |

## Key Differences from Standard Neovim

1. **No lspsaga** - Uses `snacks.picker` instead for LSP UI
2. **Blink.cmp** - Modern completion engine (can use nvim-cmp via config flag)
3. **Modular plugins** - Split into category directories
4. **Split keymaps** - Organized by functionality
5. **Oil.nvim + Yazi** - File management (no nvim-tree)
6. **AI options** - Multiple AI completion tools available

## Common Tasks

### Adding a New Plugin

1. Determine the category (core, editor, ui, navigation, git, ai, dev, markdown, tools)
2. Add to the appropriate `lua/plugins/<category>/init.lua` or create a new file
3. Use lazy loading with appropriate `event` triggers
4. Add keymaps to relevant `lua/keymaps/<category>.lua`

### Adding a New LSP Server

1. Add to `lsp_language_servers` list in `plugins/core/lsp.lua:2-20`
2. Optionally add server-specific config in the `servers` table

### Customizing Keymaps

1. Find the category in `lua/keymaps/`
2. Edit the appropriate file
3. Keymaps with `<leader>` prefix automatically show in which-key

### Debugging Plugin Issues

1. Check `:Lazy` for plugin status
2. Check `:Snacks notifier.show_history()` for errors
3. Check `:LspInfo` for LSP issues
4. Look for deprecation warnings in `init.lua` (already suppressed)

## Important Notes

### Deprecated APIs
- `client.supports_method` is deprecated - Use `client:supports_method()` instead
- Suppressed via `vim.deprecate` override in `init.lua:2-12`

### Duplicate Configurations
- **Old keymaps.lua** exists but is being replaced by `lua/keymaps/` directory
- **Old plugins_notvscode/** was replaced by organized `lua/plugins/` structure
- Eventually remove `keymaps.lua` when migration is complete

### LSP Keymap Changes
The following keymaps now use **Snacks picker** instead of direct LSP jumps:
- `gd` - Definition → `Snacks.picker.lsp_definitions()`
- `gr` - References → `Snacks.picker.lsp_references()`
- `gi` - Implementation → `Snacks.picker.lsp_implementations()`
- `gy` - Type definition → `Snacks.picker.lsp_type_definitions()`
- `<leader>ca` - Code actions → `Snacks.picker.lsp_code_actions()`
- `<leader>cs` - Symbols → `Snacks.picker.lsp_symbols()`

## Plugin Dependencies

Some plugins depend on others:
- **snacks.nvim** must be loaded before other plugins that use it
- **nvim-lspconfig** depends on **mason.nvim**
- **blink.cmp** needs LSP capabilities from nvim-lspconfig
- **noice.nvim** depends on **nui.nvim**

## Configuration Files to Edit Carefully

### Read-Only / Don't Modify
- `stylua.toml` - Formatter config (modify only if you know stylua well)
- `lazy-lock.json` - Auto-generated by lazy.nvim

### Edit with Caution
- `init.lua` - Core entry point, changes affect entire setup
- `lazy-init.lua` - Plugin manager setup
- `lua/config/init.lua` - Feature flags affect plugin loading

### Safe to Modify
- `lua/keymaps/*.lua` - Keymap customizations
- `lua/plugins/**` - Add/modify plugins
- `lua/options.lua` - Neovim options

## Testing Changes

After making changes:
1. Restart Neovim completely
2. Run `:Lazy sync` to update plugins
3. Run `:Mason` to ensure LSP servers are installed
4. Check `:Snacks notifier.show_history()` for errors
5. Test keymaps with `<leader>?` (which-key)

## Getting Help

### For Users
- Run `<leader>?` to see all available keymaps
- Run `:Lazy` to manage plugins
- Run `:Mason` to manage LSP servers
- Run `:checkhealth` for Neovim diagnostics

### For Developers/Claude
- Check `README.md` for user-facing documentation
- Check this file (`CLAUDE.md`) for architecture/conventions
- Use `:Telescope keymaps` or `:Snacks.picker.keymaps()` to find keymap definitions
- Search in `lua/keymaps/` for keymap implementations

## Migration Notes

### From Old Structure
- `plugins_notvscode/*.lua` → `lua/plugins/<category>/*.lua`
- `keymaps.lua` (436 lines) → `lua/keymaps/*.lua` (split by category)

### Still To Do
- Remove old `keymaps.lua` file (currently conflicts with `keymaps/` directory)
- Update any remaining hardcoded paths
- Add more lazy loading optimizations
