"""Durability backends for the AbstractFlow web backend.

The web host should leverage AbstractRuntime's file-based stores so:
- Runs can be inspected and controlled (pause/resume/cancel) by run_id.
- Time-based waits have durable semantics across longer sessions.

Tests use an isolated temp directory to avoid cross-test interference.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Tuple


_IS_TEST = bool(os.getenv("PYTEST_CURRENT_TEST") or "pytest" in sys.modules)

_PERSIST_DIR = Path(os.getenv("ABSTRACTFLOW_RUNTIME_DIR", "./runtime"))
_PERSIST_DIR.mkdir(parents=True, exist_ok=True)


def _base_dir_for_call() -> Path:
    # Isolate each test run to avoid cross-test interference (events scan the run store).
    if _IS_TEST:
        base = Path(tempfile.mkdtemp(prefix="abstractflow-runtime-"))
        base.mkdir(parents=True, exist_ok=True)
        return base
    return _PERSIST_DIR


def get_runtime_stores() -> Tuple[Any, Any, Any]:
    """Return (run_store, ledger_store, artifact_store)."""
    from abstractruntime import FileArtifactStore, JsonFileRunStore, JsonlLedgerStore, ObservableLedgerStore

    base = _base_dir_for_call()
    run_store = JsonFileRunStore(base)
    ledger_store = ObservableLedgerStore(JsonlLedgerStore(base))
    artifact_store = FileArtifactStore(base)
    return (run_store, ledger_store, artifact_store)
