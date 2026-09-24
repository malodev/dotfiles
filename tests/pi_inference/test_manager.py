from __future__ import annotations

import asyncio
import dataclasses
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# See _host.py: the host tree moved out of this repo in dcee88f and these tests
# silently stopped loading for six weeks because of it.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _host  # noqa: E402

manager = _host.load("manager")
MODULE = _host.host_root() / ".local/lib/pi_inference_host/manager.py"

CLIENT_MODULE = Path(__file__).parents[2] / "pi/.local/lib/pi_inference/client.py"
CLIENT_SPEC = importlib.util.spec_from_file_location("pi_inference.client", CLIENT_MODULE)
client = importlib.util.module_from_spec(CLIENT_SPEC)
sys.modules[CLIENT_SPEC.name] = client
assert CLIENT_SPEC.loader
CLIENT_SPEC.loader.exec_module(client)


# What config() wires up, and the unit each mode owns. Kept as data so a test can say
# "every mode leaves exactly its owner running" instead of asserting one mode at a time
# and leaving a fifth mode to be forgotten — which is how qwen-flash got in.
OWNER_MODES = ("team", "studio", "ds4", "qwen-flash")
OWNER_UNITS = {"team": "router", "studio": "studio", "ds4": "ds4", "qwen-flash": "qwen-flash.service"}
# The card as tests see it: an empty 32 GiB card unless a test says otherwise. Not a
# fixture for realism — without this the guard checks read the real host, and on any day
# qwen-flash is up every transition test fails for a reason that has nothing to do with
# the code under test.
EMPTY_CARD = (0.0, 32624.0)
FULL_CARD = (30742.0, 32624.0)


class FakeServices:
    def __init__(self):
        self.mode = "stop"
        self.switches: list[str] = []
        self.forced: list[bool] = []
        self.failure: Exception | None = None
        self.progress: str | None = None

    async def switch(self, mode: str, force: bool = False) -> None:
        if self.failure:
            raise self.failure
        self.mode = mode
        self.switches.append(mode)
        self.forced.append(force)

    async def status(self):
        return {
            "router": "active" if self.mode == "team" else "inactive",
            "studio": "active" if self.mode == "studio" else "inactive",
            "ds4": "active" if self.mode == "ds4" else "inactive",
            "qwen": "active" if self.mode == "qwen-flash" else "inactive",
        }


def config(root: Path):
    return manager.ManagerConfig(
        root / "manager.sock", "127.0.0.1", 46758, root / "control-token",
        root / "state.json", "router", "studio", "http://localhost/health",
        root / "model-key", 30, 3600, 300, 5,
        "ds4", "http://localhost/ds4-health",
    )


# The card as the tenant tests see it: peaks in MiB per unit, and a total. These are the real
# measured shapes (qwen 30.5 GiB, the face sidecar 0.36 idle / 0.63 peak, comfy a few GiB
# after a render), chosen so the sums cross the interesting boundary — a card where a switch
# fits only if the sidecar moves.
CARD_TOTAL_MIB = 32624.0
SIDE_CAR = manager.Tenant("recognize-daemon.service", 768, "low", "Nextcloud face sidecar")
FIXED_TENANT = manager.Tenant("vendor-collector.service", 900, "fixed", "Vendor collector")


def tenant_config(root: Path, *, tenants: tuple[manager.Tenant, ...], headroom: int = 512) -> manager.ManagerConfig:
    # `replace` rather than a second positional call: the point of these tests is the tenant
    # behaviour, and a second copy of fifteen positional arguments is how the two configs
    # drift apart and the test starts asserting something else.
    return dataclasses.replace(
        config(root), tenants=tenants, tenant_headroom_mib=headroom, tenant_release_timeout=1
    )


def mutations(calls: list[list[str]]) -> list[str]:
    """Only the systemctl calls that change state.

    "Refused up front" cannot mean "made no systemctl calls at all": the guards themselves
    read unit state, and asserting on reads would force the implementation to guess. It
    means nothing was started and nothing was stopped.
    """
    return [f"{args[2]} {args[3]}" for args in calls if len(args) > 3 and args[2] in {"start", "stop", "restart"}]


def fake_controller(
    root: Path,
    states: dict[str, str],
    *,
    vram: tuple[float | None, float | None] = EMPTY_CARD,
    comfy: float | None = 0.0,
    comfy_active: bool = True,
    busy: dict[str, str] | None = None,
    silent: tuple[str, ...] = (),
) -> tuple[manager.ServiceController, list[list[str]]]:
    """A real ServiceController over an emulated systemctl and an emulated card.

    Returns the controller and every systemctl invocation it makes; assert on
    `mutations(calls)` for "refused up front". ComfyUI defaults to up-and-idle because
    that is this host's normal state, and the guard only asks it what it holds when the
    unit is actually running.
    """
    calls: list[list[str]] = []
    controller = manager.ServiceController(config(root), vram_probe=lambda: vram)
    states.setdefault("comfyui.service", "active" if comfy_active else "inactive")

    async def run(*args: str) -> tuple[int, str, str]:
        calls.append(list(args))
        unit = args[3] if len(args) > 3 else ""
        if args[2] == "is-active":
            return 0, states.get(unit, "inactive"), ""
        if args[2] == "stop":
            states[unit] = "inactive"
            return 0, "", ""
        if args[2] == "start":
            states[unit] = "active"
            return 0, "", ""
        return 0, "", ""

    async def ready() -> None:
        return None

    async def occupancy(mode: str) -> tuple[str, str]:
        if busy and mode in busy:
            return "busy", busy[mode]
        if mode in silent:
            return "silent", f"{mode} is holding the card but did not answer /slots in 8 s"
        return "idle", "stub: idle"

    async def comfy_held() -> float | None:
        return comfy

    controller._run = run  # type: ignore[method-assign]
    controller._router_ready = ready  # type: ignore[method-assign]
    controller._ds4_ready = ready  # type: ignore[method-assign]
    controller._qwen_ready = ready  # type: ignore[method-assign]
    controller.occupancy = occupancy  # type: ignore[method-assign]
    controller.comfy_held_mib = comfy_held  # type: ignore[method-assign]
    return controller, calls


def tenant_world(
    root: Path,
    *,
    tenants: tuple[manager.Tenant, ...],
    peaks: dict[str, int],
    running: dict[str, str] | None = None,
    comfy: float = 0.0,
    comfy_active: bool = False,
    headroom: int = 512,
    config_overrides: dict | None = None,
):
    """A controller whose card is a function of which units are up.

    That is the whole point of this helper. With a fixed VRAM number, "stopping the sidecar
    frees the room the model needed" is a story a fake agrees to tell; deriving usage from
    unit state means the eviction has to actually happen, and actually free memory, for the
    transition to succeed. Peaks are the measured shapes from this host: qwen at 30.5 GiB, the
    face sidecar at 0.36 idle and 0.63 under load, comfy holding gigabytes after a render.
    """
    states = dict(running or {})
    states.setdefault("comfyui.service", "active" if comfy_active else "inactive")
    calls: list[list[str]] = []
    cfg = dataclasses.replace(
        tenant_config(root, tenants=tenants, headroom=headroom), **(config_overrides or {})
    )

    def probe() -> tuple[float, float]:
        used = sum(peaks.get(unit, 0) for unit, state in states.items() if state == "active")
        return float(used), CARD_TOTAL_MIB

    controller = manager.ServiceController(cfg, vram_probe=probe)

    async def run(*args: str) -> tuple[int, str, str]:
        calls.append(list(args))
        unit = args[3] if len(args) > 3 else ""
        if args[2] == "is-active":
            return 0, states.get(unit, "inactive"), ""
        if args[2] == "stop":
            states[unit] = "inactive"
            return 0, "", ""
        if args[2] == "start":
            states[unit] = "active"
            return 0, "", ""
        return 0, "", ""

    async def idle_occupancy(mode: str) -> tuple[str, str]:
        return "idle", "stub: idle"

    controller._run = run  # type: ignore[method-assign]
    controller._router_ready = controller._ds4_ready = controller._qwen_ready = (lambda: asyncio.sleep(0))  # type: ignore[method-assign,assignment]
    controller.occupancy = idle_occupancy  # type: ignore[method-assign]
    controller.comfy_held_mib = lambda: asyncio.sleep(0, comfy)  # type: ignore[method-assign]
    return manager.InferenceManager(cfg, controller, lambda: 1_700_000_000.0), calls, states


class ManagerTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pi-inference-manager-")
        self.root = Path(self.temp.name)
        self.now = 1_700_000_000.0
        self.services = FakeServices()
        self.manager = manager.InferenceManager(config(self.root), self.services, lambda: self.now)

    async def asyncTearDown(self):
        self.temp.cleanup()

    def test_manager_refuses_reused_control_and_model_credentials(self):
        configured = config(self.root)
        configured.control_token_file.write_text("x" * 32 + "\n")
        configured.router_api_key_file.write_text("x" * 32 + "\n")
        configured.control_token_file.chmod(0o600)
        configured.router_api_key_file.chmod(0o600)
        with self.assertRaisesRegex(RuntimeError, "must be distinct"):
            manager._load_distinct_service_tokens(configured)
        configured.router_api_key_file.write_text("different-model-key\n")
        control, model = manager._load_distinct_service_tokens(configured)
        self.assertNotEqual(control, model)

    async def test_maintenance_lease_stops_services_and_releases_with_atomic_restore(self):
        await self.manager.set_mode({"mode": "stop"})
        acquired = await self.manager.acquire({"owner": "updater", "mode": "maintenance", "expected_restore_mode": "stop", "ttl_seconds": 60})
        self.assertEqual(acquired["mode"], "maintenance")
        self.assertEqual(self.services.switches, ["stop", "maintenance"])
        state = json.loads((self.root / "state.json").read_text())
        self.assertEqual(state["mode"], "maintenance")
        self.assertEqual(state["lease"]["mode"], "maintenance")

        released = await self.manager.release(acquired["lease_id"], {"restore_mode": "stop"})
        self.assertEqual(released["mode"], "stop")
        self.assertEqual(self.services.switches, ["stop", "maintenance", "stop"])
        self.assertIsNone((await self.manager.status())["lease"])

    async def test_maintenance_acquire_retry_is_idempotent_after_mode_changes_to_maintenance(self):
        await self.manager.set_mode({"mode": "stop"})
        body = {
            "owner": "updater",
            "mode": "maintenance",
            "expected_restore_mode": "stop",
            "ttl_seconds": 60,
            "lease_id": "maintenance-retry-lease-id-000000000001",
        }
        first = await self.manager.acquire(body)
        self.now += 10
        second = await self.manager.acquire({**body, "ttl_seconds": 120})
        self.assertEqual(first["lease_id"], second["lease_id"])
        self.assertEqual(second["restore_mode"], "stop")
        self.assertEqual(self.services.switches, ["stop", "maintenance"])

    async def test_failed_atomic_restore_retains_maintenance_lease(self):
        await self.manager.set_mode({"mode": "stop"})
        acquired = await self.manager.acquire({"owner": "updater", "mode": "maintenance", "expected_restore_mode": "stop", "ttl_seconds": 60})
        self.services.failure = manager.ManagerError(503, "restore failed")
        with self.assertRaisesRegex(manager.ManagerError, "restore failed"):
            await self.manager.release(acquired["lease_id"], {"restore_mode": "stop"})
        state = json.loads((self.root / "state.json").read_text())
        self.assertEqual(state["mode"], "unknown")
        self.assertIsNotNone(state["lease"])

    async def test_maintenance_acquire_rejects_stale_expected_restore_mode(self):
        await self.manager.set_mode({"mode": "team"})
        with self.assertRaisesRegex(manager.ManagerError, "mode changed") as conflict:
            await self.manager.acquire(
                {"owner": "updater", "mode": "maintenance", "expected_restore_mode": "stop"}
            )
        self.assertEqual(conflict.exception.status, 409)
        self.assertEqual(self.services.switches, ["team"])

    async def test_expired_maintenance_release_cannot_claim_mode_restoration(self):
        await self.manager.set_mode({"mode": "stop"})
        acquired = await self.manager.acquire(
            {"owner": "updater", "mode": "maintenance", "expected_restore_mode": "stop", "ttl_seconds": 30}
        )
        self.now += 31
        with self.assertRaisesRegex(manager.ManagerError, "expired or disappeared") as conflict:
            await self.manager.release(acquired["lease_id"], {"restore_mode": "stop"})
        self.assertEqual(conflict.exception.status, 409)
        state = json.loads((self.root / "state.json").read_text())
        self.assertIsNone(state["lease"])
        self.assertEqual(state["mode"], "maintenance")

    async def test_remote_transport_cannot_acquire_maintenance_lease(self):
        server = manager.HTTPServer(self.manager, "token")
        with self.assertRaisesRegex(manager.ManagerError, "local Unix socket") as forbidden:
            await server.route("POST", "/v1/leases", {"owner": "remote", "mode": "maintenance"}, False)
        self.assertEqual(forbidden.exception.status, 403)

    async def test_manager_restart_restores_maintenance_as_stopped_not_team(self):
        await self.manager.set_mode({"mode": "stop"})
        await self.manager.acquire({"owner": "updater", "mode": "maintenance", "expected_restore_mode": "stop", "ttl_seconds": 60})
        restored_services = FakeServices()
        restarted = manager.InferenceManager(config(self.root), restored_services, lambda: self.now)
        await restarted.startup()
        self.assertEqual(restored_services.switches, ["maintenance"])

    async def test_single_lease_renews_releases_and_never_persists_raw_id(self):
        acquired = await self.manager.acquire({"owner": "host:repo:task", "mode": "team", "ttl_seconds": 60})
        self.assertEqual(self.services.switches, ["team"])
        raw_id = acquired["lease_id"]
        self.assertNotIn(raw_id, (self.root / "state.json").read_text())
        with self.assertRaisesRegex(manager.ManagerError, "held by host:repo:task") as conflict:
            await self.manager.acquire({"owner": "other", "mode": "team"})
        self.assertEqual(conflict.exception.status, 409)
        self.now += 20
        renewed = await self.manager.renew(raw_id, {"ttl_seconds": 120})
        self.assertIn("renewed", renewed["message"])
        released = await self.manager.release(raw_id)
        self.assertEqual(released["owner"], "host:repo:task")
        self.assertIsNone((await self.manager.status())["lease"])

    async def test_acquire_retry_with_same_owner_and_client_id_is_idempotent(self):
        lease_id = "client-generated-lease-id-0000000000000001"
        first = await self.manager.acquire({"owner": "retrying", "lease_id": lease_id, "ttl_seconds": 60})
        self.now += 10
        second = await self.manager.acquire({"owner": "retrying", "lease_id": lease_id, "ttl_seconds": 120})
        self.assertEqual(first["lease_id"], second["lease_id"])
        self.assertEqual(self.services.switches, ["team"])
        self.assertIn("already acquired", second["message"])

    async def test_failed_transition_persists_unknown_without_a_lease(self):
        self.services.failure = manager.ManagerError(503, "dbus unavailable")
        with self.assertRaisesRegex(manager.ManagerError, "dbus unavailable"):
            await self.manager.acquire({"owner": "cannot-start"})
        state = json.loads((self.root / "state.json").read_text())
        self.assertEqual(state["mode"], "unknown")
        self.assertIsNone(state["lease"])

    async def test_expired_lease_is_reclaimed_without_switching_away_from_team(self):
        first = await self.manager.acquire({"owner": "first", "ttl_seconds": 30})
        self.now += 31
        second = await self.manager.acquire({"owner": "second", "ttl_seconds": 30})
        self.assertNotEqual(first["lease_id"], second["lease_id"])
        self.assertEqual(self.services.switches, ["team", "team"])
        self.assertEqual((await self.manager.status())["lease"]["owner"], "second")

    async def test_manual_mode_switch_refuses_active_lease(self):
        acquired = await self.manager.acquire({"owner": "worker"})
        with self.assertRaisesRegex(manager.ManagerError, "while GPU lease is held") as conflict:
            await self.manager.set_mode({"mode": "studio"})
        self.assertEqual(conflict.exception.status, 409)
        await self.manager.release(acquired["lease_id"])
        result = await self.manager.set_mode({"mode": "studio"})
        self.assertEqual(result["mode"], "studio")

    async def test_ds4_is_a_settable_mode(self):
        result = await self.manager.set_mode({"mode": "ds4"})
        self.assertEqual(result["mode"], "ds4")
        self.assertEqual(self.services.switches, ["ds4"])
        status = await self.manager.status()
        self.assertEqual(status["services"]["ds4"], "active")
        self.assertEqual(status["services"]["router"], "inactive")

    async def test_ds4_is_a_leasable_mode_like_team(self):
        acquired = await self.manager.acquire({"owner": "worker", "mode": "ds4", "ttl_seconds": 60})
        self.assertEqual(acquired["mode"], "ds4")
        self.assertEqual(self.services.switches, ["ds4"])
        with self.assertRaisesRegex(manager.ManagerError, "while GPU lease is held") as conflict:
            await self.manager.set_mode({"mode": "team"})
        self.assertEqual(conflict.exception.status, 409)
        released = await self.manager.release(acquired["lease_id"], {"restore_mode": "team"})
        self.assertEqual(released["mode"], "team")
        self.assertEqual(self.services.switches, ["ds4", "team"])

    async def test_ds4_lease_rejects_expected_restore_mode(self):
        with self.assertRaisesRegex(manager.ManagerError, "valid only for maintenance leases"):
            await self.manager.acquire({"owner": "worker", "mode": "ds4", "expected_restore_mode": "team"})

    async def test_startup_restores_team_service_for_unexpired_lease(self):
        await self.manager.acquire({"owner": "survivor"})
        restarted_services = FakeServices()
        restarted = manager.InferenceManager(config(self.root), restarted_services, lambda: self.now)
        await restarted.startup()
        self.assertEqual(restarted_services.switches, ["team"])

    async def test_configuration_refuses_non_loopback_plain_http(self):
        path = self.root / "manager.toml"
        path.write_text("[server]\ntcp_host = \"0.0.0.0\"\n")
        with self.assertRaisesRegex(RuntimeError, "must be loopback"):
            manager.ManagerConfig.load(path)

    async def test_systemd_state_and_runtime_directories_are_used(self):
        path = self.root / "manager.toml"
        path.write_text(
            '[server]\nstate_file = "${STATE_DIRECTORY}/state.json"\n'
            'unix_socket = "${RUNTIME_DIRECTORY}/control.sock"\n'
        )
        with patch.dict("os.environ", {
            "STATE_DIRECTORY": str(self.root / "systemd-state"),
            "RUNTIME_DIRECTORY": str(self.root / "systemd-runtime"),
        }):
            loaded = manager.ManagerConfig.load(path)
        self.assertEqual(loaded.state_file, self.root / "systemd-state/state.json")
        self.assertEqual(loaded.unix_socket, self.root / "systemd-runtime/control.sock")

    async def test_rejects_invalid_ttl_and_owner(self):
        with self.assertRaises(manager.ManagerError):
            await self.manager.acquire({"owner": "", "ttl_seconds": 300})
        with self.assertRaises(manager.ManagerError):
            await self.manager.acquire({"owner": "ok", "ttl_seconds": 10})
        with self.assertRaises(manager.ManagerError):
            await self.manager.acquire({"owner": "log\ninjection"})
        with self.assertRaises(manager.ManagerError):
            await self.manager.acquire({"owner": "safe", "lease_id": "x/" * 20})

    async def test_shared_client_uses_trusted_unix_socket_end_to_end(self):
        socket_path = self.root / "control.sock"
        http = manager.HTTPServer(self.manager, "unused-over-unix")
        server = await asyncio.start_unix_server(lambda reader, writer: http.handle(reader, writer, True), path=socket_path)
        config_value = client.ClientConfig("unix", socket_path, "https://unused.test", self.root / "missing", None, None, {})
        control = client.ControlClient(config_value)
        lease_id = "unix-client-generated-lease-id-000000001"
        try:
            acquired = await asyncio.to_thread(control.request, "POST", "/v1/leases", {
                "owner": "unix-client", "mode": "team", "ttl_seconds": 60, "lease_id": lease_id,
            })
            self.assertEqual(acquired["lease_id"], lease_id)
            status = await asyncio.to_thread(control.request, "GET", "/v1/status")
            self.assertEqual(status["lease"]["owner"], "unix-client")
        finally:
            server.close()
            await server.wait_closed()

    async def test_tcp_http_requires_control_bearer_token(self):
        http = manager.HTTPServer(self.manager, "control-token")
        server = await asyncio.start_server(lambda reader, writer: http.handle(reader, writer, False), "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]

        async def request(authorization: str = ""):
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            auth = f"Authorization: {authorization}\r\n" if authorization else ""
            writer.write(f"GET /v1/status HTTP/1.1\r\nHost: localhost\r\n{auth}\r\n".encode())
            await writer.drain()
            response = await reader.read()
            writer.close()
            await writer.wait_closed()
            return response

        try:
            self.assertIn(b"HTTP/1.1 401", await request())
            response = await request("Bearer control-token")
            self.assertIn(b"HTTP/1.1 200", response)
            self.assertIn(b'\"version\":1', response)

            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(b"POST /v1/leases HTTP/1.1\r\nAuthorization: Bearer control-token\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n")
            await writer.drain()
            self.assertIn(b"HTTP/1.1 400", await reader.read())
            writer.close()
            await writer.wait_closed()

            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(b"POST /v1/leases HTTP/1.1\r\nAuthorization: Bearer control-token\r\nContent-Length: 1\r\n\r\n\xff")
            await writer.drain()
            self.assertIn(b"HTTP/1.1 400", await reader.read())
            writer.close()
            await writer.wait_closed()
        finally:
            server.close()
            await server.wait_closed()

    async def test_model_auth_endpoint_validates_model_bearer_not_control_bearer(self):
        http = manager.HTTPServer(self.manager, "control-token", "model-token")
        server = await asyncio.start_server(lambda reader, writer: http.handle(reader, writer, False), "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]

        async def request(authorization: str = ""):
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            auth = f"Authorization: {authorization}\r\n" if authorization else ""
            writer.write(f"GET /v1/model-auth HTTP/1.1\r\nHost: localhost\r\n{auth}\r\n".encode())
            await writer.drain()
            response = await reader.read()
            writer.close()
            await writer.wait_closed()
            return response

        try:
            self.assertIn(b"HTTP/1.1 401", await request())
            self.assertIn(b"HTTP/1.1 401", await request("Bearer control-token"))
            self.assertIn(b"HTTP/1.1 200", await request("Bearer model-token"))
        finally:
            server.close()
            await server.wait_closed()

    async def test_model_auth_endpoint_fails_closed_without_configured_model_token(self):
        http = manager.HTTPServer(self.manager, "control-token")
        server = await asyncio.start_server(lambda reader, writer: http.handle(reader, writer, False), "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(b"GET /v1/model-auth HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer None\r\n\r\n")
            await writer.drain()
            self.assertIn(b"HTTP/1.1 401", await reader.read())
            writer.close()
            await writer.wait_closed()
        finally:
            server.close()
            await server.wait_closed()

    async def test_transition_endpoint_reports_live_progress_without_the_lease_lock(self):
        # Simulate a transition being mid-flight by holding the manager lock,
        # the same way set_mode()/acquire() do for the whole switch() call.
        self.services.progress = "starting router"
        http = manager.HTTPServer(self.manager, "control-token")
        server = await asyncio.start_server(lambda reader, writer: http.handle(reader, writer, False), "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        try:
            async with self.manager.lock:
                reader, writer = await asyncio.open_connection("127.0.0.1", port)
                writer.write(b"GET /v1/transition HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer control-token\r\n\r\n")
                await writer.drain()
                response = await asyncio.wait_for(reader.read(), timeout=2)
                writer.close()
                await writer.wait_closed()
            self.assertIn(b"HTTP/1.1 200", response)
            self.assertIn(b'"progress":"starting router"', response)
        finally:
            server.close()
            await server.wait_closed()

    async def test_transition_endpoint_appends_ram_copy_progress_when_present(self):
        self.services.progress = "waiting for ds4 to become ready"
        http = manager.HTTPServer(self.manager, "control-token")
        server = await asyncio.start_server(lambda reader, writer: http.handle(reader, writer, False), "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]

        async def request():
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(b"GET /v1/transition HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer control-token\r\n\r\n")
            await writer.drain()
            response = await reader.read()
            writer.close()
            await writer.wait_closed()
            return response

        try:
            with patch.dict("os.environ", {"XDG_RUNTIME_DIR": str(self.root)}):
                # No copy in flight yet: base message only.
                self.assertIn(b'"progress":"waiting for ds4 to become ready"', await request())

                # A copy in flight: percentage appended.
                (self.root / "ds4-ram-copy.progress").write_text("42% (34/80 GiB)\n")
                self.assertIn(
                    b'"progress":"waiting for ds4 to become ready: 42% (34/80 GiB)"',
                    await request(),
                )
        finally:
            server.close()
            await server.wait_closed()


    async def test_qwen_flash_is_a_settable_mode(self):
        result = await self.manager.set_mode({"mode": "qwen-flash"})
        self.assertEqual(result["mode"], "qwen-flash")
        self.assertEqual(self.services.switches, ["qwen-flash"])
        status = await self.manager.status()
        self.assertEqual(status["services"]["qwen"], "active")
        self.assertEqual(status["services"]["router"], "inactive")

    async def test_qwen_flash_is_a_leasable_mode_like_the_others(self):
        acquired = await self.manager.acquire({"owner": "worker", "mode": "qwen-flash", "ttl_seconds": 60})
        self.assertEqual(acquired["mode"], "qwen-flash")
        self.assertEqual(self.services.switches, ["qwen-flash"])
        with self.assertRaisesRegex(manager.ManagerError, "while GPU lease is held") as conflict:
            await self.manager.set_mode({"mode": "team"})
        self.assertEqual(conflict.exception.status, 409)
        released = await self.manager.release(acquired["lease_id"], {"restore_mode": "team"})
        self.assertEqual(released["mode"], "team")
        self.assertEqual(self.services.switches, ["qwen-flash", "team"])

    async def test_maintenance_and_release_round_trip_through_qwen_flash(self):
        # The point of accepting qwen-flash as a restore mode: an update can take the box
        # out from under a 262K session and has to be able to put it back.
        await self.manager.set_mode({"mode": "qwen-flash"})
        acquired = await self.manager.acquire(
            {"owner": "updater", "mode": "maintenance", "expected_restore_mode": "qwen-flash", "ttl_seconds": 60}
        )
        self.assertEqual(acquired["restore_mode"], "qwen-flash")
        released = await self.manager.release(acquired["lease_id"])
        self.assertEqual(released["mode"], "qwen-flash")
        self.assertEqual(self.services.switches, ["qwen-flash", "maintenance", "qwen-flash"])

    async def test_rejected_mode_errors_name_the_modes_that_exist(self):
        # These strings used to be hand-written prose next to a separate literal set, so a
        # new mode could be accepted while the message still told you the old list.
        with self.assertRaises(manager.ManagerError) as mode_error:
            await self.manager.set_mode({"mode": "nope"})
        self.assertIn("qwen-flash", str(mode_error.exception))
        with self.assertRaises(manager.ManagerError) as lease_error:
            await self.manager.acquire({"owner": "worker", "mode": "nope"})
        self.assertIn("qwen-flash", str(lease_error.exception))
        self.assertIn("maintenance", str(lease_error.exception))
        with self.assertRaises(manager.ManagerError) as restore_error:
            await self.manager.release("id", {"restore_mode": "nope"})
        self.assertIn("qwen-flash", str(restore_error.exception))

    async def test_state_file_loads_before_and_after_the_mode_change(self):
        # Backward: a state.json written by the previous build must load, or upgrading the
        # manager on a live host is an outage. Forward: the new mode must load, or rolling the
        # code back is.
        #
        # An unfamiliar mode used to raise here, and this test asserted that. It was the
        # rollback crash-loop, written down as an expectation: `startup()` loads state before
        # the listeners open, so the raise took the control plane down and `Restart=on-failure`
        # replayed it forever. Degrading to `unknown` is the behaviour; the reasons and the
        # fail-closed lease are in StateFileRecoveryTest.
        for mode in ("ds4", "qwen-flash", "unknown"):
            path = self.root / "state.json"
            path.write_text(json.dumps({"version": 1, "mode": mode, "lease": None, "updated_at": "x"}))
            self.assertEqual(manager.StateStore(path).load()["mode"], mode)
        (self.root / "state.json").write_text(
            json.dumps({"version": 1, "mode": "teamly", "lease": None, "updated_at": "x"})
        )
        self.assertEqual(manager.StateStore(self.root / "state.json").load()["mode"], "unknown")

    async def test_force_must_be_an_explicit_boolean(self):
        # "force": "false" must not mean force. A string that Python would happily treat as
        # truthy would turn the one dangerous flag in the API into a joke.
        for value in ("true", "false", 1, 0, None):
            with self.assertRaisesRegex(manager.ManagerError, "force must be a boolean"):
                await self.manager.set_mode({"mode": "team", "force": value})

    async def test_force_overrides_guards_but_never_another_owners_lease(self):
        acquired = await self.manager.acquire({"owner": "worker", "mode": "team"})
        with self.assertRaisesRegex(manager.ManagerError, "while GPU lease is held") as conflict:
            await self.manager.set_mode({"mode": "ds4", "force": True})
        self.assertEqual(conflict.exception.status, 409)
        self.assertEqual(self.services.mode, "team")
        await self.manager.release(acquired["lease_id"])
        await self.manager.set_mode({"mode": "ds4", "force": True})
        self.assertEqual(self.services.forced, [False, True])

    async def test_startup_does_not_take_the_control_plane_down_with_a_failed_transition(self):
        # serve() calls startup() before it listens, so an exception here used to mean the
        # manager exited and Restart=on-failure replayed the same failure every 3s: the ds4
        # crash loop, one level up. The lease survives; the mode becomes unknown.
        await self.manager.acquire({"owner": "survivor", "mode": "team"})
        broken = FakeServices()
        broken.failure = manager.ManagerError(503, "card is busy")
        restarted = manager.InferenceManager(config(self.root), broken, lambda: self.now)
        await restarted.startup()
        state = json.loads((self.root / "state.json").read_text())
        self.assertEqual(state["mode"], "unknown")
        self.assertIsNotNone(state["lease"])


class TransitionGuardTest(unittest.IsolatedAsyncioTestCase):
    """The checks that refuse a transition, and the force that overrides them.

    Every guard case asserts one thing above all others: the systemctl call list is empty.
    A refusal that happens after the previous owner has been stopped leaves the host with
    nothing running and nothing started, which is the state the ds4 crash loop was born in
    — and it is the outcome a guard is supposed to make impossible, not merely delay.
    """

    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pi-inference-guard-")
        self.root = Path(self.temp.name)

    async def asyncTearDown(self):
        self.temp.cleanup()

    def all_inactive(self) -> dict[str, str]:
        return {unit: "inactive" for unit in OWNER_UNITS.values()}

    async def test_every_mode_leaves_exactly_its_owner_running(self):
        """The truth table. One assertion per mode, all four units, including that
        stop/maintenance stop qwen-flash — which is the whole reason `free` can mean
        anything on this host."""
        for mode in (*OWNER_MODES, "stop", "maintenance"):
            with self.subTest(mode=mode):
                states = self.all_inactive()
                controller, _calls = fake_controller(self.root, states)
                await controller._switch(mode)
                for owner_mode, unit in OWNER_UNITS.items():
                    want = "active" if owner_mode == mode else "inactive"
                    self.assertEqual(states[unit], want, f"{unit} after switch({mode})")

    async def test_refuses_up_front_when_no_unit_explains_the_used_vram(self):
        # Today's live state, exactly: 30.7 GiB held, every owner unit stopped, ComfyUI idle.
        states = self.all_inactive()
        controller, calls = fake_controller(self.root, states, vram=FULL_CARD)
        with self.assertRaisesRegex(manager.ManagerError, "outside this manager") as error:
            await controller._switch("ds4")
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(mutations(calls), [])

    async def test_allows_the_transition_when_the_holder_is_a_unit_it_will_stop(self):
        # Without this the guard would be a blunt instrument: qwen holding 30 GiB is only a
        # problem if nobody is allowed to stop it, and switching to team is exactly that.
        states = {**self.all_inactive(), "qwen-flash.service": "active"}
        controller, calls = fake_controller(self.root, states, vram=FULL_CARD)
        await controller._switch("team")
        self.assertEqual(states["qwen-flash.service"], "inactive")
        self.assertTrue(any(call[2:4] == ["start", "router"] for call in calls))

    async def test_refuses_when_comfyui_holds_too_much_for_the_target(self):
        # ComfyUI is a peer: no transition can stop it. 32624 - 20480 = 12144 free, and ds4
        # needs 30720, so this is the "two 30 GiB workloads onto one card" case with
        # numbers in the message rather than an OOM three minutes later.
        states = self.all_inactive()
        controller, calls = fake_controller(self.root, states, vram=(20992.0, 32624.0), comfy=20480.0)
        with self.assertRaisesRegex(manager.ManagerError, "ComfyUI holds 20480 MiB") as error:
            await controller._switch("ds4")
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(mutations(calls), [])

    async def test_allows_a_target_when_comfyui_holds_only_its_working_set(self):
        # Idle ComfyUI costs nothing and must not block anything. Measured on this host:
        # comfyui.service up for days with torch_vram_total 0, and torch keeps a few hundred
        # MiB after a render. Below the idle ceiling that is nothing, and the guard has to
        # agree or it will refuse every transition on an otherwise idle box.
        states = self.all_inactive()
        controller, calls = fake_controller(self.root, states, vram=(600.0, 32624.0), comfy=512.0)
        await controller._switch("team")
        self.assertEqual(states["router"], "active")
        self.assertTrue(mutations(calls))

    async def test_refuses_while_another_owner_is_generating(self):
        states = {**self.all_inactive(), "qwen-flash.service": "active"}
        controller, calls = fake_controller(
            self.root, states, vram=FULL_CARD, busy={"qwen-flash": "slot 0, 100908 prompt tokens"}
        )
        with self.assertRaisesRegex(manager.ManagerError, "100908 prompt tokens") as error:
            await controller._switch("ds4")
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(mutations(calls), [])

    async def test_a_server_that_will_not_say_is_refused_too(self):
        # "Silent" is either generating or wedged. Refusing is the only honest option, and
        # force is one keystroke, which beats explaining why a wedged-but-resident qwen got
        # stopped mid-request.
        states = {**self.all_inactive(), "qwen-flash.service": "active"}
        controller, calls = fake_controller(self.root, states, vram=FULL_CARD, silent=("qwen-flash",))
        with self.assertRaisesRegex(manager.ManagerError, "either generating or wedged") as error:
            await controller._switch("team")
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(mutations(calls), [])

    async def test_no_endpoint_is_never_a_refusal(self):
        # ds4 has no occupancy endpoint. If `unknown` refused, ds4 could never be stopped or
        # switched away from, and an unswitchable mode is worse than an unfenced one. The
        # honest answer and the actionable answer are different things here.
        states = {**self.all_inactive(), "ds4": "active"}
        controller, calls = fake_controller(self.root, states, vram=FULL_CARD)

        async def ds4_is_unreadable(mode: str) -> tuple[str, str]:
            if mode == "ds4":
                return "unknown", "ds4 exposes no occupancy endpoint"
            return "idle", "stub: idle"

        controller.occupancy = ds4_is_unreadable  # type: ignore[method-assign]
        await controller._switch("team")
        self.assertEqual(states["ds4"], "inactive")
        self.assertEqual(states["router"], "active")
        self.assertTrue(mutations(calls))

    async def test_force_runs_the_transition_anyway_and_says_what_it_stepped_over(self):
        states = {**self.all_inactive(), "qwen-flash.service": "active"}
        controller, calls = fake_controller(
            self.root, states, vram=FULL_CARD, busy={"qwen-flash": "slot 0, 100908 prompt tokens"}
        )
        with self.assertLogs("pi-inference-manager", level="WARNING") as logs:
            await controller._switch("ds4", force=True)
        self.assertEqual(states["qwen-flash.service"], "inactive")
        self.assertEqual(states["ds4"], "active")
        joined = "\n".join(logs.output)
        self.assertIn("transition_forced mode=ds4", joined)
        self.assertIn("100908 prompt tokens", joined)

    async def test_capacity_checks_never_block_handing_the_card_back(self):
        # Refusing `stop` because the card is busy would be absurd: stop is how you fix a
        # busy card. Only the occupancy fence may object.
        states = {**self.all_inactive(), "qwen-flash.service": "active"}
        controller, calls = fake_controller(self.root, states, vram=FULL_CARD)
        await controller._switch("stop")
        self.assertEqual(states["qwen-flash.service"], "inactive")
        self.assertTrue(mutations(calls))

    async def test_even_stop_is_refused_while_a_model_is_generating(self):
        # The panel's "Free the GPU" button is the most destructive action on this host,
        # precisely because it stops whoever is currently talking to the card. It is still
        # one click away — but it is a click that has to be made knowingly.
        states = {**self.all_inactive(), "qwen-flash.service": "active"}
        controller, calls = fake_controller(
            self.root, states, vram=FULL_CARD, busy={"qwen-flash": "slot 0, 100908 prompt tokens"}
        )
        with self.assertRaisesRegex(manager.ManagerError, "aborts that request") as error:
            await controller._switch("stop")
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(mutations(calls), [])
        await controller._switch("stop", force=True)
        self.assertEqual(states["qwen-flash.service"], "inactive")

    async def test_unknown_mode_is_rejected_with_the_mode_list(self):
        controller, calls = fake_controller(self.root, self.all_inactive())
        with self.assertRaisesRegex(manager.ManagerError, "qwen-flash") as error:
            await controller._switch("qwen")  # the ambiguous short name the docs used to use
        self.assertEqual(error.exception.status, 400)
        self.assertEqual(mutations(calls), [])

    async def test_post_condition_names_the_unit_that_did_not_move(self):
        # One exhaustive check replaced four hand-written ones that each covered only part
        # of the state. It has to say which unit moved wrong, not just that something did.
        states = self.all_inactive()
        controller, _calls = fake_controller(self.root, states)

        async def forever_activating(*args: str) -> tuple[int, str, str]:
            unit = args[3] if len(args) > 3 else ""
            if args[2] == "is-active":
                # Everything settles except the unit we were asked to start.
                return 0, ("activating" if unit == "ds4" else states.get(unit, "inactive")), ""
            if args[2] == "start":
                return 0, "", ""
            if args[2] == "stop":
                states[unit] = "inactive"
                return 0, "", ""
            return 0, "", ""

        controller._run = forever_activating  # type: ignore[method-assign]
        with self.assertRaisesRegex(manager.ManagerError, r"ds4=activating \(want active\)"):
            await controller._switch("ds4")


class OccupancyProbeTest(unittest.IsolatedAsyncioTestCase):
    """`unknown` must stay distinguishable from `idle`, everywhere.

    The fence can only refuse on evidence. ds4 has no occupancy endpoint at all, so a
    ds4 switch is never fenced, and if the probe reported `idle` for "no endpoint" or
    "server not answering" the panel would show a protected ds4 that has never been
    protected. That is the same lie the ownership layer was written to stop.
    """

    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pi-inference-occupancy-")
        self.root = Path(self.temp.name)
        self.controller = manager.ServiceController(config(self.root), vram_probe=lambda: EMPTY_CARD)

    async def asyncTearDown(self):
        self.temp.cleanup()

    def stub(self, payload):
        async def http_json(url: str, bearer: str | None = None, timeout: float = 2.0):
            return payload

        self.controller._http_json = http_json  # type: ignore[method-assign]

    async def test_qwen_slot_processing_is_busy_with_the_token_count(self):
        # Shape taken from the live server, not guessed: slot 0, is_processing,
        # n_prompt_tokens. The count is what makes the refusal actionable.
        self.stub([{"id": 0, "is_processing": True, "n_prompt_tokens": 100908, "n_ctx": 262144}])
        state, detail = await self.controller.occupancy("qwen-flash")
        self.assertEqual(state, "busy")
        self.assertIn("100908", detail)

    async def test_qwen_slot_idle_is_idle(self):
        self.stub([{"id": 0, "is_processing": False, "n_prompt_tokens": 100908}])
        state, _detail = await self.controller.occupancy("qwen-flash")
        self.assertEqual(state, "idle")

    async def test_router_with_nothing_loaded_is_idle_not_unknown(self):
        self.stub([])
        state, _detail = await self.controller.occupancy("team")
        self.assertEqual(state, "idle")

    async def test_ds4_has_no_occupancy_endpoint(self):
        async def must_not_be_called(url: str, bearer: str | None = None, timeout: float = 2.0):
            raise AssertionError(f"ds4 has no occupancy endpoint, but something probed {url}")

        self.controller._http_json = must_not_be_called  # type: ignore[method-assign]
        state, detail = await self.controller.occupancy("ds4")
        self.assertEqual(state, "unknown")
        self.assertIn("no occupancy endpoint", detail)

    async def test_a_server_that_does_not_answer_is_silent_not_idle(self):
        # The measured reason this state exists: /slots answered in 0.4 ms at idle and took
        # 4.58 s on the first call during a generation, because llama.cpp serves it off the
        # lock the decode loop holds. Treat "did not answer" as idle and the fence is wide
        # open during exactly the prefill it exists to protect — while /health answers in
        # 0.3 ms and the server looks perfectly fine.
        self.stub(None)
        state, detail = await self.controller.occupancy("qwen-flash")
        self.assertEqual(state, "silent")
        self.assertIn("holding the card", detail)

    async def test_a_malformed_slots_body_is_silent(self):
        self.stub({"error": "nope"})
        state, _detail = await self.controller.occupancy("qwen-flash")
        self.assertEqual(state, "silent")

    async def test_probe_timeout_clears_the_measured_lock_delay(self):
        # Regression against a short probe. If anyone tightens this below the 4.58 s
        # measured worst case the answer stops being "unknown" and starts being a wrong
        # one, which is the failure the panel ownership layer was written to prevent.
        seen: list[float] = []

        async def record(url: str, bearer: str | None = None, timeout: float = 0.0):
            seen.append(timeout)
            return []

        self.controller._http_json = record  # type: ignore[method-assign]
        await self.controller.occupancy("qwen-flash")
        self.assertEqual(len(seen), 1)
        self.assertGreaterEqual(seen[0], 8.0)
        self.assertLessEqual(seen[0], 15.0)


class VramLookupTest(unittest.TestCase):
    """The lookup that both checks are built on: find the AMD card by driver.

    rocm-smi calls the R9700 "card0"; in /sys/class/drm card0 is the idle NVIDIA GTX 1060
    and the R9700 is card1. A guard that reads the wrong card is worse than no guard, so
    this is asserted against a fake sysfs tree rather than trusted to a comment.
    """

    def fake_drm(self, root: Path, cards: dict[str, tuple[str, int, int]]) -> None:
        """Build a fake /sys/class/drm. `cardX/device/driver` is a real symlink to a
        directory named after the driver, because resolving that link is exactly what the
        production lookup does — and what it gets wrong if you index by card number."""
        drivers = root / "drivers"
        for name, (driver, total, used) in cards.items():
            target = drivers / driver
            target.mkdir(parents=True, exist_ok=True)
            device = root / name / "device"
            device.mkdir(parents=True)
            (device / "driver").symlink_to(target)
            (device / "mem_info_vram_total").write_text(str(total))
            (device / "mem_info_vram_used").write_text(str(used))
        (root / "card0-DP-1").mkdir(exist_ok=True)
        (root / "renderD128").mkdir(exist_ok=True)

    R9700 = {"card1": ("amdgpu", 32 * 2**30, 30700 * 2**20)}
    PLUS_NVIDIA = {"card0": ("nvidia", 6 * 2**30, 1024 * 2**20), **R9700}

    def test_finds_the_amd_card_even_though_nvidia_sorts_first(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fake_drm(root, self.PLUS_NVIDIA)
            device = manager._gpu_device_dir(root)
            self.assertIsNotNone(device)
            # The lookup hands back the device directory under the card it chose, which is
            # what the mem_info_* files live in; the card name is its parent's name.
            self.assertEqual(device.parent.name, "card1")
            used, total = manager.vram_mib(root)
            self.assertEqual(total, 32768.0)
            self.assertEqual(used, 30700.0)

    def test_connector_and_render_nodes_are_not_cards(self):
        # card0-DP-1 and renderD128 exist in the same directory and would be read as
        # candidate cards by anything that only globs "card".
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fake_drm(root, self.PLUS_NVIDIA)
            names = [entry.name for entry in root.iterdir() if entry.name.startswith("card")]
            self.assertIn("card0-DP-1", names)
            self.assertEqual(manager._gpu_device_dir(root).parent.name, "card1")

    def test_returns_no_evidence_when_there_is_no_amd_card(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fake_drm(root, {"card0": ("nvidia", 6 * 2**30, 1024 * 2**20)})
            self.assertIsNone(manager._gpu_device_dir(root))
            self.assertEqual(manager.vram_mib(root), (None, None))

    def test_missing_sysfs_is_no_evidence_not_zero(self):
        with tempfile.TemporaryDirectory() as temp:
            self.assertEqual(manager.vram_mib(Path(temp) / "absent"), (None, None))


class ServiceControllerProgressTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pi-inference-progress-")
        self.root = Path(self.temp.name)
        self.controller = manager.ServiceController(config(self.root), vram_probe=lambda: EMPTY_CARD)
        self.states: dict[str, str] = {}
        self.observed: list[str | None] = []

        async def fake_run(*args: str):
            self.observed.append(self.controller.progress)
            if len(args) >= 3 and args[2] == "is-active":
                return 0, self.states.get(args[3], "inactive"), ""
            if len(args) >= 4 and args[2] == "stop":
                self.states[args[3]] = "inactive"
                return 0, "", ""
            if len(args) >= 4 and args[2] == "start":
                self.states[args[3]] = "active"
                return 0, "", ""
            return 0, "", ""

        async def fake_router_ready():
            self.controller.progress = "waiting for the router to become ready"
            self.observed.append(self.controller.progress)

        async def fake_ds4_ready():
            self.controller.progress = "waiting for ds4 to become ready"
            self.observed.append(self.controller.progress)

        async def fake_qwen_ready():
            self.controller.progress = "waiting for qwen-flash to become ready"
            self.observed.append(self.controller.progress)

        # The guard checks look at the card, ComfyUI, and the other owners' servers. Here
        # the card is empty and idle by definition; the tests that care about those signals
        # drive them directly in TransitionGuardTest.
        async def idle_card() -> float | None:
            return 0.0

        async def idle_occupancy(mode: str) -> tuple[str, str]:
            return "idle", "stub: idle"

        self.controller._run = fake_run  # type: ignore[method-assign]
        self.controller._router_ready = fake_router_ready  # type: ignore[method-assign]
        self.controller._ds4_ready = fake_ds4_ready  # type: ignore[method-assign]
        self.controller._qwen_ready = fake_qwen_ready  # type: ignore[method-assign]
        self.controller.comfy_held_mib = idle_card  # type: ignore[method-assign]
        self.controller.occupancy = idle_occupancy  # type: ignore[method-assign]

    async def asyncTearDown(self):
        self.temp.cleanup()

    async def test_team_switch_reports_progress_and_clears_it_on_success(self):
        self.assertIsNone(self.controller.progress)
        await self.controller.switch("team")
        self.assertIsNone(self.controller.progress)
        self.assertIn("stopping ds4", self.observed)
        self.assertIn("stopping qwen-flash.service", self.observed)
        self.assertIn("starting router", self.observed)
        self.assertIn("waiting for the router to become ready", self.observed)

    async def test_ds4_switch_reports_progress_and_clears_it_on_success(self):
        await self.controller.switch("ds4")
        self.assertIsNone(self.controller.progress)
        self.assertIn("stopping router", self.observed)
        self.assertIn("stopping qwen-flash.service", self.observed)
        self.assertIn("starting ds4", self.observed)
        self.assertIn("waiting for ds4 to become ready", self.observed)

    async def test_qwen_flash_switch_reports_progress_and_clears_it_on_success(self):
        await self.controller.switch("qwen-flash")
        self.assertIsNone(self.controller.progress)
        self.assertIn("stopping router", self.observed)
        self.assertIn("stopping ds4", self.observed)
        self.assertIn("starting qwen-flash.service", self.observed)
        self.assertIn("waiting for qwen-flash to become ready", self.observed)

    async def test_progress_clears_even_when_transition_fails(self):
        async def failing_start(unit: str):
            self.controller.progress = f"starting {unit}"
            raise manager.ManagerError(503, "could not start")

        self.controller._start = failing_start  # type: ignore[method-assign]
        with self.assertRaises(manager.ManagerError):
            await self.controller.switch("team")
        self.assertIsNone(self.controller.progress)

class TenantTest(unittest.IsolatedAsyncioTestCase):
    """VRAM tenants: the sidecar that holds a slice of the card without being a mode.

    Without this, a healthy `recognize-daemon` would block every mode switch on the host
    (check A refuses unexplained VRAM, and 356 MiB is unexplained), and the only way to make
    room for a model would be to go stop a service by hand — at which point the manager would
    never put it back. The two directions of that failure are the two things these tests
    pin: evict when and only when it is needed, and put it back when and only when the card
    has room.
    """

    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pi-inference-tenant-")
        self.root = Path(self.temp.name)

    async def asyncTearDown(self):
        self.temp.cleanup()

    async def test_a_healthy_sidecar_does_not_look_like_a_rogue_holder(self):
        # 2000 MiB held by one unit with every owner stopped is above the idle ceiling, so
        # without a tenant entry check A reads it as "something outside this manager owns the
        # card" and refuses everything, forever, on a host that is actually fine.
        peaks = {"recognize-daemon.service": 2000}
        running = {"recognize-daemon.service": "active"}
        wide, _calls, _states = tenant_world(
            self.root,
            tenants=(manager.Tenant("recognize-daemon.service", 2000, "low"),),
            peaks=peaks, running=running,
        )
        status = await wide.set_mode({"mode": "team"})
        self.assertEqual(status["mode"], "team")

        # Same card, same units running, no tenant declared: this is the refusal the tenant
        # entry exists to remove, so it has to still happen when nobody has said who holds it.
        blind, _calls, _states = tenant_world(self.root, tenants=(), peaks=peaks, running=running)
        with self.assertRaises(manager.ManagerError) as refused:
            await blind.set_mode({"mode": "team"})
        self.assertEqual(refused.exception.status, 409)
        self.assertIn("outside this manager", str(refused.exception))

    async def test_a_switch_evicts_the_sidecar_only_when_the_model_does_not_otherwise_fit(self):
        manager_ , calls, states = tenant_world(
            self.root,
            tenants=(SIDE_CAR,),
            peaks={
                "qwen-flash.service": 30552,
                "recognize-daemon.service": SIDE_CAR.peak_mib,
                "comfyui.service": 1500,
                "ds4": 30000,
            },
            running={"qwen-flash.service": "active", "recognize-daemon.service": "active"},
            comfy=1500,
            comfy_active=True,
        )
        result = await manager_.set_mode({"mode": "ds4"})
        self.assertEqual(result["mode"], "ds4")
        # ComfyUI holds 1500 and cannot be stopped, so the card has 31124 free with the
        # sidecar gone and 30356 with it — ds4 wants 30720, which is the gap eviction exists
        # for. The point of the assertion is that it was the sidecar that moved.
        self.assertEqual(result["evicted_tenants"], ["recognize-daemon.service"])
        self.assertIn("stop recognize-daemon.service", mutations(calls))
        self.assertEqual(states["recognize-daemon.service"], "inactive")
        listed = await manager_.status()
        self.assertEqual([t["intent"] for t in listed["tenants"]], ["evicted"])

    async def test_the_sidecar_is_left_alone_when_stopping_the_previous_model_pays_for_it(self):
        # Same eviction machinery, same tenant, but nothing immovable on the card: stopping
        # qwen frees far more than ds4 needs, so touching the sidecar would be vandalism.
        manager_, calls, states = tenant_world(
            self.root,
            tenants=(SIDE_CAR,),
            peaks={
                "qwen-flash.service": 30552,
                "recognize-daemon.service": SIDE_CAR.peak_mib,
                "ds4": 30000,
            },
            running={"qwen-flash.service": "active", "recognize-daemon.service": "active"},
            comfy_active=False,
        )
        result = await manager_.set_mode({"mode": "ds4"})
        self.assertNotIn("evicted_tenants", result)
        self.assertNotIn("stop recognize-daemon.service", mutations(calls))
        self.assertEqual(states["recognize-daemon.service"], "active")

    async def test_a_fixed_tenant_is_counted_and_never_touched(self):
        # `fixed` is the priority for a service the manager must plan around but may not stop.
        # The refusal has to name it, because "it does not fit" with no reason attached is not
        # something you can act on from the panel.
        manager_, calls, states = tenant_world(
            self.root,
            tenants=(SIDE_CAR, FIXED_TENANT),
            peaks={"vendor-collector.service": FIXED_TENANT.peak_mib, "recognize-daemon.service": SIDE_CAR.peak_mib, "team": 18432},
            running={"recognize-daemon.service": "active", "vendor-collector.service": "active"},
        )
        # Force a card where even full eviction cannot fit the target, by making the target
        # want everything the fixed tenant is not holding.
        manager_.config.min_free_vram_mib["team"] = 32000
        with self.assertRaises(manager.ManagerError) as refused:
            await manager_.set_mode({"mode": "team"})
        self.assertIn("will not stop", str(refused.exception))
        self.assertNotIn("stop vendor-collector.service", mutations(calls))
        self.assertNotIn("stop recognize-daemon.service", mutations(calls))
        self.assertEqual(states["vendor-collector.service"], "active")

    async def test_handing_the_card_back_brings_the_sidecar_back(self):
        # The other half of the bargain, and the half that is easy to forget: eviction with no
        # restore is just a service that disappears when you use a model.
        manager_, calls, states = tenant_world(
            self.root,
            tenants=(SIDE_CAR,),
            peaks={
                "qwen-flash.service": 30552,
                "recognize-daemon.service": SIDE_CAR.peak_mib,
                "comfyui.service": 1500,
                "ds4": 30000,
            },
            running={"qwen-flash.service": "active", "recognize-daemon.service": "active"},
            comfy=1500,
            comfy_active=True,
        )
        evicted = await manager_.set_mode({"mode": "ds4"})
        self.assertIn("evicted_tenants", evicted)
        del calls[:]  # the restore below must not be credited to the earlier eviction
        freed = await manager_.set_mode({"mode": "stop"})
        self.assertEqual(freed["restored_tenants"], ["recognize-daemon.service"])
        self.assertIn("start recognize-daemon.service", mutations(calls))
        self.assertEqual(states["recognize-daemon.service"], "active")
        self.assertEqual([t["intent"] for t in (await manager_.status())["tenants"]], ["active"])

    async def test_a_tenant_stopped_by_hand_stays_stopped(self):
        # The distinction that makes the stop button mean anything: both cases look identical
        # to systemd, and reconcile must restore one and never the other.
        manager_, calls, states = tenant_world(
            self.root,
            tenants=(SIDE_CAR,),
            peaks={"recognize-daemon.service": SIDE_CAR.peak_mib, "stop": 0},
            running={"recognize-daemon.service": "active"},
        )
        stopped = await manager_.tenant_action({"unit": "recognize-daemon.service", "action": "stop"})
        self.assertEqual([t["intent"] for t in stopped["tenants"]], ["held"])
        self.assertEqual(states["recognize-daemon.service"], "inactive")
        # Card is now empty, so every condition for a restore holds except one.
        await manager_.set_mode({"mode": "stop"})
        self.assertNotIn("start recognize-daemon.service", mutations(calls))
        self.assertEqual(states["recognize-daemon.service"], "inactive")

    async def test_starting_a_tenant_needs_room_and_says_it_in_mib(self):
        manager_, calls, states = tenant_world(
            self.root,
            tenants=(SIDE_CAR,),
            # qwen at its deployed 30,552 would leave 2 GiB and the start would be correct;
            # this is the loaded-card case where starting a 768 MiB sidecar is a coin flip.
            peaks={"qwen-flash.service": 31500, "recognize-daemon.service": SIDE_CAR.peak_mib},
            running={"qwen-flash.service": "active"},
        )
        with self.assertRaises(manager.ManagerError) as refused:
            await manager_.tenant_action({"unit": "recognize-daemon.service", "action": "start"})
        message = str(refused.exception)
        self.assertEqual(refused.exception.status, 409)
        self.assertIn("1280", message)  # 768 allowance + 512 headroom
        self.assertIn("1124", message)  # what the card actually had
        self.assertIn("MiB", message)
        self.assertNotIn("start recognize-daemon.service", mutations(calls))
        forced = await manager_.tenant_action(
            {"unit": "recognize-daemon.service", "action": "start", "force": True}
        )
        self.assertIn("started", forced["message"])
        self.assertIn("start recognize-daemon.service", mutations(calls))

    async def test_a_manual_tenant_stop_does_not_leave_a_transition_running(self):
        # `_stop` sets `progress` as a side effect and `switch()` is what clears it. The tenant
        # API has no surrounding transition to clear it, so without an explicit reset the
        # manager reports "stopping recognize-daemon.service" on /v1/transition forever — and
        # reconcile refuses to run while progress is set, so the tenant could never come back
        # either. This one was found live: the 30 s timer was firing and politely doing nothing.
        manager_, calls, states = tenant_world(
            self.root,
            tenants=(SIDE_CAR,),
            peaks={"qwen-flash.service": 30000, "recognize-daemon.service": SIDE_CAR.peak_mib},
            running={"qwen-flash.service": "active", "recognize-daemon.service": "active"},
        )
        await manager_.tenant_action({"unit": "recognize-daemon.service", "action": "stop"})
        self.assertIsNone(manager_.services.progress)
        self.assertEqual(states["recognize-daemon.service"], "inactive")
        # The other half: reconcile is live again, so a tenant the manager itself moved can
        # still come back after a hand stop moved it out first.
        state = manager_.store.load()
        manager_._set_intent(state, "recognize-daemon.service", "evicted", "made room for ds4")
        manager_.store.save(state)
        self.assertEqual(await manager_.reconcile_tenants("test"), ["recognize-daemon.service"])
        self.assertIn("start recognize-daemon.service", mutations(calls))

    async def test_reconcile_leaves_a_failed_tenant_alone(self):
        # `failed` is not `inactive`. Auto-restarting something that crash-looped 147,780
        # times is a lesson this host has already learned the hard way.
        manager_, calls, states = tenant_world(
            self.root,
            tenants=(SIDE_CAR,),
            peaks={"recognize-daemon.service": SIDE_CAR.peak_mib},
            running={"recognize-daemon.service": "failed"},
        )
        manager_.store.save({"version": 1, "mode": "stop", "lease": None, "updated_at": "x",
                             "tenants": {"recognize-daemon.service": {"intent": "evicted", "reason": "test", "at": "x"}}})
        started = await manager_.reconcile_tenants("test")
        self.assertEqual(started, [])
        self.assertNotIn("start recognize-daemon.service", mutations(calls))

    async def test_a_lease_keeps_the_sidecar_off_the_card(self):
        # A lease is the whole card. A sidecar waiting in the wings stays there until the
        # person who reserved it is finished, whatever the free-VRAM arithmetic says.
        manager_, calls, _states = tenant_world(
            self.root,
            tenants=(SIDE_CAR,),
            peaks={"recognize-daemon.service": SIDE_CAR.peak_mib},
            running={},
        )
        manager_.store.save({"version": 1, "mode": "stop", "updated_at": "x",
                             "lease": {"id_hash": "b" * 64, "owner": "host:repo:task", "mode": "team",
                                        "restore_mode": None, "acquired_at": "2026-09-23T00:00:00Z",
                                        "expires_at": 1_700_000_300.0},
                             "tenants": {"recognize-daemon.service": {"intent": "evicted", "reason": "test", "at": "x"}}})
        self.assertEqual(await manager_.reconcile_tenants("test"), [])
        self.assertNotIn("start recognize-daemon.service", mutations(calls))

    async def test_tenants_are_inert_when_none_are_configured(self):
        # Every tenant test above could pass while the feature broke the default host, if the
        # empty case started issuing systemctl calls for a unit nobody declared.
        manager_, calls, _states = tenant_world(self.root, tenants=(), peaks={})
        await manager_.set_mode({"mode": "team"})
        self.assertNotIn("tenants", await manager_.status())
        self.assertEqual(await manager_.reconcile_tenants("test"), [])
        self.assertNotIn("recognize-daemon.service", " ".join(" ".join(c) for c in calls))


class StateFileRecoveryTest(unittest.IsolatedAsyncioTestCase):
    """state.json must never be able to take the control plane down.

    `load()` used to raise on an unfamiliar mode, an unknown schema version, or a file that
    was not JSON, and `startup()` runs before the listeners open — so any of those left
    `Restart=on-failure` replaying the same failure forever, with the tool you need during a
    GPU incident being the thing that would not stay up. These tests are mostly about the
    rollback case, because that is an ordinary operation rather than an accident: the state
    file legitimately contains modes that whatever code is installed next has no name for.
    """

    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pi-inference-state-")
        self.root = Path(self.temp.name)
        self.now = 1_700_000_000.0
        self.services = FakeServices()

    async def asyncTearDown(self):
        self.temp.cleanup()

    def build(self) -> manager.InferenceManager:
        return manager.InferenceManager(config(self.root), self.services, lambda: self.now)

    def write_state(self, payload) -> Path:
        path = self.root / "state.json"
        path.write_text(payload if isinstance(payload, str) else json.dumps(payload), encoding="utf-8")
        return path

    async def test_rollback_to_older_code_reports_unknown_instead_of_dying(self):
        self.write_state({
            "version": 1, "mode": "qwen-flash", "lease": None,
            "updated_at": "2026-09-23T10:00:00+00:00",
        })
        # What is actually being tested: STATE_MODES as it stood before qwen-flash existed.
        # The running manager now holds a mode the reverted binary has never seen.
        with patch.object(manager, "STATE_MODES", ("team", "studio", "ds4", "stop", "maintenance", "unknown")):
            status = await self.build().status()
        self.assertEqual(status["mode"], "unknown")
        self.assertNotIn("state_error", status)
        self.assertNotIn("qwen-flash", json.dumps(status))

    async def test_rollback_keeps_a_lease_someone_else_is_holding(self):
        # The mode string is the part older code cannot understand. The lease is a fact about
        # a person using the GPU, and dropping it because of a word they do not recognise
        # would hand the card out from under a live session.
        self.write_state({
            "version": 1, "mode": "qwen-flash",
            "lease": {"id_hash": "a" * 64, "owner": "host:repo:task", "mode": "qwen-flash",
                       "restore_mode": None, "acquired_at": "2026-09-23T10:00:00+00:00",
                       "expires_at": self.now + 300},
            "updated_at": "2026-09-23T10:00:00+00:00",
        })
        with patch.object(manager, "STATE_MODES", ("team", "studio", "ds4", "stop", "maintenance", "unknown")):
            rebuilt = self.build()
            status = await rebuilt.status()
            with self.assertRaises(manager.ManagerError) as refused:
                await rebuilt.acquire({"owner": "someone:else", "mode": "team", "ttl_seconds": 60})
        self.assertEqual(status["lease"]["owner"], "host:repo:task")
        self.assertEqual(refused.exception.status, 409)

    async def test_truncated_state_file_holds_the_card_against_everyone(self):
        # A crash mid-write is not possible (tmpfile + rename + fsync), but a bad edit during
        # an incident is. The safe answer is not "nobody owns the card".
        path = self.write_state('{"version": 1, "mode": "team", "lease": ')
        rebuilt = self.build()
        status = await rebuilt.status()
        self.assertEqual(status["mode"], "unknown")
        self.assertIn("not valid JSON", status["state_error"])
        self.assertEqual(status["lease"]["owner"], manager.StateStore.UNREADABLE_OWNER)
        with self.assertRaises(manager.ManagerError) as refused:
            await rebuilt.acquire({"owner": "someone:else", "mode": "team", "ttl_seconds": 60})
        self.assertEqual(refused.exception.status, 409)
        # The bytes are kept once, for the post-mortem, and later loads never touch the copy.
        backup = path.with_name("state.json.unreadable")
        self.assertEqual(backup.read_text(encoding="utf-8"), '{"version": 1, "mode": "team", "lease": ')
        await rebuilt.status()
        self.assertEqual(backup.read_text(encoding="utf-8"), '{"version": 1, "mode": "team", "lease": ')
        # The hold is durable, which is the only way it can expire. A fresh in-memory hold per
        # load would re-arm on every request and lock the host for as long as the file stayed
        # corrupt — the failure mode this is supposed to remove, not add.
        reloaded = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(reloaded["lease"]["owner"], manager.StateStore.UNREADABLE_OWNER)
        again = await rebuilt.status()
        self.assertNotIn("state_error", again)
        self.assertEqual(again["lease"]["owner"], manager.StateStore.UNREADABLE_OWNER)

    async def test_malformed_lease_is_not_read_as_no_lease(self):
        self.write_state({"version": 1, "mode": "team", "lease": {"owner": "host:repo:task"}})
        status = await self.build().status()
        self.assertEqual(status["lease"]["owner"], manager.StateStore.UNREADABLE_OWNER)
        self.assertIn("malformed lease", status["state_error"])

    async def test_future_schema_version_is_not_guessed_at(self):
        self.write_state({"version": 2, "mode": "team", "lease": None})
        status = await self.build().status()
        self.assertEqual(status["mode"], "unknown")
        self.assertIn("unsupported schema version", status["state_error"])

    async def test_the_hold_expires_and_the_host_becomes_usable_again(self):
        # Fail closed is only acceptable because it is bounded: an unrecoverable lock on the
        # GPU would be a worse failure than the one it protects against.
        self.write_state("not json at all")
        rebuilt = self.build()
        self.assertEqual((await rebuilt.status())["lease"]["owner"], manager.StateStore.UNREADABLE_OWNER)
        self.now += manager.StateStore(  # hold_seconds comes from config.default_ttl
            config(self.root).state_file, hold_seconds=config(self.root).default_ttl
        ).hold_seconds + 1
        status = await rebuilt.status()
        self.assertIsNone(status["lease"])
        self.assertNotIn("state_error", status)
        acquired = await rebuilt.acquire({"owner": "someone:else", "mode": "team", "ttl_seconds": 60})
        self.assertIn("lease_id", acquired)
        self.assertFalse((self.root / "state.json").read_text(encoding="utf-8").startswith("not json"))

    async def test_a_readable_file_is_left_byte_for_byte_alone(self):
        payload = {"version": 1, "mode": "ds4", "lease": None, "updated_at": "2026-09-23T10:00:00+00:00"}
        path = self.write_state(payload)
        self.assertEqual((await self.build().status())["mode"], "ds4")
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), payload)
        self.assertFalse((self.root / "state.json.unreadable").exists())


STUDIO_APP = manager.Tenant("unsloth.service", 0, "low", "Unsloth Studio (loaded GGUF)", "residual")
# The real declared peaks from manager.toml, so the arithmetic in these tests is the arithmetic
# the host does. `studio` deliberately has none: entering it loads nothing.
MEASURED_PEAKS = {"team": 18432, "ds4": 30720, "qwen-flash": 30552}
STUDIO_WORLD = {
    "studio_unit": "unsloth.service",
    "min_free_vram_mib": MEASURED_PEAKS,
}


class StudioDecouplingTest(unittest.IsolatedAsyncioTestCase):
    """Studio is an app that may hold VRAM, not a card owner.

    While `unsloth.service` was one of the owner units two things were unavoidable: `pi-inference
    stop` closed the user's Studio session to reclaim memory the app was not holding, and an
    always-on Studio would have looked like a permanent conflict. What these tests pin is both
    halves of the trade: the app is never touched by a mode switch, and yet a GGUF loaded inside
    it is still charged, still evicted when a model needs the room, and still a refusal when
    nothing explains it.
    """

    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pi-inference-studio-")
        self.root = Path(self.temp.name)

    async def asyncTearDown(self):
        self.temp.cleanup()

    def world(self, *, running: dict[str, str], gguf_mib: int = 0, extra_peaks: dict[str, int] | None = None):
        """A card whose usage is the sum of what is up, with a GGUF inside Studio.

        `gguf_mib` is memory the manager is never told about — no tenant declares a number for a
        residual holder — which is the point: it has to be found by elimination or not at all.
        """
        peaks = {"unsloth.service": gguf_mib, "qwen-flash.service": MEASURED_PEAKS["qwen-flash"]}
        peaks.update(extra_peaks or {})
        return tenant_world(
            self.root,
            tenants=(STUDIO_APP,),
            peaks=peaks,
            running=running,
            config_overrides=STUDIO_WORLD,
        )

    async def test_no_mode_switch_touches_the_app_unit(self):
        for mode in ("team", "ds4", "qwen-flash", "stop", "maintenance"):
            with self.subTest(mode=mode):
                controller, calls, states = self.world(
                    running={"unsloth.service": "active", "qwen-flash.service": "active"}
                )
                await controller.services.switch(mode)
                self.assertFalse(
                    [call for call in mutations(calls) if "unsloth.service" in call],
                    f"{mode} went near Studio's unit",
                )
                self.assertEqual(states["unsloth.service"], "active")

    async def test_entering_studio_stops_the_models_and_starts_the_app(self):
        controller, calls, states = self.world(running={"qwen-flash.service": "active"})
        status = await controller.set_mode({"mode": "studio"})
        self.assertEqual(status["mode"], "studio")
        self.assertEqual(states["unsloth.service"], "active", "the mode did not bring the app up")
        self.assertEqual(states["qwen-flash.service"], "inactive")
        self.assertIn("start unsloth.service", mutations(calls))
        self.assertNotIn("start qwen-flash.service", mutations(calls))

    async def test_handing_the_card_back_stops_a_loaded_gguf_and_spares_an_idle_app(self):
        loaded, _calls, states = self.world(running={"unsloth.service": "active"}, gguf_mib=20480)
        await loaded.services.switch("stop")
        self.assertEqual(states["unsloth.service"], "inactive", "'free the card' left 20 GiB loaded")

        idle, _calls, states = self.world(running={"unsloth.service": "active"})
        await idle.services.switch("stop")
        self.assertEqual(
            states["unsloth.service"], "active", "an app holding nothing has no business being closed"
        )

    async def test_a_model_takes_the_card_from_a_loaded_gguf_by_itself(self):
        controller, calls, states = self.world(
            running={"unsloth.service": "active"},
            gguf_mib=20480,
            extra_peaks={"ds4": 30000},
        )
        status = await controller.set_mode({"mode": "ds4"})
        self.assertEqual(status["mode"], "ds4")
        self.assertEqual(states["unsloth.service"], "inactive")
        self.assertIn("stop unsloth.service", mutations(calls))

    async def test_an_evicted_app_waits_for_an_idle_card_instead_of_flapping(self):
        controller, calls, states = self.world(
            running={"unsloth.service": "active"}, gguf_mib=20480, extra_peaks={"ds4": 30000}
        )
        await controller.set_mode({"mode": "ds4"})
        self.assertIn("stop unsloth.service", mutations(calls))
        self.assertNotIn(
            "start unsloth.service", mutations(calls),
            "restarting the app under a loaded model hands back the memory the switch just took",
        )
        # Hand the card back and it is safe again: nothing else is on the card for its next
        # allocation to collide with, so the reconcile may bring it up.
        await controller.services.switch("stop")
        self.assertEqual(states["unsloth.service"], "inactive", "handing the card back should stop the app too")
        await controller.reconcile_tenants("test")
        self.assertEqual(states["unsloth.service"], "active")

    async def test_a_card_hungry_mode_without_a_peak_is_refused_not_skipped(self):
        # `studio` left CARD_HUNGRY_MODES because entering it loads nothing and there is no
        # measurement to declare. What remains in that set are the three owners, and a missing
        # measurement among *those* must stop the transition: this is the hole `studio` fell
        # through, where an undeclared peak meant the capacity check was skipped rather than
        # failed, on the one check that keeps two 30 GiB models off one card.
        controller, calls, _states = tenant_world(
            self.root,
            tenants=(),
            peaks={"ds4": 30000},
            running={},
            config_overrides={"studio_unit": "unsloth.service", "min_free_vram_mib": {"team": 18432}},
        )
        with self.assertRaises(manager.ManagerError) as refused:
            await controller.set_mode({"mode": "ds4"})
        self.assertIn("no measured peak", str(refused.exception))
        self.assertFalse([call for call in mutations(calls) if call.startswith("start")])

    async def test_the_apps_absence_does_not_explain_a_rogue_holder(self):
        # Residual attribution is a charge against a running app, not a licence for mystery
        # memory: with Studio down the same bytes must refuse the switch again.
        controller, _calls, _states = tenant_world(
            self.root,
            tenants=(STUDIO_APP,),
            peaks={"x-another-workload.service": 8000},
            running={"x-another-workload.service": "active"},
            config_overrides=STUDIO_WORLD,
        )
        with self.assertRaises(manager.ManagerError) as refused:
            await controller.set_mode({"mode": "team"})
        self.assertIn("outside this manager", str(refused.exception))

    async def test_status_still_reports_the_app(self):
        controller, _calls, _states = self.world(running={"unsloth.service": "active"}, gguf_mib=20480)
        status = await controller.status()
        self.assertEqual(status["services"]["studio"], "active")
        self.assertEqual([t["unit"] for t in status["tenants"]], ["unsloth.service"])
        self.assertEqual(status["tenants"][0]["attribution"], "residual")


if __name__ == "__main__":
    unittest.main()
