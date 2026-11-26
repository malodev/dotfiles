#!/usr/bin/env bash
#=============================================================================
# install-herdr-agent-restore.sh
#
# Install (or remove) the per-machine, per-boot restore of Herdr agent sessions.
#
# Herdr's core never re-runs a command: after a reboot every kept terminal comes
# back as a shell in the same folder, with the same address, and whatever agent
# was inside it is gone (`~/.config/herdr-app/AGENTS.md`: "its original command
# is never run again"). The Herdr TUI kept an `agent_session` per pane and
# re-opened it; Herdr Desktop has no such step.
#
# `herdr-agent-sessions` (in local-bin) adds it: a snapshot of the agents running
# in this machine's own terminals, and one restore per boot that types the
# recorded command back into each restored shell. Everything runs HERE, on this
# machine, with its own state under ~/.local/state/herdr — so a machine that is
# off cannot break another one.
#
# This script only writes the two systemd user units and enables the timer. The
# helper itself comes from the dotfiles checkout (`dot link local-bin` puts it in
# ~/.local/bin); this script refuses to run without it, because a copy in
# ~/.local/bin where a stow symlink belongs is drift.
#
# Usage:
#   scripts/install-herdr-agent-restore.sh            # dry run: print the plan
#   scripts/install-herdr-agent-restore.sh --apply    # write, enable, first snapshot
#   scripts/install-herdr-agent-restore.sh --uninstall --apply
#   scripts/install-herdr-agent-restore.sh --help
#
# Afterwards:
#   herdr-agent-sessions status            # what is remembered, and this boot
#   herdr-agent-sessions restore --dry-run # who it would put back, touching none
#   systemctl --user disable --now herdr-agent-sessions.timer   # opt out
#=============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="dry-run"
ACTION="install"
UNIT_DIR="$HOME/.config/systemd/user"
SERVICE="$UNIT_DIR/herdr-agent-sessions.service"
TIMER="$UNIT_DIR/herdr-agent-sessions.timer"
HELPER="$HOME/.local/bin/herdr-agent-sessions"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)      MODE="apply"; shift ;;
    --dry-run)    MODE="dry-run"; shift ;;
    --uninstall)  ACTION="uninstall"; shift ;;
    --help|-h)    awk 'NR>=3 && /^#=====/{exit} NR>=3' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

info() { printf '  %s\n' "$*"; }
rule() { printf '\n── %s ──\n' "$*"; }
die()  { echo "error: $*" >&2; exit 1; }

# ── prerequisites ────────────────────────────────────────────────────────────
rule "checks"

[[ "$(uname -s)" == "Linux" ]] || die "this installs systemd user units; $(uname -s) needs launchd (see ~/dotfiles/launchd/)"
command -v systemctl >/dev/null 2>&1 || die "systemctl not found"
systemctl --user show-environment >/dev/null 2>&1 || die "no systemd user manager for this login"
info "systemd user manager: ok"

command -v python3 >/dev/null 2>&1 || die "python3 not found (the helper is python3)"
info "python3: $(command -v python3) $(python3 -V 2>&1)"

command -v hc >/dev/null 2>&1 || die "hc not found: install herdr-core first"
info "hc: $(command -v hc)"

if [[ -x "$HELPER" ]]; then
  info "helper: $HELPER"
elif [[ -f "$REPO/local-bin/.local/bin/herdr-agent-sessions" ]]; then
  die "helper not in ~/.local/bin: run 'dot link local-bin' first (a copy there would fight stow)"
else
  die "helper missing: $HELPER (expected from local-bin in $REPO)"
fi

# ── uninstall ────────────────────────────────────────────────────────────────
if [[ "$ACTION" == "uninstall" ]]; then
  rule "uninstall"
  for f in "$TIMER" "$SERVICE"; do
    if [[ -e "$f" ]]; then
      info "remove $f"
      [[ "$MODE" == "apply" ]] && rm -f "$f"
    fi
  done
  if [[ "$MODE" == "apply" ]]; then
    systemctl --user disable --now herdr-agent-sessions.timer >/dev/null 2>&1
    systemctl --user daemon-reload
    info "timer disabled; the snapshot in ~/.local/state/herdr is left in place"
  else
    info "would disable herdr-agent-sessions.timer"
  fi
  [[ "$MODE" == "apply" ]] && info "done" || info "dry run: nothing was written"
  exit 0
fi

# ── install ──────────────────────────────────────────────────────────────────
rule "units"
info "service: $SERVICE"
info "timer:   $TIMER   (every minute, and 40 s after boot)"

service_body() {
  cat <<'UNIT'
[Unit]
Description=Snapshot the local Herdr agents, and bring them back once per boot
Documentation=file:%h/.local/bin/herdr-agent-sessions

[Service]
Type=oneshot
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=%h/.local/bin/herdr-agent-sessions tick
Nice=10
UNIT
}

timer_body() {
  cat <<'UNIT'
[Unit]
Description=Keep local Herdr agent sessions across reboots (every 60 s)
Documentation=file:%h/.local/bin/herdr-agent-sessions

[Timer]
OnBootSec=40s
OnCalendar=*-*-* *:*:00
AccuracySec=5s
Unit=herdr-agent-sessions.service

[Install]
WantedBy=timers.target
UNIT
}

if [[ "$MODE" == "apply" ]]; then
  mkdir -p "$UNIT_DIR"
  service_body > "$SERVICE"
  timer_body > "$TIMER"
  systemctl --user daemon-reload
  systemctl --user enable --now herdr-agent-sessions.timer >/dev/null
  info "written and enabled"
else
  info "(dry run: bodies are the ones already in place on a configured machine)"
fi

rule "state"
if [[ "$MODE" == "apply" ]]; then
  "$HELPER" snapshot
  "$HELPER" status | head -3
  info "verify with: $HELPER restore --dry-run   (must list 'già occupato', touching nothing)"
else
  info "would take a first snapshot and enable the timer"
  info "dry run: nothing was written"
fi
