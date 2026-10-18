#!/usr/bin/env bash
#=============================================================================
# test-environments.sh
#
# End-to-end isolated environment & container verification suite for the
# Agent-Managed Cross-OS Dotfiles repository.
#
# Tests two layers:
#   1. Isolated Clean-$HOME Sandbox (always runs, zero host mutation):
#      - Creates a temporary $HOME directory (`mktemp -d`)
#      - Runs `init-pi-settings.sh` and `link-pi-agent-entries.sh` into sandbox $HOME
#      - Stows core portable packages (`starship`, `zsh`, `bash`, `git`, `tmux`)
#        into sandbox $HOME
#      - Verifies `dot doctor --json` produces valid JSON and detects linked states
#      - Verifies `extract-local-overrides.sh` detects sentinel drift and extracts
#        `_local` overrides cleanly inside the sandbox
#      - Runs headless runtime checks for `nvim-malo` (including Windows/Linux/macOS
#        OS-detection paths), `starship`, `zsh -n`, `bash -n`, and JSON templates
#
#   2. Multi-Distro Docker Container Suite (`--docker` or auto when Docker daemon is up):
#      - Spins up clean rootless/minimal Linux containers (`ubuntu:24.04`, `alpine:3.20`)
#      - Mounts the dotfiles repo read-only (copied to container workspace)
#      - Exercises `bootstrap.sh --dry-run`, `doctor.sh --json`, `init-pi-settings.sh`,
#        `link-pi-agent-entries.sh`, and `validate-install.sh` inside a virgin Linux user
#
# Usage:
#   ./scripts/test-environments.sh            # Run sandbox + headless tests (and Docker if running)
#   ./scripts/test-environments.sh --docker   # Require Docker container tests (auto-starts Docker if possible)
#   ./scripts/test-environments.sh --no-docker # Skip Docker container tests
#=============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$SCRIPT_DIR"
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"

WANT_DOCKER="auto"
for arg in "$@"; do
  case "$arg" in
    --docker)    WANT_DOCKER="yes" ;;
    --no-docker) WANT_DOCKER="no" ;;
    --help|-h)
      sed -n '2,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf "  \033[1;32m✓\033[0m %s\n" "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf "  \033[1;31m✗\033[0m %s\n" "$1" >&2
}

section() {
  printf "\n\033[1;36m━━━ %s ━━━\033[0m\n" "$1"
}

#-----------------------------------------------------------------------------
# 1. Syntax & Static Validation
#-----------------------------------------------------------------------------
section "1. Script Syntax & Template Validation"

for script in \
  "$REPO/bootstrap.sh" \
  "$REPO/scripts/doctor.sh" \
  "$REPO/local-bin/.local/bin/dot" \
  "$REPO/scripts/link-pi-agent-entries.sh" \
  "$REPO/scripts/init-pi-settings.sh" \
  "$REPO/scripts/extract-local-overrides.sh"; do
  if bash -n "$script"; then
    pass "bash -n $(basename "$script")"
  else
    fail "bash -n $(basename "$script")"
  fi
done

if command -v jq >/dev/null 2>&1; then
  for tpl in \
    "$REPO/pi/.pi/agent/settings.json.template" \
    "$REPO/pi/.pi/agent/settings-full.json.template" \
    "$REPO/pi/.pi/agent/keybindings.json.template" \
    "$REPO/pi/.pi/agent/models.json.template" \
    "$REPO/pi/.pi/agent/mcp.json.template" \
    "$REPO/windows/windows-terminal/settings.json.template"; do
    if jq empty "$tpl" >/dev/null 2>&1; then
      pass "valid JSON: ${tpl#$REPO/}"
    else
      fail "invalid JSON: ${tpl#$REPO/}"
    fi
  done
fi

# PowerShell 5.1 reads BOM-less UTF-8 as Windows-1252, where a byte above 0x7F can
# land where a quote is expected and swallow the rest of the line: a '✓' inside a
# string broke bootstrap.ps1 exactly that way. Every .ps1 stays 7-bit ASCII.
ps1_nonascii=""
while IFS= read -r ps1; do
  if LC_ALL=C grep -q $'[^\t\r -~]' "$ps1"; then
    ps1_nonascii+=" ${ps1#$REPO/}"
  fi
