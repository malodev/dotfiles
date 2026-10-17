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
# 1. Inspect OS, toolchain, symlinks, and config drift (human or JSON for agents)
./scripts/doctor.sh
./scripts/doctor.sh --json

# 2. Stage 0 minimal userspace bootstrap (installs mise + core CLI + pi + links)
./bootstrap.sh --dry-run
./bootstrap.sh

# 3. Validate installer, manifest, and isolated sandbox/container environments
./scripts/validate-install.sh
./scripts/test-environments.sh

# 4. Link agent skills & seed Pi templates
./scripts/init-pi-settings.sh
./scripts/link-pi-agent-entries.sh --list

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
  Solves the "chicken-and-egg" problem on a bare machine. Installs `mise` in userspace without requiring `sudo`/Admin, installs portable tools (`node`, `nvim`, `starship`, `rg`, `fd`, `fzf`, `jq`, `lazygit`, `zig`), installs `@mariozechner/pi-coding-agent` (`pi`), links core configs (`nvim-malo`, `starship`, agent skills), and exposes the `dot` CLI.
- **Modular Unix Installer (`install.sh` + `scripts/install/*.sh`):**
  Declarative group and package installer driven by [`scripts/install/manifest.sh`](file:///Users/mauro/dotfiles/scripts/install/manifest.sh). See [`INSTALLER_ARCHITECTURE.md`](file:///Users/mauro/dotfiles/INSTALLER_ARCHITECTURE.md) for module responsibilities.
- **Native Windows Subsystem (`windows/` + `scripts/windows/*.ps1`):**
  Forces `$env:XDG_CONFIG_HOME = "$HOME\.config"` so Neovim, Starship, Lazygit, Bat, and Yazi use the same `~/.config` structure on Windows as on Unix, and uses zero-Admin **Directory Junctions** (`mklink /J`) to link `nvim-malo`, `nushell`, and agent skills.
- **Cross-Harness Agent Ecosystem (`pi/.pi/agent/` + `scripts/link-pi-agent-entries.sh`):**
  Manages skills across `~/.agents/skills`, `~/.claude/skills`, and `~/.pi/agent/skills` without pruning OS-owned or host-local entries (`LOCAL_ONLY_ENTRIES`).
- **Sentinel-Based Local Overrides (`scripts/extract-local-overrides.sh`):**
  Managed shell/git/WM files end with `# >>> END MANAGED CONFIG <<<` and source untracked `*_local` files (`~/.zshrc_local`, `~/.gitconfig_local`, etc.).

---

## 3. Safety & Verification Rules for Agents

1. **Read [`pi/.pi/agent/AGENTS.md`](file:///Users/mauro/dotfiles/pi/.pi/agent/AGENTS.md):** Never run `rm -rf` or destructive commands without explicit user confirmation.
2. **Preflight with `--dry-run`:** Always run `--dry-run` (or `-DryRun` on PowerShell) before applying stow, bootstrap, or override migrations.
3. **Run the Test Suite:** Any change to `install.sh`, `bootstrap.*`, `scripts/install/*`, or `nvim-malo` must pass:
   - `./scripts/validate-install.sh`
   - `./scripts/test-environments.sh`
