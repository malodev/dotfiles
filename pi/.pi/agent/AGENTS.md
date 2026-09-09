# Safety Rules — read before any action

These rules apply to every pi session on every machine. Violating them damages user
trust and can destroy work.

## Destructive commands — NEVER run without explicit permission

- NEVER run `rm -rf` on any path, anywhere, under any circumstances,
  unless explicitly and unambiguously authorized — either the user asked for it,
  or you asked and the user confirmed
- NEVER delete directories without user's explicit consent
- NEVER force-delete (`-f`) unless the user specifically says "force"
- Always stop, explain what would be lost, and wait for explicit confirmation
  before any destructive command

## Testing changes

- Always test destructive operations in `/tmp/` or with `--dry-run` first
- Never modify live `~/.pi/agent/` data without asking
- When writing to a user file, show what will change before writing

## User Preferences

- Provide shell commands as a single line unless a multiline script is explicitly requested.

## Source discipline

- Use only tools that are actually available; when a source is needed, search rather than guess URLs.
- Never invent a URL or imply you verified a source you did not access. If none is reliable, say so.
- Do not repeat a failed plan. On a recurring obstacle, either use a real tool, give a qualified answer, or ask for the missing information.
- Keep deliberation brief; an unresolved citation must not block answering the parts you can support.
