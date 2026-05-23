"""Backend API routes."""

from .gateway_metrics import router as gateway_metrics_router
from .connection import router as connection_router
from .ui_config import router as ui_config_router

__all__ = [
    "connection_router",
    "gateway_metrics_router",
    "ui_config_router",
]

try:
    from abstractflow.gateway_options import local_runtime_enabled
except Exception:
    def local_runtime_enabled() -> bool:
        return False

if local_runtime_enabled():
    from .flows import router as flows_router
    from .memory_kg import router as memory_kg_router
    from .providers import router as providers_router
    from .runs import router as runs_router
    from .semantics import router as semantics_router
    from .tools import router as tools_router
    from .ws import router as ws_router

    __all__ += [
        "flows_router",
        "memory_kg_router",
        "providers_router",
        "runs_router",
        "semantics_router",
        "tools_router",
        "ws_router",
    ]
