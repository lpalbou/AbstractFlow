"""Integration test: Visual Agent passes system prompt + tool allowlist to ReAct subworkflow."""

from __future__ import annotations

from typing import Any, Dict, Optional

from abstractflow import Flow, FlowRunner


def test_visual_agent_passes_system_prompt_and_allowed_tools_to_subworkflow() -> None:
    try:
        from abstractruntime.core.models import Effect, EffectType, RunState
        from abstractruntime.core.runtime import EffectOutcome, Runtime
        from abstractruntime.storage.in_memory import InMemoryLedgerStore, InMemoryRunStore
        from abstractruntime.scheduler.registry import WorkflowRegistry
    except Exception as e:  # pragma: no cover
        raise RuntimeError(f"abstractruntime imports failed: {e}") from e

    from abstractagent.adapters.react_runtime import create_react_workflow
    from abstractagent.logic.react import ReActLogic
    from abstractcore.tools import ToolDefinition
    from abstractflow.visual.agent_ids import visual_react_workflow_id

    captured: dict[str, Any] = {}

    def llm_handler(run: RunState, effect: Effect, default_next_node: Optional[str]) -> EffectOutcome:
        del run, default_next_node
        payload = effect.payload if isinstance(effect.payload, dict) else {}
        captured["payload"] = dict(payload)
        return EffectOutcome.completed(
            {
                "content": "Done.",
                "tool_calls": [],
                "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
            }
        )

    runtime = Runtime(
        run_store=InMemoryRunStore(),
        ledger_store=InMemoryLedgerStore(),
        effect_handlers={
            EffectType.LLM_CALL: llm_handler,
        },
    )

    # Register a derived ReAct workflow for this Agent node.
    flow_id = "test-visual-agent-pins"
    node_id = "agent1"
    react_workflow_id = visual_react_workflow_id(flow_id=flow_id, node_id=node_id)
    registry = WorkflowRegistry()
    registry.register(
        create_react_workflow(
            logic=ReActLogic(
                tools=[
                    ToolDefinition(name="tool_a", description="A", parameters={}),
                    ToolDefinition(name="tool_b", description="B", parameters={}),
                ]
            ),
            workflow_id=react_workflow_id,
            provider="stub",
            model="stub",
            allowed_tools=["tool_a"],  # default allowlist (should be overridden by vars)
        )
    )
    runtime.set_workflow_registry(registry)

    flow = Flow(flow_id)
    flow._node_outputs = {}
    flow._data_edge_map = {}

    # Agent node handler returns resolved inputs including system + tools overrides.
    flow.add_node(
        node_id,
        lambda _last: {
            "task": "hello",
            "context": {},
            "system": "SYS",
            "tools": ["tool_b"],
            "provider": "stub",
            "model": "stub",
        },
        effect_type="agent",
        effect_config={"provider": "stub", "model": "stub"},
    )
    flow.set_entry(node_id)

    runner = FlowRunner(flow, runtime=runtime)
    result = runner.run({})
    assert result.get("success") is True

    payload = captured.get("payload")
    assert isinstance(payload, dict)
    assert payload.get("system_prompt") == "SYS"

    tools_payload = payload.get("tools")
    assert isinstance(tools_payload, list)
    tool_names = [t.get("name") for t in tools_payload if isinstance(t, dict)]
    assert tool_names == ["tool_b"]


def test_visual_agent_uses_agent_config_tools_when_tools_pin_unconnected() -> None:
    try:
        from abstractruntime.core.models import Effect, EffectType, RunState
        from abstractruntime.core.runtime import EffectOutcome, Runtime
        from abstractruntime.storage.in_memory import InMemoryLedgerStore, InMemoryRunStore
        from abstractruntime.scheduler.registry import WorkflowRegistry
    except Exception as e:  # pragma: no cover
        raise RuntimeError(f"abstractruntime imports failed: {e}") from e

    from abstractagent.adapters.react_runtime import create_react_workflow
    from abstractagent.logic.react import ReActLogic
    from abstractcore.tools import ToolDefinition
    from abstractflow.visual.agent_ids import visual_react_workflow_id

    captured: dict[str, Any] = {}

    def llm_handler(run: RunState, effect: Effect, default_next_node: Optional[str]) -> EffectOutcome:
        del run, default_next_node
        payload = effect.payload if isinstance(effect.payload, dict) else {}
        captured["payload"] = dict(payload)
        return EffectOutcome.completed(
            {
                "content": "Done.",
                "tool_calls": [],
                "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
            }
        )

    runtime = Runtime(
        run_store=InMemoryRunStore(),
        ledger_store=InMemoryLedgerStore(),
        effect_handlers={
            EffectType.LLM_CALL: llm_handler,
        },
    )

    flow_id = "test-visual-agent-tools-default"
    node_id = "agent1"
    react_workflow_id = visual_react_workflow_id(flow_id=flow_id, node_id=node_id)
    registry = WorkflowRegistry()
    registry.register(
        create_react_workflow(
            logic=ReActLogic(
                tools=[
                    ToolDefinition(name="tool_a", description="A", parameters={}),
                    ToolDefinition(name="tool_b", description="B", parameters={}),
                ]
            ),
            workflow_id=react_workflow_id,
            provider="stub",
            model="stub",
        )
    )
    runtime.set_workflow_registry(registry)

    flow = Flow(flow_id)
    flow._node_outputs = {}
    flow._data_edge_map = {}  # tools pin is unconnected

    # No `tools` key in resolved inputs; should fall back to agent_config.tools.
    flow.add_node(
        node_id,
        lambda _last: {
            "task": "hello",
            "context": {},
            "system": "SYS",
            "provider": "stub",
            "model": "stub",
        },
        effect_type="agent",
        effect_config={"provider": "stub", "model": "stub", "tools": ["tool_b"], "_react_workflow_id": react_workflow_id},
    )
    flow.set_entry(node_id)

    runner = FlowRunner(flow, runtime=runtime)
    result = runner.run({})
    assert result.get("success") is True

    payload = captured.get("payload")
    assert isinstance(payload, dict)
    tools_payload = payload.get("tools")
    assert isinstance(tools_payload, list)
    tool_names = [t.get("name") for t in tools_payload if isinstance(t, dict)]
    assert tool_names == ["tool_b"]