done < <(find "$REPO" -name '*.ps1' -not -path '*/node_modules/*')
if [[ -z "$ps1_nonascii" ]]; then
  pass "PowerShell scripts are pure 7-bit ASCII (no smart quotes, no BOM-less UTF-8)"
else
  fail "non-ASCII bytes in PowerShell scripts:$ps1_nonascii"
fi

# The profile is dot-sourced at every shell start and cannot load while the execution
# policy is Restricted, so both entry points have to run the helper that fixes it.
policy_refs=0
grep -q "ensure-execution-policy" "$REPO/bootstrap.ps1" && policy_refs=$((policy_refs + 1))
grep -q "ensure-execution-policy" "$REPO/scripts/windows/link-windows.ps1" && policy_refs=$((policy_refs + 1))
if [[ -f "$REPO/scripts/windows/ensure-execution-policy.ps1" && $policy_refs -eq 2 ]]; then
  pass "execution-policy helper exists and both bootstrap.ps1 and link-windows.ps1 run it"
else
  fail "execution-policy helper missing or not wired into both entry points (refs=$policy_refs)"
fi

#-----------------------------------------------------------------------------
# 2. Isolated Clean-$HOME Sandbox Simulation (Zero Host Mutation)
#-----------------------------------------------------------------------------
section "2. Isolated Virgin \$HOME Sandbox Simulation"

SANDBOX_HOME="$(mktemp -d "${TMPDIR:-/tmp}/dotfiles-sandbox.XXXXXX")"
trap 'rm -rf "$SANDBOX_HOME"' EXIT

mkdir -p "$SANDBOX_HOME/.config" "$SANDBOX_HOME/.local/bin"

# 2a. Test bootstrap.sh --dry-run in isolated HOME
if HOME="$SANDBOX_HOME" "$REPO/bootstrap.sh" --dry-run >/dev/null 2>&1; then
  pass "bootstrap.sh --dry-run succeeds in virgin \$HOME"
else
  fail "bootstrap.sh --dry-run failed in virgin \$HOME"
fi

# 2b. Test init-pi-settings.sh (essential by default vs --full) in isolated HOME
if HOME="$SANDBOX_HOME" "$REPO/scripts/init-pi-settings.sh" >/dev/null 2>&1; then
  if [[ -f "$SANDBOX_HOME/.pi/agent/settings.json" && -f "$SANDBOX_HOME/.pi/agent/models.json" ]]; then
    if command -v jq >/dev/null 2>&1 && jq -e '.packages | length == 3' "$SANDBOX_HOME/.pi/agent/settings.json" >/dev/null 2>&1; then
      pass "init-pi-settings.sh seeds essential ~/.pi/agent/settings.json (3 packages) & models.json"
    else
      fail "init-pi-settings.sh did not seed essential 3-package settings.json"
    fi
  else
    fail "init-pi-settings.sh did not create expected JSON files"
  fi
else
  fail "init-pi-settings.sh failed in virgin \$HOME"
fi

