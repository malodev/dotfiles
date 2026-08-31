from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


SCRIPT = Path(__file__).parents[1] / "local-bin/.local/bin/transcribe"


class TranscribeCommandTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="transcribe-command-")
        self.root = Path(self.temp.name)
        self.calls: list[dict] = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

        self.bin_dir = self.root / "bin"
        self.bin_dir.mkdir()
        self._write_fake_ffmpeg()
        self._write_fake_pi_inference()
        self.input_path = self.root / "recording.m4a"
        self.input_path.write_bytes(b"fake input")
        self.env = os.environ.copy()
        self.env.update(
            {
                "HOME": str(self.root / "home"),
                "PATH": f"{self.bin_dir}:{self.env['PATH']}",
                "STUDIO_API_KEY_FILE": str(self.root / "missing-key"),
                "FAKE_PI_MARKER": str(self.root / "pi-inference.marker"),
            }
        )

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp.cleanup()

    def _handler(self):
        calls = self.calls

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length)
                parsed = urlsplit(self.path)
                if parsed.path.endswith("/stt/load"):
                    payload = json.loads(body)
                    calls.append({"kind": "load", "payload": payload})
                    response = {"loaded_model": payload["model"]}
                elif parsed.path.endswith("/transcribe/raw"):
                    query = parse_qs(parsed.query)
                    calls.append(
                        {
                            "kind": "transcribe",
                            "model": query["model"][0],
                            "engine": query["engine"][0],
                            "fast": query["fast"][0],
                            "bytes": len(body),
                        }
                    )
                    response = {"text": "fake transcript"}
                else:
                    self.send_error(404)
                    return
                encoded = json.dumps(response).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

        return Handler

    def _write_fake_ffmpeg(self):
        fake = self.bin_dir / "ffmpeg"
        fake.write_text(
            "#!/usr/bin/env python3\n"
            "from pathlib import Path\n"
            "import sys\n"
            "pattern = sys.argv[-1]\n"
            "Path(pattern.replace('%04d', '0000')).write_bytes(b'fake audio')\n",
            encoding="utf-8",
        )
        fake.chmod(0o755)

    def _write_fake_pi_inference(self):
        fake = self.bin_dir / "pi-inference"
        fake.write_text(
            "#!/usr/bin/env python3\n"
            "import os\n"
            "import sys\n"
            "if sys.argv[1:] == ['--json', 'status']:\n"
            "    print('{\"mode\":\"stop\",\"services\":{\"studio\":\"inactive\"}}')\n"
            "elif sys.argv[1:] == ['studio']:\n"
            "    open(os.environ['FAKE_PI_MARKER'], 'w').write('switched')\n"
            "else:\n"
            "    raise SystemExit(1)\n",
            encoding="utf-8",
        )
        fake.chmod(0o755)

    def _run(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), *arguments],
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_help_describes_turbo_option(self):
        result = self._run("-h")
        self.assertEqual(result.returncode, 0)
        self.assertIn("-t, --turbo", result.stdout)
        self.assertIn("-f, --file", result.stdout)
        self.assertIn("-o, --output FILE", result.stdout)

    def test_standard_loads_studio_and_keeps_stdout_clean(self):
        work = self.root / "standard-work"
        result = self._run(
            "--studio-url",
            f"http://127.0.0.1:{self.server.server_port}",
            "--work-dir",
            str(work),
            "--timeout",
            "5",
            str(self.input_path),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "fake transcript\n")
        self.assertIn("loading Studio GGUF model large-v3", result.stderr)
        self.assertEqual((self.root / "pi-inference.marker").read_text(), "switched")
        self.assertEqual(self.calls[0]["payload"], {"model": "large-v3", "engine": "gguf"})
        self.assertEqual(
            self.calls[1]["model"],
            "large-v3",
        )
        self.assertEqual(self.calls[1]["engine"], "gguf")
        self.assertEqual(self.calls[1]["fast"], "false")

        call_count = len(self.calls)
        resumed = self._run(
            "--no-pi-inference",
            "--studio-url",
            f"http://127.0.0.1:{self.server.server_port}",
            "--work-dir",
            str(work),
            str(self.input_path),
        )
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertEqual(resumed.stdout, "fake transcript\n")
        self.assertEqual(len(self.calls), call_count)

    def test_file_options_write_requested_paths(self):
        automatic = self._run(
            "-f",
            "--no-pi-inference",
            "--studio-url",
            f"http://127.0.0.1:{self.server.server_port}",
            "--work-dir",
            str(self.root / "file-work"),
            str(self.input_path),
        )
        automatic_path = self.input_path.with_suffix(".txt")
        self.assertEqual(automatic.returncode, 0, automatic.stderr)
        self.assertEqual(automatic.stdout, "")
        self.assertEqual(automatic_path.read_text(), "fake transcript\n")
        self.assertIn(f"wrote {automatic_path}", automatic.stderr)

        requested_path = self.root / "requested-output.txt"
        requested = self._run(
            "-o",
            str(requested_path),
            "--no-pi-inference",
            "--studio-url",
            f"http://127.0.0.1:{self.server.server_port}",
            "--work-dir",
            str(self.root / "requested-work"),
            str(self.input_path),
        )
        self.assertEqual(requested.returncode, 0, requested.stderr)
        self.assertEqual(requested.stdout, "")
        self.assertEqual(requested_path.read_text(), "fake transcript\n")

    def test_turbo_selects_turbo_model(self):
        result = self._run(
            "-t",
            "--no-pi-inference",
            "--studio-url",
            f"http://127.0.0.1:{self.server.server_port}",
            "--work-dir",
            str(self.root / "turbo-work"),
            str(self.input_path),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "fake transcript\n")
        self.assertEqual(self.calls[0]["payload"], {"model": "large-v3-turbo", "engine": "gguf"})
        self.assertEqual(self.calls[1]["model"], "large-v3-turbo")


if __name__ == "__main__":
    unittest.main()
