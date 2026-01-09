-- AI chat: ClaudeCode, CopilotChat and CodeCompanion
return {
  -- ClaudeCode: Official Claude Code integration
  {
    "coder/claudecode.nvim",
    opts = {},
    keys = {
      { "<leader>a", "", desc = "+ai", mode = { "n", "v" } },
      { "<leader>ac", "<cmd>ClaudeCode<cr>", desc = "Toggle Claude" },
      { "<leader>af", "<cmd>ClaudeCodeFocus<cr>", desc = "Focus Claude" },
      { "<leader>ar", "<cmd>ClaudeCode --resume<cr>", desc = "Resume Claude" },
      { "<leader>ag", "<cmd>ClaudeCode --continue<cr>", desc = "Continue Claude" },
      { "<leader>ab", "<cmd>ClaudeCodeAdd %<cr>", desc = "Add current buffer " },
      { "<leader>as", "<cmd>ClaudeCodeSend<cr>", mode = "v", desc = "Send to Claude" },
      {
        "<leader>as",
        "<cmd>ClaudeCodeTreeAdd<cr>",
        desc = "Add file",
        ft = { "NvimTree", "neo-tree", "oil" },
      },
      -- Diff management
      { "<leader>aa", "<cmd>ClaudeCodeDiffAccept<cr>", desc = "Claude Accept diff" },
      { "<leader>ad", "<cmd>ClaudeCodeDiffDeny<cr>", desc = "Claude Deny diff" },
    },
  },

  -- CopilotChat: Chat interface for Copilot
  {
    "CopilotC-Nvim/CopilotChat.nvim",
    branch = "main",
    dependencies = {
      { "zbirenbaum/copilot.lua" },
      { "nvim-lua/plenary.nvim" },
    },
    cmd = { "CopilotChatToggle", "CopilotChat" },
    keys = {
      { "<leader>ap", "<cmd>CopilotChatToggle<CR>", desc = "Toggle Copilot Chat" },
    },
    opts = {
      debug = true,
    },
  },

  -- CodeCompanion: Universal AI chat interface
  {
    "olimorris/codecompanion.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-treesitter/nvim-treesitter",
    },
    cmd = {
      "CodeCompanion",
      "CodeCompanionChat",
      "CodeCompanionActions",
      "CodeCompanionCmd",
    },
    keys = {
      { "<leader>aC", "<cmd>CodeCompanionChat Toggle<cr>", mode = { "n", "v" }, desc = "Toggle CodeCompanion Chat" },
      { "<leader>aA", "<cmd>CodeCompanionActions<cr>", mode = { "n", "v" }, desc = "CodeCompanion Actions" },
      { "ga", "<cmd>CodeCompanionChat Add<cr>", mode = "v", desc = "Add to CodeCompanion Chat" },
    },
    opts = {
      strategies = {
        chat = { adapter = "copilot" },
        inline = { adapter = "copilot" },
        agent = { adapter = "copilot" },
      },
      opts = {
        log_level = "WARN",
      },
      display = {
        chat = {
          window = {
            layout = "vertical",
            border = "rounded",
            height = 0.8,
            width = 0.45,
          },
        },
      },
    },
  },
}
