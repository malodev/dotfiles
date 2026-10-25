# Adoption: what belongs in the repository, and what stays on the machine

## 1. The problem

A machine that has been used has configuration everywhere. Part of it is the same on every
machine and belongs in this repository; part of it is that machine's and must never enter it.
The repository already has the *mechanisms* to keep the two apart — templates, `*_local` files,
`LOCAL_ONLY_ENTRIES`, `.gitignore` rules — but no *process* for deciding, file by file, what to
promote and what to quarantine. That is what this document defines.

## 2. The criterion

> **If the value would be wrong on another machine, it does not belong in the repository.**

"Wrong" is concrete: a path that exists only here (`/Users/mauro/…`, `C:\Users\mauro\…`), a
hostname or LAN address, a key or token, an endpoint only this host can reach, a model or theme
this machine happens to use, a device or display name.

The test that follows from the criterion, and the reason this phase exists:

> After adopting on machine A, deploying to a **clean machine** must produce a configuration with
> **no trace of A**, and `dot doctor` must report no drift on both.

## 3. Three categories

| Category | Where it goes | Precedent in this repository |
|---|---|---|
| **Common** | a tracked file, or a tracked `*.template` | `pi/.pi/agent/settings.json.template`, `models.json.template`, `mcp.json.template`, `keybindings.json.template`, `herdr/config.toml.template` |
| **This machine's** | untracked: `*_local` (sourced through a sentinel), a real live file seeded from a template, or a `hosts/<name>.env` profile | `~/.zshrc_local`, `~/.pi/agent/models.json`, `hosts/*.local.env` |
| **Someone else's** | ignored, never adopted | `~/.pi/agent/{usage-tracker-history,trust,mcp-auth}.json`, `cache/`, `bin/`, `install/`, `~/.config/omarchy/shell.json`, `~/.config/pi/web-search-cache/`, OS-installed skills |

## 4. Signals: how to tell, without guessing

| Signal | Example in this repository | Where it goes |
|---|---|---|
| absolute home path | `/Users/mauro/.config/tokenator/litellm-api-key`, `C:\Users\mauro\bin\gam7\gam` | template + live file |
| hostname, LAN URL, IP | `api.tokenator.marconi.loc`, `http://127.0.0.1:8000/v1` | template + live file |
| key, token, credential command | `!cat ~/.config/…-api-key`, `!~/.local/bin/pi-inference credential …` | template + live file, never a tracked value |
| written by the tool itself | pi rewrites `settings.json`, `keybindings.json`, `models.json` | tracked template + untracked live file |
| a path that exists on one host | `~/.local/src/mcp-gam/dist/index.js`, `~/.config/vllm-mlx/…` | `LOCAL_ONLY_ENTRIES`, or `_local` |
| installed by the OS | Omarchy's `/usr/share/omarchy/…` skills | `LOCAL_ONLY_ENTRIES` |
| machine preference | the herdr theme, the kitty theme, the default model | template default + live override |
| cache, history, lock, backup | `web-search-cache/`, `*.bak-*`, `usage-tracker-*.json` | `.gitignore` |
| owned by another tool | `~/.config/omarchy/shell.json` | `.gitignore`, with a comment saying who owns it |

## 5. What adoption is not

- **Not "commit whatever is dirty".** An untracked file may be this machine's or someone else's;
  `implementation_plan.md` and `pi/scripts/raycast/` are examples that need a decision, not a
  `git add`.
- **Not a merge of two machines.** A value that differs between two machines is the *signal* that
  it is machine-specific, not something to reconcile into one file.
- **Not a one-off cleanup.** The three categories apply to every future difference; the clean-room
  check is what keeps the split honest over time.

## 6. The process

1. **`dot adopt --diff`** — every managed file that differs from the repository, hunk by hunk,
   with the signals above highlighted and a *suggested* category. Read-only: the agent proposes,
   the human confirms.
2. **`dot adopt --apply <file>`** — promote the common hunks into the tracked file (or its
   template) and re-link, so the live file becomes a symlink again; quarantine the rest into
   `*_local`, or into the live file when the tracked part is a template.
3. **`dot adopt --verify`** — `dot doctor` with no drift, plus the suites.
4. **Clean-room check** — deploy to a throwaway machine (`dot deploy`, or a whole fleet) and
   assert that nothing specific to this host appears there. This is what turns "we separated it"
   into "we verified it".

