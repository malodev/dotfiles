# My ![nvim](./docs/nvim-badge.svg) config

This is my ![nvim](./docs/nvim-badge.svg) configuration using lazy.vim as plugin installer

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

### File Navigation (Snacks & Telescope)

| Keymap            | Description                           |
| ----------------- | ------------------------------------- |
| `<leader><space>` | Find files (root dir)            |
| `<leader>ff`      | Find files                          |
| `<leader>fg`      | Live grep                           |
| `<leader>fb`      | Buffers                             |
| `<leader>fr`      | Recent files                        |
| `<leader>fo`      | Old files                          |
| `<leader>fh`      | Help tags                          |
| `<leader>fk`      | Find keymaps                       |
| `<leader>fd`      | LSP document symbols             |
| `<leader>fw`      | LSP workspace symbols          |
| `<leader>tp`      | Theme switcher (Telescope)        |
| `<C-p>`          | Git files (Telescope)            |
| `<leader>/`       | Buffer search (Telescope)         |
| `<leader>fc`      | Command history (Telescope)        |
| `<leader>fe`      | Select REST env (Telescope)       |
| `<leader>fi`      | Media files (Telescope)           |
| `<leader>fl`      | LSP references (Telescope)       |
| `<leader>fs`      | Grep string (Telescope)          |

### File Management

| Keymap            | Description                           |
| ----------------- | ------------------------------------- |
| `-`               | Open Oil (parent directory as buffer) |
| `<leader>fy`      | Open yazi (external file manager)     |
| `_`               | Open yazi (external file manager)     |
| `<leader>fn`      | New file                            |

**Oil buffer keymaps** (only active in Oil):
| Keymap            | Description                           |
| ----------------- | ------------------------------------- |
| `<C-o>`           | Open vertically                      |
| `<C-s>`           | Save changes                        |
| `<gd>`            | Toggle file detail view              |

### LSP Navigation

| Keymap       | Description         |
| ------------ | ------------------- |
| `K`          | Hover documentation |
| `gK`         | Signature help      |
| `gD`         | Go to declaration   |
| `<leader>cr` | Rename symbol       |
| `<leader>ci` | LSP info           |
| `go`         | Type definition     |
| `gd`         | Go to definition    (Snacks picker) |
| `gr`         | References          (Snacks picker) |
| `gi`         | Implementation      (Snacks picker) |
| `gy`         | Type definition     (Snacks picker) |
| `<leader>ca` | Code actions        (Snacks picker) |
| `<leader>cs` | LSP symbols        (Snacks picker) |

### Diagnostics

| Keymap       | Description                    |
| ------------ | ------------------------------ |
| `<leader>cd` | Line diagnostics              |
| `gl`         | Show diagnostics              |
| `[d`         | Previous diagnostic          |
| `]d`         | Next diagnostic              |
| `[e`         | Previous error               |
| `]e`         | Next error                  |
| `[w`         | Previous warning            |
| `]w`         | Next warning               |
| `<leader>ud` | Toggle diagnostics            |
| `<leader>uv` | Toggle virtual text           |
| `<leader>xx` | Diagnostics (Trouble)       |
| `<leader>xX` | Buffer Diagnostics (Trouble)  |

### Quickfix & Location

| Keymap       | Description                      |
| ------------ | -------------------------------- |
| `<leader>xq` | Quickfix list                    |
| `<leader>xl` | Location list                    |
| `<leader>xQ` | Quickfix List (Trouble)         |
| `<leader>xL` | Location List (Trouble)          |
| `[q`         | Previous quickfix              |
| `]q`         | Next quickfix                  |

### Outline & Noice

| Keymap            | Description                    |
| ----------------- | ------------------------------ |
| `<leader>o`       | Toggle outline                |
| `<leader>snl`    | Noice Last Message            |
| `<leader>snh`    | Noice History                 |
| `<leader>sna`    | Noice All                    |
| `<leader>snd`    | Dismiss All                  |
| `<leader>snt`    | Noice Picker                 |
| `<c-f>`            | Scroll forward (Noice)       |
| `<c-b>`            | Scroll backward (Noice)      |

### REST Client (Kulala)

| Keymap            | Description                        |
| ----------------- | ------------------------------------ |
| `<leader>Rs`      | Send request                      |
| `<leader>Ra`      | Send all requests                |
| `<leader>Rb`      | Open scratchpad                  |

### Git

