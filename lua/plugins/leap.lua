return {
	"ggandor/leap.nvim",
	opts = {
		highlight_unlabeled_phase_one_targets = true,
	},
	config = function(_, opts)
		local leap = require("leap")
		for k, v in pairs(opts) do
			leap.opts[k] = v
		end
		leap.add_default_mappings(true)
	end,
}
