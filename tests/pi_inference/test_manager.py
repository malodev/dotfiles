from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).parents[2] / "pi-inference-host/.local/lib/pi_inference_host/manager.py"
SPEC = importlib.util.spec_from_file_location("pi_inference_host.manager", MODULE)
manager = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = manager
assert SPEC.loader
SPEC.loader.exec_module(manager)

CLIENT_MODULE = Path(__file__).parents[2] / "pi/.local/lib/pi_inference/client.py"
CLIENT_SPEC = importlib.util.spec_from_file_location("pi_inference.client", CLIENT_MODULE)
client = importlib.util.module_from_spec(CLIENT_SPEC)
sys.modules[CLIENT_SPEC.name] = client
assert CLIENT_SPEC.loader
CLIENT_SPEC.loader.exec_module(client)


class FakeServices:
    def __init__(self):
        self.mode = "stop"
        self.switches: list[str] = []
        self.failure: Exception | None = None
        self.progress: str | None = None

    async def switch(self, mode: str) -> None:
        if self.failure:
            raise self.failure
        self.mode = mode
        self.switches.append(mode)

    async def status(self):
        return {
            "router": "active" if self.mode == "team" else "inactive",
            "studio": "active" if self.mode == "studio" else "inactive",
            "ds4": "active" if self.mode == "ds4" else "inactive",
        }


def config(root: Path):
    return manager.ManagerConfig(
        root / "manager.sock", "127.0.0.1", 46758, root / "control-token",
        root / "state.json", "router", "studio", "http://localhost/health",
        root / "model-key", 30, 3600, 300, 5,
        "ds4", "http://localhost/ds4-health",
    )


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


class ServiceControllerProgressTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pi-inference-progress-")
        self.root = Path(self.temp.name)
        self.controller = manager.ServiceController(config(self.root))
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

        self.controller._run = fake_run  # type: ignore[method-assign]
        self.controller._router_ready = fake_router_ready  # type: ignore[method-assign]
        self.controller._ds4_ready = fake_ds4_ready  # type: ignore[method-assign]

    async def asyncTearDown(self):
        self.temp.cleanup()

    async def test_team_switch_reports_progress_and_clears_it_on_success(self):
        self.assertIsNone(self.controller.progress)
        await self.controller.switch("team")
        self.assertIsNone(self.controller.progress)
        self.assertIn("stopping studio", self.observed)
        self.assertIn("stopping ds4", self.observed)
        self.assertIn("starting router", self.observed)
        self.assertIn("waiting for the router to become ready", self.observed)

    async def test_ds4_switch_reports_progress_and_clears_it_on_success(self):
        await self.controller.switch("ds4")
        self.assertIsNone(self.controller.progress)
        self.assertIn("stopping router", self.observed)
        self.assertIn("stopping studio", self.observed)
        self.assertIn("starting ds4", self.observed)
        self.assertIn("waiting for ds4 to become ready", self.observed)

    async def test_progress_clears_even_when_transition_fails(self):
        async def failing_start(unit: str):
            self.controller.progress = f"starting {unit}"
            raise manager.ManagerError(503, "could not start")

        self.controller._start = failing_start  # type: ignore[method-assign]
        with self.assertRaises(manager.ManagerError):
            await self.controller.switch("team")
        self.assertIsNone(self.controller.progress)


if __name__ == "__main__":
    unittest.main()
