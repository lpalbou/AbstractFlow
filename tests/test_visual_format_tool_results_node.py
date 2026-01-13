from __future__ import annotations

from abstractflow.visual import create_visual_runner
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_format_tool_results_condensed_digest() -> None:
    flow_id = "test-visual-format-tool-results"
    visual = VisualFlow(
        id=flow_id,
        name="format tool results",
        entryNode="code",
        nodes=[
            VisualNode(
                id="results",
                type=NodeType.LITERAL_ARRAY,
                position=Position(x=0, y=0),
                data={
                    "literalValue": [
                        {
                            "call_id": "1",
                            "name": "list_files",
                            "success": True,
                            "output": "Directory '/tmp/x' exists but is empty",
                            "error": None,
                        },
                        {
                            "call_id": "2",
                            "name": "execute_command",
                            "success": True,
                            "output": {
                                "success": True,
                                "command": "mkdir -p rtype_clone/{assets,scripts,sounds,images}",
                                "duration_s": 0.10,
                                "return_code": 0,
                                "rendered": "Command completed successfully",
                            },
                            "error": None,
                        },
                        {
                            "call_id": "3",
                            "name": "fetch_url",
                            "success": False,
                            "output": {"url": "https://example.com", "status_code": 403},
                            "error": "Forbidden",
                        },
                    ]
                },
            ),
            VisualNode(
                id="fmt",
                type=NodeType.FORMAT_TOOL_RESULTS,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return input.get('text')\n",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="d1", source="results", sourceHandle="value", target="fmt", targetHandle="tool_results"),
            VisualEdge(id="d2", source="fmt", sourceHandle="result", target="code", targetHandle="text"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    out = result.get("result")
    assert isinstance(out, str)
    assert "list_files()" in out
    assert "[SUCCESS]" in out
    assert "execute_command(" in out
    assert "mkdir -p rtype_clone" in out
    assert "fetch_url(" in out
    assert "[FAILURE]" in out
    assert "Forbidden" in out