## 7. Worked examples, from this repository

1. **`~/.zshrc` grew inline edits** — an IDE appended an absolute home path past the sentinel.
   `scripts/extract-local-overrides.sh --apply` moved them to `~/.zshrc_local` and restored the
   file from its committed version. Finding that it *could not* is how a real bug surfaced: the
   live path is a symlink to the repository file, so it was diffing a file with itself, and
   "restoring" by copying a file onto itself. It now diffs against HEAD and restores with
   `git checkout`, and it refuses a file that also rewrites managed lines — that original text
   is not in the repository any more, so restoring would destroy it.
2. **`~/.pi/agent/models.json` holds LAN endpoints and `!cat` key commands.** Tracked
   `models.json.template` + live file; `init-pi-settings.sh --force` skips it unless
   `--force-host` is passed, precisely because resetting it repoints the machine.
3. **The herdr theme differs per host.** `herdr/config.toml.template` + a live file seeded by
   `init-herdr-config.sh`; the template keeps the adaptive default.
4. **Two extensions point at paths that exist only here** (`mlxmon.ts`, `vllm-mlx.ts`). They are
   in `LOCAL_ONLY_ENTRIES`: the linker never touches them, `.gitignore` keeps them out of the
   repository, and the machine keeps working.
5. **Omarchy's skills and its `shell.json` are the OS's.** `LOCAL_ONLY_ENTRIES` plus a
   `.gitignore` rule with a comment that says who owns the file and why it only goes stale here.
6. **`~/.ssh/config` is owned by Coder, OrbStack and Gitpod** — three `Include` blocks and a
   `Host` per machine, all rewritten by those tools. It is *not* a dotfile: adopting it would
   mean fighting three generators. It still carries one deliberate block from this repository
   (prefer `~/.ssh/id_ed25519` over `id_rsa`), short, commented, additive and outside every
   managed section. That is the exception worth writing down rather than a rule to generalise:
   a file can be someone else's and still take a few documented lines.
7. **`hyprland.lua` grew a `require` that a third-party installer appended.** `oma-cast setup
   hyprland` writes `~/.config/hypr/oma-cast.lua` and then appends `require("hypr.oma-cast")` to
   `~/.config/hypr/hyprland.lua` — a stow symlink, so the tool edited the repository. The signal is
   section 4's "owned by another tool": the plugin is installed outside the repo (in
   `~/.config/omarchy/plugins`), so neither the launcher nor its bind is *common*. The tracked file
   was restored and the machine-local layer took the load (`hyprland_local.lua` ->
   `require_optional().module("hypr.oma-cast")`), the same mechanism as `hypr.monitors_local`. The
   tool will re-append its line on the next `setup hyprland`; the answer is to restore the file
   again, not to keep the diff.

7. **`~/.config/pi/web-search.json` carried the keys of every provider** — `!cat` commands
   naming one user's home, tracked, on every machine that cloned the repository. The routing is
   common (workflow, provider list, fallback order); the keys are not, and pi rewrites the file
   anyway. So: `web-search.json.template` plus a live file that `init-pi-settings.sh` seeds and
   `--force` leaves alone unless `--force-host` says otherwise. Third instance of the same shape
   as `models.json` and `herdr/config.toml` — which is the argument for the pattern, not an
   accident of three files.

## 8. Roadmap

1. ~~**`dot adopt --diff`**~~ — **done** (`scripts/adopt-report.sh`, `dot adopt`). Read-only, and
   it reuses what existed: `doctor`'s drift for links and sentinels for `extract-local-overrides.sh
   --dry-run` for what would move. The one rule worth keeping: signals are read from the *added
   lines* of a diff, never from the whole file — a script that contains `127.0.0.1` in its own
   code is not a machine-specific value, and a hunk that adds `/Users/mauro` is.
2. **`dot adopt --apply`** — promotion, quarantine and re-link, reusing `stow`/the linkers rather
   than inventing a second linking mechanism.
3. **The clean-room check in the suite** — deploy to a throwaway host and fail when a
   host-specific value leaked. The fleet machinery is already there.
4. **A per-machine profile for shareable preferences** (which model, which theme) — so that
   adoption has somewhere to put them that is neither a tracked file nor a `_local` file nobody
   reads. `hosts/<name>.env` is the obvious place to grow.
