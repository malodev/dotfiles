return {
	-- Treesitter for syntax highlighting
	{
		"nvim-treesitter/nvim-treesitter",
		event = "BufReadPost",
		build = ":TSUpdate",
		config = function()
			local ok, configs = pcall(require, "nvim-treesitter.configs")
			if not ok then
				return
			end
			---@diagnostic disable-next-line: missing-fields
			configs.setup({
				ensure_installed = {
					"c",
					"lua",
					"vim",
					"vimdoc",
					"javascript",
					"typescript",
					"tsx",
					"css",
					"html",
					"markdown",
					"markdown_inline",
					"bash",
					"regex",
					"http",
					"xml",
					"graphql",
					"json",
					"dockerfile",
					"astro",
					"php",
					"python",
					"go",
					"rust",
					"yaml",
					"toml",
				},
				sync_install = false,
				highlight = { enable = true },
				indent = { enable = true },
			})
		end,
	},

	-- UFO for better folding
	{
		"kevinhwang91/nvim-ufo",
		dependencies = {
			"kevinhwang91/promise-async",
		},
		event = "BufReadPost",
		config = function()
			local ok_ufo, ufo = pcall(require, "ufo")
			if not ok_ufo then
				return
			end

			vim.o.foldcolumn = "1"
			vim.o.foldlevel = 99
			vim.o.foldlevelstart = 99
			vim.o.foldenable = true
			vim.o.foldtext = ""
			vim.o.foldnestmax = 2
			vim.o.foldmethod = "manual"

			-- Fold keymaps
			vim.keymap.set("n", "zR", ufo.openAllFolds)
			vim.keymap.set("n", "zM", ufo.closeAllFolds)
			vim.keymap.set("n", "zr", ufo.openFoldsExceptKinds)
			vim.keymap.set("n", "zm", ufo.closeFoldsWith)
			vim.keymap.set("n", "zK", function()
				local winid = ufo.peekFoldedLinesUnderCursor()
				if not winid then
					vim.lsp.buf.hover()
				end
			end)

			local handler = function(virtText, lnum, endLnum, width, truncate)
				local newVirtText = {}
				local suffix = ("  %d "):format(endLnum - lnum)
				local sufWidth = vim.fn.strdisplaywidth(suffix)
				local targetWidth = width - sufWidth
				local curWidth = 0
				for _, chunk in ipairs(virtText) do
					local chunkText = chunk[1]
					local chunkWidth = vim.fn.strdisplaywidth(chunkText)
					if targetWidth > curWidth + chunkWidth then
						table.insert(newVirtText, chunk)
					else
						chunkText = truncate(chunkText, targetWidth - curWidth)
						local hlGroup = chunk[2]
						table.insert(newVirtText, { chunkText, hlGroup })
						chunkWidth = vim.fn.strdisplaywidth(chunkText)
						if curWidth + chunkWidth < targetWidth then
							suffix = suffix .. (" "):rep(targetWidth - curWidth - chunkWidth)
						end
						break
					end
					curWidth = curWidth + chunkWidth
				end
				table.insert(newVirtText, { suffix, "MoreMsg" })
				return newVirtText
			end

			ufo.setup({
				provider_selector = function()
					return { "lsp", "indent" }
				end,
				fold_virt_text_handler = handler,
			})
		end,
	},
}
