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
- **Another machine over SSH** (the target's own sensor, nothing needed there beyond the repo):
  ```bash
  dot doctor --host <host> [--ssh-port N] [--json]
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
| **`headless-ssh`** | Rootless / Remote Linux SSH | `mise` in userspace (`~/.local/bin/mise`) | `bootstrap.sh` or `./install.sh --minimal` |
| **`workstation-windows`** | Native Windows + Windows Terminal | `mise` (`winget`/`scoop`/GitHub release zip fallback) | `bootstrap.ps1` + `scripts/windows/link-windows.ps1` (Directory Junctions + `XDG_CONFIG_HOME=$HOME\.config`) |

The full deployment catalogue — who drives, how the repository gets there, privilege and
scope, the exact commands per scenario, what to verify and what is still missing — is
`DEPLOYMENT.md`, at the repository root (five levels up from this file, and the same
directory the `dot` CLI prints with `dot cd`). Read it before deploying to a machine you
have not touched before, especially a locked-down one.

---

## 3. Deployment Decision Tree

Run `dot doctor --host <host>` before and after any deployment: it is the target's own sensor
over SSH, and it needs nothing installed there beyond the repository.

1. **Can you reach the machine over SSH?**
   - yes -> stay on the driver: `dot deploy --to <host>` (or `--profile <name>`, `--dry-run`
     first). The agent never needs a shell on the target.
   - several machines at once -> `dot deploy --hosts hosts/<name>.fleet`: one target per line
     (profile name or `user@host`), with per-host overrides such as `port=2222` or
     `verify_only=1`, and a summary table with a non-zero exit code if any host failed.
   - no -> get a terminal there and pull: `git clone … && ./bootstrap.sh`, the
     `curl …/bootstrap.sh | bash` form (the script clones the repository itself), or a mounted
     share.
2. **Which OS and privilege?**
   - Linux / macOS / WSL, userspace or sudo -> `bootstrap.sh`, then `install.sh --minimal`,
     `--standard`, `--full`, or `-g <group>`. Add `--yes` (or set `DOTFILES_ASSUME_YES=1`) when
     nobody can answer a prompt: over SSH, in cloud-init, in a container. The installer then
     exits non-zero if a step failed, which is the signal to act on.
   - Windows with Administrator -> `bootstrap.ps1 [-Full] [-EnableSsh]`, or `dot deploy` as for
     any other host: the archive is extracted with `tar.exe`/`7z.exe` and the bootstrap is
     evaluated, so a policy that blocks script files does not matter
   - Windows without Administrator, or a Group Policy that blocks scripts ->
     `windows\bootstrap-dotfiles.cmd` (evaluates the bootstrap instead of executing it) and
     `windows\dotfiles-shell.cmd` for the profile
3. **Verify** with `dot doctor --host <host>`: `tools` missing, `providers.ready` (a fresh host
   has no key, so `pi`'s first prompt fails auth until one is added),
   `execution_policy.profile_can_load` (a Group Policy wins over the local scopes), `drift`.
4. **When a step fails**, the fix is usually already in the repository:

| Symptom | What to do |
|---|---|
| `Add-WindowsCapability` hangs | the helper times out after 180 s and installs Win32-OpenSSH from the GitHub release; `-SkipCapability` goes straight there |
| no `winget` (standard account) | the bootstrap downloads the `mise` release zip into `%LOCALAPPDATA%\mise`: userspace, no Admin |
| "running scripts is disabled on this system" | the policy blocks script *files*: evaluate instead (`iex (Get-Content -Raw …)`), and let `ensure-execution-policy.ps1` install the launchers and repoint Windows Terminal |
| key login refused, and no log explains it | sshd runs as SYSTEM: `~\.ssh\authorized_keys` needs `SYSTEM` read access as well as the user's full control |
| `pi` cannot authenticate | no provider key on that host: add the file a provider expects, or run `pi auth` |
| repository missing on the target | `dot deploy --transport clone` (needs GitHub there) or the share path of S3 |
| remote `dot` not found | `dot deploy` links `~/.local/bin/dot`; otherwise run the copy inside the repository |

## 4. Core Workflows

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

### B2. Stow conflicts (real files where the repo wants a link)

`stow <pkg>` aborts with "existing target is not owned by stow" on any machine that has been
running for a while. Do not fix it by hand and do not use `stow --adopt` (it copies the live file
back over the repository). Run the tool that encodes the rules instead:

1. `dot stow --dry-run <pkg>` — shows what would be adopted, relinked or refused.
2. `dot stow --apply <pkg>` — backs each real file up under
   `~/.local/state/dotfiles/adopted/<timestamp>/`, moves it aside, stows, then verifies every entry
   resolves into the repository.
3. It refuses OS-owned paths (`~/.config/omarchy`, `~/.config/hypr`, systemd) and refuses real
   *directories* unless `--adopt-dirs` is given, because a directory mixes machine files with
   dotfile ones.
4. Record the decision in `~/Work/AGENTS.md`: which package follows the repo on this machine and
   where the backup went.

An absolute symlink into the repository (made by hand, or by a bootstrap) is not a conflict to
adopt: it is ours and only needs relinking, which the tool does.

### C. Resolving Local Drift & Sentinel Overrides
Managed shell and git files end with `# >>> END MANAGED CONFIG <<<` and source an untracked `*_local` file for machine-specific secrets or overrides. Hyprland is excluded: Omarchy 4 made its config Lua, with machine overrides in the `hypr.hyprland_local` module loaded by `require_optional()`, so there is no sentinel to look for.
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

## 5. Mandatory Verification & Safety Rules

- **Never run `rm -rf`** or destructive file operations without explicit user confirmation.
- **Always run `--dry-run` first** on `install.sh`, `bootstrap.sh`, `link-pi-agent-entries.sh`, and `extract-local-overrides.sh`.
- **Always validate after modifying installer, manifest, or bootstrap scripts:**
  ```bash
  ./scripts/validate-install.sh
  ./scripts/test-environments.sh
  ```

---

## 6. Secrets & Credentials

Secrets are **files**, never values in tracked config. `models.json` only names them, so a host is "configured" when the files exist:

```json
"tokenator": "!cat ~/.config/tokenator/litellm-api-key"
"pi-llama":  "!~/.local/bin/pi-inference credential model-api"
```

- One secret per file, `chmod 600`, no trailing newline. Directories `0700`.
- Known locations: `~/.pi-inference/credentials/{control-api-token,model-api-key}`, `~/.config/tokenator/litellm-api-key`, `~/.config/vllm-mlx/api-key`, `~/.config/unsloth/pi-api-key`, `~/.config/pi-secrets/*`.
- **Fill credentials with the focused scripts, not the deploy script.** The inference pair (control plane + model endpoints) has its own installer; every other `!cat` provider is derived from `models.json`, so there is no list to maintain:
  ```bash
  ~/dotfiles/scripts/pi-provider-secrets.sh --check          # report only, exit 1 if incomplete
  ~/dotfiles/scripts/pi-provider-secrets.sh                  # prompt without echo for what is missing
  ~/dotfiles/scripts/pi-provider-secrets.sh --provider mlx --from-file mlx=/path/key
  ```
- **The inference pair:**
  ```bash
  ~/dotfiles/scripts/pi-inference-credentials.sh --check      # report only, exit 1 if incomplete
  ~/dotfiles/scripts/pi-inference-credentials.sh              # install what is missing (stdin, no history)
  ~/dotfiles/scripts/pi-inference-credentials.sh --from-file control-api=/path/token --from-file model-api=/path/key
  ```
- **`scripts/pi-inference-client-setup --verify` is not part of routine setup.** It flips the shared inference host between modes to smoke-test every managed model; run it deliberately, when the host is idle, never while someone else is using it.
- Secrets are not recoverable from backups of config: if a key file is missing on a new host it must be re-issued at the source (LiteLLM, the inference host, the model service). Never invent one.