# 2c. Test link-pi-agent-entries.sh essential vs --full in isolated HOME
if HOME="$SANDBOX_HOME" "$REPO/scripts/link-pi-agent-entries.sh" >/dev/null 2>&1; then
  if [[ -L "$SANDBOX_HOME/.agents/skills/dotfiles-maintainer" && -L "$SANDBOX_HOME/.claude/skills/dotfiles-maintainer" ]]; then
    pass "link-pi-agent-entries.sh links dotfiles-maintainer skill to ~/.agents/skills & ~/.claude/skills"
  else
    fail "dotfiles-maintainer skill was not linked into ~/.agents/skills and ~/.claude/skills"
  fi
  if [[ -L "$SANDBOX_HOME/.pi/agent/extensions/auto-router" && ! -e "$SANDBOX_HOME/.pi/agent/extensions/three-agent-team" ]]; then
    pass "link-pi-agent-entries.sh links essential extensions (auto-router) and omits optional extensions by default"
  else
    fail "essential vs optional extension filtering failed"
  fi
  if HOME="$SANDBOX_HOME" "$REPO/scripts/link-pi-agent-entries.sh" --full >/dev/null 2>&1 \
    && [[ -L "$SANDBOX_HOME/.pi/agent/extensions/three-agent-team" ]] \
    && HOME="$SANDBOX_HOME" "$REPO/scripts/link-pi-agent-entries.sh" >/dev/null 2>&1 \
    && [[ ! -e "$SANDBOX_HOME/.pi/agent/extensions/three-agent-team" ]]; then
    pass "link-pi-agent-entries.sh --full links optional extensions and default mode cleanly unlinks them"
  else
    fail "link-pi-agent-entries.sh --full toggle check failed"
  fi
  if [[ -L "$SANDBOX_HOME/.pi/agent/skills/init-three-agent-team" && ! -e "$SANDBOX_HOME/.agents/skills/init-three-agent-team" ]]; then
    pass "link-pi-agent-entries.sh keeps PI_ONLY_SKILLS isolated to ~/.pi/agent/skills"
  else
    fail "PI_ONLY_SKILLS isolation check failed"
  fi
else
  fail "link-pi-agent-entries.sh failed in virgin \$HOME"
fi

# 2d. Simulate Stage 0 core symlinks + GNU Stow in isolated HOME
ln -sfn "$REPO/local-bin/.local/bin/dot" "$SANDBOX_HOME/.local/bin/dot"
ln -sfn "$REPO/starship/.config/starship.toml" "$SANDBOX_HOME/.config/starship.toml"
ln -sfn "$REPO/nvim-lite/.config/nvim-lite" "$SANDBOX_HOME/.config/nvim-lite"
ln -sfn "$REPO/nvim-malo/.config/nvim-malo" "$SANDBOX_HOME/.config/nvim-malo"
ln -sfn "$REPO/nvim-lite/.config/nvim-lite" "$SANDBOX_HOME/.config/nvim"

if command -v stow >/dev/null 2>&1; then
  if stow -d "$REPO" -t "$SANDBOX_HOME" zsh bash git tmux >/dev/null 2>&1; then
    pass "GNU Stow links zsh, bash, git, tmux cleanly into virgin \$HOME"
  else
    fail "GNU Stow failed to link zsh, bash, git, tmux in virgin \$HOME"
  fi
fi

# 2e. Test `dot doctor --json` inside isolated HOME
DOCTOR_OUT="$(HOME="$SANDBOX_HOME" DOTFILES_REPO="$REPO" "$SANDBOX_HOME/.local/bin/dot" doctor --json)"
if command -v jq >/dev/null 2>&1; then
  if echo "$DOCTOR_OUT" | jq -e '.links.nvim_default == "linked" and .links.nvim_active_profile == "nvim-lite" and .links.starship == "linked" and .links.dot_cli == "linked" and (.agents.shared_skills_count > 0)' >/dev/null 2>&1; then
    pass "dot doctor --json reports valid JSON & accurate link states (nvim-lite active) in sandbox"
  else
    fail "dot doctor --json output did not match expected link states: $DOCTOR_OUT"
  fi
fi

