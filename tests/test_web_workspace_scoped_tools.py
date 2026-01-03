from __future__ import annotations

from pathlib import Path

import pytest

from abstractflow.visual.workspace_scoped_tools import WorkspaceScope, WorkspaceScopedToolExecutor


def test_workspace_scoped_tool_executor_rewrites_relative_paths_and_blocks_escapes(tmp_path: Path) -> None:
    # Use an explicit base_dir so the test doesn't depend on repo-root heuristics.
    scope = WorkspaceScope.from_input_data({"workspace_root": "proj"}, base_dir=tmp_path)
    assert scope is not None

    # Use only the required tools for the test.
    from abstractcore.tools.common_tools import write_file
    from abstractruntime.integrations.abstractcore.tool_executor import MappingToolExecutor

    delegate = MappingToolExecutor.from_tools([write_file])
    executor = WorkspaceScopedToolExecutor(scope=scope, delegate=delegate)

    ok = executor.execute(
        tool_calls=[
            {
                "name": "write_file",
                "call_id": "1",
                "arguments": {"file_path": "hello.txt", "content": "hi"},
            }
        ]
    )
    assert ok.get("mode") == "executed"
    assert isinstance(ok.get("results"), list) and ok["results"]
    assert ok["results"][0]["success"] is True
    assert (tmp_path / "proj" / "hello.txt").read_text(encoding="utf-8") == "hi"

    blocked = executor.execute(
        tool_calls=[
            {
                "name": "write_file",
                "call_id": "2",
                "arguments": {"file_path": "../oops.txt", "content": "nope"},
            }
        ]
    )
    assert blocked.get("mode") == "executed"
    assert isinstance(blocked.get("results"), list) and blocked["results"]
    assert blocked["results"][0]["success"] is False
    assert "escapes workspace_root" in str(blocked["results"][0].get("error") or "")
    assert not (tmp_path / "oops.txt").exists()


