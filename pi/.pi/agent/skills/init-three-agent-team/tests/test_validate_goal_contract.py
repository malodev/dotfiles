from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


VALIDATOR_PATH = Path(__file__).parents[1] / "assets" / "validate_goal_contract.py"
SPEC = importlib.util.spec_from_file_location("validate_goal_contract", VALIDATOR_PATH)
assert SPEC and SPEC.loader
VALIDATOR = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = VALIDATOR
SPEC.loader.exec_module(VALIDATOR)


class GoalContractRepositoryTest(unittest.TestCase):
    def git(self, repo: Path, *args: str) -> str:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()

    def create_repository(self, root: Path) -> tuple[Path, Path, str]:
        repo = root / "repo"
        task_dir = repo / "team" / "tasks" / "sample"
        task_dir.mkdir(parents=True)
        self.git(repo, "init", "-q")
        self.git(repo, "config", "user.name", "Test User")
        self.git(repo, "config", "user.email", "test@example.invalid")
        (repo / "AGENTS.md").write_text("# Commands\n\n- Test: `python -m unittest`\n", encoding="utf-8")
        self.git(repo, "add", "AGENTS.md")
        self.git(repo, "commit", "-qm", "chore: establish code baseline")
        baseline = self.git(repo, "rev-parse", "HEAD")

        brief = f"""# Goal Contract: sample

## Goal
Verify authorization snapshots.

## Current behavior
The repository has a committed code baseline.

## Agreed approach
Validate committed contract metadata independently from the execution snapshot.

## Success tests
### ST-01: validator passes
- Command: `python -m unittest`
- Expected exit code: `0`
- Expected evidence: all tests pass
- Writes hardware/system state: `no`
- Prerequisites: `none`

## Non-goals
No product changes.

## Relevant files
Validator fixtures only.

## Architectural constraints
Fail closed after authorization drift.

## Verification commands
1. `python -m unittest`

## Baseline commit
{baseline}

## Execution authority
- Repository edits: allowed
- Non-destructive development commands: allowed
- Routine technical decisions inside this contract: allowed
- Hardware/system writes: prohibited
- Allowed hardware/system operations: none
- Commit on success: false
- Push on success: false
- Deploy on success: false

## Open decisions
NONE

## Execution authorization
PENDING
"""
        status = f"""task_id: sample
state: DISCUSSING
baseline_commit: {baseline}
authorization_head: null
contract_digest: null
execution_authorized_at: null
continue_until_complete: true
review_cycle: 0
max_review_cycles: 5
latest_build_report: null
latest_review: null
blocked_reason: null
verified_at: null
completed_at: null
completion_policy:
  commit_on_success: false
  push_on_success: false
  deploy_on_success: false
commit_sha: null
pushed_at: null
deployed_at: null
"""
        (task_dir / "brief.md").write_text(brief, encoding="utf-8")
        (task_dir / "status.yaml").write_text(status, encoding="utf-8")
        self.git(repo, "add", "team/tasks/sample")
        self.git(repo, "commit", "-qm", "chore: record goal contract")
        return repo, task_dir, baseline

    def authorize(
        self,
        repo: Path,
        task_dir: Path,
        owner_source: str = "message `go`",
    ) -> str:
        authorization_head = self.git(repo, "rev-parse", "HEAD")
        stamp = "2026-07-26T00:00:00.000Z"
        brief_path = task_dir / "brief.md"
        brief = brief_path.read_text(encoding="utf-8").replace(
            "## Execution authorization\nPENDING",
            f"## Execution authorization\nAUTHORIZED at {stamp} by owner {owner_source}",
        )
        brief_path.write_text(brief, encoding="utf-8")
        digest = hashlib.sha256(brief_path.read_bytes()).hexdigest()
        status_path = task_dir / "status.yaml"
        status = status_path.read_text(encoding="utf-8")
        status = status.replace("state: DISCUSSING", "state: EXECUTING")
        status = status.replace("authorization_head: null", f"authorization_head: {authorization_head}")
        status = status.replace("contract_digest: null", f"contract_digest: {digest}")
        status = status.replace("execution_authorized_at: null", f"execution_authorized_at: {stamp}")
        status_path.write_text(status, encoding="utf-8")
        record_path = VALIDATOR.authorization_record_path(repo.resolve(), "sample")
        record_path.parent.mkdir(parents=True, exist_ok=True)
        record_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "repository": str(repo.resolve()),
                    "taskId": "sample",
                    "authorizationHead": authorization_head,
                    "contractDigest": digest,
                    "authorizedAt": stamp,
                }
            )
            + "\n",
            encoding="utf-8",
        )
        return authorization_head

    def test_environment_cannot_redirect_production_authorization_root(self) -> None:
        expected = VALIDATOR.STATE_ROOT
        with patch.dict(
            os.environ,
            {
                "HOME": "/tmp/attacker-home",
                "XDG_STATE_HOME": "/tmp/attacker-state",
                "PI_THREE_AGENT_STATE_DIR": "/tmp/attacker-override",
            },
        ):
            self.assertEqual(VALIDATOR.STATE_ROOT, expected)
            self.assertTrue(VALIDATOR.authorization_record_path(Path("/tmp/repo"), "sample").is_relative_to(expected))

    def test_pre_go_allows_committed_contract_after_baseline(self) -> None:
        with tempfile.TemporaryDirectory(prefix="three-agent-validator-") as directory:
            with patch.object(VALIDATOR, "STATE_ROOT", Path(directory) / "state"):
                _repo, task_dir, _baseline = self.create_repository(Path(directory))
                self.assertEqual(VALIDATOR.validate(task_dir, "pre-go"), [])

    def test_invalid_status_task_id_cannot_escape_authorization_directory(self) -> None:
        with tempfile.TemporaryDirectory(prefix="three-agent-validator-") as directory:
            state_root = Path(directory) / "state"
            with patch.object(VALIDATOR, "STATE_ROOT", state_root):
                _repo, task_dir, _baseline = self.create_repository(Path(directory))
                status_path = task_dir / "status.yaml"
                status_path.write_text(
                    status_path.read_text(encoding="utf-8").replace("task_id: sample", "task_id: ../escape"),
                    encoding="utf-8",
                )
                errors = VALIDATOR.validate(task_dir, "pre-go")
                self.assertTrue(any("task_id" in error for error in errors))
                self.assertFalse((state_root / "escape.json").exists())

    def test_pre_go_rejects_stale_external_authorization_record(self) -> None:
        with tempfile.TemporaryDirectory(prefix="three-agent-validator-") as directory:
            with patch.object(VALIDATOR, "STATE_ROOT", Path(directory) / "state"):
                repo, task_dir, _baseline = self.create_repository(Path(directory))
                record_path = VALIDATOR.authorization_record_path(repo.resolve(), "sample")
                record_path.parent.mkdir(parents=True, exist_ok=True)
                record_path.write_text("{}\n", encoding="utf-8")

                errors = VALIDATOR.validate(task_dir, "pre-go")
                self.assertTrue(any("stale external authorization record" in error for error in errors))

    def test_execution_accepts_immediate_go_authorization_marker(self) -> None:
        with tempfile.TemporaryDirectory(prefix="three-agent-validator-") as directory:
            with patch.object(VALIDATOR, "STATE_ROOT", Path(directory) / "state"):
                repo, task_dir, _baseline = self.create_repository(Path(directory))
                self.authorize(repo, task_dir)
                self.assertEqual(VALIDATOR.validate(task_dir, "execution"), [])

    def test_execution_accepts_exact_team_enqueue_authorization_marker(self) -> None:
        with tempfile.TemporaryDirectory(prefix="three-agent-validator-") as directory:
            with patch.object(VALIDATOR, "STATE_ROOT", Path(directory) / "state"):
                repo, task_dir, _baseline = self.create_repository(Path(directory))
                self.authorize(repo, task_dir, "command `/team-enqueue`")
                self.assertEqual(VALIDATOR.validate(task_dir, "execution"), [])

    def test_execution_accepts_authorized_queue_blocker_without_executing(self) -> None:
        with tempfile.TemporaryDirectory(prefix="three-agent-validator-") as directory:
            with patch.object(VALIDATOR, "STATE_ROOT", Path(directory) / "state"):
                repo, task_dir, _baseline = self.create_repository(Path(directory))
                self.authorize(repo, task_dir, "command `/team-enqueue`")
                status_path = task_dir / "status.yaml"
                status_path.write_text(
                    status_path.read_text(encoding="utf-8").replace("state: EXECUTING", "state: BLOCKED"),
                    encoding="utf-8",
                )
                self.assertEqual(VALIDATOR.validate(task_dir, "execution"), [])

    def test_execution_rejects_near_miss_team_enqueue_markers(self) -> None:
        invalid_sources = (
            "message `/team-enqueue`",
            "command `team-enqueue`",
            "command `/team-enqueue sample`",
            "command `/team-enqueue` extra",
        )
        for invalid_source in invalid_sources:
            with self.subTest(invalid_source=invalid_source):
                with tempfile.TemporaryDirectory(prefix="three-agent-validator-") as directory:
                    with patch.object(VALIDATOR, "STATE_ROOT", Path(directory) / "state"):
                        repo, task_dir, _baseline = self.create_repository(Path(directory))
                        self.authorize(repo, task_dir, invalid_source)
                        errors = VALIDATOR.validate(task_dir, "execution")
                        self.assertTrue(any("must be exactly" in error for error in errors))

    def test_execution_rejects_partial_queued_authorization(self) -> None:
        with tempfile.TemporaryDirectory(prefix="three-agent-validator-") as directory:
            with patch.object(VALIDATOR, "STATE_ROOT", Path(directory) / "state"):
                repo, task_dir, _baseline = self.create_repository(Path(directory))
                stamp = "2026-07-26T00:00:00.000Z"
                brief_path = task_dir / "brief.md"
                brief_path.write_text(
                    brief_path.read_text(encoding="utf-8").replace(
                        "## Execution authorization\nPENDING",
                        f"## Execution authorization\nAUTHORIZED at {stamp} by owner command `/team-enqueue`",
                    ),
                    encoding="utf-8",
                )

                errors = VALIDATOR.validate(task_dir, "execution")
                self.assertTrue(any("external authorization record" in error.lower() for error in errors))
                self.assertTrue(any("Execution validation requires state" in error for error in errors))
                self.assertTrue(any("authorization_head" in error for error in errors))
                self.assertTrue(any("contract_digest" in error for error in errors))
                self.assertTrue(any("execution_authorized_at" in error for error in errors))

    def test_execution_rejects_missing_or_conflicting_external_record(self) -> None:
        with tempfile.TemporaryDirectory(prefix="three-agent-validator-") as directory:
            with patch.object(VALIDATOR, "STATE_ROOT", Path(directory) / "state"):
                repo, task_dir, _baseline = self.create_repository(Path(directory))
                self.authorize(repo, task_dir, "command `/team-enqueue`")
                record_path = VALIDATOR.authorization_record_path(repo.resolve(), "sample")
                record = json.loads(record_path.read_text(encoding="utf-8"))

                record_path.unlink()
                errors = VALIDATOR.validate(task_dir, "execution")
                self.assertTrue(any("requires a valid external authorization record" in error for error in errors))

                record["contractDigest"] = "f" * 64
                record_path.write_text(json.dumps(record) + "\n", encoding="utf-8")
                errors = VALIDATOR.validate(task_dir, "execution")
                self.assertTrue(any("contractDigest does not match" in error for error in errors))

    def test_execution_snapshot_rejects_contract_and_head_drift(self) -> None:
        with tempfile.TemporaryDirectory(prefix="three-agent-validator-") as directory:
            with patch.object(VALIDATOR, "STATE_ROOT", Path(directory) / "state"):
                repo, task_dir, _baseline = self.create_repository(Path(directory))
                authorization_head = self.authorize(repo, task_dir)
                self.assertEqual(VALIDATOR.validate(task_dir, "execution"), [])

                status_path = task_dir / "status.yaml"
                original_status = status_path.read_text(encoding="utf-8")
                status_path.write_text(original_status.replace(authorization_head, "3" * 40), encoding="utf-8")
                self.assertTrue(any("external authorization record" in error.lower() for error in VALIDATOR.validate(task_dir, "execution")))
                status_path.write_text(original_status, encoding="utf-8")

                brief_path = task_dir / "brief.md"
                original = brief_path.read_text(encoding="utf-8")
                brief_path.write_text(original.replace("No product changes.", "Changed after authorization."), encoding="utf-8")
                self.assertTrue(any("digest" in error.lower() for error in VALIDATOR.validate(task_dir, "execution")))
                brief_path.write_text(original, encoding="utf-8")

                (repo / "unrelated.txt").write_text("head drift\n", encoding="utf-8")
                self.git(repo, "add", "unrelated.txt")
                self.git(repo, "commit", "-qm", "chore: advance head")
                self.assertTrue(any("authorization head" in error.lower() for error in VALIDATOR.validate(task_dir, "execution")))


if __name__ == "__main__":
    unittest.main()
