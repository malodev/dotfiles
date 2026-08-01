--- OSC 52 clipboard provider using BEL (\a) terminator instead of ST (\e\\)
--- The default Neovim osc52 module uses ST which herdr/tmux/some terminals
--- don't forward. BEL is more widely supported (kitty, iTerm2, foot, xterm).
---
--- We only use this for yank → system clipboard (one-way).
--- OSC 52 reads hang on multiplexers, so paste uses Neovim's internal
--- registers. Use Cmd+V / Ctrl+Shift+V for system clipboard paste.
local M = {}

--- Send a raw OSC 52 escape sequence to the terminal.
--- @param clipboard string 'c' (system) or 'p' (primary)
--- @param b64 string Base64-encoded content
function M.send(clipboard, b64)
  vim.api.nvim_ui_send(string.format('\027]52;%s;%s\007', clipboard, b64))
end

--- Build a copy function compatible with vim.g.clipboard (kept for reference;
--- the autocmd in options.lua calls M.send directly instead).
function M.copy(reg)
  local clipboard = reg == '+' and 'c' or 'p'
  return function(lines)
    M.send(clipboard, vim.base64.encode(table.concat(lines, '\n')))
  end
end

--- Placeholder paste — returns empty to avoid hanging on OSC 52 reads.
function M.paste()
  return function()
    return {}
  end
end

return M