| Keymap            | Description                  |
| ----------------- | ---------------------------- |
| `<leader>gg`      | Lazygit (cwd)              |
| `<leader>gf`      | Git log file               |
| `<leader>gL`      | Git log (all)              |
| `<leader>gb`      | Git blame line             |
| `<leader>gB`      | Git browse (open)          |
| `<leader>gY`      | Git browse (copy)          |
| `]c`               | Next git hunk              |
| `[c`               | Previous git hunk          |
| `<leader>hs`       | Stage hunk                |
| `<leader>hu`       | Undo stage hunk           |
| `<leader>hp`       | Preview hunk              |
| `<leader>hr`       | Reset hunk                |
| `<leader>hS`       | Stage buffer              |
| `<leader>hR`       | Reset buffer              |
| `<leader>hb`       | Blame line                |
| `<leader>hd`       | Diff this                 |
| `<leader>hD`       | Diff this (against HEAD~)  |
| `<leader>ux`       | Toggle git deleted         |
| `<leader>uB`       | Toggle current blame line  |
| `ih` (operator)    | Select hunk               |

### AI & Chat

| Keymap            | Description                          |
| ----------------- | ------------------------------------ |
| `<leader>ao`      | Ask opencode                       |
| `<leader>ax`      | Execute opencode action              |
| `<C-t>`           | Toggle opencode                     |
| `go`               | Add range to opencode              |
| `goo`              | Add line to opencode               |
| `<S-C-u>`          | OpenCode half page up               |
| `<S-C-d>`          | OpenCode half page down             |
| `<leader>ac`      | Toggle Claude                      |
| `<leader>af`      | Focus Claude                       |
| `<leader>ar`      | Resume Claude                      |
| `<leader>ag`      | Continue Claude                    |
| `<leader>ab`      | Add current buffer to Claude       |
| `<leader>as`      | Send to Claude (visual mode)       |
| `<leader>aa`      | Accept diff                        |
| `<leader>ad`      | Deny diff                         |
| `<leader>ap`      | Toggle Copilot Chat                 |
| `<leader>aC`      | Toggle CodeCompanion Chat            |
| `<leader>aA`      | CodeCompanion Actions               |
| `ga`               | Add to CodeCompanion Chat (visual) |

### Markdown

| Keymap            | Description              |
| ----------------- | ------------------------ |
| `<leader>mp`      | Peek open               |
| `<leader>mc`      | Peek close              |
| `<leader>mm`      | Markdown preview         |

### Snacks Utilities

| Keymap            | Description                          |
| ----------------- | ------------------------------------ |
| `<leader>n`       | Notification history                 |
| `<leader>un`      | Dismiss all notifications          |
| `<leader>.`       | Toggle scratch buffer              |
| `<leader>S`       | Select scratch buffer             |
| `<leader>N`       | Neovim news                      |
| `<leader>th`      | Dashboard                        |

### Toggles (Snacks)

| Keymap            | Description              |
| ----------------- | ------------------------ |
| `<leader>us`      | Toggle spelling          |
| `<leader>uw`      | Toggle wrap              |
| `<leader>uL`      | Toggle relative number    |
| `<leader>ul`      | Toggle line number       |
| `<leader>uc`      | Toggle conceal level     |
| `<leader>uA`      | Toggle tabline           |
| `<leader>uT`      | Toggle treesitter        |
| `<leader>ub`      | Toggle dark background   |
| `<leader>uD`      | Toggle dim              |
| `<leader>ua`      | Toggle animate           |
| `<leader>ug`      | Toggle indent           |
| `<leader>uS`      | Toggle scroll           |
| `<leader>uh`      | Toggle Harper LS        |
| `<leader>uv`      | Toggle virtual text     |
| `<leader>wm`      | Toggle zoom             |
| `<leader>uZ`      | Toggle zoom             |
| `<leader>uz`      | Toggle zen mode         |
| `<leader>dpp`     | Toggle profiler         |
| `<leader>dph`     | Toggle profiler highlights |

### Windows & Tabs

| Keymap              | Description                  |
| ------------------- | ---------------------------- |
| `<leader>-`         | Split window below          |
| `<leader>|`         | Split window right          |
| `<leader>wd`        | Delete window               |
| `<C-Up>`            | Increase window height      |
| `<C-Down>`          | Decrease window height      |
| `<C-Left>`          | Decrease window width      |
| `<C-Right>`         | Increase window width      |
| `<leader><tab>l`    | Last tab                   |
| `<leader><tab>f`    | First tab                  |
| `<leader><tab>o`    | Close other tabs           |
| `<leader><tab>]`    | Next tab                  |
| `<leader><tab>[`    | Previous tab              |
| `<leader><tab><tab>`| New tab                   |
| `<leader><tab>d`    | Close tab                 |

### Buffers

| Keymap            | Description                     |
| ----------------- | ------------------------------- |
| `<C-h>`           | Previous buffer                 |
| `<C-l>`           | Next buffer                     |
| `[b`              | Previous buffer                 |
| `]b`              | Next buffer                     |
| `<leader>bb`      | Switch to other buffer         |
| `<leader>` ``      | Switch to other buffer         |
| `<C-q>`           | Close current buffer           |
| `<leader>bd`      | Delete buffer                  |
| `<leader>ba`      | Delete all buffers            |
| `<leader>bo`      | Delete other buffers          |
| `<leader>bf`      | Delete current file           |
| `<leader>bl`      | BufferLine: Close left       |
| `<leader>br`      | BufferLine: Close right      |
| `<leader>bp`      | Toggle pin current buffer    |
| `<leader>bc`      | Choose buffer by letter      |
| `<leader>bD`      | Delete buffer and window    |

