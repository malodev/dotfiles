# Deployment Scenarios

How this repository reaches a machine, who drives it, and what to verify afterwards.

Every deployment is a combination of three choices:

| Axis | Options |
|---|---|
| **Who drives** | an agent on a *driver* machine (SSH to the target) · an agent or a human *on the target* · nobody (CI, cloud-init) |
| **Transport** | `git clone` on the target · push from the driver (`tar \| ssh`, `git bundle`) · mounted share · `curl` the bootstrap |
| **Privilege + scope** | userspace (zero `sudo`/Admin) or system (sudo, brew, Admin) × minimal · selected groups · full |

Stage 0 (`bootstrap.sh` / `bootstrap.ps1`) is always userspace: it installs `mise`, the
portable CLI, `pi`, and links the core configs. The modular installer (`install.sh`) is the
system layer and needs the package manager.

---

## 1. Entry points

Pick the entry point from the OS and what the account is allowed to do.

| Target | Privilege | Entry point | Notes |
|---|---|---|---|
| macOS / Linux / WSL | userspace or system | `./bootstrap.sh [--full] [--dry-run]` | never needs `sudo` |
| macOS / Linux / WSL | system (groups) | `./install.sh --minimal\|--ssh\|--standard\|--full`, `-g <group>`, `-p <package>` | presets: `minimal`/`ssh` = core+shell+terminal+dev, `standard` adds editor+system-info, `full` = everything supported |
| Native Windows | Administrator available | `.\bootstrap.ps1 [-Full] [-EnableSsh] [-SshPublicKeyPath <file>]` | asks for UAC only when needed |
| Native Windows | no Admin, or Group Policy blocks scripts | `windows\bootstrap-dotfiles.cmd` | policy-proof: evaluates the bootstrap instead of executing it |
| Native Windows | shell only, config must load | `windows\dotfiles-shell.cmd` | loads the profile with an inline command, so a Group Policy cannot stop it |
| any | repair an existing machine | `dot doctor` → `dot link` → `dot overrides --apply` → `dot validate` | see S8 |

`dot` wraps the common ones: `dot bootstrap [--full]`, `dot link`, `dot install [args]`,
`dot doctor [--json]`, `dot validate`, `dot agent "<request>"`.

---

## 2. Scenarios

### S1 — Agent on the driver, target over SSH (default)

The driver holds the repository (or can reach GitHub); the agent works on the target through
SSH and needs no terminal session there.

```bash
# 1. get the repository onto the target, pick one:
ssh target 'git clone https://github.com/malodev/dotfiles.git ~/dotfiles'          # needs GitHub
COPYFILE_DISABLE=1 tar -czf - --exclude=.git --exclude=pi/mattpocock-skills . \
  | ssh target 'mkdir -p ~/dotfiles && tar -xzf - -C ~/dotfiles'                    # no internet needed
git bundle create /tmp/dotfiles.bundle --all && scp /tmp/dotfiles.bundle target:/tmp/ \
  && ssh target 'git clone /tmp/dotfiles.bundle ~/dotfiles'                         # offline, keeps history

# 2. seed and inspect
ssh target '~/dotfiles/bootstrap.sh --dry-run'
ssh target '~/dotfiles/bootstrap.sh'
ssh target '~/dotfiles/local-bin/.local/bin/dot doctor --json'

# 3. only the groups the prompt asked for
ssh target '~/dotfiles/install.sh --minimal'        # or -g editor, --standard, --full
```

A Windows target goes through the same `dot deploy`: the archive is uploaded (PowerShell mangles
a binary stream on stdin, so nothing is piped into it) and extracted on the target with
`tar.exe`, which Windows 10 1803 and later ship, or with `7z.exe` when tar is missing. Symlinks
tracked in the repository are left out of that archive: they cannot be materialised on Windows
and the ones the linker already replaced with a junction make bsdtar stop on a non-empty
directory. Stage 0 then runs the policy-proof way — the bootstrap is evaluated, not executed —
so a Group Policy that blocks script files cannot stop it.

```bash
dot deploy --to mauro@192.168.6.33 --ssh-port 2222      # tar transport, verified end to end
```

