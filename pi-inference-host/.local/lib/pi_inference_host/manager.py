#!/usr/bin/env python3
"""Single-owner inference manager for the GPU host."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import os
import re
import secrets
import signal
import tempfile
import time
import tomllib
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

MAX_REQUEST_BYTES = 64 * 1024
LOG = logging.getLogger("pi-inference-manager")


class ManagerError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _expand(value: str) -> str:
    state_directory = os.environ.get("STATE_DIRECTORY", str(Path.home() / ".local/state/pi-inference-manager"))
    runtime_root = os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    runtime_directory = os.environ.get("RUNTIME_DIRECTORY", str(Path(runtime_root) / "pi-inference-manager"))
    expanded = value.replace("${STATE_DIRECTORY}", state_directory).replace("${RUNTIME_DIRECTORY}", runtime_directory)
    return os.path.expandvars(os.path.expanduser(expanded))


def _config_home() -> Path:
    return Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))


def _state_home() -> Path:
    return Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state"))


def _utc(epoch: float | None = None) -> str:
    return datetime.fromtimestamp(epoch if epoch is not None else time.time(), timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class ManagerConfig:
    unix_socket: Path
    tcp_host: str
    tcp_port: int
    control_token_file: Path
    state_file: Path
    router_unit: str
    studio_unit: str
    router_health_url: str
    router_api_key_file: Path
    minimum_ttl: int
    maximum_ttl: int
    default_ttl: int
    service_timeout: int

    @classmethod
    def load(cls, path: Path | None = None) -> "ManagerConfig":
        path = path or Path(os.environ.get("PI_INFERENCE_MANAGER_CONFIG", _config_home() / "pi-inference/manager.toml"))
        try:
            raw = tomllib.loads(path.read_text(encoding="utf-8"))
        except (OSError, tomllib.TOMLDecodeError) as error:
            raise RuntimeError(f"Cannot load manager configuration {path}: {error}") from error
        server = raw.get("server", {})
        services = raw.get("services", {})
        lease = raw.get("lease", {})
        config = cls(
            Path(_expand(str(server.get("unix_socket", "${XDG_RUNTIME_DIR}/pi-inference-manager.sock")))),
            str(server.get("tcp_host", "127.0.0.1")),
            int(server.get("tcp_port", 46758)),
            Path(_expand(str(server.get("control_token_file", Path.home() / ".pi-inference/credentials/control-api-token")))),
            Path(_expand(str(server.get("state_file", _state_home() / "pi-inference-manager/state.json")))),
            str(services.get("router_unit", "pi-llama-router.service")),
            str(services.get("studio_unit", "unsloth.service")),
            str(services.get("router_health_url", "http://127.0.0.1:46757/v1/models")),
            Path(_expand(str(services.get("router_api_key_file", Path.home() / ".pi-inference/credentials/model-api-key")))),
            int(lease.get("minimum_ttl_seconds", 30)),
            int(lease.get("maximum_ttl_seconds", 3600)),
            int(lease.get("default_ttl_seconds", 300)),
            int(services.get("transition_timeout_seconds", 180)),
        )
        if not (1 <= config.minimum_ttl <= config.default_ttl <= config.maximum_ttl):
            raise RuntimeError("Lease TTL configuration is inconsistent")
        if not (1 <= config.tcp_port <= 65535):
            raise RuntimeError("server.tcp_port is invalid")
        if config.tcp_host not in {"127.0.0.1", "::1", "localhost"}:
            raise RuntimeError("server.tcp_host must be loopback; TLS is terminated by the local reverse proxy")
        return config


class StateStore:
    def __init__(self, path: Path):
        self.path = path

    def load(self) -> dict[str, Any]:
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {"version": 1, "mode": "unknown", "lease": None, "updated_at": _utc()}
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Cannot read manager state {self.path}: {error}") from error
        if value.get("version") != 1 or value.get("mode") not in {"unknown", "team", "studio", "stop", "maintenance"}:
            raise RuntimeError("Manager state has an unsupported schema")
        lease = value.get("lease")
        if lease is not None:
            required = {"id_hash", "owner", "mode", "acquired_at", "expires_at"}
            if not isinstance(lease, dict) or not required.issubset(lease):
                raise RuntimeError("Manager lease state is malformed")
        return value

    def save(self, value: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path.parent.chmod(0o700)
        fd, temporary = tempfile.mkstemp(prefix=f".{self.path.name}.", dir=self.path.parent)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(value, stream, separators=(",", ":"), sort_keys=True)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            directory = os.open(self.path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


class ServiceController:
    def __init__(self, config: ManagerConfig):
        self.config = config

    async def _run(self, *args: str) -> tuple[int, str, str]:
        process = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), self.config.service_timeout)
        except TimeoutError:
            process.terminate()
            await process.wait()
            raise ManagerError(503, f"Command timed out: {' '.join(args)}")
        except asyncio.CancelledError:
            process.terminate()
            await process.wait()
            raise
        return process.returncode or 0, stdout.decode(errors="replace"), stderr.decode(errors="replace")

    async def active(self, unit: str) -> str:
        code, stdout, stderr = await self._run("systemctl", "--user", "is-active", unit)
        state = stdout.strip()
        if state in {"active", "activating", "deactivating", "inactive", "failed"}:
            return state
        raise ManagerError(503, f"Could not determine state of {unit} (exit {code}): {stderr or stdout}")

    async def _stop(self, unit: str) -> None:
        code, stdout, stderr = await self._run("systemctl", "--user", "stop", unit)
        if code != 0:
            raise ManagerError(503, f"Could not stop {unit}: {stderr or stdout}")
        deadline = time.monotonic() + self.config.service_timeout
        while time.monotonic() < deadline:
            if await self.active(unit) in {"inactive", "failed", "unknown"}:
                await self._run("systemctl", "--user", "reset-failed", unit)
                return
            await asyncio.sleep(1)
        raise ManagerError(503, f"Timed out stopping {unit}")

    async def _start(self, unit: str) -> None:
        code, stdout, stderr = await self._run("systemctl", "--user", "start", unit)
        if code != 0:
            raise ManagerError(503, f"Could not start {unit}: {stderr or stdout}")

    async def _router_ready(self) -> None:
        try:
            if self.config.router_api_key_file.stat().st_mode & 0o077:
                raise ManagerError(503, "Router API credential must not be accessible by group/other")
            key = next(line.strip() for line in self.config.router_api_key_file.read_text().splitlines() if line.strip() and not line.startswith("#"))
        except (OSError, StopIteration) as error:
            raise ManagerError(503, f"Cannot read router API credential: {error}") from error
        deadline = time.monotonic() + self.config.service_timeout
        while time.monotonic() < deadline:
            request = urllib.request.Request(self.config.router_health_url, headers={"Authorization": f"Bearer {key}"})
            try:
                def probe() -> None:
                    with urllib.request.urlopen(request, timeout=2):
                        pass
                await asyncio.to_thread(probe)
                return
            except (OSError, urllib.error.URLError):
                await asyncio.sleep(1)
        raise ManagerError(503, "Router did not become ready")

    async def switch(self, mode: str) -> None:
        try:
            await asyncio.wait_for(self._switch(mode), self.config.service_timeout)
        except TimeoutError as error:
            raise ManagerError(503, f"Timed out transitioning inference mode to {mode}") from error

    async def _switch(self, mode: str) -> None:
        if mode == "team":
            await self._stop(self.config.studio_unit)
            await self._start(self.config.router_unit)
            await self._router_ready()
            if await self.active(self.config.router_unit) != "active" or await self.active(self.config.studio_unit) != "inactive":
                raise ManagerError(503, "Team transition did not reach router=active and studio=inactive")
        elif mode == "studio":
            await self._stop(self.config.router_unit)
            await self._start(self.config.studio_unit)
            if await self.active(self.config.router_unit) != "inactive" or await self.active(self.config.studio_unit) != "active":
                raise ManagerError(503, "Studio transition did not reach router=inactive and studio=active")
        elif mode in {"stop", "maintenance"}:
            await self._stop(self.config.router_unit)
            await self._stop(self.config.studio_unit)
            if await self.active(self.config.router_unit) != "inactive" or await self.active(self.config.studio_unit) != "inactive":
                raise ManagerError(503, f"{mode.capitalize()} transition did not leave both services inactive")
        else:
            raise ManagerError(400, f"Unsupported mode: {mode}")

    async def status(self) -> dict[str, str]:
        return {
            "router": await self.active(self.config.router_unit),
            "studio": await self.active(self.config.studio_unit),
        }


class InferenceManager:
    def __init__(self, config: ManagerConfig, services: ServiceController | None = None, clock: Callable[[], float] = time.time):
        self.config = config
        self.store = StateStore(config.state_file)
        self.services = services or ServiceController(config)
        self.clock = clock
        self.lock = asyncio.Lock()

    def _ttl(self, value: Any) -> int:
        ttl = self.config.default_ttl if value is None else int(value)
        if not self.config.minimum_ttl <= ttl <= self.config.maximum_ttl:
            raise ManagerError(400, f"ttl_seconds must be between {self.config.minimum_ttl} and {self.config.maximum_ttl}")
        return ttl

    def _expire(self, state: dict[str, Any]) -> bool:
        lease = state.get("lease")
        if lease and float(lease["expires_at"]) <= self.clock():
            LOG.warning("lease_expired owner=%r", lease["owner"])
            state["lease"] = None
            state["updated_at"] = _utc(self.clock())
            return True
        return False

    async def status(self) -> dict[str, Any]:
        async with self.lock:
            state = self.store.load()
            if self._expire(state):
                self.store.save(state)
            lease = state.get("lease")
            public_lease = None if lease is None else {
                "owner": lease["owner"], "mode": lease["mode"],
                "acquired_at": lease["acquired_at"], "expires_at": _utc(float(lease["expires_at"])),
            }
            return {"version": 1, "mode": state["mode"], "lease": public_lease, "services": await self.services.status()}

    async def acquire(self, body: dict[str, Any]) -> dict[str, Any]:
        owner = body.get("owner")
        mode = body.get("mode", "team")
        if not isinstance(owner, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,239}", owner):
            raise ManagerError(400, "owner must use only audit-safe letters, digits, and ._:@/+- characters")
        if mode not in {"team", "maintenance"}:
            raise ManagerError(400, "Lease mode must be team or maintenance")
        expected_restore_mode = body.get("expected_restore_mode")
        if mode == "maintenance" and expected_restore_mode not in {"team", "studio", "stop"}:
            raise ManagerError(400, "Maintenance leases require expected_restore_mode=team, studio, or stop")
        if mode == "team" and expected_restore_mode is not None:
            raise ManagerError(400, "expected_restore_mode is valid only for maintenance leases")
        ttl = self._ttl(body.get("ttl_seconds"))
        raw_id = body.get("lease_id") or secrets.token_urlsafe(32)
        if not isinstance(raw_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", raw_id):
            raise ManagerError(400, "lease_id must be a URL-safe opaque string between 32 and 128 characters")
        id_hash = hashlib.sha256(raw_id.encode()).hexdigest()
        async with self.lock:
            state = self.store.load()
            self._expire(state)
            if state.get("lease"):
                lease = state["lease"]
                if (
                    lease["owner"] == owner
                    and lease["mode"] == mode
                    and lease.get("restore_mode") == expected_restore_mode
                    and secrets.compare_digest(lease["id_hash"], id_hash)
                ):
                    now = self.clock()
                    lease["expires_at"] = now + ttl
                    state["updated_at"] = _utc(now)
                    self.store.save(state)
                    LOG.info("lease_acquire_idempotent owner=%r expires_at=%s", owner, _utc(now + ttl))
                    return {
                        "message": f"{mode.capitalize()} inference lease already acquired",
                        "lease_id": raw_id,
                        "owner": owner,
                        "mode": mode,
                        "restore_mode": lease.get("restore_mode"),
                        "expires_at": _utc(now + ttl),
                    }
                LOG.warning("lease_acquire_conflict requested_owner=%r active_owner=%r", owner, lease["owner"])
                raise ManagerError(409, f"GPU lease is held by {lease['owner']} until {_utc(float(lease['expires_at']))}")
            if mode == "maintenance" and state["mode"] != expected_restore_mode:
                raise ManagerError(
                    409,
                    f"Inference mode changed before maintenance acquisition: expected {expected_restore_mode}, found {state['mode']}",
                )
            try:
                await self.services.switch(mode)
            except Exception:
                state.update({"mode": "unknown", "lease": None, "updated_at": _utc(self.clock())})
                self.store.save(state)
                raise
            now = self.clock()
            state.update({
                "mode": mode,
                "lease": {
                    "id_hash": id_hash,
                    "owner": owner,
                    "mode": mode,
                    "restore_mode": expected_restore_mode,
                    "acquired_at": _utc(now),
                    "expires_at": now + ttl,
                },
                "updated_at": _utc(now),
            })
            self.store.save(state)
            LOG.info("lease_acquired owner=%r mode=%s expires_at=%s", owner, mode, _utc(now + ttl))
            return {
                "message": f"{mode.capitalize()} inference lease acquired",
                "lease_id": raw_id,
                "owner": owner,
                "mode": mode,
                "restore_mode": expected_restore_mode,
                "expires_at": _utc(now + ttl),
            }

    async def renew(self, raw_id: str, body: dict[str, Any]) -> dict[str, Any]:
        ttl = self._ttl(body.get("ttl_seconds"))
        async with self.lock:
            state = self.store.load()
            self._expire(state)
            lease = state.get("lease")
            if not lease or not secrets.compare_digest(lease["id_hash"], hashlib.sha256(raw_id.encode()).hexdigest()):
                if state.get("lease") is None:
                    self.store.save(state)
                raise ManagerError(404, "Lease does not exist or has expired")
            now = self.clock()
            lease["expires_at"] = now + ttl
            state["updated_at"] = _utc(now)
            self.store.save(state)
            LOG.info("lease_renewed owner=%r expires_at=%s", lease["owner"], _utc(now + ttl))
            return {"message": "Inference lease renewed", "owner": lease["owner"], "expires_at": _utc(now + ttl)}

    async def release(self, raw_id: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        requested_restore_mode = (body or {}).get("restore_mode")
        if requested_restore_mode is not None and requested_restore_mode not in {"team", "studio", "stop"}:
            raise ManagerError(400, "restore_mode must be team, studio, or stop")
        async with self.lock:
            state = self.store.load()
            self._expire(state)
            lease = state.get("lease")
            if not lease:
                self.store.save(state)
                if requested_restore_mode is not None:
                    raise ManagerError(409, "Lease expired or disappeared before atomic mode restoration")
                return {"message": "Inference lease was already absent"}
            if not secrets.compare_digest(lease["id_hash"], hashlib.sha256(raw_id.encode()).hexdigest()):
                raise ManagerError(404, "Lease does not exist or belongs to another owner")
            restore_mode = requested_restore_mode
            if lease["mode"] == "maintenance":
                captured_restore_mode = lease.get("restore_mode")
                if captured_restore_mode not in {"team", "studio", "stop"}:
                    raise ManagerError(409, "Maintenance lease lacks a captured restore mode")
                if requested_restore_mode is not None and requested_restore_mode != captured_restore_mode:
                    raise ManagerError(409, "Requested restore mode does not match the atomically captured mode")
                restore_mode = captured_restore_mode
            owner = lease["owner"]
            if restore_mode is not None:
                try:
                    await self.services.switch(restore_mode)
                except Exception:
                    state.update({"mode": "unknown", "updated_at": _utc(self.clock())})
                    self.store.save(state)
                    raise
            state["lease"] = None
            if restore_mode is not None:
                state["mode"] = restore_mode
            state["updated_at"] = _utc(self.clock())
            self.store.save(state)
            LOG.info("lease_released owner=%r restore_mode=%r", owner, restore_mode)
            return {"message": "Inference lease released", "owner": owner, "mode": state["mode"]}

    async def startup(self) -> None:
        async with self.lock:
            state = self.store.load()
            if self._expire(state):
                self.store.save(state)
            elif state.get("lease"):
                await self.services.switch(state["lease"]["mode"])

    async def set_mode(self, body: dict[str, Any]) -> dict[str, Any]:
        mode = body.get("mode")
        if mode not in {"team", "studio", "stop"}:
            raise ManagerError(400, "mode must be team, studio, or stop")
        async with self.lock:
            state = self.store.load()
            self._expire(state)
            if state.get("lease"):
                raise ManagerError(409, f"Cannot switch mode while GPU lease is held by {state['lease']['owner']}")
            try:
                await self.services.switch(mode)
            except Exception:
                state.update({"mode": "unknown", "lease": None, "updated_at": _utc(self.clock())})
                self.store.save(state)
                raise
            state.update({"mode": mode, "lease": None, "updated_at": _utc(self.clock())})
            self.store.save(state)
            LOG.info("mode_switched mode=%s", mode)
            return {"message": f"Inference mode is {mode}", "mode": mode}


class HTTPServer:
    def __init__(self, manager: InferenceManager, token: str):
        self.manager = manager
        self.token = token

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, trusted_local: bool) -> None:
        status = 500
        response: dict[str, Any] = {"error": {"message": "Internal server error"}}
        try:
            header = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
            if len(header) > MAX_REQUEST_BYTES:
                raise ManagerError(413, "Request headers are too large")
            lines = header.decode("iso-8859-1").split("\r\n")
            method, path, version = lines[0].split(" ", 2)
            if version not in {"HTTP/1.0", "HTTP/1.1"}:
                raise ManagerError(400, "Unsupported HTTP version")
            headers: dict[str, str] = {}
            for line in lines[1:]:
                if not line:
                    continue
                key, separator, value = line.partition(":")
                if not separator:
                    raise ManagerError(400, "Malformed HTTP header")
                normalized_key = key.lower().strip()
                if normalized_key in headers:
                    raise ManagerError(400, f"Duplicate HTTP header is not allowed: {normalized_key}")
                headers[normalized_key] = value.strip()
            if "transfer-encoding" in headers:
                raise ManagerError(400, "Transfer-Encoding is not supported")
            if not trusted_local and not secrets.compare_digest(headers.get("authorization", ""), f"Bearer {self.token}"):
                LOG.warning("authentication_failed peer=%r", writer.get_extra_info("peername"))
                raise ManagerError(401, "Invalid control credential")
            length = int(headers.get("content-length", "0"))
            if length < 0 or length > MAX_REQUEST_BYTES:
                raise ManagerError(413, "Request body is too large")
            body_raw = await asyncio.wait_for(reader.readexactly(length), 10) if length else b"{}"
            try:
                body = json.loads(body_raw)
            except (json.JSONDecodeError, UnicodeDecodeError) as error:
                raise ManagerError(400, "Request body is not valid JSON") from error
            if not isinstance(body, dict):
                raise ManagerError(400, "Request body must be a JSON object")
            status, response = await self.route(method, path, body, trusted_local)
        except ManagerError as error:
            status, response = error.status, {"error": {"message": str(error)}}
        except (ValueError, asyncio.IncompleteReadError, asyncio.LimitOverrunError, TimeoutError) as error:
            status, response = 400, {"error": {"message": f"Malformed request: {error}"}}
        except Exception:
            LOG.exception("request_failed peer=%r", writer.get_extra_info("peername"))
            status, response = 500, {"error": {"message": "Internal server error"}}
        payload = json.dumps(response, separators=(",", ":")).encode()
        reason = {200: "OK", 201: "Created", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 413: "Payload Too Large", 500: "Internal Server Error", 503: "Service Unavailable"}.get(status, "Error")
        writer.write(f"HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {len(payload)}\r\nConnection: close\r\n\r\n".encode() + payload)
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    async def route(self, method: str, path: str, body: dict[str, Any], trusted_local: bool) -> tuple[int, dict[str, Any]]:
        if method == "GET" and path == "/v1/status":
            return 200, await self.manager.status()
        if method == "POST" and path == "/v1/leases":
            if body.get("mode") == "maintenance" and not trusted_local:
                raise ManagerError(403, "Maintenance leases are available only through the local Unix socket")
            return 201, await self.manager.acquire(body)
        if method == "POST" and path == "/v1/mode":
            return 200, await self.manager.set_mode(body)
        prefix = "/v1/leases/"
        if path.startswith(prefix) and len(path) > len(prefix):
            lease_id = path[len(prefix):]
            if "/" in lease_id:
                raise ManagerError(404, "Unknown endpoint")
            if method == "PUT":
                return 200, await self.manager.renew(lease_id, body)
            if method == "DELETE":
                if body.get("restore_mode") is not None and not trusted_local:
                    raise ManagerError(403, "Atomic mode restoration is available only through the local Unix socket")
                return 200, await self.manager.release(lease_id, body)
        raise ManagerError(404, "Unknown endpoint")


def _read_private_token(path: Path, label: str, minimum_length: int = 1) -> str:
    try:
        values = [line.strip() for line in path.read_text().splitlines() if line.strip() and not line.startswith("#")]
        mode = path.stat().st_mode
    except OSError as error:
        raise RuntimeError(f"Cannot read {label}: {error}") from error
    if mode & 0o077:
        raise RuntimeError(f"{label.capitalize()} must not be accessible by group/other")
    if len(values) != 1 or len(values[0]) < minimum_length:
        raise RuntimeError(f"{label.capitalize()} must contain one value of at least {minimum_length} characters")
    return values[0]


def _load_distinct_service_tokens(config: ManagerConfig) -> tuple[str, str]:
    control_token = _read_private_token(config.control_token_file, "control token", 32)
    model_token = _read_private_token(config.router_api_key_file, "model API key")
    if secrets.compare_digest(control_token, model_token):
        raise RuntimeError("Control token and model API key must be distinct")
    return control_token, model_token


async def serve(config: ManagerConfig) -> None:
    token, _model_token = _load_distinct_service_tokens(config)
    config.unix_socket.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if config.unix_socket.exists():
        # A stale socket is safe to replace only after proving no manager listens.
        probe = socket_probe(config.unix_socket)
        if probe:
            raise RuntimeError(f"Another manager is already listening on {config.unix_socket}")
        config.unix_socket.unlink()
    manager = InferenceManager(config)
    await manager.startup()
    http = HTTPServer(manager, token)
    unix_server = await asyncio.start_unix_server(lambda r, w: http.handle(r, w, True), path=config.unix_socket)
    os.chmod(config.unix_socket, 0o600)
    tcp_server = await asyncio.start_server(lambda r, w: http.handle(r, w, False), config.tcp_host, config.tcp_port)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for name in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(name, stop.set)
    async with unix_server, tcp_server:
        await stop.wait()
    config.unix_socket.unlink(missing_ok=True)


def socket_probe(path: Path) -> bool:
    import socket
    probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    probe.settimeout(0.2)
    try:
        probe.connect(str(path))
        return True
    except OSError:
        return False
    finally:
        probe.close()


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(prog="pi-inference-manager")
    parser.add_argument("--config", type=Path)
    args = parser.parse_args(argv)
    asyncio.run(serve(ManagerConfig.load(args.config)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
