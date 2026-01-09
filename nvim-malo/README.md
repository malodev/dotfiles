# nvim-malo

A modern Neovim configuration inspired by LazyVim, using lazy.nvim for plugin management and featuring a modular plugin structure.

## Features

- 🚀 **LazyVim-style LSP experience** with `snacks.nvim` picker
- 🎨 **Rose Pine** (default) with Catppuccin and Kanagawa themes
- 🔍 **Fuzzy finding** with fzf-lua and telescope
- 📁 **File management** with oil.nvim and yazi
- 🤖 **AI completion** with Copilot, Codeium, and ClaudeCode
- 🌳 **Git integration** with Neogit, Gitsigns, and Lazygit
- ✨ **UI enhancements** with Noice, bufferline, and lualine
- 🔧 **Formatting** with format-on-save and LSP integration

## Installation

### Prerequisites

- Neovim 0.11+
- Git
- Node.js (for some LSP servers)
- Python 3 (for some LSP servers)
- Homebrew (macOS) or package manager (Linux)

### Install

```bash
# Clone the repository
git clone https://github.com/yourusername/dotfiles.git ~/.dotfiles

# Install nvim-malo configuration
cd ~/.dotfiles
stow nvim-malo

# Or manually symlink
ln -s ~/.dotfiles/nvim-malo/.config/nvim-malo ~/.config/nvim
```

### First Run

1. Open Neovim: `nvim`
2. Lazy.nvim will automatically install plugins
3. Mason will install LSP servers and tools

## Directory Structure

```
nvim-malo/.config/nvim-malo/
├── init.lua                    # Main entry point
├── lua/
│   ├── options.lua            # Neovim options
│   ├── keymaps.lua            # Old keymaps (to be removed)
│   ├── keymaps/               # Split keymaps by category
│   │   ├── init.lua
│   │   ├── basics.lua
│   │   ├── buffers.lua
│   │   ├── search.lua
│   │   ├── git.lua
│   │   ├── terminal.lua
│   │   └── which-key.lua
│   ├── lazy-init.lua          # lazy.nvim setup
│   ├── config/                # Feature toggles
│   │   └── init.lua
│   ├── malodev/               # Custom modules
│   └── plugins/               # Plugin specifications
│       ├── init.lua
│       ├── core/              # LSP, completion, treesitter
│       ├── editor/            # Editing enhancements
│       ├── ui/                # Statusline, tabs, theme
│       ├── navigation/        # Files, finders
│       ├── git/               # Git tools
│       ├── ai/                # AI completion & chat
│       ├── dev/               # Debugging, REST
│       ├── markdown/          # Markdown plugins
│       └── tools/             # Terminal, session, etc.
└── stylua.toml                # Lua formatter config
```

## Keymaps

### Leader Key

- **Space** - Leader key

### File Navigation (Snacks Picker)

| Keymap | Description |
|--------|-------------|
| `<leader><space>` | Find files (root dir) |
| `<leader>ff` | Find files |
| `<leader>fg` | Live grep |
| `<leader>fb` | Buffers |
| `<leader>fr` | Recent files |

### File Management

| Keymap | Description |
|--------|-------------|
| `-` | Open Oil (parent directory as buffer) |
| `<leader>fy` | Open Yazi (external file manager) |
| `_` | Open Yazi (external file manager) |

### LSP Navigation (Snacks Picker - replaces lspsaga)

| Keymap | Description |
|--------|-------------|
| `gd` | Go to definition |
| `gr` | References |
| `gi` | Implementation |
| `gy` | Type definition |
| `<leader>cs` | LSP symbols |
| `<leader>ca` | Code actions |
| `K` | Hover documentation |
| `gK` | Signature help |
| `<leader>cr` | Rename symbol |
| `<leader>ci` | LSP info |

### Diagnostics

| Keymap | Description |
|--------|-------------|
| `<leader>xd` | All diagnostics |
| `<leader>xD` | Errors only |
| `<leader>xW` | Warnings only |
| `gl` | Show diagnostics |
| `[d` | Previous diagnostic |
| `]d` | Next diagnostic |

### Git

| Keymap | Description |
|--------|-------------|
| `<leader>gg` | Lazygit (cwd) |
| `<leader>gf` | Git log file |
| `<leader>gL` | Git log (all) |
| `<leader>gb` | Git blame line |

### AI & Chat

| Keymap | Description |
|--------|-------------|
| `<leader>aa` | Accept diff |
| `<leader>ac` | Toggle Claude |
| `<leader>af` | Focus Claude |
| `<leader>ar` | Resume Claude |
| `<leader>aC` | Continue Claude |
| `<leader>ab` | Add current buffer |
| `<leader>as` | Send to Claude (visual mode) |
| `<leader>cc` | Toggle Copilot Chat |
| `<leader>cC` | Toggle CodeCompanion |

### Toggles

| Keymap | Description |
|--------|-------------|
| `<leader>us` | Spelling |
| `<leader>uw` | Wrap |
| `<leader>uL` | Relative number |
| `<leader>ud` | Diagnostics |
| `<leader>ul` | Line number |
| `<leader>uc` | Conceal level |
| `<leader>uA` | Tabline |
| `<leader>uT` | Treesitter |
| `<leader>ub` | Dark background |
| `<leader>uD` | Dim |
| `<leader>ua` | Animate |
| `<leader>ug` | Indent |
| `<leader>uS` | Scroll |
| `<leader>uh` | Inlay hints |
| `<leader>uZ` / `<leader>wm` | Zoom |
| `<leader>uz` | Zen mode |

