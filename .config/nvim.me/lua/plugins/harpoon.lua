return {
	"ThePrimeagen/harpoon",
	branch = "harpoon2",
	event = "VimEnter",
	dependencies = {
		"nvim-lua/plenary.nvim",
	},
	config = function()
		local harpoon = require("harpoon")
		harpoon.setup({
			menu = {
				width = 60,
			},
		})

		local opts = { noremap = true, silent = true }
		local keymap = vim.keymap

		-- basic telescope configuration
		local conf = require("telescope.config").values
		local function toggle_telescope(harpoon_files)
			local file_paths = {}
			for _, item in ipairs(harpoon_files.items) do
				table.insert(file_paths, item.value)
			end

			require("telescope.pickers")
				.new({}, {
					prompt_title = "Harpoon",
					finder = require("telescope.finders").new_table({
						results = file_paths,
					}),
					previewer = conf.file_previewer({}),
					sorter = conf.generic_sorter({}),
				})
				:find()
		end

		opts["desc"] = "Open harpoon window"
		keymap.set("n", "<leader>fh", function()
			toggle_telescope(harpoon:list())
		end, opts)

		opts["desc"] = "Add file to Harpoon"
		keymap.set("n", "<C-h>", function()
			harpoon:list():append()
		end, opts)

		opts["desc"] = "Toogle Harpoon Menu"
		keymap.set("n", "<C-e>", function()
			harpoon.ui:toggle_quick_menu(harpoon:list())
		end, opts)

		-- Toggle previous & next buffers stored within Harpoon list
		opts["desc"] = "Harpoon previous buffers"
		keymap.set("n", "<C-S-P>", function()
			harpoon:list():prev()
		end, opts)
		opts["desc"] = "Harpoon next buffers"
		keymap.set("n", "<C-S-N>", function()
			harpoon:list():next()
		end, opts)

		opts["desc"] = "Open Harpooned file #"
		keymap.set("n", "<leader>1", function()
			harpoon:list():select(1)
		end, opts)
		opts["desc"] = "Open Harpooned file #"
		keymap.set("n", "<leader>2", function()
			harpoon:list():select(2)
		end, opts)
		opts["desc"] = "Open Harpooned file #"
		keymap.set("n", "<leader>3", function()
			harpoon:list():select(3)
		end, opts)
		opts["desc"] = "Open Harpooned file #"
		keymap.set("n", "<leader>4", function()
			harpoon:list():select(4)
		end, opts)
		opts["desc"] = "Open Harpooned file #"
		keymap.set("n", "<leader>5", function()
			harpoon:list():select(5)
		end, opts)
		opts["desc"] = "Open Harpooned file #"
		keymap.set("n", "<leader>6", function()
			harpoon:list():select(6)
		end, opts)
		opts["desc"] = "Open Harpooned file #"
		keymap.set("n", "<leader>7", function()
			harpoon:list():select(7)
		end, opts)
		opts["desc"] = "Open Harpooned file #"
		keymap.set("n", "<leader>8", function()
			harpoon:list():select(8)
		end, opts)
		opts["desc"] = "Open Harpooned file #"
		keymap.set("n", "<leader>9", function()
			harpoon:list():select(9)
		end, opts)
	end,
}
