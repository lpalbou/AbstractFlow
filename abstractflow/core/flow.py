"""Flow definition classes for AbstractFlow.

This module is a thin re-export of AbstractRuntime's Flow IR so there is a
single semantics + IR surface shared across hosts.
"""

from __future__ import annotations

from abstractruntime.visualflow_compiler.flow import Flow, FlowEdge, FlowNode

__all__ = ["Flow", "FlowNode", "FlowEdge"]
