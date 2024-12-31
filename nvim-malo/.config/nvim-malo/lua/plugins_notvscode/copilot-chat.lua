return {
	{
		"CopilotC-Nvim/CopilotChat.nvim",
		branch = "canary",
		dependencies = {
			{ "zbirenbaum/copilot.lua" }, -- or github/copilot.vim
			{ "nvim-lua/plenary.nvim" }, -- for curl, log wrapper
		},
		opts = {
			debug = true, -- Enable debugging
			-- See Configuration section for rest
		},
		keys = {
			{ "<leader>cc", "<cmd>CopilotChatToggle<CR>", desc = "Open Copilot Chat" },
		},
		-- See Commands section for default commands if you want to lazy load on them
	},
}
