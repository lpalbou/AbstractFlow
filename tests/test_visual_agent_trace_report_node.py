from __future__ import annotations

from abstractflow.visual import create_visual_runner
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_agent_trace_report_renders_tool_args_and_results() -> None:
    flow_id = "test-visual-agent-trace-report"
    scratchpad = {
        "sub_run_id": "sub-1",
        "workflow_id": "wf-1",
        "node_traces": {
            "reason": {
                "node_id": "reason",
                "steps": [
                    {
                        "ts": "2026-01-01T00:00:00Z",
                        "node_id": "reason",
                        "status": "completed",
                        "effect": {"type": "llm_call", "payload": {}, "result_key": "_temp.llm"},
                        "result": {
                            "content": "Hello",
                            "tool_calls": None,
                            "model": "test-model",
                            "finish_reason": "stop",
                        },
                    }
                ],
                "updated_at": "2026-01-01T00:00:00Z",
            },
            "act": {
                "node_id": "act",
                "steps": [
                    {
                        "ts": "2026-01-01T00:00:01Z",
                        "node_id": "act",
                        "status": "completed",
                        "effect": {
                            "type": "tool_calls",
                            "payload": {
                                "tool_calls": [
                                    {"name": "web_search", "arguments": {"query": "q"}, "call_id": "c1"}
                                ]
                            },
                            "result_key": "_temp.tools",
                        },
                        "result": {
                            "results": [
                                {
                                    "call_id": "c1",
                                    "name": "web_search",
                                    "success": True,
                                    "output": {"ok": 1},
                                    "error": None,
                                }
                            ]
                        },
                    }
                ],
                "updated_at": "2026-01-01T00:00:01Z",
            },
        },
    }

    visual = VisualFlow(
        id=flow_id,
        name="agent trace report",
        entryNode="code",
        nodes=[
            VisualNode(
                id="sp",
                type=NodeType.LITERAL_JSON,
                position=Position(x=0, y=0),
                data={"literalValue": scratchpad},
            ),
            VisualNode(
                id="report",
                type=NodeType.AGENT_TRACE_REPORT,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return input.get('md')\n",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="d1", source="sp", sourceHandle="value", target="report", targetHandle="scratchpad"),
            VisualEdge(id="d2", source="report", sourceHandle="result", target="code", targetHandle="md"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    md = result.get("result")
    assert isinstance(md, str)
    assert "Tool: `web_search`" in md
    assert '"query": "q"' in md
    assert '"ok": 1' in md


