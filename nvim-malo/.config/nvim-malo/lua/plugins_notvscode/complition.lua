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
				-- Show documentation when selecting a completion item https://cmp.saghen.dev/configuration/completion.html
				trigger = {
					-- When true, will prefetch the completion items when entering insert mode
					prefetch_on_insert = false,

					-- When false, will not show the completion window automatically when in a snippet
					show_in_snippet = true,

					-- When true, will show the completion window after typing a character that matches the `keyword.regex`
					show_on_keyword = true,

					-- When true, will show the completion window after typing a trigger character
					show_on_trigger_character = true,

					-- LSPs can indicate when to show the completion window via trigger characters
					-- however, some LSPs (i.e. tsserver) return characters that would essentially
					-- always show the window. We block these by default.
					show_on_blocked_trigger_characters = function()
						if vim.api.nvim_get_mode().mode == "c" then
							return {}
						end

						-- you can also block per filetype, for example:
						-- if vim.bo.filetype == 'markdown' then
						--   return { ' ', '\n', '\t', '.', '/', '(', '[' }
						-- end

						return { " ", "\n", "\t" }
					end,

					-- When both this and show_on_trigger_character are true, will show the completion window
					-- when the cursor comes after a trigger character after accepting an item
					show_on_accept_on_trigger_character = true,

					-- When both this and show_on_trigger_character are true, will show the completion window
					-- when the cursor comes after a trigger character when entering insert mode
					show_on_insert_on_trigger_character = true,

					-- List of trigger characters (on top of `show_on_blocked_trigger_characters`) that won't trigger
					-- the completion window when the cursor comes after a trigger character when
					-- entering insert mode/accepting an item
					show_on_x_blocked_trigger_characters = { "'", '"', "(" },
					-- or a function, similar to show_on_blocked_trigger_character
				},
				list = {
					selection = {
						preselect = function(ctx)
							return ctx.mode ~= "cmdline"
						end,
						auto_insert = function(ctx)
							return ctx.mode ~= "cmdline"
						end,
					},
				},
				menu = {
					border = "rounded",
					-- auto_show = function(ctx)
					-- 	return ctx.mode == "cmdline"
					-- end,
				},

				documentation = {
					window = {
						min_width = 10,
						max_width = 80,
						max_height = 20,
						border = "rounded",
						-- border = { "╭", "─", "╮", "│", "╯", "─", "╰", "│" },
						winblend = 0,
						winhighlight = "Normal:BlinkCmpDoc,FloatBorder:BlinkCmpDocBorder,EndOfBuffer:BlinkCmpDoc",
						-- Note that the gutter will be disabled when border ~= 'none'
						scrollbar = true,
						-- Which directions to show the documentation window,
						-- for each of the possible menu window directions,
						-- falling back to the next direction when there's not enough space
						direction_priority = {
							menu_north = { "e", "w", "n", "s" },
							menu_south = { "e", "w", "s", "n" },
						},
					},
					auto_show = true,
					auto_show_delay_ms = 500,
				},

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
