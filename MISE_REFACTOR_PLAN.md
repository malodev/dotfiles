# Mise Refactor Plan

> Refactor `dotfiles/install.sh` so **mise** is the core user-level tool/runtime
> manager, replacing the per-distro `curl`/`nvm`/`nodesource`/`go.dev`/official-installer
> tangle in `scripts/install/dev-tools.sh`.
>
> Status: **implemented & tested (2026-08-19) — Phases 0–3 and 5–6 complete. Phase 4 cancelled.**

---

## Implementation Corrections (recorded during implementation)

1. **Phase 1 — no stow package.** The plan called for stowing `~/.config/mise/config.toml`.
   **Corrected:** Omarchy's installer already owns that file (claude/gh/pi), and stowing
   would clobber it + trip stow's conflict check. The installer now uses `mise use -g`
   to **merge** the dev tools into the existing config (same mechanism Omarchy's own
   `mise.sh` uses). No `mise/` stow package, no `core` group change, no `mise trust`.
2. **Phase 3 — tool ID:** `git-delta` is not a valid mise tool ID (the binary/ID is
   `delta`). Corrected in `mise_sync_tools()`.
3. **Phase 3 — extra caller:** `install_uv_tool` / `install_bun_tool` /
   `install_lazydocker_tool` were also called from `install_user_local_preferred_tools()`
   (packages.sh, `--user-local` mode), not just `install_dev_tools()`. Both call sites
   now defer to mise; the helper functions were deleted.
4. **Ordering:** `mise install` runs **after stow** (in `mise_sync_tools()`), so the
   npm-based editor deps (yarn, tree-sitter-cli) moved there too — they need node from
   mise, which isn't available during `run_install_programs()`.
5. **Node version:** initially set to `node@lts` (24.19.0), **corrected to `node@latest`**
   (26.7.0) to match Omarchy's `mise-work.sh` (`mise use -g node@latest`).

---

## 1. Goal

- Make `install.sh` install the *dev* runtimes and CLI tools (node, go, deno, bun, uv,
  gh, git-delta, lazygit, lazydocker, hub) through **mise**, with a single committed
  `~/.config/mise/config.toml`. Baseline CLI tools (fzf, ripgrep, bat, …) stay with the
  system package manager for now (see §10 decision 2).
- Keep the native package manager (`pacman`/`apt`/`dnf`/`brew`) **only** for genuine
  system dependencies (GNU Stow, Neovim, build toolchains, system libraries, shells).
- Make the **no-sudo / `--user-local`** path first-class and simple: bootstrap mise
  once (`curl https://mise.run | sh`), then `mise install` handles the rest.
- Delete all traces of nvm/nodesource and the duplicated GitHub-release/`go.dev`
  installers.

---

## 2. Background & Motivation

- **Omarchy 4.0 already adopted mise** as its tool manager (ships `omarchy-mise-install`,
  `omarchy-update-mise`, `mise.sh`, `mise-work.sh`). The dotfiles should match.
- **`nvim-malo` already expects mise-managed node** (`nvim-malo/.config/nvim-malo/lua/config/init.lua`
  → `find_copilot_node()` calls `mise which node`). Today the installer installs *system*
  node (`pacman nodejs npm`) while Neovim looks for *mise* node — an inconsistency.
- **mise is cross-platform** (Linux/macOS/Windows) and installs user-locally with no sudo,
  which is exactly the case this installer must handle (`--user-local`, shared hosting).
- **nvm is already fully removed** from the machine (shell configs + `~/.nvm` +
  `~/.config/nvm`); this plan makes the installer itself nvm-free so it can't resurrect it.

---

## 3. Current Architecture (what we're replacing)

`install.sh` is a thin entrypoint. The real logic is **group-based**:

- `scripts/install/manifest.sh` declares groups (`core`, `shell`, `terminal`, `dev`,
  `editor`, `editor-alt`, `web-cli`, `gui-terminal`, `desktop`, `linux`, `hyprland`,
  `pi-agent`, `system-info`), defaults, and install order.
- `main()` in `install.sh` runs:
  `detect_os` → `resolve_install_mode` → interactive/preset selection →
  `setup_stow` → `setup_package_manager_for_mode` → `run_install_programs` →
  stow preflight → stow → post-steps.
- **`run_install_programs()`** (in `scripts/install/flow.sh`) calls every installer
  function; each function **gates itself on group selection** (e.g. `install_dev_tools()`
  returns unless `get_group_selection "dev"` is `1`).
