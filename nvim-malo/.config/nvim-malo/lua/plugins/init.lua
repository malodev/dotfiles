-- Main plugins entry point
-- All plugins here are excluded from VSCode by lazy-init.lua
return {
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
