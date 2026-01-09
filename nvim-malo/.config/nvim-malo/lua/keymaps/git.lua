-- Git keymaps
local map = require("keymaps.util").safe_keymap_set

-- Lazygit
if vim.fn.executable("lazygit") == 1 then
	map("n", "<leader>gg", function()
		Snacks.lazygit()
	end, { desc = "Lazygit (cwd)" })
	map("n", "<leader>gf", function()
		Snacks.lazygit.log_file()
	end, { desc = "Lazygit Current File History" })
	map("n", "<leader>gL", function()
		Snacks.lazygit.log()
	end, { desc = "Lazygit Log (cwd)" })
end

-- Git blame and browse
map("n", "<leader>gb", function()
	Snacks.git.blame_line()
end, { desc = "Git Blame Line" })
map({ "n", "x" }, "<leader>gB", function()
	Snacks.gitbrowse()
end, { desc = "Git Browse (open)" })
map({ "n", "x" }, "<leader>gY", function()
	Snacks.gitbrowse({ open = function(url)
		vim.fn.setreg("+", url)
	end, notify = false })
end, { desc = "Git Browse (copy)" })
