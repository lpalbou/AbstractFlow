"""Gateway-compatible host metrics endpoints.

This keeps UI widgets (like @abstractutils/monitor-gpu) working when AbstractFlow's
backend is the only server available.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..services import host_metrics

router = APIRouter(prefix="/gateway", tags=["gateway"])


@router.get("/host/metrics/gpu")
async def host_gpu_metrics():
    return host_metrics.get_host_gpu_metrics()

