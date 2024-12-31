return {
	"zbirenbaum/copilot.lua",
	-- Lazy load when event occurs. Events are triggered
	-- as mentioned in:
	-- https://vi.stackexchange.com/a/4495/20389
	event = "InsertEnter",
	-- You can also have it load at immediately at
	-- startup by commenting above and uncommenting below:
	-- lazy = false
	opts = {
		panel = {
			enabled = false,
			auto_refresh = false,
			keymap = {
				jump_prev = "[[",
				jump_next = "]]",
				accept = "<CR>",
				refresh = "gr",
				open = "<M-CR>",
			},
			layout = {
				position = "bottom", -- | top | left | right | horizontal | vertical
				ratio = 0.4,
			},
		},
		suggestion = {
			enabled = false,
			auto_trigger = false,
			hide_during_completion = true,
			debounce = 75,
			keymap = {
				accept = "<M-l>",
				accept_word = false,
				accept_line = false,
				next = "<M-]>",
				prev = "<M-[>",
				dismiss = "<C-]>",
			},
		},
		filetypes = {
			yaml = true,
			markdown = true,
			help = false,
			gitcommit = false,
			gitrebase = false,
			hgcommit = false,
			svn = false,
			cvs = false,
			["."] = false,
		},
		copilot_node_command = "node", -- Node.js version must be > 18.x
		server_opts_overrides = {},
	},
}
