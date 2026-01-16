"""UI configuration endpoints for AbstractFlow clients."""

from __future__ import annotations

import os

from fastapi import APIRouter

router = APIRouter(prefix="/ui", tags=["ui"])


def _flag_enabled(value: str | None) -> bool:
    s = str(value or "").strip().lower()
    return s in {"1", "true", "yes", "on"}


def _monitor_gpu_enabled() -> bool:
    return _flag_enabled(os.getenv("ABSTRACTFLOW_MONITOR_GPU") or os.getenv("ABSTRACT_MONITOR_GPU"))


@router.get("/config")
async def ui_config() -> dict[str, object]:
    return {"monitor_gpu": _monitor_gpu_enabled()}

