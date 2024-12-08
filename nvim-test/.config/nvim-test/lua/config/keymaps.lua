local keymap = vim.keymap.set

keymap("n", "-", "<cmd>e .<CR>", { desc = "Open cwd in file tree view" })
keymap("n", "<leader>q", "<cmd>qa<CR>", { desc = "Quit all" })


-- WhichKey mappings
local wk = require("which-key")
wk.add({
  { "<leader>" , group = "<leader>" },
  { "gr" , group = "LSP functions" },
  { "gra" , desc = "LSP action" },
  { "gri" , desc = "LSP implementation" },
  { "grn" , desc = "LSP rename" },
  { "grr" , desc = "LSP reference" },

  { "<leader>b", group = "buffers", expand = function()
      return require("which-key.extras").expand.buf()
    end
  },
  { "<leader>w", group = "windows", expand = function()
      return require("which-key.extras").expand.win()
    end
  },
  { "<C-s>", "<cmd>w<CR>", desc = "Save buffer", mode = { "n", "v", "i" } },
})
print("KEYMAPS")
