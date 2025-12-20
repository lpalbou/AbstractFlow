"""Flow definition classes for AbstractFlow.

This module provides the core data structures for defining flows:
- Flow: A directed graph of nodes connected by edges
- FlowNode: A node in the flow (agent, function, or nested flow)
- FlowEdge: An edge connecting two nodes
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Union, TYPE_CHECKING

if TYPE_CHECKING:
    # Avoid circular import - only used for type hints
    pass


@dataclass
class FlowNode:
    """A node in a flow graph.

    Attributes:
        id: Unique identifier for the node within the flow
        handler: The handler for this node - can be an agent, function, or nested flow
        input_key: Key in run.vars to read input from (optional)
        output_key: Key in run.vars to write output to (optional)
        effect_type: Effect type for effect nodes (ask_user, wait_until, etc.)
        effect_config: Additional configuration for effect nodes
    """
    id: str
    handler: Any  # Union[BaseAgent, Callable, Flow] - Any to avoid circular imports
    input_key: Optional[str] = None
    output_key: Optional[str] = None
    effect_type: Optional[str] = None  # e.g., "ask_user", "wait_until", etc.
    effect_config: Optional[Dict[str, Any]] = None  # Effect-specific configuration


@dataclass
class FlowEdge:
    """An edge connecting two nodes in a flow.

    Attributes:
        source: ID of the source node
        target: ID of the target node
        condition: Optional condition function for conditional routing (future)
        source_handle: Optional execution output handle id (visual flows).
    """
    source: str
    target: str
    condition: Optional[Callable[[Dict[str, Any]], bool]] = None
    source_handle: Optional[str] = None


class Flow:
    """Declarative flow definition that compiles to WorkflowSpec.

    A Flow represents a directed graph of nodes (agents, functions, or nested flows)
    connected by edges. Flows can be compiled to AbstractRuntime WorkflowSpec for
    durable execution.

    Example:
        >>> flow = Flow("my_flow")
        >>> flow.add_node("start", my_function, output_key="data")
        >>> flow.add_node("process", process_function, input_key="data")
        >>> flow.add_edge("start", "process")
        >>> flow.set_entry("start")
    """

    def __init__(self, flow_id: str):
        """Initialize a new flow.

        Args:
            flow_id: Unique identifier for this flow
        """
        self.flow_id = flow_id
        self.nodes: Dict[str, FlowNode] = {}
        self.edges: List[FlowEdge] = []
        self.entry_node: Optional[str] = None
        self.exit_node: Optional[str] = None

    def add_node(
        self,
        node_id: str,
        handler: Any,
        *,
        input_key: Optional[str] = None,
        output_key: Optional[str] = None,
        effect_type: Optional[str] = None,
        effect_config: Optional[Dict[str, Any]] = None,
    ) -> "Flow":
        """Add a node to the flow.

        Args:
            node_id: Unique identifier for this node
            handler: The handler - an agent, callable function, or nested Flow
            input_key: Key in run.vars to read input from
            output_key: Key in run.vars to write output to
            effect_type: Effect type for effect nodes (ask_user, wait_until, etc.)
            effect_config: Additional configuration for effect nodes

        Returns:
            Self for method chaining
        """
        if node_id in self.nodes:
            raise ValueError(f"Node '{node_id}' already exists in flow '{self.flow_id}'")

        self.nodes[node_id] = FlowNode(
            id=node_id,
            handler=handler,
            input_key=input_key,
            output_key=output_key,
            effect_type=effect_type,
            effect_config=effect_config,
        )
        return self

    def add_edge(
        self,
        source: str,
        target: str,
        *,
        condition: Optional[Callable[[Dict[str, Any]], bool]] = None,
        source_handle: Optional[str] = None,
    ) -> "Flow":
        """Add an edge between nodes.

        Args:
            source: ID of the source node
            target: ID of the target node
            condition: Optional condition function for conditional routing

        Returns:
            Self for method chaining
        """
        self.edges.append(
            FlowEdge(
                source=source,
                target=target,
                condition=condition,
                source_handle=source_handle,
            )
        )
        return self

    def set_entry(self, node_id: str) -> "Flow":
        """Set the entry node for the flow.

        Args:
            node_id: ID of the entry node

        Returns:
            Self for method chaining
        """
        if node_id not in self.nodes:
            raise ValueError(f"Entry node '{node_id}' not found in flow '{self.flow_id}'")
        self.entry_node = node_id
        return self

    def set_exit(self, node_id: str) -> "Flow":
        """Set the exit node for the flow (optional, can be inferred).

        Args:
            node_id: ID of the exit node

        Returns:
            Self for method chaining
        """
        if node_id not in self.nodes:
            raise ValueError(f"Exit node '{node_id}' not found in flow '{self.flow_id}'")
        self.exit_node = node_id
        return self

    def validate(self) -> List[str]:
        """Validate the flow definition.

        Returns:
            List of validation error messages (empty if valid)
        """
        errors = []

        if not self.entry_node:
            errors.append("Flow must have an entry node")
        elif self.entry_node not in self.nodes:
            errors.append(f"Entry node '{self.entry_node}' not found")

        # Check that all edge endpoints exist
        for edge in self.edges:
            if edge.source not in self.nodes:
                errors.append(f"Edge source '{edge.source}' not found")
            if edge.target not in self.nodes:
                errors.append(f"Edge target '{edge.target}' not found")

        # Check for unreachable nodes
        if self.entry_node:
            reachable = self._find_reachable_nodes(self.entry_node)
            for node_id in self.nodes:
                if node_id not in reachable:
                    errors.append(f"Node '{node_id}' is unreachable from entry")

        return errors

    def _find_reachable_nodes(self, start: str) -> set:
        """Find all nodes reachable from a starting node."""
        reachable = set()
        to_visit = [start]

        while to_visit:
            current = to_visit.pop()
            if current in reachable:
                continue
            reachable.add(current)

            # Find outgoing edges
            for edge in self.edges:
                if edge.source == current and edge.target not in reachable:
                    to_visit.append(edge.target)

        return reachable

    def get_next_nodes(self, node_id: str) -> List[str]:
        """Get the next nodes from a given node.

        Args:
            node_id: ID of the current node

        Returns:
            List of target node IDs
        """
        return [edge.target for edge in self.edges if edge.source == node_id]

    def get_terminal_nodes(self) -> List[str]:
        """Get nodes with no outgoing edges (terminal nodes).

        Returns:
            List of terminal node IDs
        """
        sources = {edge.source for edge in self.edges}
        return [node_id for node_id in self.nodes if node_id not in sources]

    def __repr__(self) -> str:
        return (
            f"Flow(id={self.flow_id!r}, "
            f"nodes={len(self.nodes)}, "
            f"edges={len(self.edges)}, "
            f"entry={self.entry_node!r})"
        )
