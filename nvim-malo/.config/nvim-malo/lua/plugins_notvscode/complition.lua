local useBlink = function()
	return require("config").is_enabled.blink
end

return {
	-- blink completion
	{
		"saghen/blink.compat",
		-- use the latest release, via version = '*', if you also use the latest release for blink.cmp
		version = "*",
		-- lazy.nvim will automatically load the plugin when it's required by blink.cmp
		lazy = true,
		-- make sure to set opts so that lazy.nvim calls blink.compat's setup
		opts = {},
	},
	{
		"saghen/blink.cmp",
		enabled = useBlink,
		-- optional: provides snippets for the snippet source
		dependencies = { "rafamadriz/friendly-snippets", "giuxtaposition/blink-cmp-copilot" },

		-- use a release tag to download pre-built binaries
		version = "*",
		-- AND/OR build from source, requires nightly: https://rust-lang.github.io/rustup/concepts/channels.html#working-with-nightly-rust
		-- build = 'cargo build --release',
		-- If you use nix, you can build from source using latest nightly rust with:
		-- build = 'nix run .#build-plugin',

		---@module 'blink.cmp'
		---@type blink.cmp.Config
		opts = {
			-- 'default' for mappings similar to built-in completion
			-- 'super-tab' for mappings similar to vscode (tab to accept, arrow keys to navigate)
			-- 'enter' for mappings similar to 'super-tab' but with 'enter' to accept
			-- See the full "keymap" documentation for information on defining your own keymap.
			keymap = {
				preset = "enter",
				["<C-c>"] = {
					function(cmp)
						cmp.show({ providers = { "copilot" } })
					end,
				},
			},

			appearance = {
				nerd_font_variant = "mono",
				-- Blink does not expose its default kind icons so you must copy them all (or set your custom ones) and add Copilot
				kind_icons = {
					Copilot = "",
					Text = "",
					Method = "󰆧",
					Function = "󰊕",
					Constructor = "",
					Field = "󰇽",
					Variable = "󰂡",
					Class = "󰠱",
					Interface = "",
					Module = "",
					Property = "󰜢",
					Unit = "",
					Value = "󰎠",
					Enum = "",
					Keyword = "󰌋",
					Snippet = "",
					Color = "󰏘",
					File = "󰈙",
					Reference = "",
					Folder = "󰉋",
					EnumMember = "",
					Constant = "󰏿",
					Struct = "",
					Event = "",
					Operator = "󰆕",
					TypeParameter = "󰅲",
				},
			},
			completion = {
				-- Show documentation when selecting a completion item
				documentation = { auto_show = true, auto_show_delay_ms = 500 },

				-- Display a preview of the selected item on the current line
				ghost_text = { enabled = true },
			},

			-- Default list of enabled providers defined so that you can extend it
			-- elsewhere in your config, without redefining it, due to `opts_extend`
			-- sources = { "lsp", "path", "snippets", "buffer", "copilot", "luasni
			sources = {
				default = { "lsp", "path", "snippets", "buffer", "copilot" },
				providers = {
					copilot = {
						name = "copilot",
						module = "blink-cmp-copilot",
						score_offset = 100,
						async = true,
						transform_items = function(_, items)
							local CompletionItemKind = require("blink.cmp.types").CompletionItemKind
							local kind_idx = #CompletionItemKind + 1
							CompletionItemKind[kind_idx] = "Copilot"
							for _, item in ipairs(items) do
								item.kind = kind_idx
							end
							return items
						end,
					},
				},
			},
		},
		opts_extend = { "sources.default" },
	},
}
