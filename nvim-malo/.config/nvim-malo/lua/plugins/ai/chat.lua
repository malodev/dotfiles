-- AI chat: ClaudeCode, CopilotChat and CodeCompanion
return {
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