- **`install_cli_tools()`** is the one un-gated baseline (always runs on Linux): fzf,
  ripgrep, lsd, bat, fd, gdu, bottom, procs, jq, curl, wget, imagemagick, etc.
- **Three parallel install mechanisms today:**
  1. `pm_install` / `_linux_pkg_install` (native package manager — already distro-aware).
  2. GitHub-release `curl` + `install_to_user_local_bin` (delta, lazygit, bat, hub, lazydocker).
  3. Language/runtime installers (nvm, `deb.nodesource.com`, `go.dev` tarball, `deno.land`,
     `bun.sh`, `astral.sh`, pipx).

**Node is installed in two places:**
- `install_editor_tools()` → `nodejs npm` (system, `pacman`/`apt`/`dnf`) as Neovim deps.
- `install_dev_tools()` → `deb.nodesource.com` (sudo) / **nvm** (no-sudo) — Debian-only branch,
  lines ~354–380 of `scripts/install/dev-tools.sh`.

**The problem:** `install_dev_tools()` is ~500 lines of near-duplicate per-distro code that
mise collapses to a handful of lines, and it's inconsistent with the rest of the installer
(the installer is Arch-aware everywhere *except* this node block, which hardcodes Debian).

---

## 4. Target Architecture

```text
install.sh (main)
  ├─ setup_stow()                     # system: GNU Stow (unchanged)
  ├─ ensure_mise()                    # NEW: bootstrap mise (stow-tier, like stow)
  ├─ run_install_programs()
  │    ├─ install_cli_tools()         # unchanged (system + GitHub-release fallbacks)
  │    ├─ install_editor_tools()      # (Phase 2) node/yarn/tree-sitter → mise
  │    └─ install_dev_tools()         # (Phase 3) → `mise install` from committed config
  ├─ run_stow_and_post_steps()
  │    ├─ install_group "core"        # stows mise package (committed config)
  │    └─ ...                          # then `mise trust` + `mise install`
  └─ ...
```

One committed config drives everything:

```toml
# mise/.config/mise/config.toml  (declared via `mise use -g`, merged into existing config)
[tools]
node = "latest"
go = "latest"
deno = "latest"
bun = "latest"
uv = "latest"
gh = "latest"
delta = "latest"
lazygit = "latest"
lazydocker = "latest"
hub = "latest"
```

---

## 5. Tool Categorization

| Tool(s) | → mise | → system `pm_install` | Notes |
|---|---|---|---|
| node, go, deno, bun, uv | ✅ | | runtimes |
| gh, git-delta, lazygit, lazydocker, hub | ✅ | | CLI tools |
| llm | ✅ (via `uv`/`pipx` backend) | | |
| yarn, tree-sitter-cli | ✅ (mise node's npm) | | editor deps |
| fzf, ripgrep, bat, fd, lsd, procs, gdu, bottom, yazi, jq | | ✅ | CLI tools — stay in `pm_install` (Phase 4 cancelled; revisit only if a problem appears) |
| GNU Stow | | ✅ | chicken-egg: stow needed to stow mise config |
| Neovim, make/gcc/cmake, luarocks, python-pynvim | | ✅ | system deps for Neovim/Mason |
| git, curl, wget, ffmpeg, imagemagick, unzip, p7zip, poppler | | ✅ | OS-level essentials |
| zsh, tmux, kitty, starship, zoxide | | ✅ (initially) | shell/terminal integration; revisit later |
| python venv, build-essential/base-devel | | ✅ | system toolchains |

> **Verify each tool's mise backend before implementing Phase 3** (mise backends:
> `core`, `cargo`, `ubi`, `github`, `aqua`, `npm`, `pipx`, `go`, …). The dev tools
> (gh, git-delta, lazygit, lazydocker, hub, go, deno, bun, uv) are all known-installable,
> but exact backend/ID mapping is a checklist item in Phase 3.

---

## 6. Phased Implementation Plan

### Phase 0 — Bootstrap mise (foundation) ✅ DONE

- [ ] **Add `scripts/install/mise.sh`** with `ensure_mise()`:

  ```bash
  ensure_mise() {
      if command_exists mise; then return 0; fi
      if can_sys_install; then
          if is_arch; then
              # Omarchy repo ships mise-bin (tracks upstream); fall back to Arch's mise
              $sudo_prefix pacman -S --noconfirm mise-bin 2>/dev/null \
                  || $sudo_prefix pacman -S --noconfirm mise
              return 0
          fi
          if is_macos && command_exists brew; then brew install mise; return 0; fi
          if is_debian || is_fedora; then pm_install mise && return 0; fi
      fi
      log_info "Installing mise user-locally (curl https://mise.run | sh)..."
      curl https://mise.run | sh || log_warn "mise install failed"
      # ensure ~/.local/bin + ~/.local/share/mise/shims are on PATH for this session
  }
  ```

