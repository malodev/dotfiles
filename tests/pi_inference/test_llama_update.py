from __future__ import annotations

import argparse
import importlib.util
import io
import json
import os
import stat
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).parents[2] / "pi-inference-host/.local/lib/pi_inference_host/llama_update.py"
SPEC = importlib.util.spec_from_file_location("pi_inference_host.llama_update", MODULE)
llama_update = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = llama_update
assert SPEC.loader
SPEC.loader.exec_module(llama_update)


class FakeRunner:
    def __init__(self, status: dict | None = None, unit: str = "", fail_on: tuple[str, ...] | None = None):
        self.status = status or {
            "mode": "stop",
            "lease": None,
            "services": {"router": "inactive", "studio": "inactive"},
        }
        self.unit = unit
        self.fail_on = fail_on
        self.calls: list[list[str]] = []

    def run(self, argv, *, env=None, capture=True):
        command = [str(item) for item in argv]
        self.calls.append(command)
        if self.fail_on and tuple(command[: len(self.fail_on)]) == self.fail_on:
            raise llama_update.UpdateError(f"injected failure: {' '.join(command)}")
        if Path(command[0]).name == "llama-server":
            return llama_update.CommandRunner().run(command, env=env, capture=capture)
        if command[:3] == ["pi-inference", "--json", "status"]:
            output = json.dumps(self.status)
        elif command[:3] == ["systemctl", "--user", "show"]:
            output = self.unit
        else:
            output = "{}"
        return type("Result", (), {"stdout": output})()


def make_runtime(root: Path, version: int = 10107, commit: str = "857c97607") -> Path:
    binary_dir = root / "bin"
    binary_dir.mkdir(parents=True)
    options = " ".join(llama_update.REQUIRED_SERVER_OPTIONS)
    script = binary_dir / "llama-server"
    script.write_text(
        "#!/bin/sh\n"
        "case \"$1\" in\n"
        f"  --version) echo 'version: {version} ({commit})' ;;\n"
        f"  --help) echo '{options}' ;;\n"
        "  --list-devices) echo 'ROCm0: AMD Radeon AI PRO R9700' ;;\n"
        "  *) exit 2 ;;\n"
        "esac\n",
        encoding="utf-8",
    )
    script.chmod(0o755)
    (binary_dir / "libllama-server-impl.so").write_bytes(b"test-library")
    manifest = llama_update.build_manifest(root)
    (root / "MANIFEST.json").write_text(json.dumps(manifest, separators=(",", ":"), sort_keys=True) + "\n")
    return root


def writable_tree(root: Path) -> None:
    if not root.exists():
        return
    for path in root.rglob("*"):
        if not path.is_symlink():
            path.chmod(stat.S_IMODE(path.stat().st_mode) | stat.S_IWUSR | (stat.S_IXUSR if path.is_dir() else 0))
    root.chmod(0o700)


class LlamaUpdateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pi-llama-update-")
        self.root = Path(self.temp.name)

    def tearDown(self):
        writable_tree(self.root)
        self.temp.cleanup()

    def test_inspect_runtime_requires_router_options_and_rocm_r9700(self):
        source = make_runtime(self.root / "source")
        info = llama_update.inspect_runtime(source, llama_update.CommandRunner())
        self.assertEqual(info.version, 10107)
        self.assertEqual(info.commit, "857c97607")

        binary = source / "bin/llama-server"
        binary.write_text(
            "#!/bin/sh\n"
            "[ \"$1\" = --version ] && echo 'version: 1 (abcdef0)' && exit\n"
            "[ \"$1\" = --help ] && echo '--models-preset' && exit\n"
            "[ \"$1\" = --list-devices ] && echo 'CPU' && exit\n",
            encoding="utf-8",
        )
        binary.chmod(0o755)
        with self.assertRaisesRegex(llama_update.UpdateError, "lacks required router options"):
            llama_update.inspect_runtime(source, llama_update.CommandRunner())

    def test_manifest_rejects_escaping_symlink(self):
        source = make_runtime(self.root / "source")
        (source / "escape").symlink_to("/etc/passwd")
        with self.assertRaisesRegex(llama_update.UpdateError, "escaping or broken symlink"):
            llama_update.build_manifest(source)

    def test_install_is_coherent_immutable_and_switch_is_atomic(self):
        source = make_runtime(self.root / "source")
        runtime_root = self.root / "runtimes"
        info = llama_update.inspect_runtime(source, llama_update.CommandRunner())
        manifest = llama_update.build_manifest(source)
        target = runtime_root / info.commit
        llama_update.install_candidate(source, target, info, manifest)

        self.assertTrue((target / "VERSION").is_file())
        self.assertTrue((target / "SHA256SUMS").is_file())
        self.assertTrue((target / "MANIFEST.json").is_file())
        self.assertIn("source commit: 857c97607", (target / "VERSION").read_text())
        self.assertFalse(stat.S_IMODE(target.stat().st_mode) & stat.S_IWUSR)
        llama_update.switch_current(runtime_root, target)
        self.assertEqual((runtime_root / "current").resolve(), target)

        previous = make_runtime(runtime_root / "87d9271bd", 10068, "87d9271bd")
        llama_update.switch_current(runtime_root, previous)
        self.assertEqual((runtime_root / "current").resolve(), previous)
        self.assertTrue(target.is_dir())

    def test_selector_and_installed_target_reject_escape_or_commit_mismatch(self):
        runtime_root = self.root / "runtimes"
        runtime_root.mkdir()
        (runtime_root / "current").symlink_to("/tmp")
        with self.assertRaisesRegex(llama_update.UpdateError, "one commit-named child"):
            llama_update.resolve_current(runtime_root)
        (runtime_root / "current").unlink()
        target = make_runtime(runtime_root / "aaaaaaaa", 1, "bbbbbbb")
        with self.assertRaisesRegex(llama_update.UpdateError, "contains commit"):
            llama_update.validate_installed_target(runtime_root, target, llama_update.CommandRunner())

    def test_installed_manifest_detects_tampering(self):
        runtime_root = self.root / "runtimes"
        target = make_runtime(runtime_root / "857c97607")
        (target / "bin/libllama-server-impl.so").write_bytes(b"tampered")
        with self.assertRaisesRegex(llama_update.UpdateError, "failed manifest verification"):
            llama_update.validate_installed_target(runtime_root, target, llama_update.CommandRunner())

    def test_source_and_runtime_root_cannot_overlap(self):
        source = make_runtime(self.root / "source")
        args = argparse.Namespace(
            source=source,
            root=source / "runtimes",
            service="pi-llama-router.service",
            health_url="http://127.0.0.1/health",
            health_timeout=1,
            apply=False,
        )
        with self.assertRaisesRegex(llama_update.UpdateError, "must not contain one another"):
            llama_update.promote(args, FakeRunner())

    def test_dry_run_does_not_copy_or_switch(self):
        source = make_runtime(self.root / "source")
        runtime_root = self.root / "runtimes"
        runner = FakeRunner()
        args = argparse.Namespace(
            source=source,
            root=runtime_root,
            service="pi-llama-router.service",
            health_url="http://127.0.0.1/health",
            health_timeout=1,
            apply=False,
        )
        output = io.StringIO()
        with redirect_stdout(output):
            llama_update.promote(args, runner)
        self.assertIn("Dry run", output.getvalue())
        self.assertFalse((runtime_root / "857c97607").exists())
        self.assertFalse((runtime_root / "current").exists())

    def test_active_lease_blocks_apply_before_mutation(self):
        source = make_runtime(self.root / "source")
        runtime_root = self.root / "runtimes"
        runner = FakeRunner(
            {
                "mode": "team",
                "lease": {"owner": "builder"},
                "services": {"router": "active", "studio": "inactive"},
            }
        )
        args = argparse.Namespace(
            source=source,
            root=runtime_root,
            service="pi-llama-router.service",
            health_url="http://127.0.0.1/health",
            health_timeout=1,
            apply=True,
        )
        with self.assertRaisesRegex(llama_update.UpdateError, "lease is active"):
            llama_update.promote(args, runner)
        self.assertFalse((runtime_root / "857c97607").exists())

    def test_transaction_fences_clients_and_restores_mode(self):
        runtime_root = self.root / "runtimes"
        previous = make_runtime(runtime_root / "87d9271bd", 10068, "87d9271bd")
        target = make_runtime(runtime_root / "857c97607", 10107, "857c97607")
        llama_update.switch_current(runtime_root, previous)
        runner = FakeRunner()
        with patch.object(llama_update, "wait_for_health") as health, patch.object(
            llama_update, "verify_running_target"
        ):
            llama_update.transactional_switch(
                root=runtime_root,
                target=target,
                previous=previous,
                restore="studio",
                service="pi-llama-router.service",
                health_url="http://health",
                health_timeout=1,
                runner=runner,
            )
        self.assertEqual((runtime_root / "current").resolve(), target)
        commands = [" ".join(call) for call in runner.calls]
        self.assertIn("pi-inference --json acquire", commands[0])
        self.assertTrue(any("pi-inference --json renew" in command for command in commands))
        self.assertTrue(any("pi-inference --json release" in command for command in commands))
        self.assertIn("pi-inference --json release", commands[-1])
        self.assertIn("--restore-mode studio", commands[-1])
        health.assert_called_once()

    def test_health_failure_rolls_back_then_restores_mode(self):
        runtime_root = self.root / "runtimes"
        previous = make_runtime(runtime_root / "87d9271bd", 10068, "87d9271bd")
        target = make_runtime(runtime_root / "857c97607", 10107, "857c97607")
        llama_update.switch_current(runtime_root, previous)
        runner = FakeRunner()
        with patch.object(
            llama_update,
            "wait_for_health",
            side_effect=[llama_update.UpdateError("new runtime unhealthy"), None],
        ), patch.object(llama_update, "verify_running_target"):
            with self.assertRaisesRegex(llama_update.UpdateError, "new runtime unhealthy"):
                llama_update.transactional_switch(
                    root=runtime_root,
                    target=target,
                    previous=previous,
                    restore="team",
                    service="pi-llama-router.service",
                    health_url="http://health",
                    health_timeout=1,
                    runner=runner,
                )
        self.assertEqual((runtime_root / "current").resolve(), previous)
        self.assertIn("pi-inference --json release", " ".join(runner.calls[-1]))
        self.assertIn("--restore-mode team", " ".join(runner.calls[-1]))

    def test_failed_lease_acquisition_does_not_touch_service_or_selector(self):
        runtime_root = self.root / "runtimes"
        previous = make_runtime(runtime_root / "87d9271bd", 10068, "87d9271bd")
        target = make_runtime(runtime_root / "857c97607", 10107, "857c97607")
        llama_update.switch_current(runtime_root, previous)
        runner = FakeRunner(fail_on=("pi-inference", "--json", "acquire"))
        with self.assertRaisesRegex(llama_update.UpdateError, "injected failure"):
            llama_update.transactional_switch(
                root=runtime_root,
                target=target,
                previous=previous,
                restore="team",
                service="pi-llama-router.service",
                health_url="http://health",
                health_timeout=1,
                runner=runner,
            )
        self.assertEqual((runtime_root / "current").resolve(), previous)
        self.assertFalse(any(call[:3] == ["systemctl", "--user", "stop"] for call in runner.calls))

    def test_failed_recovery_retains_maintenance_lease_fence(self):
        runtime_root = self.root / "runtimes"
        previous = make_runtime(runtime_root / "87d9271bd", 10068, "87d9271bd")
        target = make_runtime(runtime_root / "857c97607", 10107, "857c97607")
        llama_update.switch_current(runtime_root, previous)
        runner = FakeRunner(fail_on=("systemctl", "--user", "stop"))
        with self.assertRaisesRegex(llama_update.UpdateError, "maintenance lease retained for safety"):
            llama_update.transactional_switch(
                root=runtime_root,
                target=target,
                previous=previous,
                restore="team",
                service="pi-llama-router.service",
                health_url="http://health",
                health_timeout=1,
                runner=runner,
            )
        commands = [" ".join(call) for call in runner.calls]
        self.assertTrue(any("pi-inference --json acquire --mode maintenance" in command for command in commands))
        self.assertFalse(any("pi-inference --json release" in command for command in commands))

    def test_manager_status_rejects_inconsistent_or_transitional_state(self):
        runner = FakeRunner(
            {
                "mode": "team",
                "lease": None,
                "services": {"router": "activating", "studio": "inactive"},
            }
        )
        with self.assertRaisesRegex(llama_update.UpdateError, "not in a stable"):
            llama_update.manager_status(runner)

    def test_rollback_rejects_path_traversal(self):
        args = argparse.Namespace(
            root=self.root,
            rollback="../../outside",
            apply=False,
            service="pi-llama-router.service",
            health_url="http://127.0.0.1/health",
            health_timeout=1,
        )
        with self.assertRaisesRegex(llama_update.UpdateError, "hexadecimal commit ID"):
            llama_update.rollback(args, FakeRunner())

    def test_service_must_use_effective_stable_selector(self):
        with self.assertRaisesRegex(llama_update.UpdateError, "stable current selector"):
            llama_update.verify_service_uses_selector("pi-llama-router.service", Path.home() / ".local/opt/pi-llama-server", FakeRunner(unit="old path"))
        home = Path.home()
        llama_update.verify_service_uses_selector(
            "pi-llama-router.service",
            home / ".local/opt/pi-llama-server",
            FakeRunner(
                unit=(
                    f"ExecStart={home}/.local/opt/pi-llama-server/current/bin/llama-server\n"
                    f"Environment=LD_LIBRARY_PATH={home}/.local/opt/pi-llama-server/current/bin"
                )
            ),
        )

    def test_local_lock_rejects_second_updater_without_modifying_contents(self):
        lock = self.root / "update.lock"
        lock.write_text("keep me\n")
        lock.chmod(0o600)
        with llama_update.updater_lock(lock):
            with self.assertRaisesRegex(llama_update.UpdateError, "Another pi-llama-update"):
                with llama_update.updater_lock(lock):
                    pass
        self.assertEqual(lock.read_text(), "keep me\n")

    def test_local_lock_refuses_symlink_without_touching_target(self):
        victim = self.root / "victim"
        victim.write_text("valuable\n")
        lock = self.root / "update.lock"
        lock.symlink_to(victim)
        with self.assertRaisesRegex(llama_update.UpdateError, "Cannot safely open updater lock"):
            with llama_update.updater_lock(lock):
                pass
        self.assertEqual(victim.read_text(), "valuable\n")


if __name__ == "__main__":
    unittest.main()
