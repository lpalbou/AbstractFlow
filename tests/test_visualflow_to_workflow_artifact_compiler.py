from __future__ import annotations

from abstractruntime import InMemoryLedgerStore, InMemoryRunStore, Runtime
from abstractruntime.workflow_artifact.default_nodes import register_default_visual_node_factories
from abstractruntime.workflow_artifact.interpreter import workflow_spec_from_artifact
from abstractruntime.workflow_artifact.registry import NodeRegistry

from abstractflow.visual.models import VisualFlow
from abstractflow.workflow_artifact_compiler import compile_visualflow_to_workflow_artifact


def test_compile_visualflow_to_workflow_artifact_executes_without_ui_fields() -> None:
    flow = VisualFlow.model_validate(
        {
            "id": "wf-vf-to-artifact",
            "name": "vf to artifact",
            "description": "",
            "interfaces": [],
            "entryNode": "node-1",
            "nodes": [
                {
                    "id": "node-1",
                    "type": "on_flow_start",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "nodeType": "on_flow_start",
                        "label": "On Flow Start",
                        "icon": "x",
                        "headerColor": "#000",
                        "inputs": [],
                        "outputs": [{"id": "exec-out", "label": "", "type": "execution"}],
                    },
                },
                {
                    "id": "node-2",
                    "type": "literal_string",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "nodeType": "literal_string",
                        "label": "Literal",
                        "icon": "x",
                        "headerColor": "#000",
                        "inputs": [],
                        "outputs": [{"id": "value", "label": "value", "type": "string"}],
                        "literalValue": "hi",
                    },
                },
                {
                    "id": "node-3",
                    "type": "answer_user",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "nodeType": "answer_user",
                        "label": "Answer User",
                        "icon": "x",
                        "headerColor": "#000",
                        "effectConfig": {},
                        "inputs": [
                            {"id": "exec-in", "label": "", "type": "execution"},
                            {"id": "message", "label": "message", "type": "string"},
                        ],
                        "outputs": [
                            {"id": "exec-out", "label": "", "type": "execution"},
                            {"id": "message", "label": "message", "type": "string"},
                        ],
                    },
                },
                {
                    "id": "node-4",
                    "type": "on_flow_end",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "nodeType": "on_flow_end",
                        "label": "On Flow End",
                        "icon": "x",
                        "headerColor": "#000",
                        "inputs": [
                            {"id": "exec-in", "label": "", "type": "execution"},
                            {"id": "message", "label": "message", "type": "string"},
                        ],
                        "outputs": [],
                    },
                },
            ],
            "edges": [
                {"id": "e1", "source": "node-1", "sourceHandle": "exec-out", "target": "node-3", "targetHandle": "exec-in"},
                {"id": "e2", "source": "node-3", "sourceHandle": "exec-out", "target": "node-4", "targetHandle": "exec-in"},
                {"id": "e3", "source": "node-2", "sourceHandle": "value", "target": "node-3", "targetHandle": "message"},
                {"id": "e4", "source": "node-3", "sourceHandle": "message", "target": "node-4", "targetHandle": "message"},
            ],
        }
    )

    artifact = compile_visualflow_to_workflow_artifact(flow)

    # UI-only keys should not be shipped in the artifact node.data.
    n1 = next(n for n in artifact.nodes if n.node_id == "node-1")
    assert "label" not in n1.data
    assert "icon" not in n1.data
    assert "headerColor" not in n1.data
    assert "nodeType" not in n1.data

    registry = NodeRegistry()
    register_default_visual_node_factories(registry)
    spec = workflow_spec_from_artifact(artifact=artifact, registry=registry)

    rt = Runtime(run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore())
    run_id = rt.start(workflow=spec, vars={})
    run = rt.tick(workflow=spec, run_id=run_id, max_steps=50)

    assert run.status == "completed"
    assert isinstance(run.output, dict)
    result = run.output.get("result")
    assert isinstance(result, dict)
    assert result.get("message") == "hi"