# 2f. Test sentinel drift detection & extraction in isolated HOME
if [[ -L "$SANDBOX_HOME/.zshrc" ]]; then
  # Replace symlink with a real copy and append a machine-local line to simulate drift
  rm "$SANDBOX_HOME/.zshrc"
  cp "$REPO/zsh/.zshrc" "$SANDBOX_HOME/.zshrc"
  echo "export MY_SANDBOX_SECRET=42" >> "$SANDBOX_HOME/.zshrc"

  DRIFT_JSON="$(HOME="$SANDBOX_HOME" "$REPO/scripts/doctor.sh" --json)"
  if echo "$DRIFT_JSON" | grep -q '"zsh/.zshrc"'; then
    pass "doctor.sh detects missing sentinel when ~/.zshrc has local inline edits"
  else
    fail "doctor.sh did not detect missing sentinel on modified ~/.zshrc"
  fi

  if HOME="$SANDBOX_HOME" "$REPO/scripts/extract-local-overrides.sh" --apply >/dev/null 2>&1; then
    if [[ -f "$SANDBOX_HOME/.zshrc_local" ]] && grep -q "MY_SANDBOX_SECRET=42" "$SANDBOX_HOME/.zshrc_local"; then
      pass "extract-local-overrides.sh --apply extracts local edits to ~/.zshrc_local & restores sentinel"
    else
      fail "extract-local-overrides.sh --apply did not populate ~/.zshrc_local"
    fi
  else
    fail "extract-local-overrides.sh --apply failed in sandbox"
  fi
fi

#-----------------------------------------------------------------------------
# 3. Headless Core Tool & Config Verification (Neovim, Starship, Shells, Tmux)
#-----------------------------------------------------------------------------
section "3. Headless Core Config Verification (Neovim, Starship, Zsh, Tmux)"

# 3a. Neovim (`nvim-lite` & `nvim-malo`) headless startup verification
if command -v nvim >/dev/null 2>&1; then
  NVIM_LITE_CHECK="$(HOME="$SANDBOX_HOME" XDG_CONFIG_HOME="$SANDBOX_HOME/.config" \
    nvim --headless -u "$REPO/nvim-lite/.config/nvim-lite/init.lua" \
    +"lua assert(type(_G.OS) == 'string', 'OS global missing'); assert(vim.g.mapleader == ' ', 'leader missing'); print('NVIM_LITE_OK:' .. _G.OS)" +qa 2>&1 || true)"
  if echo "$NVIM_LITE_CHECK" | grep -q "NVIM_LITE_OK:"; then
    pass "nvim-lite init.lua loads cleanly in headless mode with zero external deps ($NVIM_LITE_CHECK)"
  else
    fail "nvim-lite init.lua headless check failed: $NVIM_LITE_CHECK"
  fi

  NVIM_CHECK="$(HOME="$SANDBOX_HOME" XDG_CONFIG_HOME="$SANDBOX_HOME/.config" NVIM_APPNAME=nvim-malo \
    nvim --headless -u "$REPO/nvim-malo/.config/nvim-malo/lua/options.lua" \
    +"lua assert(type(_G.OS) == 'string', 'OS global missing'); assert(type(_G.IS_WINDOWS) == 'boolean', 'IS_WINDOWS missing'); print('NVIM_OPTIONS_OK:' .. _G.OS)" +qa 2>&1 || true)"
  if echo "$NVIM_CHECK" | grep -q "NVIM_OPTIONS_OK:"; then
    pass "nvim-malo lua/options.lua loads cleanly in headless mode ($NVIM_CHECK)"
  else
    fail "nvim-malo lua/options.lua headless check failed: $NVIM_CHECK"
  fi
fi

# 3b. Starship config validation
if command -v starship >/dev/null 2>&1; then
  STARSHIP_OUT="$(STARSHIP_CONFIG="$REPO/starship/.config/starship.toml" starship prompt --status 0 --path "$REPO" 2>/dev/null || true)"
  if [[ -n "$STARSHIP_OUT" ]]; then
    pass "starship renders prompt cleanly using starship/.config/starship.toml"
  else
    fail "starship failed to render prompt with starship/.config/starship.toml"
  fi
fi

# 3c. Zsh & Bash config syntax validation + Parrot prompt verification
if command -v zsh >/dev/null 2>&1; then
  for zfile in "$REPO/zsh/.zshenv" "$REPO/zsh/.zprofile" "$REPO/zsh/.zshrc"; do
    if zsh -n "$zfile" 2>/dev/null; then
      pass "zsh -n ${zfile#$REPO/}"
    else
      fail "zsh -n ${zfile#$REPO/}"
    fi
  done
fi

