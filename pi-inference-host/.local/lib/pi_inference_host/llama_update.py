#!/usr/bin/env python3
"""Safely promote Unsloth's llama.cpp build into the pinned Pi router runtime."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional, Sequence

DEFAULT_SOURCE = Path.home() / ".unsloth/llama.cpp/build"
DEFAULT_ROOT = Path.home() / ".local/opt/pi-llama-server"
DEFAULT_LOCK = Path.home() / ".local/state/pi-llama-update/update.lock"
DEFAULT_SERVICE = "pi-llama-router.service"
DEFAULT_HEALTH_URL = "http://127.0.0.1:46757/health"
LEASE_TTL_SECONDS = 3600
REQUIRED_SERVER_OPTIONS = (
    "--api-key-file",
    "--models-autoload",
    "--models-max",
    "--models-preset",
    "--no-agent",
    "--no-webui",
    "--sse-ping-interval",
    "--timeout",
)
VERSION_PATTERN = re.compile(r"version:\s*(\d+)\s*\(([0-9a-f]{7,40})\)", re.IGNORECASE)
COMMIT_PATTERN = re.compile(r"[0-9a-f]{7,40}", re.IGNORECASE)
MANIFEST_EXCLUDES = frozenset({"VERSION", "SHA256SUMS", "MANIFEST.json"})


class UpdateError(RuntimeError):
    pass


@dataclass(frozen=True)
class RuntimeInfo:
    root: Path
    version: int
    commit: str
    version_output: str

    @property
    def binary(self) -> Path:
        return self.root / "bin/llama-server"


@dataclass(frozen=True)
class ManagerStatus:
    mode: str
    restore_mode: str
    lease: object | None


class CommandRunner:
    def run(
        self,
        argv: Sequence[str | Path],
        *,
        env: Optional[dict[str, str]] = None,
        capture: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(
                [str(item) for item in argv],
                check=True,
                text=True,
                stdout=subprocess.PIPE if capture else None,
                stderr=subprocess.STDOUT if capture else None,
                env=env,
                timeout=300,
            )
        except FileNotFoundError as exc:
            raise UpdateError(f"Required command is unavailable: {argv[0]}") from exc
        except subprocess.TimeoutExpired as exc:
            raise UpdateError(f"Command timed out after 300 seconds: {' '.join(map(str, argv))}") from exc
        except subprocess.CalledProcessError as exc:
            detail = (exc.stdout or "").strip()
            suffix = f": {detail}" if detail else ""
            raise UpdateError(f"Command failed: {' '.join(map(str, argv))}{suffix}") from exc


def runtime_environment(root: Path) -> dict[str, str]:
    return {**os.environ, "LD_LIBRARY_PATH": str(root / "bin")}


def inspect_runtime(root: Path, runner: CommandRunner, *, full: bool = True) -> RuntimeInfo:
    binary = root / "bin/llama-server"
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise UpdateError(f"llama-server is missing or not executable: {binary}")

    result = runner.run([binary, "--version"], env=runtime_environment(root))
    match = VERSION_PATTERN.search(result.stdout)
    if match is None:
        raise UpdateError(f"Could not parse llama.cpp version from {binary}: {result.stdout.strip()!r}")
    info = RuntimeInfo(root, int(match.group(1)), match.group(2).lower(), result.stdout.strip())

    if full:
        help_output = runner.run([binary, "--help"], env=runtime_environment(root)).stdout
        missing = [option for option in REQUIRED_SERVER_OPTIONS if option not in help_output]
        if missing:
            raise UpdateError(f"Candidate runtime lacks required router options: {', '.join(missing)}")
        devices = runner.run([binary, "--list-devices"], env=runtime_environment(root)).stdout
        if "ROCm" not in devices or "R9700" not in devices:
            raise UpdateError(f"Candidate runtime does not expose the R9700 through ROCm: {devices.strip()}")
    return info


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_symlinks(root: Path) -> None:
    resolved_root = root.resolve()
    for path in root.rglob("*"):
        if not path.is_symlink():
            continue
        try:
            destination = path.resolve(strict=True)
            destination.relative_to(resolved_root)
        except (OSError, ValueError) as exc:
            raise UpdateError(f"Runtime contains an escaping or broken symlink: {path} -> {os.readlink(path)}") from exc


def build_manifest(root: Path) -> dict[str, dict[str, str | int]]:
    validate_symlinks(root)
    manifest: dict[str, dict[str, str | int]] = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if relative in MANIFEST_EXCLUDES:
            continue
        if path.is_symlink():
            manifest[relative] = {"type": "symlink", "target": os.readlink(path)}
        elif path.is_dir():
            continue
        elif path.is_file():
            manifest[relative] = {
                "type": "file",
                "size": path.stat().st_size,
                "sha256": sha256(path),
                "executable": bool(stat.S_IMODE(path.stat().st_mode) & 0o111),
            }
        else:
            raise UpdateError(f"Runtime contains an unsupported filesystem entry: {path}")
    return manifest


def manifest_size(manifest: dict[str, dict[str, str | int]]) -> int:
    return sum(int(entry.get("size", 0)) for entry in manifest.values())


def write_metadata(target: Path, info: RuntimeInfo, source: Path, manifest: dict[str, dict[str, str | int]]) -> None:
    version_lines = [
        f"llama.cpp version: {info.version}",
        f"source commit: {info.commit}",
        "built by: Unsloth team",
        f"promoted on: {datetime.now(timezone.utc).isoformat()}",
        f"source: {source}",
    ]
    (target / "VERSION").write_text("\n".join(version_lines) + "\n", encoding="utf-8")
    checksum_lines = [
        f"{entry['sha256']}  {relative}"
        for relative, entry in sorted(manifest.items())
        if entry["type"] == "file"
    ]
    (target / "SHA256SUMS").write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")
    (target / "MANIFEST.json").write_text(
        json.dumps(manifest, separators=(",", ":"), sort_keys=True) + "\n",
        encoding="utf-8",
    )


def fsync_tree(root: Path) -> None:
    for path in root.rglob("*"):
        if path.is_file() and not path.is_symlink():
            with path.open("rb") as stream:
                os.fsync(stream.fileno())
    for path in sorted((item for item in root.rglob("*") if item.is_dir()), reverse=True):
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def make_immutable_to_user(root: Path) -> None:
    for path in root.rglob("*"):
        if path.is_symlink():
            continue
        mode = stat.S_IMODE(path.stat().st_mode)
        if path.is_dir():
            path.chmod(0o555)
        elif mode & 0o111:
            path.chmod(0o555)
        else:
            path.chmod(0o444)
    root.chmod(0o555)


def install_candidate(
    source: Path,
    target: Path,
    info: RuntimeInfo,
    source_manifest: dict[str, dict[str, str | int]],
) -> None:
    if target.exists() or target.is_symlink():
        raise UpdateError(f"Candidate destination already exists: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    required = manifest_size(source_manifest)
    available = shutil.disk_usage(target.parent).free
    reserve = 1024**3
    if available < required + reserve:
        raise UpdateError(
            f"Insufficient free space: need at least {(required + reserve) / 1024**3:.1f} GiB, "
            f"have {available / 1024**3:.1f} GiB"
        )

    staging = target.parent / f".{target.name}.staging-{uuid.uuid4().hex}"
    try:
        shutil.copytree(source, staging, symlinks=True)
        copied_manifest = build_manifest(staging)
        if build_manifest(source) != source_manifest or copied_manifest != source_manifest:
            raise UpdateError("Unsloth runtime changed while it was being copied; update Studio first, then retry")
        copied = inspect_runtime(staging, CommandRunner(), full=True)
        if (copied.version, copied.commit) != (info.version, info.commit):
            raise UpdateError("Copied runtime identity differs from the validated source")
        write_metadata(staging, copied, source, copied_manifest)
        fsync_tree(staging)
        make_immutable_to_user(staging)
        staging.rename(target)
        fsync_directory(target.parent)
    except Exception:
        if staging.exists():
            failed = target.parent / f".{target.name}.failed-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
            staging.rename(failed)
            print(f"Incomplete candidate retained for inspection: {failed}", file=sys.stderr)
        raise


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def verify_persisted_manifest(target: Path) -> None:
    manifest_path = target / "MANIFEST.json"
    try:
        expected = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise UpdateError(f"Installed runtime lacks a valid manifest: {manifest_path}") from exc
    if not isinstance(expected, dict) or build_manifest(target) != expected:
        raise UpdateError(f"Installed runtime failed manifest verification: {target}")


def validate_installed_target(root: Path, target: Path, runner: CommandRunner, *, full: bool = True) -> RuntimeInfo:
    resolved_root = root.resolve()
    resolved_target = target.resolve()
    if target.is_symlink() or not target.is_dir() or resolved_target.parent != resolved_root:
        raise UpdateError(f"Runtime must be a non-symlink direct child of {root}: {target}")
    if COMMIT_PATTERN.fullmatch(target.name) is None:
        raise UpdateError(f"Runtime directory is not named by a commit ID: {target}")
    validate_symlinks(target)
    verify_persisted_manifest(target)
    info = inspect_runtime(target, runner, full=full)
    if info.commit != target.name.lower():
        raise UpdateError(f"Runtime directory {target.name} contains commit {info.commit}")
    return info


def resolve_current(root: Path) -> Optional[Path]:
    current = root / "current"
    if not current.is_symlink():
        if current.exists():
            raise UpdateError(f"Runtime selector must be a symlink: {current}")
        return None
    raw = Path(os.readlink(current))
    if raw.is_absolute() or len(raw.parts) != 1 or COMMIT_PATTERN.fullmatch(raw.name) is None:
        raise UpdateError(f"Runtime selector must point to one commit-named child of {root}: {current} -> {raw}")
    target = root / raw
    if target.is_symlink() or not target.is_dir():
        raise UpdateError(f"Runtime selector target is invalid: {target}")
    return target


def switch_current(root: Path, target: Path) -> None:
    validate_installed_target(root, target, CommandRunner(), full=False)
    current = root / "current"
    temporary = root / f".current-{os.getpid()}-{uuid.uuid4().hex}"
    temporary.symlink_to(target.name, target_is_directory=True)
    os.replace(temporary, current)
    fsync_directory(root)


@contextmanager
def updater_lock(path: Path) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        descriptor = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    except OSError as exc:
        raise UpdateError(f"Cannot safely open updater lock {path}: {exc}") from exc
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) & 0o077:
            raise UpdateError(f"Updater lock must be a private regular non-symlink file: {path}")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise UpdateError(f"Another pi-llama-update process holds {path}") from exc
        yield
    finally:
        os.close(descriptor)


def manager_status(runner: CommandRunner) -> ManagerStatus:
    output = runner.run(["pi-inference", "--json", "status"]).stdout
    try:
        status = json.loads(output)
    except json.JSONDecodeError as exc:
        raise UpdateError(f"pi-inference returned invalid status JSON: {output!r}") from exc
    services = status.get("services", {})
    router = services.get("router")
    studio = services.get("studio")
    mode = status.get("mode")
    expected = {
        ("active", "inactive"): "team",
        ("inactive", "active"): "studio",
        ("inactive", "inactive"): "stop",
    }.get((router, studio))
    if expected is None or mode != expected:
        raise UpdateError(f"Inference manager is not in a stable, consistent state: {status}")
    return ManagerStatus(str(mode), expected, status.get("lease"))


def verify_service_uses_selector(service: str, root: Path, runner: CommandRunner) -> None:
    properties = runner.run(
        ["systemctl", "--user", "show", service, "--property=ExecStart", "--property=Environment"]
    ).stdout
    binary = str(root / "current/bin/llama-server")
    library = f"LD_LIBRARY_PATH={root / 'current/bin'}"
    if binary not in properties or library not in properties:
        raise UpdateError(
            f"{service} effective configuration does not use the stable current selector; "
            "deploy the pi-inference-host Stow package and run systemctl --user daemon-reload"
        )


def acquire_maintenance_lease(owner: str, restore_mode: str, runner: CommandRunner) -> None:
    runner.run(
        [
            "pi-inference",
            "--json",
            "acquire",
            "--mode",
            "maintenance",
            "--owner",
            owner,
            "--expected-restore-mode",
            restore_mode,
            "--ttl",
            str(LEASE_TTL_SECONDS),
        ]
    )


def renew_maintenance_lease(owner: str, runner: CommandRunner) -> None:
    runner.run(
        [
            "pi-inference",
            "--json",
            "renew",
            "--owner",
            owner,
            "--ttl",
            str(LEASE_TTL_SECONDS),
        ]
    )


def release_maintenance_lease(owner: str, restore_mode: str, runner: CommandRunner) -> None:
    runner.run(
        [
            "pi-inference",
            "--json",
            "release",
            "--owner",
            owner,
            "--restore-mode",
            restore_mode,
        ]
    )


class LeaseHeartbeat:
    def __init__(self, owner: str, interval: float = 60.0):
        self.owner = owner
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, name="pi-llama-update-heartbeat", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        self.thread.join(timeout=self.interval + 5)
        if self.thread.is_alive():
            raise UpdateError("Maintenance lease heartbeat did not stop")

    def _run(self) -> None:
        runner = CommandRunner()
        while not self.stop_event.wait(self.interval):
            try:
                renew_maintenance_lease(self.owner, runner)
            except Exception as exc:
                print(f"Warning: maintenance lease heartbeat failed and will retry: {exc}", file=sys.stderr)


def wait_for_health(url: str, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    last_error = "no response"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                body = response.read(4096)
                if response.status == 200 and b'"status":"ok"' in body.replace(b" ", b""):
                    return
                last_error = f"HTTP {response.status}: {body!r}"
        except (OSError, urllib.error.URLError) as exc:
            last_error = str(exc)
        time.sleep(0.5)
    raise UpdateError(f"Router health check failed after {timeout:.0f}s: {last_error}")


def verify_running_target(service: str, target: Path, runner: CommandRunner) -> None:
    output = runner.run(
        ["systemctl", "--user", "show", service, "--property=MainPID", "--value"]
    ).stdout.strip()
    try:
        pid = int(output)
    except ValueError as exc:
        raise UpdateError(f"Could not determine {service} MainPID: {output!r}") from exc
    if pid <= 0:
        raise UpdateError(f"{service} has no running process")
    try:
        executable = Path(f"/proc/{pid}/exe").resolve(strict=True)
    except OSError as exc:
        raise UpdateError(f"Could not inspect {service} process {pid}: {exc}") from exc
    expected = (target / "bin/llama-server").resolve(strict=True)
    if executable != expected:
        raise UpdateError(f"{service} runs {executable}, expected {expected}")


def service_stop(service: str, runner: CommandRunner) -> None:
    runner.run(["systemctl", "--user", "stop", service], capture=False)


def service_start(service: str, runner: CommandRunner) -> None:
    runner.run(["systemctl", "--user", "daemon-reload"], capture=False)
    runner.run(["systemctl", "--user", "start", service], capture=False)


def recover_previous(
    root: Path,
    previous: Optional[Path],
    service: str,
    health_url: str,
    health_timeout: float,
    runner: CommandRunner,
) -> None:
    service_stop(service, runner)
    if previous is None:
        current = root / "current"
        if current.is_symlink():
            current.unlink()
            fsync_directory(root)
        return
    switch_current(root, previous)
    service_start(service, runner)
    wait_for_health(health_url, health_timeout)
    verify_running_target(service, previous, runner)


def transactional_switch(
    *,
    root: Path,
    target: Path,
    previous: Optional[Path],
    restore: str,
    service: str,
    health_url: str,
    health_timeout: float,
    runner: CommandRunner,
) -> None:
    owner = f"{socket.gethostname()}:pi-llama-update:{os.getpid()}:{uuid.uuid4().hex[:12]}"
    if not 1 <= health_timeout <= LEASE_TTL_SECONDS - 300:
        raise UpdateError(f"health timeout must be between 1 and {LEASE_TTL_SECONDS - 300} seconds")
    leased = False
    heartbeat: Optional[LeaseHeartbeat] = None
    service_disrupted = False
    update_error: Optional[BaseException] = None
    recovery_errors: list[str] = []
    try:
        acquire_maintenance_lease(owner, restore, runner)
        leased = True
        heartbeat = LeaseHeartbeat(owner)
        heartbeat.start()
        service_disrupted = True
        service_stop(service, runner)
        switch_current(root, target)
        renew_maintenance_lease(owner, runner)
        service_start(service, runner)
        wait_for_health(health_url, health_timeout)
        verify_running_target(service, target, runner)
    except BaseException as exc:
        update_error = exc
        if service_disrupted:
            try:
                recover_previous(root, previous, service, health_url, health_timeout, runner)
            except BaseException as recovery_exc:
                recovery_errors.append(f"runtime recovery failed: {recovery_exc}")
    finally:
        if heartbeat is not None:
            try:
                heartbeat.stop()
            except BaseException as heartbeat_exc:
                recovery_errors.append(f"maintenance lease heartbeat shutdown failed: {heartbeat_exc}")
        if leased and not recovery_errors:
            try:
                renew_maintenance_lease(owner, runner)
                release_maintenance_lease(owner, restore, runner)
            except BaseException as release_exc:
                recovery_errors.append(f"atomic lease release/mode restoration failed: {release_exc}")

    if recovery_errors and leased:
        recovery_errors.append(f"maintenance lease retained for safety (owner={owner}, TTL={LEASE_TTL_SECONDS}s)")
    if update_error is not None or recovery_errors:
        details = [str(update_error)] if update_error is not None else []
        details.extend(recovery_errors)
        raise UpdateError("; ".join(details)) from update_error


def promote(args: argparse.Namespace, runner: CommandRunner) -> None:
    source = args.source.expanduser().resolve()
    root = args.root.expanduser().resolve()
    try:
        source.relative_to(root)
        overlap = True
    except ValueError:
        try:
            root.relative_to(source)
            overlap = True
        except ValueError:
            overlap = False
    if overlap:
        raise UpdateError("Source and immutable runtime root must not contain one another")
    candidate = inspect_runtime(source, runner, full=True)
    source_manifest = build_manifest(source)
    target = root / candidate.commit
    active = resolve_current(root)
    active_info = validate_installed_target(root, active, runner, full=False) if active else None
    status = manager_status(runner)

    print(f"Unsloth candidate: b{candidate.version} ({candidate.commit}) from {source}")
    if active_info:
        print(f"Current Pi runtime: b{active_info.version} ({active_info.commit}) from {active}")
    else:
        print("Current Pi runtime: selector is not initialized")
    print(f"Inference state: mode={status.mode}, restore={status.restore_mode}, lease={'active' if status.lease else 'none'}")

    if active_info and (active_info.version, active_info.commit) == (candidate.version, candidate.commit):
        print("Pi runtime is already current; nothing to do.")
        return
    if not args.apply:
        action = "reuse" if target.exists() else f"copy approximately {manifest_size(source_manifest) / 1024**3:.1f} GiB"
        print(f"Dry run: would {action} at {target}")
        print(f"Dry run: would fence clients, switch {root / 'current'}, test team mode, and restore {status.restore_mode}")
        print("Re-run with --apply to perform the update.")
        return
    if status.lease is not None:
        raise UpdateError("An inference lease is active; wait for it to be released before updating")

    verify_service_uses_selector(args.service, root, runner)
    if target.exists() or target.is_symlink():
        existing = validate_installed_target(root, target, runner, full=True)
        if (existing.version, existing.commit) != (candidate.version, candidate.commit):
            raise UpdateError(f"Existing candidate directory has the wrong runtime identity: {target}")
    else:
        print(f"Installing immutable runtime at {target} ...")
        install_candidate(source, target, candidate, source_manifest)

    status = manager_status(runner)
    if status.lease is not None:
        raise UpdateError("An inference lease became active while the candidate was installed; retry after it is released")
    transactional_switch(
        root=root,
        target=target,
        previous=active,
        restore=status.restore_mode,
        service=args.service,
        health_url=args.health_url,
        health_timeout=args.health_timeout,
        runner=runner,
    )
    print(f"Updated Pi llama.cpp to b{candidate.version} ({candidate.commit}).")
    print(f"Previous immutable runtime retained at: {active or 'none'}")
    print(f"Restored inference mode: {status.restore_mode}")


def rollback(args: argparse.Namespace, runner: CommandRunner) -> None:
    root = args.root.expanduser().resolve()
    if COMMIT_PATTERN.fullmatch(args.rollback) is None:
        raise UpdateError("Rollback target must be a 7-40 character hexadecimal commit ID")
    target = root / args.rollback.lower()
    candidate = validate_installed_target(root, target, runner, full=True)
    status = manager_status(runner)
    active = resolve_current(root)
    if active == target:
        print(f"Pi runtime is already b{candidate.version} ({candidate.commit}); nothing to do.")
        return
    print(f"Rollback target: b{candidate.version} ({candidate.commit}) at {target}")
    print(f"Current target: {active or 'none'}")
    if not args.apply:
        print("Dry run: would fence clients, switch the selector, test team mode, and restore the previous mode.")
        print("Re-run with --apply to perform the rollback.")
        return
    if status.lease is not None:
        raise UpdateError("An inference lease is active; wait for it to be released before rolling back")
    verify_service_uses_selector(args.service, root, runner)
    transactional_switch(
        root=root,
        target=target,
        previous=active,
        restore=status.restore_mode,
        service=args.service,
        health_url=args.health_url,
        health_timeout=args.health_timeout,
        runner=runner,
    )
    print(f"Rolled back Pi llama.cpp to b{candidate.version} ({candidate.commit}); restored mode: {status.restore_mode}")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Promote the current Unsloth llama.cpp build into the pinned Pi router runtime"
    )
    result.add_argument("--apply", action="store_true", help="perform the update; without this flag only preview")
    result.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="Unsloth llama.cpp build directory")
    result.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="immutable Pi runtime root")
    result.add_argument("--lock", type=Path, default=DEFAULT_LOCK, help="local updater lock file")
    result.add_argument("--service", default=DEFAULT_SERVICE, help="Pi router systemd user service")
    result.add_argument("--health-url", default=DEFAULT_HEALTH_URL)
    result.add_argument("--health-timeout", type=float, default=60.0)
    result.add_argument("--rollback", metavar="COMMIT", help="switch to an already installed immutable runtime")
    return result


def main(argv: Optional[Sequence[str]] = None) -> int:
    try:
        args = parser().parse_args(argv)
        with updater_lock(args.lock.expanduser().resolve()):
            runner = CommandRunner()
            if args.rollback:
                rollback(args, runner)
            else:
                promote(args, runner)
        return 0
    except (UpdateError, OSError) as exc:
        print(f"pi-llama-update: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
