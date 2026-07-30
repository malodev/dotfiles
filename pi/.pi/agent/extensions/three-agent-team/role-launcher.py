#!/usr/bin/env python3
"""Stop-before-exec launcher used to journal a role process before it can run."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys


def process_start_identity() -> str:
    try:
        fields = open("/proc/self/stat", encoding="utf-8").read().rsplit(")", 1)[1].split()
        return f"proc:{fields[19]}"
    except (IndexError, OSError):
        try:
            started = subprocess.check_output(
                ["ps", "-o", "lstart=", "-p", str(os.getpid())],
                text=True,
            ).strip()
            if started:
                return f"ps:{started}"
        except (OSError, subprocess.SubprocessError):
            pass
        return f"conservative-pid:{os.getpid()}"


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: role-launcher.py EXECUTABLE [ARG ...]", file=sys.stderr)
        return 2
    ready = json.dumps(
        {"pid": os.getpid(), "pgid": os.getpgrp(), "processStart": process_start_identity()},
        separators=(",", ":"),
    ).encode("utf-8") + b"\n"
    os.write(3, ready)
    os.close(3)
    os.kill(os.getpid(), signal.SIGSTOP)
    os.execvpe(sys.argv[1], sys.argv[1:], os.environ)
    return 127


if __name__ == "__main__":
    raise SystemExit(main())
