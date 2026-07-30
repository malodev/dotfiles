#!/usr/bin/env python3
"""Validate a three-agent-team Goal Contract before execution or review.

Standard-library only. The validator checks contract structure and repository state;
it cannot prove that product requirements are semantically correct.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pwd
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


REQUIRED_SECTIONS = (
    "Goal",
    "Current behavior",
    "Agreed approach",
    "Success tests",
    "Non-goals",
    "Relevant files",
    "Architectural constraints",
    "Verification commands",
    "Baseline commit",
    "Execution authority",
    "Open decisions",
    "Execution authorization",
)
PLACEHOLDER_RE = re.compile(r"REPLACE_ME|\bTBD\b|\bTODO\b|\[PROJECT_[A-Z_]+\]|<[^>\n]+>", re.IGNORECASE)
SUCCESS_HEADING_RE = re.compile(r"^###\s+(ST-\d{2,})\s*(?:[:—-])\s*(.+?)\s*$", re.MULTILINE)
EXECUTION_AUTHORIZATION_RE = re.compile(
    r"AUTHORIZED at (?P<timestamp>\S+) by owner "
    r"(?P<source>message `go`|command `/team-enqueue`)"
)
FULL_SHA_RE = re.compile(r"\b[0-9a-f]{40}\b")
TASK_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
STATE_ROOT = Path(pwd.getpwuid(os.getuid()).pw_dir) / ".local" / "state" / "pi-three-agent-team"


@dataclass(frozen=True)
class SuccessTest:
    identifier: str
    title: str
    command: str
    expected_exit_code: int
    expected_evidence: str
    writes_state: bool
    prerequisites: tuple[str, ...]


def run_git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=False,
        capture_output=True,
        text=True,
    )


def authorization_record_path(repo: Path, task_id: str) -> Path:
    if not TASK_ID_RE.fullmatch(task_id):
        raise ValueError(f"Invalid task ID for authorization record: {task_id}")
    repository_key = hashlib.sha256(str(repo.resolve()).encode("utf-8")).hexdigest()
    return STATE_ROOT / "authorizations" / repository_key / f"{task_id}.json"


def markdown_sections(text: str) -> dict[str, str]:
    matches = list(re.finditer(r"^##\s+(.+?)\s*$", text, re.MULTILINE))
    sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        sections[match.group(1).strip()] = text[start:end].strip()
    return sections


def field(block: str, label: str) -> str | None:
    match = re.search(rf"^- {re.escape(label)}:\s*(.+?)\s*$", block, re.MULTILINE)
    return match.group(1).strip() if match else None


def unquote_code(value: str | None) -> str | None:
    if value is None or len(value) < 2 or not (value.startswith("`") and value.endswith("`")):
        return None
    return value[1:-1].strip()


def parse_success_tests(section: str, errors: list[str]) -> list[SuccessTest]:
    headings = list(SUCCESS_HEADING_RE.finditer(section))
    if not headings:
        errors.append("Success tests must contain at least one '### ST-NN: <name>' block.")
        return []

    tests: list[SuccessTest] = []
    identifiers: set[str] = set()
    for index, heading in enumerate(headings):
        identifier, title = heading.group(1), heading.group(2).strip()
        start = heading.end()
        end = headings[index + 1].start() if index + 1 < len(headings) else len(section)
        block = section[start:end]
        if identifier in identifiers:
            errors.append(f"Duplicate success-test identifier: {identifier}.")
            continue
        identifiers.add(identifier)

        command = unquote_code(field(block, "Command"))
        exit_raw = unquote_code(field(block, "Expected exit code"))
        evidence = field(block, "Expected evidence")
        writes_raw = unquote_code(field(block, "Writes hardware/system state"))
        prerequisites_raw = unquote_code(field(block, "Prerequisites"))

        missing = []
        for label, value in (
            ("Command", command),
            ("Expected exit code", exit_raw),
            ("Expected evidence", evidence),
            ("Writes hardware/system state", writes_raw),
            ("Prerequisites", prerequisites_raw),
        ):
            if value is None or not value.strip():
                missing.append(label)
        if missing:
            errors.append(f"{identifier} is missing valid field(s): {', '.join(missing)}.")
            continue

        assert command is not None and exit_raw is not None and evidence is not None
        assert writes_raw is not None and prerequisites_raw is not None
        if PLACEHOLDER_RE.search(" ".join((command, exit_raw, evidence, writes_raw, prerequisites_raw))):
            errors.append(f"{identifier} contains a placeholder.")
            continue
        if command in {"true", "false", "none"} or "|| true" in command:
            errors.append(f"{identifier} Command is not a strict verification command: {command!r}.")
            continue
        try:
            expected_exit_code = int(exit_raw)
        except ValueError:
            errors.append(f"{identifier} Expected exit code must be an integer, got {exit_raw!r}.")
            continue
        if writes_raw not in {"yes", "no"}:
            errors.append(f"{identifier} Writes hardware/system state must be `yes` or `no`.")
            continue
        prerequisites = () if prerequisites_raw == "none" else tuple(
            item.strip() for item in prerequisites_raw.split(",") if item.strip()
        )
        if not prerequisites and prerequisites_raw != "none":
            errors.append(f"{identifier} has an empty prerequisites list.")
            continue
        tests.append(
            SuccessTest(
                identifier=identifier,
                title=title,
                command=command,
                expected_exit_code=expected_exit_code,
                expected_evidence=evidence.strip(),
                writes_state=writes_raw == "yes",
                prerequisites=prerequisites,
            )
        )

    known = {test.identifier for test in tests}
    by_id = {test.identifier: test for test in tests}
    for test in tests:
        unknown = [item for item in test.prerequisites if item not in known]
        if unknown:
            errors.append(f"{test.identifier} references unknown prerequisite(s): {', '.join(unknown)}.")
        if test.identifier in test.prerequisites:
            errors.append(f"{test.identifier} cannot depend on itself.")
        if test.writes_state:
            if not test.prerequisites:
                errors.append(f"{test.identifier} writes hardware/system state but has no offline prerequisite.")
            elif not any(not by_id[item].writes_state for item in test.prerequisites if item in by_id):
                errors.append(f"{test.identifier} must depend on at least one non-writing success test.")
    return tests


def yaml_scalar(text: str, key: str, indent: int = 0) -> str | None:
    match = re.search(rf"^{' ' * indent}{re.escape(key)}:\s*(.*?)\s*$", text, re.MULTILINE)
    if not match:
        return None
    value = match.group(1).strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'\"', "'"}:
        value = value[1:-1]
    return value


def authority_value(section: str, label: str) -> str | None:
    value = field(section, label)
    return value.strip().lower() if value else None


def validate(task_dir: Path, phase: str) -> list[str]:
    errors: list[str] = []
    task_dir = task_dir.expanduser().resolve()
    brief_path = task_dir / "brief.md"
    status_path = task_dir / "status.yaml"
    if not brief_path.is_file():
        return [f"Missing Goal Contract: {brief_path}"]
    if not status_path.is_file():
        return [f"Missing task status: {status_path}"]

    root_result = run_git(task_dir, "rev-parse", "--show-toplevel")
    if root_result.returncode != 0:
        return ["Task directory is not inside a Git repository."]
    repo = Path(root_result.stdout.strip()).resolve()
    expected_tasks_root = (repo / "team" / "tasks").resolve()
    if expected_tasks_root not in task_dir.parents:
        errors.append(f"Task directory must be below {expected_tasks_root}.")

    brief_bytes = brief_path.read_bytes()
    brief = brief_bytes.decode("utf-8")
    status = status_path.read_text(encoding="utf-8")
    sections = markdown_sections(brief)
    for name in REQUIRED_SECTIONS:
        if name not in sections:
            errors.append(f"Missing required section: ## {name}")
        elif not sections[name].strip():
            errors.append(f"Required section is empty: ## {name}")
    if errors:
        return errors

    if PLACEHOLDER_RE.search(brief):
        errors.append("Goal Contract contains a placeholder (REPLACE_ME, TBD, TODO, PROJECT_*, or <...>).")

    agents_path = repo / "AGENTS.md"
    if not agents_path.is_file():
        errors.append("AGENTS.md is missing.")
    elif PLACEHOLDER_RE.search(agents_path.read_text(encoding="utf-8")):
        errors.append("AGENTS.md still contains project-command placeholders.")

    baseline_matches = FULL_SHA_RE.findall(sections["Baseline commit"])
    if len(baseline_matches) != 1:
        errors.append("## Baseline commit must contain exactly one full 40-character commit SHA.")
        baseline = None
    else:
        baseline = baseline_matches[0]

    status_baseline = yaml_scalar(status, "baseline_commit")
    if baseline and status_baseline != baseline:
        errors.append("status.yaml baseline_commit does not exactly match brief.md.")
    if baseline:
        baseline_exists = run_git(repo, "cat-file", "-e", f"{baseline}^{{commit}}")
        if baseline_exists.returncode != 0:
            errors.append(f"Baseline commit does not exist: {baseline}.")
        else:
            ancestor = run_git(repo, "merge-base", "--is-ancestor", baseline, "HEAD")
            if ancestor.returncode != 0:
                errors.append("Baseline commit must remain an ancestor of HEAD.")

    untracked = run_git(repo, "ls-files", "--others", "--exclude-standard")
    if untracked.returncode != 0:
        errors.append("Unable to enumerate untracked files.")
    elif untracked.stdout.strip():
        names = ", ".join(untracked.stdout.splitlines()[:8])
        suffix = " …" if len(untracked.stdout.splitlines()) > 8 else ""
        errors.append(f"Files are invisible to git diff; run `git add -N .`: {names}{suffix}")

    tests = parse_success_tests(sections["Success tests"], errors)
    verification = sections["Verification commands"]
    for test in tests:
        if test.command not in verification:
            errors.append(f"Verification commands does not include {test.identifier} command exactly: {test.command}")

    open_decisions = sections["Open decisions"].strip().rstrip(".").upper()
    if open_decisions != "NONE":
        errors.append("## Open decisions must be exactly NONE before asking for go.")

    authority = sections["Execution authority"]
    required_authority = {
        "Repository edits": {"allowed", "prohibited"},
        "Non-destructive development commands": {"allowed", "prohibited"},
        "Routine technical decisions inside this contract": {"allowed", "prohibited"},
        "Hardware/system writes": {"allowed", "prohibited"},
        "Commit on success": {"true", "false"},
        "Push on success": {"true", "false"},
        "Deploy on success": {"true", "false"},
    }
    authority_values: dict[str, str] = {}
    for label, choices in required_authority.items():
        value = authority_value(authority, label)
        if value not in choices:
            errors.append(f"Execution authority must define '- {label}: {' | '.join(sorted(choices))}'.")
        elif value is not None:
            authority_values[label] = value

    writing_tests = [test for test in tests if test.writes_state]
    hardware_authority = authority_values.get("Hardware/system writes")
    allowed_operations = field(authority, "Allowed hardware/system operations")
    if writing_tests:
        if hardware_authority != "allowed":
            errors.append("At least one success test writes hardware/system state, but authority is not allowed.")
        if not allowed_operations or PLACEHOLDER_RE.search(allowed_operations) or allowed_operations.lower() in {"none", "n/a"}:
            errors.append("Allowed hardware/system operations must enumerate the authorized operations.")
    elif hardware_authority == "allowed":
        errors.append("Hardware/system writes are allowed but no success test declares a write; use prohibited or add the test.")

    policy_map = {
        "Commit on success": "commit_on_success",
        "Push on success": "push_on_success",
        "Deploy on success": "deploy_on_success",
    }
    for brief_label, status_key in policy_map.items():
        brief_value = authority_values.get(brief_label)
        status_value = yaml_scalar(status, status_key, indent=2)
        if brief_value and status_value != brief_value:
            errors.append(f"status.yaml {status_key} does not match brief.md ({brief_value}).")

    state = yaml_scalar(status, "state")
    task_id = yaml_scalar(status, "task_id")
    authorization_head = yaml_scalar(status, "authorization_head")
    contract_digest = yaml_scalar(status, "contract_digest")
    authorized_at = yaml_scalar(status, "execution_authorized_at")
    authorization = sections["Execution authorization"].strip()
    safe_record_task_id = task_id if task_id and TASK_ID_RE.fullmatch(task_id) else task_dir.name
    if not TASK_ID_RE.fullmatch(safe_record_task_id):
        safe_record_task_id = "invalid-task-id"
    record_path = authorization_record_path(repo, safe_record_task_id)
    if phase == "pre-go":
        if state != "DISCUSSING":
            errors.append("Pre-go validation requires status state DISCUSSING.")
        if authorization_head not in {None, "null", ""}:
            errors.append("Pre-go validation requires authorization_head: null.")
        if contract_digest not in {None, "null", ""}:
            errors.append("Pre-go validation requires contract_digest: null.")
        if authorized_at not in {"null", ""}:
            errors.append("Pre-go validation requires execution_authorized_at: null.")
        if authorization != "PENDING":
            errors.append("Pre-go validation requires ## Execution authorization to be exactly PENDING.")
        if record_path.exists():
            errors.append(f"Pre-go validation found a stale external authorization record: {record_path}.")
    else:
        record: dict[str, object] | None = None
        try:
            loaded = json.loads(record_path.read_text(encoding="utf-8"))
            if not isinstance(loaded, dict):
                raise ValueError("record is not an object")
            record = loaded
        except (OSError, ValueError, json.JSONDecodeError) as error:
            errors.append(f"Execution validation requires a valid external authorization record at {record_path}: {error}.")
        if record is not None:
            expected_record = {
                "version": 1,
                "repository": str(repo),
                "taskId": task_id,
                "authorizationHead": authorization_head,
                "contractDigest": contract_digest,
                "authorizedAt": authorized_at,
            }
            for key, expected in expected_record.items():
                if record.get(key) != expected:
                    errors.append(f"External authorization record {key} does not match status.yaml.")
        if state not in {"EXECUTING", "REVIEWING", "VERIFYING", "BLOCKED"}:
            errors.append("Execution validation requires state EXECUTING, REVIEWING, VERIFYING, or BLOCKED.")
        if not authorization_head or not re.fullmatch(r"[0-9a-f]{40}", authorization_head):
            errors.append("Execution validation requires a full authorization_head commit SHA.")
        else:
            snapshot_exists = run_git(repo, "cat-file", "-e", f"{authorization_head}^{{commit}}")
            if snapshot_exists.returncode != 0:
                errors.append(f"Authorization head does not exist: {authorization_head}.")
            head = run_git(repo, "rev-parse", "HEAD")
            if head.returncode != 0 or head.stdout.strip() != authorization_head:
                errors.append("HEAD must equal the authorization head during execution.")
        if not contract_digest or not re.fullmatch(r"[0-9a-f]{64}", contract_digest):
            errors.append("Execution validation requires a SHA-256 contract_digest.")
        elif hashlib.sha256(brief_bytes).hexdigest() != contract_digest:
            errors.append("Goal Contract digest changed after owner authorization.")
        if authorized_at in {None, "null", ""}:
            errors.append("Execution validation requires a recorded execution_authorized_at timestamp.")
        authorization_match = EXECUTION_AUTHORIZATION_RE.fullmatch(authorization)
        if authorization_match is None:
            errors.append(
                "Execution authorization must be exactly "
                "'AUTHORIZED at <timestamp> by owner message `go`' or "
                "'AUTHORIZED at <timestamp> by owner command `/team-enqueue`'."
            )
        elif authorized_at and authorization_match.group("timestamp") != authorized_at:
            errors.append("brief.md authorization timestamp does not match status.yaml.")

    if not task_id or not TASK_ID_RE.fullmatch(task_id) or task_id == "REPLACE_ME" or task_id != task_dir.name:
        errors.append("status.yaml task_id must be valid and equal the task directory name.")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a three-agent-team Goal Contract.")
    parser.add_argument("task_dir", help="team/tasks/<task-id> directory")
    parser.add_argument("--phase", choices=("pre-go", "execution"), default="pre-go")
    args = parser.parse_args()

    errors = validate(Path(args.task_dir), args.phase)
    if errors:
        print(f"Goal Contract validation FAILED ({len(errors)} error(s)):", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"Goal Contract validation PASSED ({args.phase}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
