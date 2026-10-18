# AGENTS.md — Agent-Managed Cross-OS Dotfiles

This repository is an **Agent-Managed Cross-OS Dotfiles** system supporting four primary environments from a single source of truth:
1. **macOS Workstation** (`Brewfile` + `mise` + GNU Stow + AeroSpace + SketchyBar)
2. **Linux Desktop / Omarchy** (`pacman`/`apt` + `mise` + GNU Stow + Hyprland / i3)
3. **Headless Linux / Rootless SSH** (`mise` userspace + GNU Stow, zero `sudo` required)
4. **Native Windows Workstation** (Windows Terminal + PowerShell 7 / Nushell + `mise` + Zero-Admin Directory Junctions + `$env:XDG_CONFIG_HOME = "$HOME\.config"`)

---

## 1. Quick Commands (`dot` CLI & Scripts)

Whenever working in this repository, start by inspecting the environment rather than guessing:

```bash
# 0. The `dot` CLI wraps everything below (bootstrap links it to ~/.local/bin/dot)
dot doctor [--json]   # platform, toolchain, links, drift
dot bootstrap [--full]  # Stage 0 seed
dot link              # stow packages + agent skills + overrides
dot overrides         # extract inline edits into untracked *_local files
dot validate          # installer + environment test suites
dot status            # git status of the checkout
dot prompt [parrot|starship|status]   # Bash prompt switcher
dot nvim [lite|malo|status]           # Neovim profile switcher
dot agent "<request>" # launch pi/claude here with `dot doctor --json` injected

# 1. Inspect OS, toolchain, symlinks, and config drift (human or JSON for agents)
./scripts/doctor.sh
./scripts/doctor.sh --json

# 2. Stage 0 minimal userspace bootstrap (mise + portable CLI + pi + links)
./bootstrap.sh --dry-run
./bootstrap.sh          # essentials: nvim-lite, essential pi packages
./bootstrap.sh --full   # + nvim-malo, zig, the optional pi extension set

# 3. Validate installer, manifest, and isolated sandbox/container environments
./scripts/validate-install.sh
./scripts/test-environments.sh

# 4. Seed per-machine config and link agent skills
./scripts/init-pi-settings.sh [--full] [--force] [--diff]
./scripts/init-herdr-config.sh
./scripts/link-pi-agent-entries.sh --list [--full]

# 5. Extract inline edits into untracked *_local override files
./scripts/extract-local-overrides.sh
```

On **Native Windows (PowerShell in Windows Terminal)**:
```powershell
.\scripts\windows\doctor.ps1 -Json
.\bootstrap.ps1 -DryRun
.\scripts\windows\link-windows.ps1 -DryRun
```

---

## 2. Repository Architecture

- **Stage 0 Bootstrap (`bootstrap.sh`, `bootstrap.ps1`):**
  Solves the "chicken-and-egg" problem on a bare machine. Installs `mise` in userspace without requiring `sudo`/Admin, installs the portable baseline (`node`, `neovim`, `starship`, `zoxide`, `ripgrep`, `fd`, `fzf`, `jq`, `lazygit`), installs `@earendil-works/pi-coding-agent` together with `@earendil-works/pi-tui`, links the core configs (`nvim-lite` as `~/.config/nvim`, `starship.toml`, the pi/herdr templates, agent skills) and exposes the `dot` CLI.
  `--full` adds `zig`, points `~/.config/nvim` at `nvim-malo`, and enables the optional pi extension set (`pi/.pi/agent/settings-full.json.template` + `OPTIONAL_EXTENSIONS` in the linker).
- **Modular Unix Installer (`install.sh` + `scripts/install/*.sh`):**
  Declarative group and package installer driven by [`scripts/install/manifest.sh`](file:///Users/mauro/dotfiles/scripts/install/manifest.sh). See [`INSTALLER_ARCHITECTURE.md`](file:///Users/mauro/dotfiles/INSTALLER_ARCHITECTURE.md) for module responsibilities.
- **Native Windows Subsystem (`windows/` + `scripts/windows/*.ps1`):**
  Forces `$env:XDG_CONFIG_HOME = "$HOME\.config"` so Neovim, Starship, Lazygit, Bat, and Yazi use the same `~/.config` structure on Windows as on Unix, and uses zero-Admin **Directory Junctions** (`mklink /J`) to link `nvim-lite` / `nvim-malo` (plus `%LOCALAPPDATA%\nvim`), `nushell`, and the agent skills. `scripts/windows/ensure-execution-policy.ps1` sets the CurrentUser execution policy to `RemoteSigned` so the profile can load. Where a Group Policy enforces the policy nothing local outranks it (not `-Scope Process`, not `-ExecutionPolicy Bypass`), so the helper instead installs the policy-proof launchers (`windows/dotfiles-shell.cmd`, `windows/bootstrap-dotfiles.cmd`) and points the PowerShell profiles in Windows Terminal at them: an inline command is not a script file, so the execution policy does not govern it and the same configuration loads. `Invoke-DotfileScript` in `bootstrap.ps1` / `link-windows.ps1` does the same for the helper scripts, which is why both read `$env:DOTFILES_REPO`. Every `.ps1` stays pure 7-bit ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as Windows-1252, where `✓` ends in a byte that it takes for a closing quote and swallows the next line.
- **Cross-Harness Agent Ecosystem (`pi/.pi/agent/` + `scripts/link-pi-agent-entries.sh`):**
  Manages skills across `~/.agents/skills`, `~/.claude/skills`, and `~/.pi/agent/skills` without pruning OS-owned or host-local entries (`LOCAL_ONLY_ENTRIES`), and only ever replaces links it owns or that dangle — real files and live foreign links are left alone. The `dotfiles-maintainer` skill is linked for every harness.
- **Per-Machine Config Templates (`*.json.template`, `*.toml.template`):**
  `settings`, `keybindings`, `models`, `mcp` (native pi MCP, live file `~/.pi/agent/mcp.json`) and `herdr` ship as tracked templates; `scripts/init-pi-settings.sh` and `scripts/init-herdr-config.sh` seed the live, untracked files on first run and never overwrite an existing one. `--force` skips the host-endpoint files (`models`, `mcp`) unless `--force-host` is passed.
- **Sentinel-Based Local Overrides (`scripts/extract-local-overrides.sh`):**
  Managed shell/git/WM files end with `# >>> END MANAGED CONFIG <<<` and source untracked `*_local` files (`~/.zshrc_local`, `~/.gitconfig_local`, etc.).

---

## 3. Safety & Verification Rules for Agents

1. **Read [`pi/.pi/agent/AGENTS.md`](file:///Users/mauro/dotfiles/pi/.pi/agent/AGENTS.md):** Never run `rm -rf` or destructive commands without explicit user confirmation.
2. **Preflight with `--dry-run`:** Always run `--dry-run` (or `-DryRun` on PowerShell) before applying stow, bootstrap, or override migrations.
3. **Run the Test Suite:** Any change to `install.sh`, `bootstrap.*`, `scripts/install/*`, `scripts/doctor.sh`, `scripts/windows/*`, `nvim-lite`, or `nvim-malo` must pass:
   - `./scripts/validate-install.sh`
   - `./scripts/test-environments.sh`
