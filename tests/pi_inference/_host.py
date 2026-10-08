"""Locate the `pi-inference-host` tree and load its modules under test.

Commit dcee88f (2026-08-06, "move pi-inference-host to local-models") relocated the
GPU-host tree to `~/Develop/MACHINE_LEARNING/local-models/pi-inference-host/`. The
tests kept resolving it relative to this repo (`parents[2] / "pi-inference-host/..."`),
so both host test modules have raised `FileNotFoundError` at import ever since — and
nothing noticed, because there is no CI and no git hook runs `tests/`. A host test
suite that silently fails to load is worse than none: it reads as "guarded by tests".

Resolution is therefore explicit and the failure is loud:

    1. $PI_INFERENCE_HOST, if set
    2. ~/Develop/MACHINE_LEARNING/local-models/pi-inference-host (current location)
    3. <this repo>/pi-inference-host (pre-move layout, still correct in old checkouts)

and `load()` raises with all three candidates in the message rather than an
ImportError several frames away from the cause.
"""
from __future__ import annotations

import importlib.util
import os
import sys
import types
from pathlib import Path

DOTFILES = Path(__file__).resolve().parents[2]


def _candidates() -> list[tuple[str, Path]]:
    override = os.environ.get("PI_INFERENCE_HOST")
    options: list[tuple[str, Path]] = []
    if override:
        options.append(("$PI_INFERENCE_HOST", Path(override)))
    options.append(("current location", Path.home() / "Develop/MACHINE_LEARNING/local-models/pi-inference-host"))
    options.append(("pre-move layout", DOTFILES / "pi-inference-host"))
    return options


def host_root() -> Path:
    candidates = _candidates()
    for _label, path in candidates:
        if (path / ".local" / "lib" / "pi_inference_host").is_dir():
            return path
    tried = "\n".join(f"    {label}: {path}" for label, path in candidates)
    raise FileNotFoundError(
        "cannot find the pi-inference-host tree (needs .local/lib/pi_inference_host). Tried:\n"
        f"{tried}\n"
        "Set PI_INFERENCE_HOST to the checkout root if it lives somewhere else."
    )


def load(name: str) -> types.ModuleType:
    """Import `pi_inference_host.<name>` from the host tree, by file path."""
    module_path = host_root() / ".local" / "lib" / "pi_inference_host" / f"{name}.py"
    if not module_path.is_file():
        raise FileNotFoundError(f"{module_path} does not exist (host root: {host_root()})")
    spec = importlib.util.spec_from_file_location(f"pi_inference_host.{name}", module_path)
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
