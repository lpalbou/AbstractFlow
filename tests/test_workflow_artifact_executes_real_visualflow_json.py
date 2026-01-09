from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from abstractruntime import InMemoryLedgerStore, InMemoryRunStore, Runtime
from abstractruntime.core.models import Effect, EffectType, RunState
from abstractruntime.core.runtime import EffectOutcome
from abstractruntime.workflow_artifact.default_nodes import register_default_visual_node_factories
from abstractruntime.workflow_artifact.interpreter import workflow_spec_from_artifact
from abstractruntime.workflow_artifact.registry import NodeRegistry

from abstractflow.visual.models import VisualFlow
from abstractflow.workflow_artifact_compiler import compile_visualflow_to_workflow_artifact


def test_workflow_artifact_executes_real_visualflow_json_without_abstractflow_runtime_dependency() -> None:
    flow_path = Path(__file__).resolve().parent.parent / "web" / "flows" / "4ed3b340.json"
    raw = json.loads(flow_path.read_text(encoding="utf-8"))
    flow = VisualFlow.model_validate(raw)

    artifact = compile_visualflow_to_workflow_artifact(flow)

    registry = NodeRegistry()
    register_default_visual_node_factories(registry)
    spec = workflow_spec_from_artifact(artifact=artifact, registry=registry)

    def _llm_handler(run: RunState, effect: Effect, default_next_node: Optional[str]) -> EffectOutcome:
        del run, default_next_node
        assert effect.type == EffectType.LLM_CALL
        # Provide a minimal shape that the workflow expects downstream:
        # break_object(result).data -> parse_json -> break_object(enriched_request,tasks)
        return EffectOutcome.completed(
            {
                "content": "ok",
                "data": json.dumps(
                    {"enriched_request": "enriched", "tasks": ["t1", "t2"]},
                    ensure_ascii=False,
                    sort_keys=True,
                ),
            }
        )

    rt = Runtime(
        run_store=InMemoryRunStore(),
        ledger_store=InMemoryLedgerStore(),
        effect_handlers={EffectType.LLM_CALL: _llm_handler},
    )
    run_id = rt.start(workflow=spec, vars={"request": "hello"})
    run = rt.tick(workflow=spec, run_id=run_id, max_steps=200)

    assert run.status == "completed"
    assert isinstance(run.output, dict)
    result = run.output.get("result")
    assert isinstance(result, dict)
    assert result.get("enriched_request") == "enriched"
    assert result.get("tasks") == ["t1", "t2"]


