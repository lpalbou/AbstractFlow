from __future__ import annotations

import json
from pathlib import Path

from abstractruntime.visualflow_compiler import compile_visualflow


def test_visualflow_compiler_compiles_all_web_flows_to_executable_specs() -> None:
    flows_dir = Path(__file__).resolve().parent.parent / "web" / "flows"
    assert flows_dir.exists() and flows_dir.is_dir()

    json_files = sorted([p for p in flows_dir.glob("*.json") if p.is_file()])
    assert json_files, "Expected at least one flow in abstractflow/web/flows/*.json"

    failures: list[str] = []
    for p in json_files:
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
            _spec = compile_visualflow(raw)
        except Exception as e:
            failures.append(f"{p.name}: {e}")

    assert not failures, "Some flows failed to compile via VisualFlow compiler:\\n" + "\\n".join(failures)

