#!/usr/bin/env python3
"""Portable client for the Pi inference control plane."""

from __future__ import annotations

import argparse
import fcntl
import getpass
import hashlib
import http.client
import json
import os
import re
import secrets
import socket
import ssl
import sys
import tempfile
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional


class ClientError(RuntimeError):
    pass


def _expand(value: str) -> str:
    return os.path.expandvars(os.path.expanduser(value))


def _config_home() -> Path:
    return Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))


def _state_home() -> Path:
    return Path(os.environ.get("PI_INFERENCE_STATE_HOME", Path.home() / ".pi-inference/state"))


@dataclass(frozen=True)
class ClientConfig:
    transport: str
    local_socket: Path
    remote_url: str
    control_token_file: Path
    client_certificate_file: Optional[Path]
    client_key_file: Optional[Path]
    credentials: dict[str, Path]

    @classmethod
    def load(cls, path: Optional[Path] = None) -> "ClientConfig":
        path = path or Path(os.environ.get("PI_INFERENCE_CONFIG", _config_home() / "pi-inference/client.json"))
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ClientError(f"Cannot load client configuration {path}: {error}") from error
        control = raw.get("control", {})
        credentials = raw.get("credentials", {})
        transport = str(control.get("transport", "auto"))
        if transport not in {"auto", "unix", "https"}:
            raise ClientError("control.transport must be auto, unix, or https")
        socket_default = "${XDG_RUNTIME_DIR}/pi-inference-manager.sock"
        socket_path = Path(_expand(str(control.get("local_socket", socket_default))))
        remote_url = str(control.get("remote_url", "")).rstrip("/")
        token_path = Path(_expand(str(control.get("token_file", Path.home() / ".pi-inference/credentials/control-api-token"))))
        certificate_value = control.get("client_certificate_file")
        key_value = control.get("client_key_file")
        if (certificate_value is None) != (key_value is None):
            raise ClientError("control.client_certificate_file and control.client_key_file must be configured together")
        certificate_path = Path(_expand(str(certificate_value))) if certificate_value is not None else None
        key_path = Path(_expand(str(key_value))) if key_value is not None else None
        mapped = {
            name.replace("_", "-"): Path(_expand(str(value)))
            for name, value in credentials.items()
            if name.endswith("_file")
        }
        # Convert model_api_key_file -> model-api.
        normalized: dict[str, Path] = {}
        for name, value in mapped.items():
            normalized[name.removesuffix("-key-file").removesuffix("-file")] = value
        return cls(transport, socket_path, remote_url, token_path, certificate_path, key_path, normalized)


class UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, socket_path: Path, timeout: float = 30.0):
        super().__init__("localhost", timeout=timeout)
        self.socket_path = socket_path

    def connect(self) -> None:
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(str(self.socket_path))


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class ControlClient:
    def __init__(self, config: ClientConfig, timeout: float = 210.0):
        self.config = config
        self.timeout = timeout

    def _transport(self) -> str:
        if self.config.transport == "auto":
            return "unix" if self.config.local_socket.exists() else "https"
        return self.config.transport

    def request(self, method: str, path: str, body: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        payload = None if body is None else json.dumps(body, separators=(",", ":")).encode()
        transport = self._transport()
        try:
            if transport == "unix":
                connection = UnixHTTPConnection(self.config.local_socket, self.timeout)
                headers = {"Content-Type": "application/json"}
                connection.request(method, path, body=payload, headers=headers)
                response = connection.getresponse()
                data = response.read()
                status = response.status
                connection.close()
            else:
                remote = urlsplit(self.config.remote_url)
                if remote.scheme != "https" or not remote.hostname or remote.username or remote.password:
                    raise ClientError("Remote control URL must be an HTTPS origin without embedded credentials")
                if remote.path not in {"", "/"} or remote.query or remote.fragment:
                    raise ClientError("Remote control URL must not contain a path, query, or fragment")
                token = _read_secret(self.config.control_token_file)
                context = ssl.create_default_context()
                if self.config.client_certificate_file is not None and self.config.client_key_file is not None:
                    _assert_private_file(self.config.client_key_file, "optional mTLS client private key")
                    try:
                        context.load_cert_chain(self.config.client_certificate_file, self.config.client_key_file)
                    except (OSError, ssl.SSLError) as error:
                        raise ClientError(f"Cannot load optional mTLS client identity: {error}") from error
                request = urllib.request.Request(
                    f"{self.config.remote_url}{path}",
                    data=payload,
                    method=method,
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                )
                opener = urllib.request.build_opener(
                    urllib.request.HTTPSHandler(context=context),
                    NoRedirectHandler(),
                )
                try:
                    with opener.open(request, timeout=self.timeout) as response:
                        status = response.status
                        data = response.read()
                except urllib.error.HTTPError as error:
                    status = error.code
                    data = error.read()
        except (OSError, urllib.error.URLError, http.client.HTTPException) as error:
            raise ClientError(f"Inference manager is unreachable via {transport}: {error}") from error
        if 300 <= status < 400:
            raise ClientError(f"Inference manager redirect refused (HTTP {status})")
        try:
            result = json.loads(data or b"{}")
        except json.JSONDecodeError as error:
            raise ClientError(f"Inference manager returned invalid JSON (HTTP {status})") from error
        if status < 200 or status >= 300:
            message = result.get("error", {}).get("message") if isinstance(result, dict) else None
            raise ClientError(message or f"Inference manager request failed with HTTP {status}")
        if not isinstance(result, dict):
            raise ClientError("Inference manager response must be a JSON object")
        return result


def _assert_private_file(path: Path, label: str) -> None:
    try:
        mode = path.stat().st_mode & 0o777
    except OSError as error:
        raise ClientError(f"Cannot inspect {label} {path}: {error}") from error
    if mode & 0o077:
        raise ClientError(f"{label} must not be accessible by group/other: {path}")


def _read_secret(path: Path) -> str:
    try:
        _assert_private_file(path, "Credential file")
        value = next((line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#")), "")
    except OSError as error:
        raise ClientError(f"Cannot read credential {path}: {error}") from error
    if not value:
        raise ClientError(f"Credential is empty: {path}")
    return value


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _write_private_secret(path: Path, value: str, replace: bool = False) -> None:
    if path.exists() and not replace:
        raise ClientError(f"Credential already exists; use --replace to overwrite it: {path}")
    if not value or "\n" in value or "\r" in value:
        raise ClientError("Credential must be one non-empty line")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.parent.chmod(0o700)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(value + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        _fsync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def _client_lock():
    path = _state_home() / "client.lock"
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.parent.chmod(0o700)
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def _lease_path(owner: str) -> Path:
    digest = hashlib.sha256(owner.encode()).hexdigest()
    return _state_home() / "client-leases" / f"{digest}.json"


def _write_private_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.parent.chmod(0o700)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        _fsync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _owner(args: argparse.Namespace) -> str:
    owner = args.owner or os.environ.get("PI_INFERENCE_OWNER", "")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,239}", owner):
        raise ClientError("Lease owner must use only letters, digits, and ._:@/+- characters")
    return owner


def _load_lease(owner: str) -> dict[str, Any]:
    path = _lease_path(owner)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ClientError(f"No valid local lease record for owner {owner!r}: {error}") from error
    if data.get("owner") != owner or not data.get("lease_id"):
        raise ClientError("Local lease record does not match its owner")
    return data


def _assert_lease_manager(lease: dict[str, Any], config: ClientConfig) -> None:
    if lease.get("manager") != config.remote_url:
        raise ClientError("Local lease record belongs to a different inference-manager origin")


def _remove_lease(owner: str) -> None:
    path = _lease_path(owner)
    try:
        path.unlink()
        _fsync_directory(path.parent)
    except FileNotFoundError:
        pass


def _print(result: dict[str, Any], json_output: bool) -> None:
    if json_output:
        print(json.dumps(result, sort_keys=True))
        return
    if "message" in result:
        print(result["message"])
    else:
        print(json.dumps(result, indent=2, sort_keys=True))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="pi-inference")
    parser.add_argument("--config", type=Path)
    parser.add_argument("--json", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    credential = sub.add_parser("credential")
    credential.add_argument("--install", action="store_true", help="read and install the credential without putting it in shell history")
    credential.add_argument("--replace", action="store_true", help="replace an existing credential (requires --install)")
    credential.add_argument("name", choices=["model-api", "control-api"])
    acquire = sub.add_parser("acquire")
    acquire.add_argument("--mode", choices=["team", "maintenance"], default="team")
    acquire.add_argument("--owner")
    acquire.add_argument("--expected-restore-mode", choices=["team", "studio", "stop"])
    acquire.add_argument("--ttl", type=int, default=None)
    renew = sub.add_parser("renew")
    renew.add_argument("--owner")
    renew.add_argument("--ttl", type=int, default=None)
    release = sub.add_parser("release")
    release.add_argument("--owner")
    release.add_argument("--restore-mode", choices=["team", "studio", "stop"])
    for mode in ("team", "studio", "stop"):
        sub.add_parser(mode)
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        config = ClientConfig.load(args.config)
        if args.command == "credential":
            key = args.name
            path = config.control_token_file if key == "control-api" else config.credentials.get(key)
            if path is None:
                raise ClientError(f"No credential path configured for {key}")
            if args.replace and not args.install:
                raise ClientError("--replace requires --install")
            if args.install:
                value = getpass.getpass(f"{key} credential: ") if sys.stdin.isatty() else sys.stdin.readline().rstrip("\r\n")
                _write_private_secret(path, value, args.replace)
                print(f"Installed {key} credential at {path}")
            else:
                print(_read_secret(path))
            return 0
        client = ControlClient(config)
        if args.command == "status":
            result = client.request("GET", "/v1/status")
        elif args.command == "acquire":
            owner = _owner(args)
            ttl = args.ttl if args.ttl is not None else int(os.environ.get("PI_INFERENCE_TTL", "300"))
            with _client_lock():
                lease_path = _lease_path(owner)
                if lease_path.exists():
                    existing_lease = _load_lease(owner)
                    _assert_lease_manager(existing_lease, config)
                    lease_id = existing_lease["lease_id"]
                else:
                    lease_id = secrets.token_urlsafe(32)
                _write_private_json(_lease_path(owner), {"owner": owner, "lease_id": lease_id, "manager": config.remote_url, "pending": True})
                request_body = {
                    "mode": args.mode,
                    "owner": owner,
                    "ttl_seconds": ttl,
                    "lease_id": lease_id,
                }
                if args.expected_restore_mode is not None:
                    request_body["expected_restore_mode"] = args.expected_restore_mode
                result = client.request("POST", "/v1/leases", request_body)
                _write_private_json(_lease_path(owner), {"owner": owner, "lease_id": result["lease_id"], "manager": config.remote_url})
        elif args.command == "renew":
            owner = _owner(args)
            ttl = args.ttl if args.ttl is not None else int(os.environ.get("PI_INFERENCE_TTL", "300"))
            with _client_lock():
                lease = _load_lease(owner)
                _assert_lease_manager(lease, config)
                result = client.request("PUT", f"/v1/leases/{lease['lease_id']}", {"ttl_seconds": ttl})
        elif args.command == "release":
            owner = _owner(args)
            with _client_lock():
                lease = _load_lease(owner)
                _assert_lease_manager(lease, config)
                body = {"restore_mode": args.restore_mode} if args.restore_mode else None
                result = client.request("DELETE", f"/v1/leases/{lease['lease_id']}", body)
                _remove_lease(owner)
        else:
            result = client.request("POST", "/v1/mode", {"mode": args.command})
        _print(result, args.json)
        return 0
    except (ClientError, ValueError, KeyError) as error:
        print(f"pi-inference: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