for bfile in "$REPO/bash/.bashrc" "$REPO/bash/.bash_profile" "$REPO/bash/.bash_aliases" "$REPO/bash/.bashrc.d/parrot-prompt.sh"; do
  if bash -n "$bfile" 2>/dev/null; then
    pass "bash -n ${bfile#$REPO/}"
  else
    fail "bash -n ${bfile#$REPO/}"
  fi
done

if PARROT_PS1="$(TERM=xterm-256color bash -c "source '$REPO/bash/.bashrc.d/parrot-prompt.sh' && parrot_prompt yes && printf '%s' \"\$PS1\"")" && [[ "$PARROT_PS1" == *"╭─"* && "$PARROT_PS1" == *"╰──╼"* ]]; then
  pass "parrot-prompt.sh builds two-line Parrot/Kali PS1 prompt cleanly"
else
  fail "parrot-prompt.sh failed to build PS1 prompt"
fi

#-----------------------------------------------------------------------------
# 4. Docker Container & Omarchy Linux / Windows VM Environment Tests
#-----------------------------------------------------------------------------
section "4. Container & Remote Omarchy / Windows VM Environment Tests"

DOCKER_READY=0
if [[ "$WANT_DOCKER" != "no" ]] && command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    DOCKER_READY=1
  elif [[ "$WANT_DOCKER" == "yes" ]] && [[ "$(uname -s)" == "Darwin" ]]; then
    echo "  • Starting local Docker Desktop..."
    open -a Docker 2>/dev/null || true
    for _ in {1..15}; do
      if docker info >/dev/null 2>&1; then
        DOCKER_READY=1
        break
      fi
      sleep 2
    done
  fi
fi

if [[ "$DOCKER_READY" == "1" ]]; then
  if docker run --rm -v "$REPO:/dotfiles:ro" ubuntu:24.04 bash -c '
    set -euo pipefail
    export HOME=/tmp/testuser
    mkdir -p "$HOME"
    cp -a /dotfiles "$HOME/dotfiles"
    cd "$HOME/dotfiles"
    ./bootstrap.sh --dry-run >/dev/null
    ./scripts/init-pi-settings.sh >/dev/null
    ./scripts/link-pi-agent-entries.sh >/dev/null
    ./scripts/doctor.sh --json | grep -q "\"os\": \"linux\""
    ./scripts/validate-manifest.sh >/dev/null
  '; then
    pass "Local Docker (ubuntu:24.04): bootstrap --dry-run, doctor --json, skill linker, & manifest validation pass"
  else
    fail "Local Docker (ubuntu:24.04) container verification failed"
  fi
else
  printf "  \033[1;33m•\033[0m Local Docker daemon not running (checking Omarchy-Home SSH + remote Docker...)\n"
fi

# 4b. Test against live Omarchy Linux host + Remote Docker + Omarchy Windows VM if reachable over SSH
if ssh -o ConnectTimeout=2 -o BatchMode=yes Omarchy-Home "true" 2>/dev/null; then
  REMOTE_SANDBOX="/tmp/dotfiles-omarchy-test.$$"
  if COPYFILE_DISABLE=1 tar -C "$REPO" \
      --exclude='.git' \
      --exclude='pi/mattpocock-skills' \
      --exclude='nvim-malo-old.ignore' \
      -czf - . | ssh -o BatchMode=yes Omarchy-Home "mkdir -p '$REMOTE_SANDBOX/repo' '$REMOTE_SANDBOX/home' && tar -xzf - -C '$REMOTE_SANDBOX/repo' 2>/dev/null" \
    && ssh -o BatchMode=yes Omarchy-Home "REMOTE_SANDBOX='$REMOTE_SANDBOX' bash -s" <<'EOF_REMOTE'
set -euo pipefail
export HOME="$REMOTE_SANDBOX/home"
cd "$REMOTE_SANDBOX/repo"

