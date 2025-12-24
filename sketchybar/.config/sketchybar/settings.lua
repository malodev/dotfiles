-- settings.lua
return {
  font = {
    text = "SF Pro",
    apps = "sketchybar-app-font", -- Ensure you have this font installed
    nerd = "Hack Nerd Font",
  },
  dim = {
    h = 50,
    padding = 3,
  },
  item_width = 65, -- Width of center items (adjust to match bar width)
  git = {
    projects_dir = os.getenv("HOME") .. "/Develop",
    max_repos = 10,
    recent_days = 0, -- 0 = no time filter
  },
}
