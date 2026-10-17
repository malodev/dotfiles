---
name: dotfiles-maintainer
description: Maintain, bootstrap, diagnose, and synchronize this cross-OS agent-managed dotfiles repository across macOS, Linux (Arch/Omarchy/Ubuntu/Debian), headless SSH, and native Windows (Windows Terminal + PowerShell/Nushell). Trigger whenever working inside ~/dotfiles or ~/.dotfiles, or when the user asks to add/remove tools, fix stow/junction conflicts, resolve local config drift, or bootstrap a machine.
---

# Dotfiles Maintainer Skill

You are operating an **Agent-Managed Cross-OS Dotfiles Repository**. Never guess the machine's OS, installed package managers, or symlink state—always inspect first using the built-in diagnostic tools.

## 1. Situational Awareness First (`dot doctor`)

Before proposing or executing any configuration or package changes:

- **macOS / Linux / WSL:**
  ```bash
  ./scripts/doctor.sh --json
  ```
- **Native Windows (PowerShell):**
  ```powershell
  .\scripts\windows\doctor.ps1 -Json
  ```

Inspect the JSON output for:
- `platform.os`, `platform.distro` (`omarchy`, `arch`, `ubuntu`, `macos`, `windows`), `platform.is_ssh`, `platform.has_gui`, `platform.sudo`.
- `tools`: Which portable tools (`mise`, `stow`, `nvim`, `starship`, `rg`, `fd`, `fzf`, `jq`, `lazygit`, `zig`) are already installed.
- `links`: Which configs are `linked`, `real-file-or-dir`, `dangling-symlink`, or `absent`.
- `drift.sentinel_missing`: Tracked files that have inline edits instead of ending with `# >>> END MANAGED CONFIG <<<`.

---

## 2. The Four Supported Target Profiles

| Profile | Target Environment | Package & Runtime Layer | Config Linker |
| :--- | :--- | :--- | :--- |
| **`workstation-macos`** | macOS Desktop | `Brewfile` + `mise` | GNU Stow (`./install.sh`) + `scripts/link-pi-agent-entries.sh` |
| **`workstation-linux`** | Arch / Omarchy / Ubuntu GUI | System PM (`pacman`/`apt`) + `mise` | GNU Stow (`./install.sh`) + `scripts/link-pi-agent-entries.sh` |
| **`headless-ssh`** | Rootless / Remote Linux SSH | `mise` in userspace (`~/.local/bin/mise`) | `bootstrap.sh` or `./install.sh --preset minimal` |
| **`workstation-windows`** | Native Windows + Windows Terminal | `mise` (`winget`/`scoop` fallback) | `bootstrap.ps1` + `scripts/windows/link-windows.ps1` (Directory Junctions + `XDG_CONFIG_HOME=$HOME\.config`) |

---

## 3. Core Workflows

### A. Bootstrapping a Fresh Machine (Stage 0 -> Stage 1)
1. **Stage 0 Seed** (runs without any agent installed):
   - Unix: `./bootstrap.sh`
   - Windows: `.\bootstrap.ps1`
2. **Stage 1 Agent Completion** (your job once running):
   - Run `doctor` (`--json` / `-Json`).
   - If on macOS/Linux with sudo and full setup desired, run `./install.sh --dry-run` first, review output, then run `./install.sh` with the desired groups/preset.
   - Ensure `~/.pi/agent/*.json` are seeded (`./scripts/init-pi-settings.sh`) and skills are linked (`./scripts/link-pi-agent-entries.sh` or `scripts/windows/link-windows.ps1`).

### B. Adding a New CLI Tool Across All Platforms
To keep macOS, Linux, and Windows in sync when adding a portable CLI tool:
1. **Portable Layer (`mise`):** Add the tool to `bootstrap.sh`, `bootstrap.ps1`, and `scripts/install/mise.sh` if it belongs in the universal baseline or `dev` group.
2. **macOS Layer:** Add to `Brewfile` if macOS manages it via Homebrew.
3. **Manifest Layer:** If adding a new dotfile config directory `<pkg>/`, register it in `scripts/install/manifest.sh` (`INSTALL_GROUPS`, `GROUP_DETAIL_LINE_*`) and `scripts/windows/link-windows.ps1` (if applicable to Windows).
4. **Verify:** Run `./scripts/validate-install.sh` and `./scripts/test-environments.sh`.

### C. Resolving Local Drift & Sentinel Overrides
Managed shell/git/WM files end with `# >>> END MANAGED CONFIG <<<` and source an untracked `*_local` file for machine-specific secrets or overrides.
- If `doctor` reports files in `drift.sentinel_missing`:
  1. Preview extraction: `./scripts/extract-local-overrides.sh --dry-run`
  2. Apply extraction: `./scripts/extract-local-overrides.sh --apply`
- For `models.json` or `mcp.json` in `~/.pi/agent/`:
  - Never overwrite host-specific endpoints without asking. Use `./scripts/init-pi-settings.sh --diff` to inspect differences.

### D. Unfolding & Linking Agent Skills
Skills in `pi/.pi/agent/skills/` are shared across Pi, Claude Code, Codex, and Antigravity via `scripts/link-pi-agent-entries.sh` (Unix) and `scripts/windows/link-windows.ps1` (Windows):
- Harness-agnostic skills link to `~/.agents/skills/<name>` and mirror to `~/.claude/skills/<name>`.
- Pi-specific skills (`PI_ONLY_SKILLS`) link only to `~/.pi/agent/skills/<name>`.
- Machine-local skills (`LOCAL_ONLY_ENTRIES`, such as Omarchy's `/usr/share/omarchy/...`) are never touched or pruned.

---

## 4. Mandatory Verification & Safety Rules

- **Never run `rm -rf`** or destructive file operations without explicit user confirmation.
- **Always run `--dry-run` first** on `install.sh`, `bootstrap.sh`, `link-pi-agent-entries.sh`, and `extract-local-overrides.sh`.
- **Always validate after modifying installer, manifest, or bootstrap scripts:**
  ```bash
  ./scripts/validate-install.sh
  ./scripts/test-environments.sh
  ```
