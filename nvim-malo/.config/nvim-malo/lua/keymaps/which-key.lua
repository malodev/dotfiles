-- Toggle mappings and diagnostic keymaps
local map = require("keymaps.util").safe_keymap_set

-- Snacks toggles
Snacks.toggle.option("spell", { name = "Spelling" }):map("<leader>us")
Snacks.toggle.option("wrap", { name = "Wrap" }):map("<leader>uw")
Snacks.toggle.option("relativenumber", { name = "Relative Number" }):map("<leader>uL")
Snacks.toggle.diagnostics():map("<leader>ud")
Snacks.toggle.line_number():map("<leader>ul")
Snacks.toggle.option("conceallevel",
	{ off = 0, on = vim.o.conceallevel > 0 and vim.o.conceallevel or 2, name = "Conceal Level" }):map("<leader>uc")
Snacks.toggle.option("showtabline", { off = 0, on = vim.o.showtabline > 0 and vim.o.showtabline or 2, name = "Tabline" })
	:map("<leader>uA")
Snacks.toggle.treesitter():map("<leader>uT")
Snacks.toggle.option("background", { off = "light", on = "dark", name = "Dark Background" }):map("<leader>ub")
Snacks.toggle.dim():map("<leader>uD")
Snacks.toggle.animate():map("<leader>ua")
Snacks.toggle.indent():map("<leader>ug")
Snacks.toggle.scroll():map("<leader>uS")
Snacks.toggle.profiler():map("<leader>dpp")
Snacks.toggle.profiler_highlights():map("<leader>dph")

if vim.lsp.inlay_hint then
	Snacks.toggle.inlay_hints():map("<leader>uh")
end

Snacks.toggle.zoom():map("<leader>wm"):map("<leader>uZ")
Snacks.toggle.zen():map("<leader>uz")

-- Diagnostic keymaps
local diagnostic_goto = function(next, severity)
	local go = next and vim.diagnostic.goto_next or vim.diagnostic.goto_prev
	severity = severity and vim.diagnostic.severity[severity] or nil
	return function()
		go({ severity = severity })
	end
end
map("n", "<leader>cd", vim.diagnostic.open_float, { desc = "Line Diagnostics" })
map("n", "]d", diagnostic_goto(true), { desc = "Next Diagnostic" })
map("n", "[d", diagnostic_goto(false), { desc = "Prev Diagnostic" })
map("n", "]e", diagnostic_goto(true, "ERROR"), { desc = "Next Error" })
map("n", "[e", diagnostic_goto(false, "ERROR"), { desc = "Prev Error" })
map("n", "]w", diagnostic_goto(true, "WARN"), { desc = "Next Warning" })
map("n", "[w", diagnostic_goto(false, "WARN"), { desc = "Prev Warning" })

-- Inspect
map("n", "<leader>ui", vim.show_pos, { desc = "Inspect Pos" })
map("n", "<leader>uI", "<cmd>InspectTree<cr>", { desc = "Inspect Tree" })

-- Which-Key group definitions
if not vim.g.vscode then
	local wk = require("which-key")

	-- Helper function for virtual text toggle state
	local is_virtual_text_enabled = function()
		return vim.diagnostic.config().virtual_text
	end

	wk.add({
		{ "<leader>b", group = "Buffers" },
		{ "<leader>c", group = "Coding Stuff" },
		{ "<leader>d", group = "Debugging" },
		{ "<leader>f", group = "Find and force" },
		{ "<leader>g", group = "LSP Go to and git" },
		{ "<leader>h", group = "Gitsign hunk" },
		{ "<leader>m", group = "Markdown" },
		{ "<leader>p", group = "Persistence (session)" },
		{ "<leader>r", group = "Rest client" },
		{ "<leader>u", group = "Toggles" },
		{ "<leader>x", group = "Trouble" },
		{
			mode = { "n", "x" },
			{
				"<leader>uv",
				function()
					vim.diagnostic.config({ virtual_text = not is_virtual_text_enabled() })
				end,
				desc = is_virtual_text_enabled() and "Disable Virtual Text Diagnostic" or "Enable Virtual Text Diagnostic",
				icon = function()
					if is_virtual_text_enabled() then
						return { icon = " ", hl = "DiagnosticInfo" }
					else
						return { icon = " ", hl = "DiagnosticWarn" }
					end
				end,
			},
		},
	})
end
