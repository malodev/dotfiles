#!/usr/bin/env python3
"""Safely scaffold the Pi three-agent-team workflow into a repository.

Dry-run is the default. --apply creates missing files but never overwrites.
This script never initializes Git and never modifies global Pi configuration.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = SKILL_DIR / "assets"
REFERENCES_DIR = SKILL_DIR / "references"


@dataclass(frozen=True)
class Template:
    source: Path
    destination: Path
    purpose: str


TEMPLATES = (
    Template(ASSETS_DIR / "AGENTS.md", Path("AGENTS.md"), "project commands and stable agent constraints"),
    Template(ASSETS_DIR / "CONTEXT.md", Path("CONTEXT.md"), "domain and architecture context"),
    Template(
        ASSETS_DIR / "team-workflow.md",
        Path(".pi/skills/three-agent-team/SKILL.md"),
        "operational Architect–Builder–Reviewer skill",
    ),
    Template(
        ASSETS_DIR / "team-builder.md",
        Path("team/agents/team-builder.md"),
        "canonical version-controlled Builder definition",
    ),
    Template(
        ASSETS_DIR / "team-reviewer.md",
        Path("team/agents/team-reviewer.md"),
        "canonical version-controlled Reviewer definition",
    ),
    Template(
        REFERENCES_DIR / "workflow.md",
        Path("team/README.md"),
        "workflow, state-machine, and safety reference",
    ),
    Template(
        ASSETS_DIR / "task-status.yaml",
        Path("team/tasks/.template/status.yaml"),
        "new-task state template",
    ),
    Template(
        ASSETS_DIR / "validate_goal_contract.py",
        Path("team/validate_goal_contract.py"),
        "deterministic pre-go and execution contract validator",
    ),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Preview or safely apply the Pi three-agent-team repository scaffold."
    )
    parser.add_argument("target", nargs="?", default=".", help="target repository root")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="create missing files; without this flag only preview changes",
    )
    parser.add_argument(
        "--allow-non-git",
        action="store_true",
        help="allow an existing non-Git directory (Git is otherwise required)",
    )
    parser.add_argument(
        "--fail-on-existing",
        action="store_true",
        help="abort if any destination already exists instead of safely skipping it",
    )
    return parser.parse_args()


def git_root(target: Path) -> Path | None:
    result = subprocess.run(
        ["git", "-C", str(target), "rev-parse", "--show-toplevel"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    return Path(result.stdout.strip()).resolve()


def ensure_safe_target(raw_target: str, allow_non_git: bool) -> Path:
    target = Path(raw_target).expanduser().resolve()
    home = Path.home().resolve()

    if target in (Path("/").resolve(), home):
        raise ValueError(f"refusing unsafe target: {target}")
    if not target.is_dir():
        raise ValueError(f"target is not an existing directory: {target}")

    root = git_root(target)
    if root is None:
        if not allow_non_git:
            raise ValueError(
                "target is not a Git repository; initialize it yourself or explicitly pass --allow-non-git"
            )
    elif root != target:
        raise ValueError(f"target must be the repository root: {root}")

    return target


def ensure_destination_inside_target(target: Path, relative: Path) -> Path:
    destination = target / relative
    ancestor = destination.parent
    while not ancestor.exists():
        if ancestor == target:
            break
        ancestor = ancestor.parent

    resolved_ancestor = ancestor.resolve()
    if resolved_ancestor != target and target not in resolved_ancestor.parents:
        raise ValueError(f"destination escapes target through a symlink: {destination}")
    return destination


def validate_skill_frontmatter(path: Path) -> None:
    """Validate the strict frontmatter subset used by generated Pi skills."""
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise ValueError(f"skill frontmatter must start with ---: {path}")
    try:
        closing = lines.index("---", 1)
    except ValueError as error:
        raise ValueError(f"skill frontmatter has no closing ---: {path}") from error

    values: dict[str, str] = {}
    for line in lines[1:closing]:
        if not line.strip():
            continue
        if ":" not in line:
            raise ValueError(f"invalid skill frontmatter line in {path}: {line!r}")
        key, value = line.split(":", 1)
        value = value.strip()
        if value and value[0] in {'\"', "'"}:
            if len(value) < 2 or value[-1] != value[0]:
                raise ValueError(f"unterminated quoted frontmatter value in {path}: {key}")
        elif ": " in value:
            raise ValueError(
                f"plain frontmatter scalar contains ': ' and must be quoted in {path}: {key}"
            )
        values[key.strip()] = value

    for required in ("name", "description"):
        if not values.get(required):
            raise ValueError(f"skill frontmatter is missing {required}: {path}")


def validate_sources() -> None:
    missing = [str(template.source) for template in TEMPLATES if not template.source.is_file()]
    if missing:
        raise ValueError("missing initializer assets:\n- " + "\n- ".join(missing))
    for template in TEMPLATES:
        if template.destination.name == "SKILL.md":
            validate_skill_frontmatter(template.source)


def validate_installed_files(target: Path) -> None:
    skill_path = target / ".pi/skills/three-agent-team/SKILL.md"
    validate_skill_frontmatter(skill_path)
    validator = target / "team/validate_goal_contract.py"
    compile(validator.read_text(encoding="utf-8"), str(validator), "exec")


def show_plan(target: Path) -> tuple[list[tuple[Template, Path]], list[tuple[Template, Path]]]:
    creates: list[tuple[Template, Path]] = []
    existing: list[tuple[Template, Path]] = []

    print(f"Target: {target}")
    print("Mode: dry-run" if not ARGS.apply else "Mode: apply")
    print()

    for template in TEMPLATES:
        destination = ensure_destination_inside_target(target, template.destination)
        if destination.exists() or destination.is_symlink():
            existing.append((template, destination))
            status = "SKIP existing"
        else:
            creates.append((template, destination))
            status = "CREATE"
        print(f"{status:13} {template.destination} — {template.purpose}")

    print()
    print(f"Summary: {len(creates)} create, {len(existing)} skip, 0 overwrite")
    return creates, existing


def apply_plan(creates: list[tuple[Template, Path]]) -> tuple[list[Path], list[Path]]:
    created: list[Path] = []
    raced: list[Path] = []

    for template, destination in creates:
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            with destination.open("xb") as output:
                output.write(template.source.read_bytes())
            created.append(destination)
        except FileExistsError:
            # Another process created it after preview. Preserve it.
            raced.append(destination)

    return created, raced


def main() -> int:
    try:
        validate_sources()
        target = ensure_safe_target(ARGS.target, ARGS.allow_non_git)
        creates, existing = show_plan(target)

        if ARGS.fail_on_existing and existing:
            print("Aborted: existing destinations found and --fail-on-existing was requested.", file=sys.stderr)
            return 2

        if not ARGS.apply:
            print("No files written. Re-run with --apply after reviewing this plan.")
            return 0

        created, raced = apply_plan(creates)
        validate_installed_files(target)
        print(f"Created {len(created)} file(s).")
        for path in created:
            print(f"  + {path.relative_to(target)}")
        for path in raced:
            print(f"  = skipped concurrent existing file: {path.relative_to(target)}")
        print("Validated generated skill frontmatter and contract-validator syntax.")
        print("Global Pi configuration was not modified.")
        print("Next: review the files, verify the global extension commands, and start with /team-new.")
        return 0
    except (OSError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


ARGS = parse_args()

if __name__ == "__main__":
    raise SystemExit(main())
