from __future__ import annotations

import json
from pathlib import Path

from abstractruntime.workflow_artifact.default_nodes import register_default_visual_node_factories
from abstractruntime.workflow_artifact.interpreter import workflow_spec_from_artifact
from abstractruntime.workflow_artifact.registry import NodeRegistry

from abstractflow.visual.models import VisualFlow
from abstractflow.workflow_artifact_compiler import compile_visualflow_to_workflow_artifact


def test_workflow_artifact_compiles_all_web_flows_to_executable_specs() -> None:
    flows_dir = Path(__file__).resolve().parent.parent / "web" / "flows"
    assert flows_dir.exists() and flows_dir.is_dir()

    json_files = sorted([p for p in flows_dir.glob("*.json") if p.is_file()])
    assert json_files, "Expected at least one flow in abstractflow/web/flows/*.json"

    registry = NodeRegistry()
    register_default_visual_node_factories(registry)

    failures: list[str] = []
    for p in json_files:
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
            flow = VisualFlow.model_validate(raw)
            artifact = compile_visualflow_to_workflow_artifact(flow)
            _spec = workflow_spec_from_artifact(artifact=artifact, registry=registry)
        except Exception as e:
            failures.append(f"{p.name}: {e}")

    assert not failures, "Some flows failed to compile to WorkflowArtifact/WorkflowSpec:\\n" + "\\n".join(failures)


