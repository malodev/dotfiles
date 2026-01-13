-- AI plugins: chat only
-- Note: AI completion (copilot, codeium) has been merged into core/completion.lua
return {
  { import = "plugins.ai.chat" },
  { import = "plugins.ai.opencode" },
}
