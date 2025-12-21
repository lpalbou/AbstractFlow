"""Unit test for visual Agent node scratchpad output (no real LLM calls).

Scratchpad is runtime-owned and stored under `run.vars["_runtime"]["node_traces"]`.
AbstractFlow only exposes it via the Agent node output pin.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from abstractflow import Flow, FlowRunner


def test_visual_agent_exposes_runtime_backed_scratchpad_output() -> None:
    try:
        from abstractruntime.core.models import Effect, EffectType, RunState
        from abstractruntime.core.runtime import EffectOutcome, Runtime
        from abstractruntime.storage.in_memory import InMemoryLedgerStore, InMemoryRunStore
    except Exception as e:  # pragma: no cover
        raise RuntimeError(f"abstractruntime imports failed: {e}") from e

    def llm_handler(run: RunState, effect: Effect, default_next_node: Optional[str]) -> EffectOutcome:
        del effect, default_next_node
        temp = run.vars.setdefault("_temp", {})
        if not isinstance(temp, dict):
            temp = {}
            run.vars["_temp"] = temp
        meta = temp.setdefault("_test", {})
        if not isinstance(meta, dict):
            meta = {}
            temp["_test"] = meta
        calls = int(meta.get("llm_calls") or 0)
        meta["llm_calls"] = calls + 1

        if calls == 0:
            return EffectOutcome.completed(
                {
                    "content": "I should use a tool.",
                    "tool_calls": [
                        {
                            "call_id": "call_1",
                            "name": "execute_command",
                            "arguments": {"command": "pwd"},
                        }
                    ],
                    "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
                }
            )

        return EffectOutcome.completed(
            {
                "content": "Done.",
                "tool_calls": [],
                "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
            }
        )

    def tool_handler(run: RunState, effect: Effect, default_next_node: Optional[str]) -> EffectOutcome:
        del run, default_next_node
        payload = effect.payload if isinstance(effect.payload, dict) else {}
        tool_calls = payload.get("tool_calls")
        tool_calls = tool_calls if isinstance(tool_calls, list) else []

        results: list[Dict[str, Any]] = []
        for tc in tool_calls:
            if not isinstance(tc, dict):
                continue
            results.append(
                {
                    "call_id": tc.get("call_id"),
                    "name": tc.get("name"),
                    "result": {"stdout": "/fake/dir", "stderr": "", "exit_code": 0},
                }
            )

        return EffectOutcome.completed({"results": results})

    runtime = Runtime(
        run_store=InMemoryRunStore(),
        ledger_store=InMemoryLedgerStore(),
        effect_handlers={
            EffectType.LLM_CALL: llm_handler,
            EffectType.TOOL_CALLS: tool_handler,
        },
    )

    flow = Flow("test-visual-agent-scratchpad")
    flow._node_outputs = {}
    flow._data_edge_map = {}

    flow.add_node(
        "agent1",
        lambda _last: {"task": "run pwd and respond", "context": {}},
        effect_type="agent",
        effect_config={
            "provider": "stub",
            "model": "stub",
            "tools": ["execute_command"],
        },
    )
    flow.set_entry("agent1")

    runner = FlowRunner(flow, runtime=runtime)
    result = runner.run({})
    assert result.get("success") is True

    state = runner.get_state()
    assert state is not None

    # AbstractFlow must not "own" scratchpad persistence under run.vars["scratchpad"]["agents"].
    scratchpad_ns = state.vars.get("scratchpad")
    if isinstance(scratchpad_ns, dict):
        assert scratchpad_ns.get("agents") is None

    runtime_ns = state.vars.get("_runtime")
    assert isinstance(runtime_ns, dict)
    traces = runtime_ns.get("node_traces")
    assert isinstance(traces, dict)
    agent_trace = traces.get("agent1")
    assert isinstance(agent_trace, dict)
    assert agent_trace.get("node_id") == "agent1"
    steps = agent_trace.get("steps")
    assert isinstance(steps, list)
    assert len(steps) >= 2
    assert any(
        isinstance(step, dict) and isinstance(step.get("effect"), dict) and step["effect"].get("type") == "tool_calls"
        for step in steps
    )

    node_output = flow._node_outputs.get("agent1")
    assert isinstance(node_output, dict)
    assert "result" in node_output
    assert node_output.get("scratchpad") == agent_trace
