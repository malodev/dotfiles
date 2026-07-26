import importlib.machinery
import importlib.util
import json
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "pi-inference-client-setup"
loader = importlib.machinery.SourceFileLoader("pi_inference_client_setup", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
assert spec is not None
setup = importlib.util.module_from_spec(spec)
loader.exec_module(setup)


class ClientSetupTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def private_file(self, path: Path, value: str = "secret\n") -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
        path.chmod(0o600)
        return path

    def test_requires_one_line_private_non_symlink_secret(self):
        secret = self.private_file(self.root / "secret")
        self.assertEqual(setup.require_private_secret(secret, "secret"), "secret")
        secret.chmod(0o640)
        with self.assertRaises(setup.SetupError):
            setup.require_private_secret(secret, "secret")
        secret.chmod(0o600)
        secret.write_text("one\ntwo\n")
        with self.assertRaises(setup.SetupError):
            setup.require_private_secret(secret, "secret")
        target = self.private_file(self.root / "target")
        link = self.root / "link"
        link.symlink_to(target)
        with self.assertRaises(setup.SetupError):
            setup.require_private_secret(link, "secret")

    def test_stow_preview_does_not_modify_home(self):
        dotfiles = self.root / "dotfiles"
        client = dotfiles / "pi" / ".local" / "bin" / "pi-inference"
        client.parent.mkdir(parents=True)
        client.write_text("#!/bin/sh\n")
        home = self.root / "home"
        home.mkdir()
        setup.stow_client(dotfiles, home, apply=False)
        self.assertEqual(list(home.iterdir()), [])

    def test_installs_credential_from_private_source_without_argument_leak(self):
        client = self.root / "pi-inference"
        client.write_text("#!/bin/sh\n")
        destination = self.root / "credentials" / "control-api-token"
        source = self.private_file(self.root / "source", "control-value\n")
        with patch.object(setup, "run") as invoked:
            setup.install_credential(client, "control-api", destination, source)
        argv = invoked.call_args.args[0]
        self.assertNotIn("control-value", " ".join(argv))
        self.assertEqual(invoked.call_args.kwargs["input_text"], "control-value\n")

    def test_existing_credential_is_validated_and_not_replaced(self):
        client = self.root / "pi-inference"
        client.write_text("#!/bin/sh\n")
        destination = self.private_file(self.root / "credentials" / "model-api-key")
        with patch.object(setup, "run") as invoked:
            setup.install_credential(client, "model-api", destination, None)
        invoked.assert_not_called()

    def test_redirect_handler_refuses_redirects(self):
        self.assertIsNone(
            setup.NoRedirect().redirect_request(
                object(), None, 302, "Found", {}, "https://attacker.example/"
            )
        )

    def test_locates_pi_inside_nvm_when_not_in_noninteractive_path(self):
        pi = self.root / ".nvm" / "versions" / "node" / "v22" / "bin" / "pi"
        pi.parent.mkdir(parents=True)
        pi.write_text("#!/bin/sh\n")
        with patch.object(setup.shutil, "which", return_value=None):
            self.assertEqual(setup.locate_pi(self.root), pi)

    def test_http_request_omits_authorization_when_no_bearer_is_supplied(self):
        class FakeResponse:
            status = 401

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b"{}"

        class FakeOpener:
            request = None

            def open(self, request, timeout):
                self.request = request
                return FakeResponse()

        opener = FakeOpener()
        with patch.object(setup.urllib.request, "build_opener", return_value=opener):
            self.assertEqual(setup.http_json("https://example.test/status"), (401, b"{}"))
        self.assertNotIn("Authorization", opener.request.headers)

    def test_verification_releases_lease_when_model_test_fails(self):
        home = self.root / "home"
        credential_dir = home / ".pi-inference" / "credentials"
        self.private_file(credential_dir / "control-api-token", "control\n")
        self.private_file(credential_dir / "model-api-key", "model\n")
        client = home / ".local" / "bin" / "pi-inference"
        client.parent.mkdir(parents=True)
        client.write_text("#!/bin/sh\n")
        calls = []

        def fake_run(argv, **kwargs):
            calls.append(list(argv))
            if "status" in argv:
                return SimpleNamespace(stdout=json.dumps({"mode": "team", "services": {}, "lease": None}))
            return SimpleNamespace(stdout="")

        responses = [(401, b"{}"), (201, b"{}"), (500, b"{}"), (200, b"{}")]
        http_calls = []

        def fake_http(url, **kwargs):
            http_calls.append((url, kwargs))
            return responses.pop(0)

        args = SimpleNamespace(model="model", with_pi=False)
        with patch.object(setup, "run", side_effect=fake_run), patch.object(
            setup, "http_json", side_effect=fake_http
        ):
            with self.assertRaises(setup.SetupError):
                setup.verify(args, client, home)
        self.assertTrue(any(url.endswith("/v1/leases") for url, _kwargs in http_calls))
        self.assertTrue(any(kwargs.get("method") == "DELETE" for _url, kwargs in http_calls))

    def test_verification_rejects_reused_control_and_model_credential(self):
        home = self.root / "home"
        credential_dir = home / ".pi-inference" / "credentials"
        self.private_file(credential_dir / "control-api-token", "same-secret\n")
        self.private_file(credential_dir / "model-api-key", "same-secret\n")
        client = home / ".local" / "bin" / "pi-inference"
        client.parent.mkdir(parents=True)
        client.write_text("#!/bin/sh\n")
        with self.assertRaisesRegex(setup.SetupError, "must be distinct"):
            setup.verify(SimpleNamespace(model="model", with_pi=False), client, home)


if __name__ == "__main__":
    unittest.main()
