from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from abstractruntime import InMemoryLedgerStore, InMemoryRunStore, Runtime
from abstractruntime.core.models import Effect, EffectType, RunState
from abstractruntime.core.runtime import EffectOutcome
from abstractruntime.visualflow_compiler import compile_visualflow


def test_visualflow_compiler_executes_real_visualflow_json_without_abstractflow_runtime_dependency() -> None:
    flow_path = Path(__file__).resolve().parent.parent / "web" / "flows" / "4ed3b340.json"
    raw = json.loads(flow_path.read_text(encoding="utf-8"))
    spec = compile_visualflow(raw)

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
    assert run.output.get("success") is True
    assert "result" not in run.output
    assert run.output.get("enriched_request") == "enriched"
    assert run.output.get("tasks") == ["t1", "t2"]
