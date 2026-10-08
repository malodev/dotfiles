# Pi scripts

## Shared agent skills

Upstream skills live in the `pi/mattpocock-skills` git submodule and are exposed to
agent harnesses as per-skill symlinks:

| Location | Read by |
| --- | --- |
| `~/.agents/skills/` | pi, Codex and other Agent Skills-compatible harnesses |
| `~/.claude/skills/` | Claude Code |

Linking is done by the submodule's own script, which is non-pruning — entries it
does not own (skills installed locally, or by the OS under
`/usr/share/omarchy/default/agents/skills`) are left alone:

```bash
cd ~/dotfiles/pi/mattpocock-skills
./scripts/link-skills.sh
```

`install.sh` runs this automatically for the `pi-agent` group, after
`git submodule update --init --recursive`. To re-link after updating the
submodule:

```bash
cd ~/dotfiles
git submodule update --remote --recursive pi/mattpocock-skills
./pi/mattpocock-skills/scripts/link-skills.sh
```

### Where pi's own skills live

`~/.pi/agent/skills` (stowed from `pi/.pi/agent/skills`) holds only skills that
are specific to pi. Upstream skills are **not** copied there — keeping one
location per skill is what avoids the name collisions pi reports at startup under
`[Skill conflicts]` (visible with `--verbose`, hidden when `quietStartup` is on).

Skills can be switched off in `~/.pi/agent/settings.json` with a `skills` array of
`-path/to/SKILL.md` / `+path/to/SKILL.md` entries, matched relative to each skill
root, so one entry covers both `~/.pi/agent/skills` and `~/.agents/skills`.

General skills are mirrored from `~/.agents/skills` into `~/.claude/skills`,
because Claude Code only reads `~/.claude/skills` and has no `~/.agents/skills`
fallthrough. The mirror points at the `~/.agents/skills` link, so each skill
still has one home and loads once.

## `link-codex-skills.sh` — removed

This linked the same submodule into `~/.codex/skills`. Codex reads user skills
from `~/.agents/skills`, which `link-skills.sh` already populates, and
`~/.codex/skills` is not among Codex's documented skill locations. Removed as
redundant.

## `copy-pi-skills.sh` — retired

This copied upstream skills into `pi/.pi/agent/skills`, which duplicated every
skill in `~/.agents/skills` and caused pi name collisions. It is no longer part of
the workflow; running it would resurrect those duplicates.
