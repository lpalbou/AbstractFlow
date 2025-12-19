"""Pydantic models for the visual editor API."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from enum import Enum
import uuid


class PinType(str, Enum):
    """Types of pins with their colors."""

    EXECUTION = "execution"  # White #FFFFFF - Flow control
    STRING = "string"        # Magenta #FF00FF - Text data
    NUMBER = "number"        # Green #00FF00 - Integer/Float
    BOOLEAN = "boolean"      # Red #FF0000 - True/False
    OBJECT = "object"        # Cyan #00FFFF - JSON objects
    ARRAY = "array"          # Orange #FF8800 - Collections
    AGENT = "agent"          # Blue #4488FF - Agent reference
    ANY = "any"              # Gray #888888 - Accepts any type


class NodeType(str, Enum):
    """Types of nodes in the visual editor."""

    # Event/Trigger nodes (entry points)
    ON_USER_REQUEST = "on_user_request"
    ON_AGENT_MESSAGE = "on_agent_message"
    ON_SCHEDULE = "on_schedule"
    # Core execution nodes
    AGENT = "agent"
    FUNCTION = "function"
    CODE = "code"
    SUBFLOW = "subflow"
    # Math
    ADD = "add"
    SUBTRACT = "subtract"
    MULTIPLY = "multiply"
    DIVIDE = "divide"
    MODULO = "modulo"
    POWER = "power"
    ABS = "abs"
    ROUND = "round"
    # String
    CONCAT = "concat"
    SPLIT = "split"
    JOIN = "join"
    FORMAT = "format"
    UPPERCASE = "uppercase"
    LOWERCASE = "lowercase"
    TRIM = "trim"
    SUBSTRING = "substring"
    LENGTH = "length"
    # Control
    IF = "if"
    SWITCH = "switch"
    LOOP = "loop"
    COMPARE = "compare"
    NOT = "not"
    AND = "and"
    OR = "or"
    # Data
    GET = "get"
    SET = "set"
    MERGE = "merge"
    ARRAY_MAP = "array_map"
    ARRAY_FILTER = "array_filter"


class Pin(BaseModel):
    """A connection point on a node."""

    id: str
    label: str
    type: PinType


class Position(BaseModel):
    """2D position on canvas."""

    x: float
    y: float


class VisualNode(BaseModel):
    """A node in the visual flow editor."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    type: NodeType
    position: Position
    data: Dict[str, Any] = Field(default_factory=dict)
    # Node display properties (from template)
    label: Optional[str] = None
    icon: Optional[str] = None
    headerColor: Optional[str] = None
    inputs: List[Pin] = Field(default_factory=list)
    outputs: List[Pin] = Field(default_factory=list)


class VisualEdge(BaseModel):
    """An edge connecting two nodes."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    source: str
    sourceHandle: str  # Pin ID on source node
    target: str
    targetHandle: str  # Pin ID on target node
    animated: bool = False


class VisualFlow(BaseModel):
    """A complete visual flow definition."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    name: str
    description: str = ""
    nodes: List[VisualNode] = Field(default_factory=list)
    edges: List[VisualEdge] = Field(default_factory=list)
    entryNode: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class FlowCreateRequest(BaseModel):
    """Request to create a new flow."""

    name: str
    description: str = ""
    nodes: List[VisualNode] = Field(default_factory=list)
    edges: List[VisualEdge] = Field(default_factory=list)
    entryNode: Optional[str] = None


class FlowUpdateRequest(BaseModel):
    """Request to update an existing flow."""

    name: Optional[str] = None
    description: Optional[str] = None
    nodes: Optional[List[VisualNode]] = None
    edges: Optional[List[VisualEdge]] = None
    entryNode: Optional[str] = None


class FlowRunRequest(BaseModel):
    """Request to execute a flow."""

    input_data: Dict[str, Any] = Field(default_factory=dict)


class FlowRunResult(BaseModel):
    """Result of a flow execution."""

    success: bool
    result: Optional[Any] = None
    error: Optional[str] = None
    run_id: Optional[str] = None


class ExecutionEvent(BaseModel):
    """Real-time execution event for WebSocket."""

    type: str  # "node_start", "node_complete", "flow_complete", "flow_error"
    nodeId: Optional[str] = None
    result: Optional[Any] = None
    error: Optional[str] = None
