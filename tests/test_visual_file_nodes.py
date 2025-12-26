from __future__ import annotations

from pathlib import Path

from abstractflow.visual import create_visual_runner
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_visual_file_nodes_can_write_then_read(tmp_path: Path) -> None:
    flow_id = "test-visual-file-nodes"
    target = tmp_path / "out.txt"

    visual = VisualFlow(
        id=flow_id,
        name="file nodes",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="write",
                type=NodeType.WRITE_FILE,
                position=Position(x=0, y=0),
                data={
                    "pinDefaults": {"file_path": str(target), "content": "hello"},
                },
            ),
            VisualNode(
                id="read",
                type=NodeType.READ_FILE,
                position=Position(x=0, y=0),
                data={
                    "pinDefaults": {"file_path": str(target)},
                },
            ),
            VisualNode(id="answer", type=NodeType.ANSWER_USER, position=Position(x=0, y=0), data={}),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="write", targetHandle="exec-in"),
            VisualEdge(id="e2", source="write", sourceHandle="exec-out", target="read", targetHandle="exec-in"),
            VisualEdge(id="e3", source="read", sourceHandle="exec-out", target="answer", targetHandle="exec-in"),
            VisualEdge(id="d1", source="read", sourceHandle="content", target="answer", targetHandle="message"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result["result"]["message"] == "hello"
    assert target.read_text(encoding="utf-8") == "hello"
