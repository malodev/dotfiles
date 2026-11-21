# Catalogue: software this repository can offer a machine

This is not a dependency list. Nothing here is installed by `bootstrap.sh`, `install.sh` or
`dot link`, and nothing here has to be present for the dotfiles to work. It is the repository's
**offer**: software worth installing on some machines, with the notes an agent needs to judge
whether *this* machine wants it, and to do it properly if so.

The rule that keeps it honest is the same as `ADOPTION.md`'s: the *offer* is common and belongs
here; the *decision* is the machine's and belongs in `~/Work/AGENTS.md`, untracked. A catalogue
entry that carries a machine's decision, path or key is a bug.

## How an agent uses an entry

1. **Read the whole entry**, including *Do not install when*. Applicability is usually the part
   that matters, not the commands.
2. **Check the machine** instead of assuming: the OS and architecture, whether the harness
   directories in *Install* exist, the runtime in *Requires*, free disk.
3. **Ask the human** unless the entry or `~/Work/AGENTS.md` already records a decision. Installing
   something is a change to their machine, not a fix to the repository.
4. **Install** with the entry's commands, then run its *Verify*.
5. **Record the decision** in `~/Work/AGENTS.md` in one line: what was installed, where, and the
   reason. The next agent reads that instead of re-deciding.
6. If the entry is wrong or incomplete, fix the entry — that is the point of it being tracked.

An entry stays useful when it is editable by the machine that adopts it. If a machine had to do
something the entry does not mention, the entry is missing a line.

## Entry format

```markdown
## <what it is>

- **What it gives you:** the capability, in the words of someone who would use it.
- **Requires:** OS and architecture, runtime, disk, which harness directory must exist.
- **Install:** exact commands, idempotent, no prompts.
- **Verify:** the one command whose output proves it worked.
- **Update / Remove:** how to move forward and how to take it back out.
- **Install when:** the situations that make it worth its cost.
- **Do not install when:** the situations where it is noise, a security question, or a duplicate.
- **Decisions:** the machines that have it, recorded in `~/Work/AGENTS.md` (not here).
```

---

## design-taste-frontend — the "taste" frontend skill

A single Agent Skill (upstream repo: `Leonxlnx/taste-skill`, ~70 MB on disk, mostly licensed
sample photography) for building and reviewing landing pages: one system per page, real copy and
real product UI, a checker and a finish gate that run in a real browser.

- **What it gives you:** a frontend agent that produces company-grade pages instead of templated
  ones, and says why. It carries its own `scripts/` (the gate), `references/`, `library/` and
  `assets/`, and declares a Claude Code `Stop` hook that runs the gate after a session.
- **Requires:** `git`, `node` (the gate is `.mjs`), ~70 MB of disk, network for the clone. The
  harness directories must exist or be creatable: `~/.agents/skills` (read natively by pi and
  Codex), `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/config/skills` (what agy reads here).
- **Install:** clone once, then let upstream's own installer link Claude and Codex; add the two
  directories upstream does not know about by hand:
  ```bash
  git clone --depth 1 https://github.com/Leonxlnx/taste-skill.git ~/Tools/taste-skill
  ( cd ~/Tools/taste-skill && ./install.sh --all-agents )
  for d in ~/.agents/skills ~/.gemini/config/skills; do
    ln -sfn ~/Tools/taste-skill/skills/taste-skill "$d/design-taste-frontend"
  done
  ```
  The link name matters: it must be the frontmatter `name:` (`design-taste-frontend`), not the
  folder name (`taste-skill`), because the Claude `Stop` hook looks for that exact path.
- **Verify:** `head -2 ~/.agents/skills/design-taste-frontend/SKILL.md` shows
  `name: design-taste-frontend`. In pi, `/skill:design-taste-frontend` appears in the skill list.
- **Update / Remove:** `git -C ~/Tools/taste-skill pull` (the links are symlinks, so updates land
  in place). Remove with `( cd ~/Tools/taste-skill && ./install.sh --all-agents --uninstall )` plus
  `rm ~/.agents/skills/design-taste-frontend ~/.gemini/config/skills/design-taste-frontend`.
- **Install when:** the machine builds or reviews websites — landing pages, company, product,
  shop, cafe, hotel, SaaS — and an agent works there.
- **Do not install when:** the machine has no frontend work, is short on disk or has no `node`, or
  the harness reads skills from a directory this entry does not cover. It is also a Claude-first
  skill: on a harness without hooks, only the instructions apply, and the gate never runs.
- **Decisions:** recorded per machine in `~/Work/AGENTS.md`, as the rule above says. Two things
  worth carrying in that line: the upstream commit installed, and the clone path, because a
  `git pull` there is what updates every harness at once.
