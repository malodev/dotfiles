return {
	"nvim-tree/nvim-tree.lua",
	version = "*",
	lazy = false,
	dependencies = {
		"nvim-tree/nvim-web-devicons",
	},
	config = function()
		require("nvim-tree").setup({
			on_attach = "default",
			hijack_cursor = false,
			auto_reload_on_write = true,
			disable_netrw = false,
			hijack_netrw = true,
			hijack_unnamed_buffer_when_opening = false,
			root_dirs = {},
			prefer_startup_root = false,
			sync_root_with_cwd = false,
			reload_on_bufenter = false,
			respect_buf_cwd = false,
			select_prompts = false,
			sort = {
				sorter = "name",
				folders_first = true,
				files_first = false,
			},
			view = {
				centralize_selection = false,
				cursorline = true,
				debounce_delay = 15,
				side = "left",
				preserve_window_proportions = false,
				number = false,
				relativenumber = false,
				signcolumn = "yes",
				width = 30,
				float = {
					enable = false,
					quit_on_focus_loss = true,
					open_win_config = {
						relative = "editor",
						border = "rounded",
						width = 30,
						height = 30,
						row = 1,
						col = 1,
					},
				},
			},
			renderer = {
				add_trailing = true,
				group_empty = false,
				full_name = false,
				root_folder_label = ":~:s?$?/..?",
				indent_width = 2,
				special_files = { "Cargo.toml", "Makefile", "README.md", "readme.md" },
				symlink_destination = true,
				highlight_git = "none",
				highlight_diagnostics = "none",
				highlight_opened_files = "none",
				highlight_modified = "none",
				highlight_bookmarks = "none",
				highlight_clipboard = "name",
				indent_markers = {
					enable = true,
					inline_arrows = true,
					icons = {
						corner = "└",
						edge = "│",
						item = "│",
						bottom = "─",
						none = " ",
					},
				},
				icons = {
					web_devicons = {
						file = {
							enable = true,
							color = true,
						},
						folder = {
							enable = false,
							color = true,
						},
					},
					git_placement = "before",
					modified_placement = "after",
					diagnostics_placement = "signcolumn",
					bookmarks_placement = "signcolumn",
					padding = " ",
					symlink_arrow = " ➛ ",
					show = {
						file = true,
						folder = true,
						folder_arrow = true,
						git = true,
						modified = true,
						diagnostics = true,
						bookmarks = true,
					},
					glyphs = {
						default = "",
						symlink = "",
						bookmark = "󰆤",
						modified = "●",
						folder = {
							arrow_closed = "",
							arrow_open = "",
							default = "",
							open = "",
							empty = "",
							empty_open = "",
							symlink = "",
							symlink_open = "",
						},
						git = {
							unstaged = "✗",
							staged = "✓",
							unmerged = "",
							renamed = "➜",
							untracked = "★",
							deleted = "",
							ignored = "◌",
						},
					},
				},
			},
			hijack_directories = {
				enable = true,
				auto_open = true,
			},
			update_focused_file = {
				enable = true,
				update_root = {
					enable = false,
					ignore_list = {},
				},
				exclude = false,
			},
			system_open = {
				cmd = "",
				args = {},
			},
			git = {
				enable = true,
				show_on_dirs = true,
				show_on_open_dirs = true,
				disable_for_dirs = {},
				timeout = 400,
				cygwin_support = false,
			},
			diagnostics = {
				enable = false,
				show_on_dirs = false,
				show_on_open_dirs = true,
				debounce_delay = 50,
				severity = {
					min = vim.diagnostic.severity.HINT,
					max = vim.diagnostic.severity.ERROR,
				},
				icons = {
					hint = "",
					info = "",
					warning = "",
					error = "",
				},
			},
			modified = {
				enable = true,
				show_on_dirs = true,
				show_on_open_dirs = true,
			},
			filters = {
				enable = true,
				git_ignored = true,
				dotfiles = false,
				git_clean = false,
				no_buffer = false,
				no_bookmark = false,
				custom = {},
				exclude = {},
			},
			live_filter = {
				prefix = "[FILTER]: ",
				always_show_folders = true,
			},
			filesystem_watchers = {
				enable = true,
				debounce_delay = 50,
				ignore_dirs = {},
			},

			actions = {
				use_system_clipboard = true,
				change_dir = {
					enable = true,
					global = false,
					restrict_above_cwd = false,
				},
				expand_all = {
					max_folder_discovery = 300,
					exclude = {},
				},
				file_popup = {
					open_win_config = {
						col = 1,
						row = 1,
						relative = "cursor",
						border = "shadow",
						style = "minimal",
					},
				},
				open_file = {
					quit_on_open = false,
					eject = true,
					resize_window = true,
					window_picker = {
						enable = true,
						picker = "default",
						chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
						exclude = {
							filetype = { "notify", "packer", "qf", "diff", "fugitive", "fugitiveblame" },
							buftype = { "nofile", "terminal", "help" },
						},
					},
				},
				remove_file = {
					close_window = true,
				},
			},
			trash = {
				cmd = "gio trash",
			},
			tab = {
				sync = {
					open = false,
					close = false,
					ignore = {},
				},
			},
			notify = {
				threshold = vim.log.levels.INFO,
				absolute_path = true,
			},
			help = {
				sort_by = "key",
			},
			ui = {
				confirm = {
					remove = true,
					trash = true,
					default_yes = false,
				},
			},
			experimental = {},
			log = {
				enable = false,
				truncate = false,
				types = {
					all = false,
					config = false,
					copy_paste = false,
					dev = false,
					diagnostics = false,
					git = false,
					profile = false,
					watcher = false,
				},
			},
		})
	end,
	keys = {
		{ "<C-n>", "<cmd>NvimTreeToggle<CR><C-W><C-W>", desc = "Toogle nvim-tree" },
		{ "<C-b>", "<cmd>NvimTreeFindFile<CR>", desc = "Show the current buffer in NvimTree" },
		{ "<leader>e", "<cmd>NvimTreeFocus<CR>", desc = "Focus on NvimTree" },
	},
    vim.api.nvim_create_autocmd("BufEnter", {
      nested = true,
      callback = function()
        local api = require("nvim-tree.api")

        -- Only 1 window with nvim-tree left: we probably closed a file buffer
        if #vim.api.nvim_list_wins() == 1 and api.tree.is_tree_buf() then
          -- Required to let the close event complete. An error is thrown without this.
          vim.defer_fn(function()
            -- close nvim-tree: will go to the last hidden buffer used before closing
            api.tree.toggle({ find_file = true, focus = true })
            -- re-open nivm-tree
            api.tree.toggle({ find_file = true, focus = true })
            -- nvim-tree is still the active window. Go to the previous window.
            vim.cmd("wincmd p")
          end, 0)
        end
      end,
    })

    local nvimTreeFocusOrToggle = function()
      local nvimTree = require("nvim-tree.api")
      local currentBuf = vim.api.nvim_get_current_buf()
      local currentBufFt = vim.api.nvim_get_option_value("filetype", { buf = currentBuf })
      if currentBufFt == "NvimTree" then
        vim.cmd("wincmd w")
      else
        nvimTree.tree.focus()
      end
    end

    -- vim.keymap.set("n", "<leader>tn", nvimTreeFocusOrToggle)
    vim.keymap.set("n", "<A-n>", nvimTreeFocusOrToggle)

    -- -- Set vim.g.nvimtree_was_open to 1 when the NvimTree window is opened
    -- vim.cmd("autocmd FileType NvimTree let g:nvimtree_was_open = 1")
    --
    -- -- Set vim.g.nvimtree_was_open to 0 when the NvimTree window is closed
    -- vim.cmd("autocmd BufWinLeave NvimTree let g:nvimtree_was_open = 0")
    --
    -- -- Function to save the variable
    -- function _G.save_nvimtree_state()
    -- 	local file = io.open(vim.fn.stdpath("data") .. "/nvimtree_was_open.txt", "w")
    -- 	if file then
    -- 		file:write(vim.g.nvimtree_was_open)
    -- 		file:close()
    -- 		-- vim.api.nvim_echo(
    -- 		-- 	{ { "Save State to " .. vim.fn.stdpath("data") .. "/nvimtree_was_open.txt", "DiagnosticInfo" } },
    -- 		-- 	true,
    -- 		-- 	{}
    -- 		-- )
    -- 	end
    -- end
    --
    -- -- Function to load the variable
    -- function _G.load_nvimtree_state()
    -- 	local file = io.open(vim.fn.stdpath("data") .. "/nvimtree_was_open.txt", "r")
    -- 	if file then
    -- 		vim.g.nvimtree_was_open = file:read("*a")
    -- 		-- vim.api.nvim_echo({ { "Load State: " .. vim.g.nvimtree_was_open, "DiagnosticInfo" } }, true, {})
    --
    -- 		file:close()
    -- 		if vim.g.nvimtree_was_open == "1" then
    -- 			local api = require("nvim-tree.api")
    -- 			api.tree.open()
    -- 			-- vim.cmd("NvimTreeOpen")
    -- 			-- vim.cmd("wincmd w")
    -- 		end
    -- 	end
    -- end
}
