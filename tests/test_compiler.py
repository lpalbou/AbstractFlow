"""Tests for flow compiler."""

from __future__ import annotations

import pytest

from abstractflow import Flow, compile_flow


class TestCompileFlow:
    """Tests for compile_flow function."""

    def test_compile_single_node_flow(self):
        """Test compiling a flow with a single node."""
        flow = Flow("single")
        flow.add_node("start", lambda x: x * 2)
        flow.set_entry("start")

        spec = compile_flow(flow)

        assert spec.workflow_id == "single"
        assert spec.entry_node == "start"
        assert "start" in spec.nodes

    def test_compile_linear_flow(self):
        """Test compiling a linear flow (a -> b -> c)."""
        flow = Flow("linear")
        flow.add_node("a", lambda x: x)
        flow.add_node("b", lambda x: x)
        flow.add_node("c", lambda x: x)
        flow.add_edge("a", "b")
        flow.add_edge("b", "c")
        flow.set_entry("a")

        spec = compile_flow(flow)

        assert spec.workflow_id == "linear"
        assert spec.entry_node == "a"
        assert set(spec.nodes.keys()) == {"a", "b", "c"}

    def test_compile_invalid_flow_raises(self):
        """Test that compiling an invalid flow raises an error."""
        flow = Flow("invalid")
        # No entry node

        with pytest.raises(ValueError, match="entry"):
            compile_flow(flow)

    def test_compile_flow_with_unknown_handler_raises(self):
        """Test that unknown handler types raise an error."""
        flow = Flow("test")
        # Add a node with an invalid handler type
        flow.nodes["bad"] = type("FakeNode", (), {
            "id": "bad",
            "handler": "not a callable",
            "input_key": None,
            "output_key": None,
        })()
        flow.entry_node = "bad"

        with pytest.raises(TypeError, match="Unknown handler type"):
            compile_flow(flow)

    def test_compile_flow_with_branching_raises(self):
        """Test that branching (multiple outgoing edges) raises an error."""
        flow = Flow("branching")
        flow.add_node("a", lambda x: x)
        flow.add_node("b", lambda x: x)
        flow.add_node("c", lambda x: x)
        flow.add_edge("a", "b")
        flow.add_edge("a", "c")  # Second edge from 'a'
        flow.set_entry("a")

        with pytest.raises(ValueError, match="multiple outgoing edges"):
            compile_flow(flow)


class TestNestedFlowCompilation:
    """Tests for nested flow compilation."""

    def test_compile_nested_flow(self):
        """Test compiling a flow containing a nested flow."""
        # Inner flow
        inner = Flow("inner")
        inner.add_node("process", lambda x: x * 2)
        inner.set_entry("process")

        # Outer flow
        outer = Flow("outer")
        outer.add_node("start", lambda x: x)
        outer.add_node("nested", inner)  # Nested flow as node
        outer.add_node("end", lambda x: x)
        outer.add_edge("start", "nested")
        outer.add_edge("nested", "end")
        outer.set_entry("start")

        spec = compile_flow(outer)

        assert spec.workflow_id == "outer"
        assert "nested" in spec.nodes
