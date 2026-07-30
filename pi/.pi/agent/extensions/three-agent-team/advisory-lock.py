#!/usr/bin/env python3
"""Small fcntl.flock broker.

The process owns the kernel lock for as long as its stdin remains open.  Lock files
are stable coordination objects: this program never renames or unlinks them.
"""

from __future__ import annotations

import argparse
import errno
import fcntl
import json
import os
import stat
import sys
import time


def fail(message: str, code: int = 1) -> "None":
    print(json.dumps({"status": "error", "message": message}), file=sys.stderr, flush=True)
    raise SystemExit(code)


def secure_open(path: str) -> int:
    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_CLOEXEC"):
        flags |= os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags, 0o600)
    except OSError as error:
        fail(f"cannot open advisory lock {path}: {error}")

    info = os.fstat(descriptor)
    if not stat.S_ISREG(info.st_mode):
        os.close(descriptor)
        fail(f"advisory lock is not a regular file: {path}")
    if info.st_uid != os.getuid():
        os.close(descriptor)
        fail(f"advisory lock has wrong owner: {path}")
    if stat.S_IMODE(info.st_mode) & 0o077:
        os.close(descriptor)
        fail(f"advisory lock is group/world accessible: {path}")
    # Persist creation of the stable coordination inode before announcing it.
    parent = os.open(os.path.dirname(path), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(parent)
    finally:
        os.close(parent)
    return descriptor


def current_diagnostic(descriptor: int) -> str:
    try:
        os.lseek(descriptor, 0, os.SEEK_SET)
        value = os.read(descriptor, 16_384).decode("utf-8", "replace").strip()
        return value or "owner metadata unavailable"
    except OSError as error:
        return f"owner metadata unreadable: {error}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", required=True)
    parser.add_argument("--timeout-ms", required=True, type=int)
    parser.add_argument("--owner", required=True)
    arguments = parser.parse_args()
    if arguments.timeout_ms < 0:
        fail("timeout must be non-negative")

    descriptor = secure_open(arguments.path)
    deadline = time.monotonic() + arguments.timeout_ms / 1000
    while True:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except OSError as error:
            if error.errno not in (errno.EACCES, errno.EAGAIN):
                os.close(descriptor)
                fail(f"cannot acquire advisory lock {arguments.path}: {error}")
            if time.monotonic() >= deadline:
                diagnostic = current_diagnostic(descriptor)
                os.close(descriptor)
                fail(
                    f"timed out acquiring advisory lock {arguments.path}; current owner: {diagnostic}",
                    73,
                )
            time.sleep(min(0.025, max(0.001, deadline - time.monotonic())))

    metadata = arguments.owner.encode("utf-8")
    os.ftruncate(descriptor, 0)
    os.lseek(descriptor, 0, os.SEEK_SET)
    os.write(descriptor, metadata + b"\n")
    os.fsync(descriptor)
    print(json.dumps({"status": "locked", "pid": os.getpid()}), flush=True)

    # EOF is the release protocol.  If the TypeScript parent dies, the pipe is
    # closed by the kernel and flock is released when this process exits.
    try:
        while os.read(sys.stdin.fileno(), 8192):
            pass
    finally:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


if __name__ == "__main__":
    main()