Cosmetic wart: a nested PowerShell serialises its streams as CLIXML when it has no console, so
the bootstrap's chatter arrives wrapped in it. The deploy's own summary and the exit code are
unaffected.

**Needs:** SSH access (Tailscale makes this trivial and survives NAT), and a non-interactive
shell that is not blocked by policy. **Missing today:** one command that does transport +
bootstrap + verify and returns the target's `doctor` JSON — see the roadmap.

### S2 — Terminal on the target, bootstrap from the repository

No driver machine involved; the target pulls everything itself.

```bash
git clone https://github.com/malodev/dotfiles.git ~/dotfiles && ~/dotfiles/bootstrap.sh
```

Or with nothing but `curl` and `git`:

```bash
curl -fsSL https://raw.githubusercontent.com/malodev/dotfiles/main/bootstrap.sh | bash
```

`bootstrap.sh` locates the repository and **clones it itself** when it is not already at
`$HOME/dotfiles` or `$HOME/.dotfiles` (verified with a throwaway `$HOME`). Useful environment
overrides: `DOTFILES_REPO_URL`, `DOTFILES_DIR`.

On Windows the same scenario is `git clone` plus `windows\bootstrap-dotfiles.cmd` (the `.cmd`
exists for exactly this: the default execution policy refuses `.\bootstrap.ps1`).

**Limits:** needs `git` (and `curl` for the piped form); on a machine without either, ship a
tarball instead — the repository is a plain tree, nothing in Stage 0 requires history.

### S3 — Repository from a share or mount, target without internet

The repository arrives over a filesystem, not the network.

```bash
# Linux: 9p / virtiofs / NFS / bind mount, then
cd /mnt/dotfiles && ./bootstrap.sh

# Windows VM with the repository on a host share (the Proxmox test VM does this):
robocopy "\\host.lan\Data\dotfiles" "$HOME\dotfiles" /MIR /XD conversations /R:0 /W:0 /NFL /NDL /NJH /NJS /NP
cd "$HOME\dotfiles"; .\windows\bootstrap-dotfiles.cmd
```

**Limits:** `mise` still downloads its tools from the internet, and `pi` installs its packages
from npm. A machine with no internet at all needs the bundle from S10.

### S4 — Locked-down target (no Admin, Group Policy, no winget)

Verified end to end on a Windows 11 VM with a standard (non-Admin) account and a Group
Policy that enforced `Restricted`.

What still works, and how:

| Step | Mechanism |
|---|---|
| own SSH key | `scripts/windows/enable-ssh-server.ps1 -NoElevate -PublicKey "..."` writes `~\.ssh\authorized_keys` — no Admin needed. The file needs `SYSTEM` read access, or sshd (which runs as SYSTEM) cannot read it and every key login fails silently |
| the server itself | needs Administrator once. Where the account cannot elevate: ask IT for the *OpenSSH Server* feature, or use **Tailscale SSH** (`tailscale up --ssh`), which needs no feature and no firewall rule |
| `mise` without winget | the bootstrap falls back to the GitHub release zip (`mise-<arch>.zip` → `%LOCALAPPDATA%\mise\bin`), all userspace |
| the profile, when a Group Policy blocks scripts | `scripts/windows/ensure-execution-policy.ps1` installs the launchers and repoints the PowerShell profiles in Windows Terminal at `windows\dotfiles-shell.cmd`, which loads the profile with an inline command (the execution policy governs script *files*, not inline commands) |
| the bootstrap itself | `windows\bootstrap-dotfiles.cmd`, or the inline `iex ((Get-Content -Raw ...))` form |

On Linux the equivalent is: no `sudo`, so Stage 0 only; if `sshd` is missing and cannot be
installed, Tailscale SSH again.

### S5 — Ephemeral machine, CI or cloud-init (no agent)

```bash
# cloud-init user-data / CI step
curl -fsSL https://raw.githubusercontent.com/malodev/dotfiles/main/bootstrap.sh | bash
~/dotfiles/local-bin/.local/bin/dot doctor --json

# the system layer, unattended
~/dotfiles/install.sh --yes --minimal
```

`--yes` (or `DOTFILES_ASSUME_YES=1`, which is what cloud-init wants) makes the installer never
ask: it takes the documented default selection when none is given, and every prompt goes
through one helper that returns the default when stdin is not a terminal, so nothing can block
on a `read` that would only ever see EOF. Without a terminal and without `--yes`, the group
menu is replaced by the default selection and a warning saying so, instead of hanging.