### Windows & Buffers

| Keymap | Description |
|--------|-------------|
| `<leader>-` | Split window below |
| `<leader>\|` | Split window right |
| `<leader>wd` | Delete window |
| `<C-h>` | Previous buffer |
| `<C-l>` | Next buffer |
| `[b` | Previous buffer |
| `]b` | Next buffer |
| `<leader>bd` | Delete buffer |
| `<leader>ba` | Delete all buffers |
| `<leader>bo` | Delete other buffers |

### Terminal

| Keymap | Description |
|--------|-------------|
| `<A-t>` | Toggle terminal tab |
| `<A-->` | Toggle horizontal terminal |
| `<A-i>` | Toggle float terminal |
| `<C-/>` | Hide terminal (insert mode) |

## Theme Switching

| Keymap | Theme |
|--------|-------|
| `<leader>tr` | Rose Pine Moon |
| `<leader>tc` | Catppuccin |
| `<leader>tk` | Kanagawa Dragon |

## LSP Servers

Configured language servers (auto-installed via Mason):

- **Web**: html, tailwindcss, css, eslint, emmet_language_server
- **TypeScript/JavaScript**: ts_ls, denols
- **Lua**: lua_ls
- **Python**: basedpyright
- **Go**: gopls
- **PHP**: intelephense
- **Rust**: (add via Mason)
- **TOML**: taplo
- **JSON**: jsonls
- **Markdown**: marksman
- **Astro**: astro
- **Shell**: bashls
- **SQL**: sqlls
- **Grammar**: harper_ls

## Plugin Categories

### Core
- **lazy.nvim** - Plugin manager
- **nvim-lspconfig** - LSP configuration
- **mason.nvim** - LSP installer
- **blink.cmp** - Completion (alternative to nvim-cmp)
- **nvim-treesitter** - Syntax highlighting

### Editor
- **nvim-surround** - Surround text objects
- **mini.ai** - Text objects
- **mini.pairs** - Auto pairs
- **mini.comment** - Commenting
- **mini.surround** - Surround (alternative)

### UI
- **rose-pine** - Default theme
- **catppuccin** - Alternative theme
- **kanagawa** - Alternative theme
- **lualine** - Statusline
- **bufferline** - Tab line
- **noice.nvim** - UI for messages/cmdline
- **snacks.nvim** - Utilities & picker (LazyVim style)
- **nvim-notify** - Notifications

### Navigation
- **fzf-lua** - Fuzzy finder
- **telescope** - Alternative finder
- **oil.nvim** - File explorer as buffer
- **yazi.nvim** - External file manager

### Git
- **neogit** - Git interface
- **gitsigns** - Git signs in gutter
- **lazygit** - Git terminal UI
- **git-conflict** - Conflict resolution

### AI
- **copilot.lua** - GitHub Copilot
- **codeium.nvim** - Free AI completion
- **claudecode.nvim** - Claude integration
- **copilotchat.nvim** - Copilot chat
- **codecompanion.nvim** - Universal AI chat

### Development
- **nvim-dap** - Debugger
- **rest.nvim** - REST client
- **trouble.nvim** - Diagnostics list

## Configuration

### Enable/Disable Features

Edit `lua/config/init.lua`:

```lua
config.is_enabled = {
    blink = true,        -- Use blink.cmp instead of nvim-cmp
    codeium = true,      -- Enable Codeium
    -- Add your feature flags
}
```

### Customize Theme

Edit `lua/plugins/ui/theme.lua` to change the default theme variant.

### Customize Keymaps

Keymaps are organized in `lua/keymaps/`:
- `basics.lua` - Core keymaps
- `buffers.lua` - Buffer management
- `search.lua` - Search keymaps
- `git.lua` - Git keymaps
- `terminal.lua` - Terminal keymaps
- `which-key.lua` - Toggle maps

## FAQ

### How do I disable the deprecation warning?

The `client.supports_method` deprecation warning is suppressed in `init.lua` using a `vim.deprecate` override.

### How do I use Snacks picker instead of telescope?

Snacks picker is enabled by default. Use these keymaps:
- `<leader>ff` - Find files
- `<leader>fg` - Live grep
- `gd` - Go to definition
- `<leader>ca` - Code actions

### What happened to lspsaga?

lspsaga has been disabled due to deprecation warnings. Snacks picker provides similar functionality with better performance and no warnings.

### How do I add a new LSP server?

Add it to the `lsp_language_servers` list in `lua/plugins/core/lsp.lua`:

```lua
local lsp_language_servers = {
    -- ... existing servers
    "rust_analyzer",
    "clangd",
}
```

## Troubleshooting

### LSP not working

1. Check `:LspInfo` to see attached servers
2. Check `:Mason` to ensure servers are installed
3. Check logs with `:Snacks notifier.show_history()`

### Plugin not loading

1. Check with `:Lazy`
2. Check for errors in `:Snacks notifier.show_history()`
3. Try `:Lazy sync`

### Keymap not working

1. Check with `:Telescope keymaps` (if using telescope)
2. Check if which-key shows it with `<leader>?`
3. Look for conflicts in `lua/keymaps/`

## Credits

Inspired by:
- [LazyVim](https://github.com/LazyVim/LazyVim) - Plugin structure and snacks.nvim usage
- [NVIM-Astro](https://github.com/AstroNvim/AstroNvim) - Plugin organization ideas

## License

MIT
