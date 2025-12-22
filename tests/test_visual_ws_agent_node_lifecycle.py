"""WebSocket regression tests for Agent node lifecycle + trace previews.

We specifically validate two behaviors:
1) Agent nodes should not emit misleading `node_complete` events while they are
   still in an internal "running" phase (multi-tick node).
2) Agent scratchpad traces shipped over the WS must retain nested fields like
   `steps[].effect.type/payload` (no premature "…" truncation that breaks UI).

This test uses a fake runner to avoid requiring a real LLM provider.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi.testclient import TestClient

from web.backend.main import app
from web.backend.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode
from web.backend.routes.flows import _flows


@dataclass
class _FakeRunState:
    current_node: Optional[str]
    vars: Dict[str, Any]
    output: Optional[Dict[str, Any]] = None
    status: str = "running"
    error: Optional[str] = None
    waiting: Any = None


class _FakeFlowNode:
    def __init__(self, *, effect_type: Optional[str] = None) -> None:
        self.effect_type = effect_type


class _FakeFlow:
    def __init__(self) -> None:
        self._node_outputs: Dict[str, Any] = {}
        self.nodes: Dict[str, _FakeFlowNode] = {
            "n1": _FakeFlowNode(effect_type=None),
            "agent": _FakeFlowNode(effect_type="agent"),
        }


class _FakeRunner:
    """A minimal FlowRunner-like object used by the WS endpoint."""

    def __init__(self) -> None:
        self.flow = _FakeFlow()
        self._step = 0
        self._state = _FakeRunState(
            current_node="n1",
            vars={"_temp": {"agent": {"agent": {"phase": "init"}}}},
        )
        self.run_id: Optional[str] = None

    def start(self, input_data: Dict[str, Any]) -> str:
        self.run_id = "run_fake_1"
        # OnFlowStart output shape (the UI uses this as a payload echo).
        self.flow._node_outputs["n1"] = dict(input_data)
        return self.run_id

    def get_state(self) -> _FakeRunState:
        return self._state

    def step(self) -> _FakeRunState:
        self._step += 1

        # Step 1: execute n1, then transition to agent
        if self._step == 1:
            self._state.current_node = "agent"
            return self._state

        # Step 2: agent init tick -> internal phase transitions to subworkflow, but node is NOT complete yet.
        if self._step == 2:
            self._state.vars["_temp"]["agent"]["agent"]["phase"] = "subworkflow"
            self.flow._node_outputs["agent"] = {
                "status": "running",
                "task": "list the files in /Users/albou/r-type/ , read some key files and tell me what this is about",
                "context": {},
                "result": None,
            }
            # Self-loop (multi-tick node).
            self._state.current_node = "agent"
            return self._state

        # Step 3: agent completes -> final result + scratchpad trace.
        self._state.vars["_temp"]["agent"]["agent"]["phase"] = "done"
        self._state.status = "completed"
        result_obj = {
            "result": "This is a Python-based R-Type II clone project (arcade shooter) with modular weapons and power-ups.",
            "task": "list the files in /Users/albou/r-type/ , read some key files and tell me what this is about",
            "context": {},
            "success": True,
            "provider": "lmstudio",
            "model": "qwen/qwen3-next-80b",
            "iterations": 2,
            "sub_run_id": "sub_fake_1",
        }
        self.flow._node_outputs["agent"] = {
            "result": result_obj,
            "scratchpad": {
                "sub_run_id": "sub_fake_1",
                "workflow_id": "visual_react_agent_test_agent",
                "node_traces": {"too": {"deep": {"to": {"ship": "over ws"}}}},
                "steps": [
                    {
                        "ts": "2025-12-22T00:00:00Z",
                        "status": "completed",
                        "effect": {
                            "type": "tool_calls",
                            "payload": {
                                "tool_calls": [
                                    {"name": "list_files", "arguments": {"directory_path": "/Users/albou/r-type/", "pattern": "*"}},
                                    {"name": "read_file", "arguments": {"file_path": "/Users/albou/r-type/designs.md"}},
                                ]
                            },
                        },
                        "result": {
                            "results": [
                                {"name": "list_files", "success": True, "output": "Files in '/Users/albou/r-type/'..."},
                                {"name": "read_file", "success": True, "output": "File: ..."},
                            ]
                        },
                    }
                ],
            },
        }
        self._state.current_node = None
        self._state.output = {"success": True, "result": result_obj}
        return self._state

    def is_waiting(self) -> bool:
        return False

    def is_complete(self) -> bool:
        return self._state.status == "completed"

    def is_failed(self) -> bool:
        return self._state.status == "failed"


def test_ws_agent_node_emits_single_complete_and_trace_is_not_truncated() -> None:
    flow_id = "test-ws-agent-lifecycle"

    visual = VisualFlow(
        id=flow_id,
        name="test ws agent lifecycle",
        entryNode="n1",
        nodes=[
            VisualNode(
                id="n1",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="agent",
                type=NodeType.AGENT,
                position=Position(x=0, y=0),
                data={"agentConfig": {"provider": "lmstudio", "model": "qwen/qwen3-next-80b", "tools": ["list_files", "read_file"]}},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="n1", sourceHandle="exec-out", target="agent", targetHandle="exec-in"),
            VisualEdge(id="d1", source="n1", sourceHandle="query", target="agent", targetHandle="task"),
        ],
    )

    _flows[flow_id] = visual
    try:
        # Patch the WS module to avoid invoking the real visual runner (LLM).
        import web.backend.routes.ws as ws_routes

        original_create = ws_routes.create_visual_runner
        ws_routes.create_visual_runner = lambda *_args, **_kwargs: _FakeRunner()  # type: ignore[assignment]

        try:
            with TestClient(app) as client:
                with client.websocket_connect(f"/api/ws/{flow_id}") as ws:
                    ws.send_text(json.dumps({"type": "run", "input_data": {"query": "x"}}))

                    msgs = []
                    for _ in range(200):
                        msg = ws.receive_json()
                        msgs.append(msg)
                        if msg.get("type") == "flow_complete":
                            break

                    node_events = [(m.get("type"), m.get("nodeId")) for m in msgs if m.get("type") in {"node_start", "node_complete"}]
                    # Agent node should only close once (no misleading "status: running" completion event).
                    assert node_events == [
                        ("node_start", "n1"),
                        ("node_complete", "n1"),
                        ("node_start", "agent"),
                        ("node_complete", "agent"),
                    ]

                    agent_complete = next(m for m in msgs if m.get("type") == "node_complete" and m.get("nodeId") == "agent")
                    payload = agent_complete.get("result")
                    assert isinstance(payload, dict)

                    # WS preview should preserve scratchpad.step.effect.type/payload (not "…").
                    scratchpad = payload.get("scratchpad")
                    assert isinstance(scratchpad, dict)
                    assert "node_traces" not in scratchpad  # dropped server-side to keep payload sane

                    steps = scratchpad.get("steps")
                    assert isinstance(steps, list) and steps
                    first = steps[0]
                    assert isinstance(first, dict)
                    effect = first.get("effect")
                    assert isinstance(effect, dict)
                    assert effect.get("type") == "tool_calls"
                    payload_obj = effect.get("payload")
                    assert isinstance(payload_obj, dict)
                    tool_calls = payload_obj.get("tool_calls")
                    assert isinstance(tool_calls, list) and tool_calls
                    assert tool_calls[0]["name"] == "list_files"
                    assert tool_calls[0]["arguments"]["directory_path"] == "/Users/albou/r-type/"
        finally:
            ws_routes.create_visual_runner = original_create  # type: ignore[assignment]
    finally:
        _flows.pop(flow_id, None)


