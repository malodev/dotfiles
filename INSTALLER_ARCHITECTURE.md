# Installer Architecture

This repository's installer is intentionally split into a thin entrypoint plus focused modules.

## Entrypoint

```text
install.sh
```

Responsibilities:

- check Bash version
- initialize globals like `SCRIPT_DIR`, `LOG_FILE`, `DRY_RUN`
- source common helpers and installer modules
- run `main()`

`install.sh` should stay small. New installer behavior should usually go into a module under `scripts/install/`.

## Modules

```text
scripts/install/manifest.sh
```

Bash-native declarative metadata:

- install groups and stow packages
- group descriptions
- install order
- platform constraints
- default group selections
- Neovim config order/default
- shell config package classification
- package-name to command-name overrides
- menu/detail display lines

```text
scripts/install/groups.sh
```

Initializes group-related runtime state from the manifest:

- `DEFAULT_GROUPS`
- `SELECTED_GROUPS`
- `SELECTED_PACKAGES`
- `PACKAGE_ONLY_MODE`

```text
scripts/install/helpers.sh
```

Shared helpers for:

- group/package lookup
- platform support checks
- package command lookup
- Neovim selection helpers
- stow preflight/stow execution
- user-local binary installation helpers

```text
scripts/install/ui.sh
```

Terminal UI and status display:

- interactive checkbox-style menu
- selected group details
- status display
- `--list-groups`

```text
scripts/install/cli.sh
```

CLI argument parsing and help output.

Sets:

- `CLI_MANUAL_ARGS`
- `CLI_USE_PRESET`
- `DRY_RUN`
- `WITH_BREW`

```text
scripts/install/selection.sh
```

Resolves requested groups/packages into selected installer state.

Handles:

- package-only mode
- explicit `--group`
- explicit `--package`
- shell package selection
- default selection mode

```text
scripts/install/presets.sh
```

Applies presets:

- `minimal`
- `standard`
- `full`

Also applies manifest-driven platform constraints.

```text
scripts/install/core.sh
```

Core runtime functions:

- OS/distro detection
- stowing packages for selected groups

```text
scripts/install/nvim.sh
```

Neovim-specific behavior:

- stow selected Neovim configs
- set `~/.config/nvim` default symlink
- user-local fallback Neovim binary install on Linux

```text
scripts/install/packages.sh
```

Package-manager and non-dev tool installers:

- Homebrew setup / Brewfile install
- GNU Stow setup
- Linux CLI tools
- shell/terminal/editor dependencies
- extras like `fastfetch`, `zoxide`, `starship`, shell color scripts

```text
scripts/install/dev-tools.sh
```

Developer tools and language/tooling dependencies.

## Flow

High-level flow is implemented in:

```text
scripts/install/flow.sh
```

The main order is:

1. parse CLI args
2. detect OS/distro
3. resolve preset/manual/default selection
4. optionally show interactive menu
5. show selected groups/status
6. setup package manager and GNU Stow
7. install selected system tools/dependencies
8. stow selected dotfile packages
9. stow Neovim configs
10. configure default Neovim symlink
11. run post-install extras
12. print summary

## Safety principles

- Linux Homebrew is opt-in only via `--with-brew`.
- Package-only mode stows selected dotfile packages and skips system installers.
- Stow commands use explicit source and target:

```bash
stow -d "$SCRIPT_DIR" -t "$HOME" ...
```

- Real stow operations are preceded by a dry-run conflict preflight.
- Manual/fallback binary installs should prefer user-local locations:

```text
~/.local/bin
~/.local/opt/<tool>
~/.local/share/<tool>
```

- `--dry-run` must never run package managers, curl installers, symlink writes, moves, or installs.

## Validation

Run:

```bash
./scripts/validate-install.sh
```

This runs:

- syntax checks
- manifest consistency validation
- dry-run regression cases
- output assertions for package-only mode, mixed mode, Neovim selection, `--with-brew`, `--list-groups`, and running from outside the repo
- `shellcheck` if installed

Manifest-only validation:

```bash
./scripts/validate-manifest.sh
```

## Adding a new stow package

1. Add the directory at repository root.
2. Add it to the appropriate group in `scripts/install/manifest.sh`.
3. Update group detail lines if needed.
4. Run:

```bash
./scripts/validate-install.sh
```

## Adding a new group

1. Add the group to `INSTALL_GROUPS` in `scripts/install/manifest.sh`.
2. Add its description to `GROUP_DESC`.
3. Add platform support to `GROUP_PLATFORM`.
4. Add defaults to both `DEFAULT_GROUPS_DARWIN` and `DEFAULT_GROUPS_LINUX`.
5. Add it to `INSTALL_ORDER`.
6. Add group detail lines if needed.
7. Add package-manager behavior in `packages.sh` or `dev-tools.sh` if needed.
8. Run validation.
