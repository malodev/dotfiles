return {
  "zbirenbaum/copilot.lua",
  -- Lazy load when event occurs. Events are triggered
  -- as mentioned in:
  -- https://vi.stackexchange.com/a/4495/20389
  event = "InsertEnter",
  -- You can also have it load at immediately at
  -- startup by commenting above and uncommenting below:
  -- lazy = false
  opts = {
    -- Possible configurable fields can be found on:
    -- https://github.com/zbirenbaum/copilot.lua#setup-and-configuration
    suggestion = {
      enable = false,
    },
    panel = {
      enable = false,
    },
  }
}
