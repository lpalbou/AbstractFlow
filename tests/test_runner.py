"""Tests for FlowRunner."""

from __future__ import annotations

import pytest

from abstractflow import Flow, FlowRunner


class TestFlowRunnerBasic:
    """Basic tests for FlowRunner."""

    def test_create_runner(self):
        """Test creating a FlowRunner."""
        flow = Flow("test")
        flow.add_node("start", lambda x: x)
        flow.set_entry("start")

        runner = FlowRunner(flow)

        assert runner.flow is flow
        assert runner.workflow.workflow_id == "test"
        assert runner.run_id is None

    def test_runner_repr(self):
        """Test FlowRunner __repr__."""
        flow = Flow("test")
        flow.add_node("start", lambda x: x)
        flow.set_entry("start")

        runner = FlowRunner(flow)
        repr_str = repr(runner)

        assert "test" in repr_str
        assert "not started" in repr_str


class TestFlowExecution:
    """Tests for flow execution."""

    def test_run_single_function_flow(self):
        """Test running a flow with a single function node."""
        flow = Flow("single")
        flow.add_node("double", lambda x: x * 2, input_key="value")
        flow.set_entry("double")

        runner = FlowRunner(flow)
        result = runner.run({"value": 21})

        assert result["success"] is True
        assert result["result"] == 42

    def test_run_linear_function_flow(self):
        """Test running a linear flow with multiple function nodes."""
        flow = Flow("linear")
        flow.add_node("double", lambda x: x * 2, input_key="value", output_key="doubled")
        flow.add_node("add_ten", lambda x: x + 10, input_key="doubled", output_key="final")
        flow.add_edge("double", "add_ten")
        flow.set_entry("double")

        runner = FlowRunner(flow)
        result = runner.run({"value": 5})

        # (5 * 2) + 10 = 20
        assert result["success"] is True
        assert result["result"] == 20

    def test_run_flow_with_dict_transformation(self):
        """Test a flow that transforms dictionaries."""
        def extract_name(data):
            return data.get("user", {}).get("name", "unknown")

        def greet(name):
            return f"Hello, {name}!"

        flow = Flow("greet")
        flow.add_node("extract", extract_name, output_key="name")
        flow.add_node("greet", greet, input_key="name")
        flow.add_edge("extract", "greet")
        flow.set_entry("extract")

        runner = FlowRunner(flow)
        result = runner.run({"user": {"name": "Alice"}})

        assert result["success"] is True
        assert result["result"] == "Hello, Alice!"

    def test_run_flow_with_error(self):
        """Test that flow errors are properly raised."""
        def failing_func(x):
            raise ValueError("Intentional error")

        flow = Flow("failing")
        flow.add_node("fail", failing_func)
        flow.set_entry("fail")

        runner = FlowRunner(flow)
        result = runner.run({})

        # Function adapter catches errors and returns error output
        assert result.get("success") is False
        assert "error" in result


class TestFlowState:
    """Tests for flow state management."""

    def test_start_returns_run_id(self):
        """Test that start() returns a run ID."""
        flow = Flow("test")
        flow.add_node("start", lambda x: x)
        flow.set_entry("start")

        runner = FlowRunner(flow)
        run_id = runner.start({})

        assert run_id is not None
        assert runner.run_id == run_id

    def test_get_state(self):
        """Test getting the run state."""
        flow = Flow("test")
        flow.add_node("start", lambda x: x)
        flow.set_entry("start")

        runner = FlowRunner(flow)

        # Before start
        assert runner.get_state() is None

        # After start
        runner.start({})
        state = runner.get_state()

        assert state is not None
        assert state.workflow_id == "test"

    def test_step_without_start_raises(self):
        """Test that step() without start() raises an error."""
        flow = Flow("test")
        flow.add_node("start", lambda x: x)
        flow.set_entry("start")

        runner = FlowRunner(flow)

        with pytest.raises(ValueError, match="No active run"):
            runner.step()


class TestFlowStatusChecks:
    """Tests for flow status check methods."""

    def test_is_running(self):
        """Test is_running() check."""
        flow = Flow("test")
        flow.add_node("start", lambda x: x)
        flow.set_entry("start")

        runner = FlowRunner(flow)

        assert not runner.is_running()

        runner.start({})
        # After start but before tick, should be running
        assert runner.is_running()

    def test_is_complete(self):
        """Test is_complete() check."""
        flow = Flow("test")
        flow.add_node("start", lambda x: x)
        flow.set_entry("start")

        runner = FlowRunner(flow)
        runner.run({})

        assert runner.is_complete()


class TestFlowLedger:
    """Tests for flow execution ledger."""

    def test_get_ledger_empty(self):
        """Test get_ledger() when no run exists."""
        flow = Flow("test")
        flow.add_node("start", lambda x: x)
        flow.set_entry("start")

        runner = FlowRunner(flow)
        ledger = runner.get_ledger()

        assert ledger == []