- [ ] **Call it in `install.sh` `main()`**, immediately after `setup_stow` (same tier as stow,
      before `run_install_programs`).
- [ ] **Ensure PATH** for mise shims in `zsh/.zshrc` + `bash/.bashrc`
      (`~/.local/bin` and `~/.local/share/mise/shims`). Verify Omarchy's shell integration
      doesn't already do this (it does, but the dotfiles must also work on non-Omarchy hosts).
- [ ] Validate: `./install.sh --dry-run` on Arch + Debian shows the mise bootstrap.

### Phase 1 — Declare tools in mise (via `mise use -g`) ✅ DONE (revised — no stow package)

- [ ] Create stow package **`mise/`** → `mise/.config/mise/config.toml`
      (contents per §4).
- [ ] Add `mise` to a group in `scripts/install/manifest.sh` — fold into **`core`** (always
      stowed) or a new `mise` group selected by default. Prefer `core` (foundational, platform `all`).
- [ ] In `run_stow_and_post_steps()` (or a post-stow hook): `mise trust ~/.config/mise/config.toml`
      then `mise install` (idempotent; skips already-installed tools).
- [ ] Add to `scripts/install/manifest.sh` `COMMAND_CHECK_OVERRIDES` any mise-tool→command mappings.
- [ ] Update `README.md` group table + `INSTALLER_ARCHITECTURE.md`.

### Phase 2 — Unify Node.js (the immediate fix) ✅ DONE

- [ ] In `scripts/install/dev-tools.sh`, **delete** the node block (lines ~354–380:
      nodesource + nvm) — node now comes from the committed mise config.
- [ ] In `scripts/install/packages.sh` `install_editor_tools()`, **remove** `nodejs npm yarn`
      from the system package list; replace with a note that node/yarn come from mise
      (or call `mise install node yarn` if the editor group is selected).
- [ ] Keep `luarocks`, `python-pynvim`, build tools as system packages.
- [ ] Verify `nvim-malo`'s `mise which node` now resolves (Copilot uses mise node).
- [ ] Verify Mason LSP servers (need node on PATH) — confirm mise shims are on PATH in
      interactive shells and Neovim's environment.

### Phase 3 — Migrate dev tools to mise ✅ DONE

- [ ] Rewrite `install_dev_tools()` to a thin wrapper:
  ```bash
  install_dev_tools() {
      if [[ "$(get_group_selection "dev")" != "1" ]]; then return; fi
      show_banner "Installing Developer Tools"
      if [[ "$OS" == "Darwin" || "${WITH_BREW:-0}" == "1" ]]; then
          log_info "Developer tools installed via Brewfile"; return 0
      fi
      ensure_mise
      mise install            # installs node/go/deno/bun/uv/gh/delta/lazygit/lazydocker/hub
      # llm: uv tool install llm  (keep as a post-step, or mise pipx backend)
  }
  ```
- [ ] **Delete** now-dead helpers: `install_uv_tool`, `install_bun_tool`,
      `install_lazydocker_tool`, the `go.dev` tarball block, the deno installer, and the
      per-distro GitHub-release blocks for delta/lazygit/hub/bat.
- [ ] Keep `git` in `pm_install` (system tool).
- [ ] Keep `python3-venv` in `pm_install` (system).
- [ ] Decide `llm` backend: `uv tool install llm` (current) vs mise `pipx` backend. Prefer
      `uv` since `uv` is already mise-managed.

### Phase 4 — Migrate CLI tools to mise — **CANCELLED**

> Cancelled by decision (2026-08-19): the CLI tools (fzf, ripgrep, bat, fd, lsd, procs,
> gdu, bottom, yazi, jq) **stay installed via `pm_install`** (plus the existing GitHub-release
> fallbacks on Debian/Fedora). Revisit **only if** a concrete problem emerges with not using
> mise for them (e.g. distro lag, no-sudo install pain).
>
> If reopened, remember the original concerns: prefer prebuilt backends (`ubi`/`github`/`core`,
> avoid slow `cargo` compiles); verify shim PATH visibility for Neovim/cron/systemd;
> keep `jq` in `pm_install` (system packages may depend on `/usr/bin/jq`).

### Phase 5 — Prune, document, clean up ✅ DONE

