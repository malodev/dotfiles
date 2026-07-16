-- Main plugins entry point
-- All plugins here are excluded from VSCode by lazy-init.lua
return {
  -- This is a custom LazyVim-inspired config. Omarchy's generated theme spec
  -- references LazyVim only to communicate the selected colorscheme.
  { "LazyVim/LazyVim", enabled = false },
  { import = "plugins.core" },
  { import = "plugins.editor" },
  { import = "plugins.ui" },
  { import = "plugins.navigation" },
  { import = "plugins.git" },
  { import = "plugins.ai" },
  { import = "plugins.dev" },
  { import = "plugins.markdown" },
  { import = "plugins.tools" },
}
