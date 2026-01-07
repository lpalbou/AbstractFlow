"""Run Gateway wiring for the AbstractFlow web backend.

This module owns the singleton GatewayRunner instance used by the HTTP gateway routes.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from .runtime_stores import get_runtime_stores
from .gateway_runner import GatewayRunner, GatewayRunnerConfig


_runner: Optional[GatewayRunner] = None


def get_gateway_runner() -> GatewayRunner:
    global _runner
    if _runner is not None:
        return _runner

    run_store, ledger_store, artifact_store = get_runtime_stores()

    base_dir = getattr(run_store, "_base", None)
    if isinstance(base_dir, Path):
        base = base_dir
    else:
        # Fallback (should not happen for JsonFileRunStore).
        base = Path(os.getenv("ABSTRACTFLOW_RUNTIME_DIR", "./runtime")).resolve()

    # Flows registry lives in routes.flows (loaded from ./flows at import).
    # Import lazily to avoid circular imports at module import time.
    from ..routes.flows import _flows  # type: ignore

    enabled_raw = os.getenv("ABSTRACTFLOW_GATEWAY_RUNNER", "1").strip().lower()
    enabled = enabled_raw not in {"0", "false", "no", "off"}

    cfg = GatewayRunnerConfig(
        poll_interval_s=float(os.getenv("ABSTRACTFLOW_GATEWAY_POLL_S", "0.25")),
        tick_workers=int(os.getenv("ABSTRACTFLOW_GATEWAY_TICK_WORKERS", "2")),
    )

    _runner = GatewayRunner(
        base_dir=base,
        flows=_flows,
        run_store=run_store,
        ledger_store=ledger_store,
        artifact_store=artifact_store,
        config=cfg,
        enable=enabled,
    )
    return _runner


def start_gateway_runner() -> None:
    runner = get_gateway_runner()
    runner.start()


def stop_gateway_runner() -> None:
    global _runner
    if _runner is None:
        return
    try:
        _runner.stop()
    finally:
        _runner = None


