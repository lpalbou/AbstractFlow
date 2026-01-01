from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict

from abstractflow.compiler import _create_visual_agent_effect_handler
from abstractruntime.core.models import EffectType


class _DummyFlow:
    def __init__(self) -> None:
        self.flow_id = "flow-test"
        self._node_outputs: Dict[str, Any] = {}


def test_visual_agent_node_reentry_resets_bucket_and_reruns_with_new_inputs() -> None:
    """Regression: Visual Agent nodes inside loops can be re-entered.

    The handler previously cached `phase="done"` + `resolved_inputs` per node_id,
    causing subsequent invocations to *skip* and reuse the first task forever.
    """

    flow = _DummyFlow()

    # Data handler reads the current pipeline output (set by upstream nodes) and maps it to agent inputs.
    def data_handler(last_output: Any) -> Dict[str, Any]:
        if isinstance(last_output, dict):
            task = str(last_output.get("task") or "")
        else:
            task = str(last_output or "")
        return {
            "task": task,
            "provider": "lmstudio",
            "model": "qwen/qwen3-next-80b",
            "max_iterations": 42,
            "system": "",
            "context": {},
            "tools": [],
        }

    handler = _create_visual_agent_effect_handler(
        node_id="agent",
        next_node="next",
        agent_config={"provider": "lmstudio", "model": "qwen/qwen3-next-80b", "tools": []},
        data_aware_handler=data_handler,
        flow=flow,  # type: ignore[arg-type]
    )

    run = SimpleNamespace(vars={"_temp": {}, "_last_output": {"task": "TASK 0"}})

    # First entry: should start subworkflow.
    plan1 = handler(run, None)
    assert plan1.effect is not None
    assert plan1.effect.type == EffectType.START_SUBWORKFLOW
    assert plan1.next_node == "agent"
    assert run.vars["_temp"]["agent"]["agent"]["phase"] == "subworkflow"

    payload_vars1 = plan1.effect.payload.get("vars")
    assert isinstance(payload_vars1, dict)
    limits1 = payload_vars1.get("_limits")
    assert isinstance(limits1, dict)
    assert limits1.get("max_iterations") == 42
    scratchpad1 = payload_vars1.get("scratchpad")
    assert isinstance(scratchpad1, dict)
    assert scratchpad1.get("max_iterations") == 42

    # Simulate the runtime writing the subworkflow result into the specified result_key.
    run.vars["_temp"]["agent"]["agent"]["sub"] = {
        "sub_run_id": "sub_1",
        "output": {"answer": "done 0", "iterations": 1, "messages": []},
        "node_traces": {},
    }

    # Second call (same node_id) processes subworkflow completion and marks done.
    plan2 = handler(run, None)
    assert run.vars["_temp"]["agent"]["agent"]["phase"] == "done"
    assert plan2.next_node == "next"

    # Re-enter the node later with a different upstream task. This must create a *new* START_SUBWORKFLOW.
    run.vars["_last_output"] = {"task": "TASK 1"}
    plan3 = handler(run, None)
    assert plan3.effect is not None
    assert plan3.effect.type == EffectType.START_SUBWORKFLOW
    # Ensure the new subworkflow vars reflect the updated task.
    payload_vars = plan3.effect.payload.get("vars")
    assert isinstance(payload_vars, dict)
    assert payload_vars.get("context", {}).get("task") == "TASK 1"


