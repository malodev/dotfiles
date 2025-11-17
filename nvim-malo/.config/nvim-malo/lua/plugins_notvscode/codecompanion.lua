return {
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
    { "<leader>cC", "<cmd>CodeCompanionChat Toggle<cr>", mode = { "n", "v" }, desc = "Toggle CodeCompanion Chat" },
    { "<leader>cA", "<cmd>CodeCompanionActions<cr>", mode = { "n", "v" }, desc = "CodeCompanion Actions" },
    { "ga", "<cmd>CodeCompanionChat Add<cr>", mode = "v", desc = "Add to CodeCompanion Chat" },
  },
  opts = {
    strategies = {
      -- Choose your adapter - options: "anthropic", "copilot", "openai", "ollama", "gemini", etc.
      chat = { adapter = "copilot" },
      inline = { adapter = "copilot" },
      agent = { adapter = "copilot" },
    },
    opts = {
      log_level = "WARN", -- Change to "DEBUG" or "TRACE" for troubleshooting
    },
    display = {
      chat = {
        window = {
          layout = "vertical", -- float|vertical|horizontal|buffer
          border = "rounded",
          height = 0.8,
          width = 0.45,
        },
      },
    },
  },
}
