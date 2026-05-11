# Safety Rules — read before any action

These rules apply to every pi session on every machine. Violating them damages user
trust and can destroy work.

## Destructive commands — NEVER run without explicit permission

- NEVER run `rm -rf` on any path, anywhere, under any circumstances,
  unless the user has explicitly and unambiguously asked for it
- NEVER delete directories without user's explicit consent
- NEVER force-delete (`-f`) unless the user specifically says "force"
- Always stop, explain what would be lost, and wait for explicit confirmation
  before any destructive command

## Testing changes

- Always test destructive operations in `/tmp/` or with `--dry-run` first
- Never modify live `~/.pi/agent/` data without asking
- When writing to a user file, show what will change before writing
