"""AbstractFlow compiler shim.

AbstractFlow no longer owns workflow compilation semantics. The single source of
truth for VisualFlow/Flow compilation lives in `abstractruntime.visualflow_compiler`.
"""

from __future__ import annotations

from abstractruntime.visualflow_compiler.compiler import (
    _create_visual_agent_effect_handler,
    _sync_effect_results_to_node_outputs,
    compile_flow,
    compile_visualflow,
    compile_visualflow_tree,
)

__all__ = [
    "compile_flow",
    "compile_visualflow",
    "compile_visualflow_tree",
    "_create_visual_agent_effect_handler",
    "_sync_effect_results_to_node_outputs",
]
