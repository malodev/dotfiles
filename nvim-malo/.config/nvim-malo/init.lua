-- Suppress LSP deprecation warnings from upstream plugins (must be first!)
do
	-- Override vim.deprecate
	local original_deprecate = vim.deprecate
	vim.deprecate = function(name, alternative, version, plugin, message)
		if name == "client.supports_method" then
			return
		end
		if original_deprecate then
			original_deprecate(name, alternative, version, plugin, message)
		end
	end

	-- Also override vim.notify as backup
	local original_notify = vim.notify
	vim.notify = function(msg, level, opts)
		if type(msg) == "string" and msg:find("client.supports_method is deprecated") then
			return
		end
		original_notify(msg, level, opts)
	end
end

require("options")
require("lazy-init")
require("keymaps")


