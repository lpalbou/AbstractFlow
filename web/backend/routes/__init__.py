"""Backend API routes."""

from .flows import router as flows_router
from .gateway_metrics import router as gateway_metrics_router
from .connection import router as connection_router
from .providers import router as providers_router
from .runs import router as runs_router
from .semantics import router as semantics_router
from .memory_kg import router as memory_kg_router
from .tools import router as tools_router
from .ui_config import router as ui_config_router
from .ws import router as ws_router

__all__ = [
    "connection_router",
    "flows_router",
    "gateway_metrics_router",
    "memory_kg_router",
    "providers_router",
    "runs_router",
    "semantics_router",
    "tools_router",
    "ui_config_router",
    "ws_router",
]
