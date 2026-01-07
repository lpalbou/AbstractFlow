"""AbstractFlow - Multi-agent orchestration layer for the Abstract Framework.

AbstractFlow enables composition of agents into pipelines and coordinates
their execution via AbstractRuntime. It provides:

- Flow: Declarative flow definition with nodes and edges
- FlowRunner: High-level interface for running flows
- compile_flow: Convert Flow to WorkflowSpec for direct runtime usage

Example:
    >>> from abstractflow import Flow, FlowRunner
    >>>
    >>> # Define a simple flow
    >>> flow = Flow("my_pipeline")
    >>> flow.add_node("step1", lambda x: x * 2, input_key="value", output_key="doubled")
    >>> flow.add_node("step2", lambda x: x + 10, input_key="doubled", output_key="result")
    >>> flow.add_edge("step1", "step2")
    >>> flow.set_entry("step1")
    >>>
    >>> # Run the flow
    >>> runner = FlowRunner(flow)
    >>> result = runner.run({"value": 5})
    >>> print(result)  # {'result': 20, 'success': True}

For agent-based flows:
    >>> from abstractflow import Flow, FlowRunner
    >>> from abstractagent import create_react_agent
    >>>
    >>> planner = create_react_agent(provider="ollama", model="qwen3:4b")
    >>> executor = create_react_agent(provider="ollama", model="qwen3:4b")
    >>>
    >>> flow = Flow("plan_and_execute")
    >>> flow.add_node("plan", planner, output_key="plan")
    >>> flow.add_node("execute", executor, input_key="plan")
    >>> flow.add_edge("plan", "execute")
    >>> flow.set_entry("plan")
    >>>
    >>> runner = FlowRunner(flow)
    >>> result = runner.run({"context": {"task": "Build a REST API"}})
"""

__version__ = "0.3.0"
__author__ = "Laurent-Philippe Albou"
__email__ = "contact@abstractcore.ai"
__license__ = "MIT"

# Core classes
from .core.flow import Flow, FlowNode, FlowEdge

# Compiler
from .compiler import compile_flow

# Runner
from .runner import FlowRunner

# Adapters (for advanced usage)
from .adapters import (
    create_function_node_handler,
    create_agent_node_handler,
    create_subflow_node_handler,
)

__all__ = [
    # Version info
    "__version__",
    "__author__",
    "__email__",
    "__license__",
    # Core classes
    "Flow",
    "FlowNode",
    "FlowEdge",
    # Compiler
    "compile_flow",
    # Runner
    "FlowRunner",
    # Adapters
    "create_function_node_handler",
    "create_agent_node_handler",
    "create_subflow_node_handler",
]


def get_version() -> str:
    """Get the current version of AbstractFlow."""
    return __version__


def is_development_version() -> bool:
    """Check if this is a development version."""
    return False  # Now implemented!