### Terminal

| Keymap            | Description                          |
| ----------------- | ------------------------------------ |
| `<leader>tt`      | Terminal (cwd)                       |
| `<A-->`           | Toggle horizontal terminal             |
| `<A-i>`           | Toggle float terminal                 |
| `<C-/>`           | Hide terminal (insert mode)            |
| `<c-_>`           | Hide terminal (which_key_ignore)        |
| `<C-A>`           | Terminal beginning of line (insert)    |
| `<C-E>`           | Terminal end of line (insert)         |
| `<C-a>`           | Go down in terminal (term mode)       |
| `<C-e>`           | Go up in terminal (term mode)         |
| `<C-h>`           | Go left in terminal (term mode)       |
| `<C-j>`           | Go down in terminal (term mode)       |
| `<C-k>`           | Go up in terminal (term mode)         |
| `<C-l>`           | Go right in terminal (term mode)      |
| `<C-w>`           | Exit terminal mode                   |
| `jk`               | Exit terminal mode                   |

### Theme Switching

| Keymap            | Theme                  |
| ----------------- | ---------------------- |
| `<leader>tr`       | Rose Pine Moon         |
| `<leader>tc`       | Catppuccin             |
| `<leader>tk`       | Kanagawa Dragon        |

### Basic Editing

| Keymap            | Description                          |
| ----------------- | ------------------------------------ |
| `<C-c>`           | ESC in insert mode                   |
| `<C-s>`           | Save file                           |
| `<D-s>`           | Save file (macOS)                    |
| `<C-a>`           | Select all                           |
| `<C-A>`           | Increment number                     |
| `<C-X>`           | Decrement number                     |
| `<A-j>`           | Move line down                      |
| `<A-k>`           | Move line up                        |
| `j`, `<Down>`      | Down (respect wrapped lines)        |
| `k`, `<Up>`        | Up (respect wrapped lines)          |
| `H`               | Beginning of line                   |
| `L`               | End of line                         |
| `<`               | Indent and stay in visual mode      |
| `>`               | Unindent and stay in visual mode    |
| `n`               | Next search result (centered)       |
| `N`               | Previous search result (centered)   |
| `,`, `.`, `;`     | Undo breakpoints (insert mode)       |
| `<leader>ms`       | Slugify line                       |
| `<leader>ss`       | Search and replace current word     |
| `<leader>c``      | React: change string to interp.     |
| `<leader>K`        | Lookup keyword under cursor         |
| `<leader>ur`       | Redraw / Clear hlsearch / Diff update |

### Visual Mode

| Keymap              | Description                          |
| ------------------- | ------------------------------------ |
| `<TAB>`             | Indent and stay in visual mode      |
| `<S-TAB>`           | Unindent and stay in visual mode    |
| `<S-Down>`          | Move down in visual line mode       |
| `<S-Up>`            | Move up in visual line mode         |
| `<S-Left>`          | Move left in visual mode           |
| `<S-Right>`         | Move right in visual mode          |
| `<C-j>`, `<C-k>`    | Move in visual line mode           |
| `<C-c>`             | Copy to system clipboard           |
| `<leader>y`         | Copy to * register               |
| `<leader>p`         | Paste without affecting register   |
| `/`                 | Search for selected text          |

### Code Formatting & LSP

| Keymap            | Description                          |
| ----------------- | ------------------------------------ |
| `<F2>`            | Rename symbol                        |
| `<F3>`            | Format code                         |
| `<F4>`            | Code actions                        |
| `<leader>gf`       | Format code                         |

### Folds

| Keymap            | Description                          |
| ----------------- | ------------------------------------ |
| `zR`              | Open all folds                      |
| `zM`              | Close all folds                     |
| `zr`              | Open folds except kinds             |
| `zm`              | Close folds with                    |
| `zK`              | Peek folded lines under cursor       |

### Debugging & Utilities

| Keymap            | Description                          |
| ----------------- | ------------------------------------ |
| `<F5>`            | Toggle undotree                     |
| `<leader>db`      | Toggle breakpoint                  |
| `<leader>dc`      | Debug continue                     |
| `<leader>du`      | Toggle DAP UI                     |
| `<leader>ll`      | Open lazy.nvim                      |
| `<leader>ui`      | Inspect position                    |
| `<leader>uI`      | Inspect tree                       |
| `<leader>qq`      | Quit all                           |
| `<leader>qf`      | Force quit all                     |

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
