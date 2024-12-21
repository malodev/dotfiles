return {
	{
		"hrsh7th/nvim-cmp",
		enabled = true,
		event = "InsertEnter",
		dependencies = {
			"hrsh7th/cmp-nvim-lsp",
			"hrsh7th/cmp-buffer",
			"hrsh7th/cmp-path",
			"hrsh7th/cmp-cmdline",
			"L3MON4D3/LuaSnip",
			"saadparwaiz1/cmp_luasnip",
			"js-everts/cmp-tailwind-colors",
		},
		---@type cmp.Config
		config = function()
			local cmp = require("cmp")
			local cmp_select_opts = { behavior = cmp.SelectBehavior.Select }
			local kind_icons = {
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
			}

			cmp.setup({
				sources = cmp.config.sources({
					{ name = "nvim_lsp" },
					{ name = "nvim_lua" },
					{ name = "luasnip" },
					{ name = "buffer" },
					{ name = "path" },
				}),
				mapping = cmp.mapping.preset.insert({
					["<C-\\>"] = cmp.mapping.complete(),
					["<C-e>"] = cmp.mapping.abort(),
					["<C-u>"] = cmp.mapping.scroll_docs(-4),
					["<C-d>"] = cmp.mapping.scroll_docs(4),
					-- ["<C-f>"] = cmp_action.luasnip_jump_forward(),
					-- ["<C-b>"] = cmp_action.luasnip_jump_backward(),
					["<CR>"] = cmp.mapping.confirm({ select = false }), -- Accept currently selected item. Set `select` to `false` to only confirm explicitly selected items.
					["<Up>"] = cmp.mapping.select_prev_item(cmp_select_opts),
					["<Down>"] = cmp.mapping.select_next_item(cmp_select_opts),
					["<C-p>"] = cmp.mapping(function()
						if cmp.visible() then
							cmp.select_prev_item(cmp_select_opts)
						else
							cmp.complete()
						end
					end),
					["<C-n>"] = cmp.mapping(function()
						if cmp.visible() then
							cmp.select_next_item(cmp_select_opts)
						else
							cmp.complete()
						end
					end),
				}),
				snippet = {
					expand = function(args)
						require("luasnip").lsp_expand(args.body)
					end,
				},
				window = {
					completion = cmp.config.window.bordered(),
					documentation = cmp.config.window.bordered(),
				},
				formatting = {
					expandable_indicator = false,
					fields = { "kind", "abbr", "menu" },
					format = function(entry, item)
						item.menu = item.kind
						item = require("cmp-tailwind-colors").format(entry, item)
						if kind_icons[item.kind] then
							item.kind = kind_icons[item.kind] .. " "
						end
						return item
					end,
				},
			})
		end,
	},
}
