from __future__ import annotations

from abstractruntime import InMemoryLedgerStore, InMemoryRunStore, Runtime
from abstractruntime.visualflow_compiler import compile_visualflow


def test_visualflow_compiler_executes_without_ui_fields() -> None:
    # Minimal flow: should execute even if UI-only fields are missing.
    flow = {
        "id": "wf-vf-direct",
        "name": "vf direct",
        "description": "",
        "interfaces": [],
        "entryNode": "node-1",
        "nodes": [
            {"id": "node-1", "type": "on_flow_start", "position": {"x": 0, "y": 0}, "data": {"nodeType": "on_flow_start"}},
            {"id": "node-2", "type": "literal_string", "position": {"x": 0, "y": 0}, "data": {"nodeType": "literal_string", "literalValue": "hi"}},
            {"id": "node-3", "type": "answer_user", "position": {"x": 0, "y": 0}, "data": {"nodeType": "answer_user"}},
            {"id": "node-4", "type": "on_flow_end", "position": {"x": 0, "y": 0}, "data": {"nodeType": "on_flow_end"}},
        ],
        "edges": [
            {"id": "e1", "source": "node-1", "sourceHandle": "exec-out", "target": "node-3", "targetHandle": "exec-in"},
            {"id": "e2", "source": "node-3", "sourceHandle": "exec-out", "target": "node-4", "targetHandle": "exec-in"},
            {"id": "e3", "source": "node-2", "sourceHandle": "value", "target": "node-3", "targetHandle": "message"},
            {"id": "e4", "source": "node-3", "sourceHandle": "message", "target": "node-4", "targetHandle": "message"},
        ],
    }

    spec = compile_visualflow(flow)
    rt = Runtime(run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore())
    run_id = rt.start(workflow=spec, vars={})
    run = rt.tick(workflow=spec, run_id=run_id, max_steps=50)

    assert run.status == "completed"
    assert isinstance(run.output, dict)
    assert run.output.get("success") is True
    assert "result" not in run.output
    assert run.output.get("message") == "hi"
