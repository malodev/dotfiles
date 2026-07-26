from __future__ import annotations

import importlib.util
import json
import os
import stat
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).parents[2] / "pi/.local/lib/pi_inference/client.py"
SPEC = importlib.util.spec_from_file_location("pi_inference.client", MODULE)
client = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = client
assert SPEC.loader
SPEC.loader.exec_module(client)


class ClientTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pi-inference-client-")
        self.root = Path(self.temp.name)
        self.runtime = self.root / "run"
        self.runtime.mkdir()
        self.credentials = self.root / "credentials"
        self.credentials.mkdir()
        self.model_key = self.credentials / "model-api-key"
        self.control_key = self.credentials / "control-api-token"
        self.model_key.write_text("model-secret\n")
        self.control_key.write_text("control-secret\n")
        self.model_key.chmod(0o600)
        self.control_key.chmod(0o600)
        self.config_path = self.root / "client.json"
        self.config_path.write_text(json.dumps({
            "control": {
                "transport": "auto",
                "local_socket": str(self.runtime / "manager.sock"),
                "remote_url": "https://inference.example.test",
                "token_file": str(self.control_key),
            },
            "credentials": {"model_api_key_file": str(self.model_key)},
        }))

    def tearDown(self):
        self.temp.cleanup()

    def test_loads_portable_config_and_credentials(self):
        config = client.ClientConfig.load(self.config_path)
        self.assertEqual(config.transport, "auto")
        self.assertEqual(config.credentials["model-api"], self.model_key)
        self.assertEqual(client._read_secret(self.model_key), "model-secret")

    def test_stowed_profile_uses_bearer_only_remote_authentication(self):
        shared = client.ClientConfig.load(Path(__file__).parents[2] / "pi/.config/pi-inference/client.json")
        self.assertEqual(shared.remote_url, "https://inference.malo.tn.it")
        self.assertEqual(shared.local_socket, Path(os.environ.get("XDG_RUNTIME_DIR", "${XDG_RUNTIME_DIR}")) / "pi-inference-manager/control.sock")
        self.assertIsNone(shared.client_certificate_file)
        self.assertIsNone(shared.client_key_file)

    def test_mtls_paths_must_be_configured_together(self):
        raw = json.loads(self.config_path.read_text())
        raw["control"]["client_certificate_file"] = str(self.root / "client.crt")
        self.config_path.write_text(json.dumps(raw))
        with self.assertRaisesRegex(client.ClientError, "must be configured together"):
            client.ClientConfig.load(self.config_path)

    def test_rejects_broad_secret_permissions(self):
        self.model_key.chmod(0o644)
        with self.assertRaisesRegex(client.ClientError, "group/other"):
            client._read_secret(self.model_key)

    def test_installs_secret_privately_and_refuses_implicit_overwrite(self):
        target = self.credentials / "new-secret"
        client._write_private_secret(target, "value")
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        with self.assertRaisesRegex(client.ClientError, "--replace"):
            client._write_private_secret(target, "other")
        client._write_private_secret(target, "other", replace=True)
        self.assertEqual(target.read_text(), "other\n")

    def test_client_lock_serializes_concurrent_lease_state_mutations(self):
        state = self.root / "serialized-state"
        entered = threading.Event()

        def contender():
            with patch.dict(os.environ, {"PI_INFERENCE_STATE_HOME": str(state)}):
                with client._client_lock():
                    entered.set()

        with patch.dict(os.environ, {"PI_INFERENCE_STATE_HOME": str(state)}):
            with client._client_lock():
                thread = threading.Thread(target=contender)
                thread.start()
                time.sleep(0.05)
                self.assertFalse(entered.is_set())
            thread.join(timeout=1)
        self.assertTrue(entered.is_set())

    def test_explicit_zero_ttl_is_not_replaced_by_the_default(self):
        source = MODULE.read_text()
        self.assertIn("args.ttl if args.ttl is not None", source)

    def test_lease_record_is_private_and_keyed_by_owner(self):
        state = self.root / "state"
        with patch.dict(os.environ, {"PI_INFERENCE_STATE_HOME": str(state)}):
            path = client._lease_path("machine:repo:task")
            client._write_private_json(path, {"owner": "machine:repo:task", "lease_id": "opaque"})
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(client._load_lease("machine:repo:task")["lease_id"], "opaque")
            self.assertNotIn("machine:repo:task", path.name)
            config = client.ClientConfig.load(self.config_path)
            with self.assertRaisesRegex(client.ClientError, "different inference-manager origin"):
                client._assert_lease_manager({"manager": "https://different.test"}, config)

    def test_remote_transport_requires_https_origin_and_refuses_redirects(self):
        config = client.ClientConfig.load(self.config_path)
        insecure = client.ClientConfig("https", config.local_socket, "http://example.test", config.control_token_file, None, None, config.credentials)
        with self.assertRaisesRegex(client.ClientError, "HTTPS origin"):
            client.ControlClient(insecure).request("GET", "/v1/status")
        with_path = client.ClientConfig("https", config.local_socket, "https://example.test/control", config.control_token_file, None, None, config.credentials)
        with self.assertRaisesRegex(client.ClientError, "must not contain a path"):
            client.ControlClient(with_path).request("GET", "/v1/status")
        bearer_only = client.ClientConfig("https", config.local_socket, "https://example.test", config.control_token_file, None, None, config.credentials)

        class FakeResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b'{"version":1}'

        class FakeOpener:
            request = None

            def open(self, request, timeout):
                self.request = request
                return FakeResponse()

        opener = FakeOpener()
        with patch.object(urllib.request, "build_opener", return_value=opener):
            self.assertEqual(client.ControlClient(bearer_only).request("GET", "/v1/status"), {"version": 1})
        self.assertEqual(opener.request.get_header("Authorization"), "Bearer control-secret")
        handler = client.NoRedirectHandler()
        request = urllib.request.Request("https://example.test/v1/status")
        self.assertIsNone(handler.redirect_request(request, None, 302, "Found", {}, "https://attacker.test/"))


if __name__ == "__main__":
    unittest.main()