- [ ] Remove all nvm/nodesource references from `scripts/`, `README.md`, `flow.sh`.
- [ ] Fix the README `--standard` preset discrepancy (code includes `dev`; README omits it).
- [ ] Update `README.md` "Binary Installation Reference" tables to reflect mise.
- [ ] Update `INSTALLER_ARCHITECTURE.md` (new module `mise.sh`, new stow package `mise/`).
- [ ] Update `scripts/pi-inference-client-setup` `locate_pi()` — drop the `~/.nvm` fallback
      (point at `~/.local/share/mise/shims/pi` or rely on PATH).

### Phase 6 — Validate ✅ DONE

- [ ] Run `./scripts/validate-install.sh` and `./scripts/validate-manifest.sh`.
- [ ] Manual test matrix:
  - [ ] `./install.sh --dry-run` (all presets)
  - [ ] `./install.sh --minimal` on a clean Linux user
  - [ ] `./install.sh --user-local --minimal` (the no-sudo case)
  - [ ] `./install.sh --standard` and `--full`
  - [ ] `./install.sh dev` (dev-only)
  - [ ] `./install.sh editor` (verify node via mise, not pacman)
  - [ ] macOS `--with-brew` (Brewfile unchanged; ensure_mise no-op if Brewfile has mise)
- [ ] Confirm `mise install` from a fresh machine installs everything declared.

---

## 7. File-by-file change summary

| File | Change |
|---|---|
| `install.sh` | add `ensure_mise` call in `main()` after `setup_stow` |
| `scripts/install/mise.sh` | **NEW** — `ensure_mise()` |
| `scripts/install/dev-tools.sh` | rewrite `install_dev_tools()`; delete nvm/nodesource/go.dev/deno/uv/bun/GitHub-release code |
| `scripts/install/packages.sh` | remove node/yarn from `install_editor_tools()` |
| `scripts/install/manifest.sh` | add `mise` package to `core` group; command overrides |
| `scripts/install/flow.sh` | add `mise trust` + `mise install` post-stow step |
| `mise/.config/mise/config.toml` | **NEW** — committed tool manifest |
| `zsh/.zshrc`, `bash/.bashrc` | ensure `~/.local/bin` + mise shims on PATH |
| `scripts/pi-inference-client-setup` + test | drop `~/.nvm` fallback |
| `README.md`, `INSTALLER_ARCHITECTURE.md` | document the new model |

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Breaking other machines (macOS/Debian/Fedora) | keep `pm_install` for system packages; mise config is portable; test per-platform |
| Mason/Neovim can't find node | ensure mise shims on PATH in shells + Neovim env; `mise which node` already used by nvim config |
| Chicken-egg (stow ← mise) | bootstrap mise via `curl mise.run | sh` (no stow needed); stow only for the *config file* |
| mise backend flakiness / GitHub rate limits | pin versions; use `core`/`ubi`/`cargo` backends over raw GitHub where possible |
| `latest` vs pinned reproducibility | pin major versions (`node = "latest"`, others `= "X"`) in the committed config |
| `mise trust` rejected on stowed config | run `mise trust ~/.config/mise/config.toml` after stow; document |
| No-sudo Debian/Fedora system tools (stow, neovim) still need source-build/curl | unchanged from today; out of scope — mise only covers user tools |

---

## 9. Acceptance Criteria

1. `grep -rni nvm scripts/ README.md` → no results.
2. `./install.sh --user-local --minimal` installs node + dev tools **without sudo** via mise.
3. `mise install` on a fresh host installs the full committed tool set.
4. `./scripts/validate-install.sh` passes (dry-run + manifest + shellcheck).
5. On Arch: `install_dev_tools` no longer touches `deb.nodesource.com` or nvm.
6. `nvim-malo`'s `find_copilot_node()` resolves `mise which node` to a real path.
7. The installer's `--standard` preset matches its README description.

---

## 10. Decisions (resolved)

1. **mise config home:** stow package `mise/` → `~/.config/mise/config.toml` (XDG).
2. **Phase 4 (CLI tools):** **cancelled.** CLI tools stay in `pm_install` until a concrete
   problem justifies moving them to mise.
3. **macOS:** Brewfile-first; `ensure_mise()` is a no-op on macOS (mise only for Linux user tools).
4. **Version pinning:** `node = "latest"` (aligned with Omarchy's `mise-work.sh` → `mise use -g node@latest`); everything else `latest` for now — pin exact versions
   only if a tool breaks.
5. **Group:** mise config stow lives in **`core`** (always stowed).
