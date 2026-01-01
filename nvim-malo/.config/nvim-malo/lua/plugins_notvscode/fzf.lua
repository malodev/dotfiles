return {
	"ibhagwan/fzf-lua",
	-- optional for icon support
	dependencies = { "nvim-tree/nvim-web-devicons" },
	config = function()
		local ok, fzf_lua = pcall(require, "fzf-lua")
		if not ok then
			return
		end
		-- calling `setup` is optional for customization
		fzf_lua.setup({})
	end,
}
