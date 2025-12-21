from __future__ import annotations

import json

from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_agent_tools_and_schema_survive_visualflow_json_roundtrip() -> None:
    flow = VisualFlow(
        id="flow-1",
        name="test",
        nodes=[
            VisualNode(
                id="node-1",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={
                    "nodeType": "on_flow_start",
                    "label": "On Flow Start",
                    "icon": "🏁",
                    "headerColor": "#C0392B",
                    "inputs": [],
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "query", "label": "query", "type": "string"},
                    ],
                },
            ),
            VisualNode(
                id="node-2",
                type=NodeType.AGENT,
                position=Position(x=200, y=0),
                data={
                    "nodeType": "agent",
                    "label": "Agent",
                    "icon": "🤖",
                    "headerColor": "#4488FF",
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "task", "label": "task", "type": "string"},
                        {"id": "context", "label": "context", "type": "object"},
                    ],
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "result", "label": "result", "type": "object"},
                        {"id": "scratchpad", "label": "scratchpad", "type": "object"},
                    ],
                    "agentConfig": {
                        "provider": "lmstudio",
                        "model": "zai-org/glm-4.6v-flash",
                        "tools": ["execute_command", "read_file"],
                        "outputSchema": {
                            "enabled": True,
                            "mode": "json",
                            "jsonSchema": {
                                "type": "object",
                                "properties": {"answer": {"type": "string"}},
                                "required": ["answer"],
                            },
                        },
                    },
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="node-1",
                sourceHandle="exec-out",
                target="node-2",
                targetHandle="exec-in",
                animated=True,
            )
        ],
        entryNode="node-1",
    )

    payload = json.loads(flow.model_dump_json())
    loaded = VisualFlow(**payload)

    agent = next(n for n in loaded.nodes if n.id == "node-2")
    cfg = agent.data.get("agentConfig")
    assert isinstance(cfg, dict)
    assert cfg.get("tools") == ["execute_command", "read_file"]

    schema = cfg.get("outputSchema")
    assert isinstance(schema, dict)
    assert schema.get("enabled") is True
    assert isinstance(schema.get("jsonSchema"), dict)

