return {
	"elentok/format-on-save.nvim",
	event = { "BufReadPre", "BufNewFile" },
	config = function()
		local format_on_save = require("format-on-save")
		local formatters = require("format-on-save.formatters")

		format_on_save.setup({
			exclude_path_patterns = {
				"/node_modules/",
				".local/share/nvim/lazy",
			},
			formatter_by_ft = {
				go = formatters.lsp,
				css = formatters.prettierd,
				html = formatters.prettierd,
				javascript = formatters.prettierd,
				javascriptreact = formatters.prettierd,
				json = formatters.prettierd,
				tyepscript = formatters.prettierd,
				typescriptreact = formatters.prettierd,
				markdown = formatters.prettierd,
				lua = formatters.stylua,
				python = formatters.black,
			},
		})
	end,
}