Exit codes are the contract an agent or a CI job branches on:

| Code | Meaning |
|---|---|
| `0` | everything asked for is in place |
| `1` | something failed; the summary lists it (failures are collected, not fatal, so one broken package does not stop the rest) |
| `2` | the installer could not start (bad arguments, unsupported platform) |

The repository's own suites run in CI on every push and pull request
(`.github/workflows/validate.yml`): `validate-install.sh`, `validate-manifest.sh`,
`test-environments.sh --no-docker`, plus a check that the installer stays silent with `--yes`.

### S6 — WSL hybrid

`bootstrap.sh` runs on WSL like any Linux, while the Windows side keeps its own entry point.
The two sides do not share `$HOME`: WSL owns `/home/<user>/.config`, Windows owns
`C:\Users\<user>\.config` through `XDG_CONFIG_HOME`. Run both if the machine is used from both
sides, and keep the agent assets (`~/.agents/skills`, `~/.claude/skills`) linked on each.

### S7 — Fleet: many targets from one driver

```bash
dot deploy --hosts hosts/lab.fleet [--dry-run] [--verify-only] [--json]
```

One target per line: a profile name (`hosts/<name>.env`) or an ssh destination, with optional
per-host overrides (`transport=`, `port=`, `dir=`, `full=`, `groups=`, `verify_only=`). See
`hosts/example.fleet`. Every host gets the full S1 treatment in turn, and the run ends with a
table — host, platform, result, `providers.ready`, drift — plus a non-zero exit code if any
host failed. `--json` prints each host's raw doctor output instead of the table.

Group targets by *profile* rather than per host: "school laptop" and "workstation" are two
profiles, not twenty command lines. Verified on the lab VMs in one run: two Linux hosts
deployed with the tar transport and a Windows host inspected through its forwarded port.

### S8 — Repair or re-deploy on an existing machine

```bash
dot doctor            # platform, tools, links, providers, drift
dot link              # stow packages + agent skills + per-machine templates
dot overrides --apply # move inline edits into untracked *_local files
dot validate          # installer + manifest + environment suites
```

This is the scenario that runs most often in practice: the machine already has the
configuration and something drifted (a tool wrote into a live file, a package was removed,
a template changed upstream).

### S9 — New machine handover

The shared defaults live in tracked templates (`*.json.template`, `*.toml.template`), the
per-machine files are untracked and seeded by `scripts/init-pi-settings.sh` and
`scripts/init-herdr-config.sh`, and host-specific edits belong in `*_local` files. A new
machine is therefore: deploy (S1–S3) → the agent asks for the two or three values that are
genuinely local (model endpoints, keys, theme) → done.

**Missing:** a machine-readable *host profile* that says what a given machine should end up
with (`os`, `privilege`, `groups`, `features`, `ssh`). Without it, "the minimum necessary" is
whatever the agent happens to decide, and no deployment can be verified against a target
state.

### S10 — Fully offline

```bash
# on a machine that already has everything (the source):
scripts/make-offline-bundle.sh [--tools "node jq"] [--with-git] [--out DIR]

# on the machine with no internet at all:
scripts/install-offline-bundle.sh dotfiles-offline-<os>-<arch>-<date>.tar.gz [target-dir]
```

The bundle carries the repository, the `mise` binary, the tool installs, a **pinned** mise
config (`node = "24.22.0"`, not `lts`, which needs the network to resolve) and pi's npm
packages. The installer restores them into `$HOME`, rebuilds the shims, and runs
`bootstrap.sh --offline`, which skips every step that would reach out: `mise install` from the
pinned config instead of `mise use -g …@latest`, no npm install for pi, no skill submodule
fetch.

Verified on a Linux VM inside `unshare -n` — no network at all, confirmed by a `curl` control
in the same namespace: restore, Stage 0 and `dot doctor` all complete, and the bundled `jq`
resolves from the restored installs.

Not covered, on purpose: the system layer (it needs a package manager), `nvim-malo`'s plugins
(`nvim-lite`, the bootstrap default, needs none), and Windows.

---

