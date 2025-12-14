"""Tests for Flow definition classes."""

from __future__ import annotations

import pytest

from abstractflow import Flow, FlowNode, FlowEdge


class TestFlowNode:
    """Tests for FlowNode dataclass."""

    def test_create_node_with_function(self):
        """Test creating a node with a function handler."""
        handler = lambda x: x * 2
        node = FlowNode(id="test", handler=handler)

        assert node.id == "test"
        assert node.handler is handler
        assert node.input_key is None
        assert node.output_key is None

    def test_create_node_with_keys(self):
        """Test creating a node with input/output keys."""
        node = FlowNode(
            id="test",
            handler=lambda x: x,
            input_key="input",
            output_key="output",
        )

        assert node.input_key == "input"
        assert node.output_key == "output"


class TestFlowEdge:
    """Tests for FlowEdge dataclass."""

    def test_create_edge(self):
        """Test creating a simple edge."""
        edge = FlowEdge(source="a", target="b")

        assert edge.source == "a"
        assert edge.target == "b"
        assert edge.condition is None

    def test_create_edge_with_condition(self):
        """Test creating an edge with a condition."""
        condition = lambda vars: vars.get("flag", False)
        edge = FlowEdge(source="a", target="b", condition=condition)

        assert edge.condition is condition


class TestFlow:
    """Tests for Flow class."""

    def test_create_empty_flow(self):
        """Test creating an empty flow."""
        flow = Flow("test_flow")

        assert flow.flow_id == "test_flow"
        assert flow.nodes == {}
        assert flow.edges == []
        assert flow.entry_node is None
        assert flow.exit_node is None

    def test_add_node(self):
        """Test adding nodes to a flow."""
        flow = Flow("test")
        flow.add_node("a", lambda x: x)
        flow.add_node("b", lambda x: x * 2)

        assert "a" in flow.nodes
        assert "b" in flow.nodes
        assert len(flow.nodes) == 2

    def test_add_node_chaining(self):
        """Test that add_node supports method chaining."""
        flow = (
            Flow("test")
            .add_node("a", lambda x: x)
            .add_node("b", lambda x: x)
        )

        assert len(flow.nodes) == 2

    def test_add_duplicate_node_raises(self):
        """Test that adding a duplicate node raises an error."""
        flow = Flow("test")
        flow.add_node("a", lambda x: x)

        with pytest.raises(ValueError, match="already exists"):
            flow.add_node("a", lambda x: x * 2)

    def test_add_edge(self):
        """Test adding edges to a flow."""
        flow = Flow("test")
        flow.add_node("a", lambda x: x)
        flow.add_node("b", lambda x: x)
        flow.add_edge("a", "b")

        assert len(flow.edges) == 1
        assert flow.edges[0].source == "a"
        assert flow.edges[0].target == "b"

    def test_add_edge_chaining(self):
        """Test that add_edge supports method chaining."""
        flow = (
            Flow("test")
            .add_node("a", lambda x: x)
            .add_node("b", lambda x: x)
            .add_node("c", lambda x: x)
            .add_edge("a", "b")
            .add_edge("b", "c")
        )

        assert len(flow.edges) == 2

    def test_set_entry(self):
        """Test setting the entry node."""
        flow = Flow("test")
        flow.add_node("start", lambda x: x)
        flow.set_entry("start")

        assert flow.entry_node == "start"

    def test_set_entry_invalid_node_raises(self):
        """Test that setting an invalid entry node raises an error."""
        flow = Flow("test")

        with pytest.raises(ValueError, match="not found"):
            flow.set_entry("nonexistent")

    def test_set_exit(self):
        """Test setting the exit node."""
        flow = Flow("test")
        flow.add_node("end", lambda x: x)
        flow.set_exit("end")

        assert flow.exit_node == "end"

    def test_set_exit_invalid_node_raises(self):
        """Test that setting an invalid exit node raises an error."""
        flow = Flow("test")

        with pytest.raises(ValueError, match="not found"):
            flow.set_exit("nonexistent")

    def test_get_next_nodes(self):
        """Test getting next nodes from a given node."""
        flow = Flow("test")
        flow.add_node("a", lambda x: x)
        flow.add_node("b", lambda x: x)
        flow.add_node("c", lambda x: x)
        flow.add_edge("a", "b")
        flow.add_edge("a", "c")

        next_nodes = flow.get_next_nodes("a")
        assert set(next_nodes) == {"b", "c"}

    def test_get_terminal_nodes(self):
        """Test getting terminal nodes (no outgoing edges)."""
        flow = Flow("test")
        flow.add_node("a", lambda x: x)
        flow.add_node("b", lambda x: x)
        flow.add_node("c", lambda x: x)
        flow.add_edge("a", "b")

        terminals = flow.get_terminal_nodes()
        # b and c have no outgoing edges
        assert set(terminals) == {"b", "c"}


class TestFlowValidation:
    """Tests for Flow validation."""

    def test_validate_empty_flow(self):
        """Test that an empty flow fails validation."""
        flow = Flow("test")
        errors = flow.validate()

        assert len(errors) > 0
        assert any("entry" in e.lower() for e in errors)

    def test_validate_missing_entry_node(self):
        """Test validation fails when entry node is missing."""
        flow = Flow("test")
        flow.add_node("a", lambda x: x)
        # Don't set entry

        errors = flow.validate()
        assert any("entry" in e.lower() for e in errors)

    def test_validate_invalid_edge_source(self):
        """Test validation catches invalid edge source."""
        flow = Flow("test")
        flow.add_node("a", lambda x: x)
        flow.set_entry("a")
        flow.edges.append(FlowEdge(source="nonexistent", target="a"))

        errors = flow.validate()
        assert any("nonexistent" in e for e in errors)

    def test_validate_invalid_edge_target(self):
        """Test validation catches invalid edge target."""
        flow = Flow("test")
        flow.add_node("a", lambda x: x)
        flow.set_entry("a")
        flow.edges.append(FlowEdge(source="a", target="nonexistent"))

        errors = flow.validate()
        assert any("nonexistent" in e for e in errors)

    def test_validate_unreachable_node(self):
        """Test validation catches unreachable nodes."""
        flow = Flow("test")
        flow.add_node("a", lambda x: x)
        flow.add_node("b", lambda x: x)  # Not connected
        flow.set_entry("a")

        errors = flow.validate()
        assert any("unreachable" in e.lower() for e in errors)

    def test_validate_valid_flow(self):
        """Test that a valid flow passes validation."""
        flow = Flow("test")
        flow.add_node("start", lambda x: x)
        flow.add_node("end", lambda x: x)
        flow.add_edge("start", "end")
        flow.set_entry("start")

        errors = flow.validate()
        assert errors == []


class TestFlowRepr:
    """Tests for Flow string representation."""

    def test_repr(self):
        """Test Flow __repr__ output."""
        flow = Flow("my_flow")
        flow.add_node("a", lambda x: x)
        flow.add_node("b", lambda x: x)
        flow.add_edge("a", "b")
        flow.set_entry("a")

        repr_str = repr(flow)
        assert "my_flow" in repr_str
        assert "nodes=2" in repr_str
        assert "edges=1" in repr_str
        assert "entry='a'" in repr_str
