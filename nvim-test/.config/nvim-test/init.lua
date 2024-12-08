print("advend of neovim")

MyFun = function() print "hello" end

vim.api.nvim_create_autocmd('TextYankPost', {
  desc = 'Highlight when yankink text',
  group = vim.api.nvim_create_augroup('yank-highlight', { clear = true }),
  callback = function()
	  vim.highlight.on_yank()
  end,
})