## 3. Verification after any deployment

The target's own sensor, over SSH, needs nothing installed there beyond the repository:

```bash
dot doctor --host <host>              # summarised: platform, tools, agents, providers, drift
dot doctor --host <host> --json       # raw JSON, for an agent to parse
dot doctor --host <host> --ssh-port 2222
dot deploy --verify-only --to <host>  # the same probe, inside a deploy
```

Per target (`dot doctor --json`):

- `platform.os`, `platform.distro`, `platform.is_ssh`, `platform.has_gui`, `platform.sudo`,
  `platform.recommended_profile`
- `tools{}` — the portable baseline actually on `PATH`
- `agents.pi` / `agents.claude` — the CLI, plus `*_skills_count`
- `links{}` — `nvim_default`, `nvim_active_profile`, `starship`, `zshrc`, `dot_cli`
- `providers.ready` — at least one `pi` provider key resolves (a fresh host has none, and the
  first prompt fails auth until one is added)
- `execution_policy.profile_can_load` — whether a *new* shell can load the profile (Group
  Policy wins over the local scopes)
- `drift{}` — `git_branch`, `git_dirty_files`, `sentinel_missing`

Functional probes worth one line each:

```bash
NVIM_APPNAME=nvim-lite nvim --headless +qa          # the config loads
NVIM_APPNAME=nvim-malo nvim --headless +qa          # the daily driver loads
pi -p "say OK"                                      # extensions load, no "Failed to load extension"
bash -n ~/.bashrc                                   # shell configs parse
ssh -p 2222 user@host whoami                        # Windows: the key and the shell work
```

Repository-side suites (run on the driver, they cover every platform they can reach):

```bash
./scripts/validate-install.sh      # installer dry-runs, group/package selection
./scripts/validate-manifest.sh     # manifest and group metadata
./scripts/test-environments.sh     # sandbox, containers, remote hosts, PowerShell AST
```

---

## 4. Roadmap

Done and verified:

- **`dot deploy --to <host> | --profile <name>`** — transport (tar or clone), the right entry
  point for the target OS and privilege, then the target's doctor back. `--dry-run`,
  `--verify-only`, `--groups`, `--full`, `--json`. The tar transport ships the working tree,
  uncommitted changes included; `--transport clone` ships what is on GitHub. Verified on the lab
  VMs: tar, clone (git pull on an existing checkout), `--groups` through the system installer,
  and `--verify-only` against a Windows host over its forwarded port.
- **Host profiles** — `hosts/<name>.env` (tracked) or `hosts/<name>.local.env` (untracked) with
  `HOST`, `USER`, `SSH_PORT`, `TRANSPORT`, `FULL`, `INSTALL_GROUPS`, `DIR`. See
  `hosts/example.env`.
- **`dot doctor --host <h>`** — the remote variant of the sensor.
- **`dot deploy --hosts <file>`** — the fleet case (S7): many targets, one report, grouped by
  profile, per-host overrides, non-zero exit code when any host fails.
- **Unattended installer and exit codes** (S5) — `install.sh --yes` /
  `DOTFILES_ASSUME_YES=1`, failures collected and a non-zero exit when any happened, and
  `.github/workflows/validate.yml` running the suites on every push and pull request.
- **Offline bundles** (S10) — `make-offline-bundle.sh` / `install-offline-bundle.sh` plus
  `bootstrap.sh --offline`, verified inside `unshare -n` with no network at all.

Still missing, deliberately:

1. **A tarball entry for machines without `git`** — `curl | bash` clones the repository itself,
   so it needs `git`. A machine with only `curl` (or a USB stick) needs the tree as a tarball:
   `curl -fsSL …/dotfiles.tar.gz | tar -xz -C ~/dotfiles && ~/dotfiles/bootstrap.sh`, and
   `bootstrap.sh` has to accept a repository that is already there without a `.git`. The offline
   bundle covers the *no-network* case; this covers the *no-git* one.
2. **An offline bundle for Windows** — port `make-offline-bundle.sh` /
   `install-offline-bundle.sh` to PowerShell: the `mise` release zip (the same source the
   bootstrap already falls back to), the tool installs, the `.cmd` launchers and the
   execution-policy handling. The Unix bundle does not apply as it stands.
