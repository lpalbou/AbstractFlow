"""VisualFlow -> WorkflowArtifact compiler.

This compiler bridges authoring (VisualFlow JSON) to execution (AbstractRuntime).
It intentionally strips UI-only fields while preserving execution semantics.

Note: this is *not* the WorkflowBundle compiler (314). It compiles a single VisualFlow
into a single WorkflowArtifact.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from abstractruntime.workflow_artifact import (
    WORKFLOW_ARTIFACT_FORMAT_VERSION_V1,
    WorkflowArtifact,
    WorkflowArtifactDataEdge,
    WorkflowArtifactExecEdge,
    WorkflowArtifactNode,
)

from .visual.models import NodeType, VisualFlow, VisualNode


_UI_ONLY_NODE_DATA_KEYS = {
    "nodeType",
    "label",
    "icon",
    "headerColor",
}


def _pin_type_maps(flow: VisualFlow) -> Dict[str, Dict[str, Dict[str, str]]]:
    """Return {node_id: {"inputs": {pin_id: type}, "outputs": {...}}}."""
    out: Dict[str, Dict[str, Dict[str, str]]] = {}
    for n in flow.nodes:
        data = dict(n.data) if isinstance(n.data, dict) else {}
        ins = data.get("inputs") if isinstance(data.get("inputs"), list) else []
        outs = data.get("outputs") if isinstance(data.get("outputs"), list) else []
        in_map: Dict[str, str] = {}
        out_map: Dict[str, str] = {}
        for p in ins:
            if not isinstance(p, dict):
                continue
            pid = p.get("id")
            ptype = p.get("type")
            if isinstance(pid, str) and pid and isinstance(ptype, str) and ptype:
                in_map[pid] = ptype
        for p in outs:
            if not isinstance(p, dict):
                continue
            pid = p.get("id")
            ptype = p.get("type")
            if isinstance(pid, str) and pid and isinstance(ptype, str) and ptype:
                out_map[pid] = ptype
        out[n.id] = {"inputs": in_map, "outputs": out_map}
    return out


def _is_execution_node(node: VisualNode) -> bool:
    data = node.data if isinstance(node.data, dict) else {}
    for key in ("inputs", "outputs"):
        pins = data.get(key)
        if not isinstance(pins, list):
            continue
        for p in pins:
            if isinstance(p, dict) and p.get("type") == "execution":
                return True
    return False


def _entry_node_id(flow: VisualFlow) -> str:
    if isinstance(flow.entryNode, str) and flow.entryNode.strip():
        return flow.entryNode.strip()
    # Prefer on_flow_start if present, otherwise any event node, otherwise first node.
    for preferred in (NodeType.ON_FLOW_START, NodeType.ON_USER_REQUEST, NodeType.ON_AGENT_MESSAGE):
        for n in flow.nodes:
            if n.type == preferred:
                return n.id
    if flow.nodes:
        return flow.nodes[0].id
    raise ValueError("VisualFlow has no nodes; cannot determine entry node.")


def compile_visualflow_to_workflow_artifact(flow: VisualFlow) -> WorkflowArtifact:
    """Compile a VisualFlow (authoring JSON) into a WorkflowArtifact (execution JSON)."""
    pin_maps = _pin_type_maps(flow)

    nodes: list[WorkflowArtifactNode] = []
    for n in flow.nodes:
        data = dict(n.data) if isinstance(n.data, dict) else {}

        # Extract and remove per-pin defaults into the artifact-level `pin_defaults`.
        raw_defaults = data.pop("pinDefaults", None)
        pin_defaults: Dict[str, Any] = dict(raw_defaults) if isinstance(raw_defaults, dict) else {}

        # Remove UI-only data keys (execution doesn't need them).
        for k in list(data.keys()):
            if k in _UI_ONLY_NODE_DATA_KEYS:
                data.pop(k, None)

        # Visual Agent nodes: ensure a deterministic ReAct workflow id is present in agentConfig
        # so runtime-only hosts can register/resolve the required subworkflow without importing
        # AbstractFlow's visual executor.
        if str(n.type.value) == str(NodeType.AGENT.value):
            from abstractruntime.workflow_artifact.utils import visual_react_workflow_id

            raw_cfg = data.get("agentConfig", {})
            cfg = dict(raw_cfg) if isinstance(raw_cfg, dict) else {}
            cfg.setdefault("_react_workflow_id", visual_react_workflow_id(flow_id=str(flow.id), node_id=str(n.id)))
            data["agentConfig"] = cfg

        nodes.append(
            WorkflowArtifactNode(
                node_id=n.id,
                node_type=str(n.type.value),
                data=data,
                is_execution=_is_execution_node(n),
                pin_defaults=pin_defaults,
            )
        )

    exec_edges: list[WorkflowArtifactExecEdge] = []
    data_edges: list[WorkflowArtifactDataEdge] = []

    def _pin_type(node_id: str, side: str, handle: str) -> Optional[str]:
        m = pin_maps.get(node_id, {})
        s = m.get(side, {})
        return s.get(handle)

    def _fallback_is_exec(handle: str) -> bool:
        h = str(handle or "")
        if h.startswith("exec"):
            return True
        if h.startswith("then:") or h.startswith("case:"):
            return True
        if h in {"true", "false", "default", "loop", "done", "completed"}:
            return True
        return False

    for e in flow.edges:
        st = _pin_type(e.source, "outputs", e.sourceHandle)
        tt = _pin_type(e.target, "inputs", e.targetHandle)
        is_exec = (st == "execution") or (tt == "execution") or _fallback_is_exec(e.sourceHandle) or _fallback_is_exec(e.targetHandle)
        if is_exec:
            exec_edges.append(
                WorkflowArtifactExecEdge(
                    source=e.source,
                    source_handle=e.sourceHandle,
                    target=e.target,
                )
            )
        else:
            data_edges.append(
                WorkflowArtifactDataEdge(
                    source=e.source,
                    source_pin=e.sourceHandle,
                    target=e.target,
                    target_pin=e.targetHandle,
                )
            )

    return WorkflowArtifact(
        format_version=WORKFLOW_ARTIFACT_FORMAT_VERSION_V1,
        workflow_id=str(flow.id),
        entry_node=_entry_node_id(flow),
        nodes=nodes,
        exec_edges=exec_edges,
        data_edges=data_edges,
        name=str(flow.name),
        description=str(flow.description or ""),
        interfaces=list(flow.interfaces or []),
    )