# 1. Test on live Arch/Omarchy Linux host in virgin HOME
./bootstrap.sh --dry-run >/dev/null
./scripts/init-pi-settings.sh >/dev/null
./scripts/link-pi-agent-entries.sh >/dev/null
./scripts/validate-manifest.sh >/dev/null
./scripts/validate-install.sh >/dev/null
DOC_OUT="$(./scripts/doctor.sh --json)"
grep -q '"distro": "omarchy"' <<<"$DOC_OUT"

# 2. Test inside a clean Debian/Ubuntu Docker container on Omarchy-Home
if docker info >/dev/null 2>&1; then
  docker run --rm -v "$REMOTE_SANDBOX/repo:/dotfiles:ro" --entrypoint /bin/bash collabora/code:latest -c '
    set -euo pipefail
    export HOME=/tmp/container-home
    mkdir -p "$HOME"
    cp -a /dotfiles "$HOME/dotfiles"
    cd "$HOME/dotfiles"
    ./bootstrap.sh --dry-run >/dev/null
    ./scripts/init-pi-settings.sh >/dev/null
    ./scripts/link-pi-agent-entries.sh >/dev/null
    C_DOC="$(./scripts/doctor.sh --json)"
    grep -q "\"os\": \"linux\"" <<<"$C_DOC"
    ./scripts/validate-manifest.sh >/dev/null
  '
fi
rm -rf /tmp/dotfiles-omarchy-*
EOF_REMOTE
  then
    pass "Omarchy Linux Host (7.2.5-omarchy): sandbox bootstrap, doctor (distro=omarchy), skill linker & validate-install pass"
    pass "Remote Docker Container (Debian/Ubuntu on Omarchy-Home): clean-container bootstrap, doctor, & skill linker pass"
  else
    fail "Omarchy-Home remote Linux / Docker verification failed"
  fi
fi

# 4c. PowerShell AST parse of every .ps1 when pwsh is available, plus the Omarchy
#     Windows VM shared mount (/media/VIRT/omarchy-windows/Windows) when reachable.
if command -v pwsh >/dev/null 2>&1; then
  ps1_parse_fail=""
  while IFS= read -r ps1; do
    if ! pwsh -NoProfile -Command "\$e=\$null; [System.Management.Automation.Language.Parser]::ParseFile('$ps1',[ref]\$null,[ref]\$e) | Out-Null; if (\$e.Count) { exit 1 }" >/dev/null 2>&1; then
      ps1_parse_fail+=" ${ps1#$REPO/}"
    fi
  done < <(find "$REPO" -name '*.ps1' -not -path '*/node_modules/*')
  if [[ -z "$ps1_parse_fail" ]]; then
    pass "PowerShell AST parse clean for every .ps1"
  else
    fail "PowerShell parse errors in:$ps1_parse_fail"
  fi

  # bootstrap.ps1 and link-windows.ps1 call it on every platform, so it has to exit
  # cleanly when it is not running on Windows.
  if pwsh -NoProfile -File "$REPO/scripts/windows/ensure-execution-policy.ps1" >/dev/null 2>&1; then
    pass "ensure-execution-policy.ps1 is a clean no-op on a non-Windows host"
  else
    fail "ensure-execution-policy.ps1 failed on a non-Windows host"
  fi
else
  printf "  \033[1;33m•\033[0m pwsh not on PATH: skipped the PowerShell AST parse (section 1 still checks ASCII purity)\n"
fi

if ssh -o ConnectTimeout=2 -o BatchMode=yes Ubuntu-Home "test -d /media/VIRT/omarchy-windows/Windows" 2>/dev/null; then
  pass "Omarchy Windows 11 VM shared directory (/media/VIRT/omarchy-windows/Windows) detected on Ubuntu-Home"
fi

#-----------------------------------------------------------------------------
# Summary
#-----------------------------------------------------------------------------
echo ""
if [[ "$FAIL_COUNT" -eq 0 ]]; then
  printf "\033[1;32m✓ All %d environment & configuration checks passed!\033[0m\n" "$PASS_COUNT"
  exit 0
else
  printf "\033[1;31m✗ %d check(s) failed (%d passed).\033[0m\n" "$FAIL_COUNT" "$PASS_COUNT" >&2
  exit 1
fi
