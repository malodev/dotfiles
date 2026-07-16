local function find_copilot_node()
  if vim.fn.executable("mise") == 1 then
    local result = vim.system({ "mise", "which", "node" }, { text = true }):wait()
    local node = vim.trim(result.stdout or "")
    if result.code == 0 and vim.fn.executable(node) == 1 then
      return node
    end
  end
  return "node"
end

return {
  copilot_node_command = find_copilot_node(),
  is_enabled = {
    chatgpt = false,
    codeium = true,
    nvchad_colorizer = true,
    norcalli_colorizer = false,
    neogit = true,
    telescope_tabs = true,
    bufferline = true,
    blink = true,
  },
  -- icons from LazyVim
  icons = {
    misc = {
      dots = "󰇘",
      on = " ",
      off = " ",
      nvim = "",
    },
    ft = {
      octo = "",
    },
    dap = {
      Stopped = { "󰁕 ", "DiagnosticWarn", "DapStoppedLine" },
      Breakpoint = " ",
      BreakpointCondition = " ",
      BreakpointRejected = { " ", "DiagnosticError" },
      LogPoint = ".>",
    },
    diagnostics = {
      Error = " ",
      Warn = " ",
      Hint = " ",
      Info = " ",
    },
    git = {
      added = " ",
      modified = " ",
      removed = " ",
    },
    kinds = {
      Array = " ",
      Boolean = "󰨙 ",
      Class = " ",
      Codeium = "󰘦 ",
      Color = " ",
      Control = " ",
      Collapsed = " ",
      Constant = "󰏿 ",
      Constructor = " ",
      Copilot = " ",
      Enum = " ",
      EnumMember = " ",
      Event = " ",
      Field = " ",
      File = " ",
      Folder = " ",
      Function = "󰊕 ",
      Interface = " ",
      Key = " ",
      Keyword = " ",
      Method = "󰊕 ",
      Module = " ",
      Namespace = "󰦮 ",
      Null = " ",
      Number = "󰎠 ",
      Object = " ",
      Operator = " ",
      Package = " ",
      Property = " ",
      Reference = " ",
      Snippet = "󱄽 ",
      String = " ",
      Struct = "󰆼 ",
      Supermaven = " ",
      TabNine = "󰏚 ",
      Text = " ",
      TypeParameter = " ",
      Unit = " ",
      Value = " ",
      Variable = "󰀫 ",
    },
  },
}
