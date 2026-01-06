"""Pydantic models for the AbstractFlow visual workflow JSON format.

These models are intentionally kept in the `abstractflow` package so workflows
authored in the visual editor can be loaded and executed from any host (CLI,
AbstractCode, servers), not only the web backend.
"""

from __future__ import annotations

from enum import Enum
from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class PinType(str, Enum):
    """Types of pins with their colors."""

    EXECUTION = "execution"  # White #FFFFFF - Flow control
    STRING = "string"  # Magenta #FF00FF - Text data
    NUMBER = "number"  # Green #00FF00 - Integer/Float
    BOOLEAN = "boolean"  # Red #FF0000 - True/False
    OBJECT = "object"  # Cyan #00FFFF - JSON objects
    ARRAY = "array"  # Orange #FF8800 - Collections
    TOOLS = "tools"  # Orange - Tool allowlist (string[])
    PROVIDER = "provider"  # Cyan-blue - LLM provider id/name (string-like)
    MODEL = "model"  # Purple - LLM model id/name (string-like)
    AGENT = "agent"  # Blue #4488FF - Agent reference
    ANY = "any"  # Gray #888888 - Accepts any type


class NodeType(str, Enum):
    """Types of nodes in the visual editor."""

    # Event/Trigger nodes (entry points)
    ON_FLOW_START = "on_flow_start"
    ON_USER_REQUEST = "on_user_request"
    ON_AGENT_MESSAGE = "on_agent_message"
    ON_SCHEDULE = "on_schedule"
    ON_EVENT = "on_event"
    # Flow IO nodes
    ON_FLOW_END = "on_flow_end"
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
    STRING_TEMPLATE = "string_template"
    UPPERCASE = "uppercase"
    LOWERCASE = "lowercase"
    TRIM = "trim"
    SUBSTRING = "substring"
    LENGTH = "length"
    # Control
    IF = "if"
    SWITCH = "switch"
    LOOP = "loop"
    WHILE = "while"
    FOR = "for"
    SEQUENCE = "sequence"
    PARALLEL = "parallel"
    COMPARE = "compare"
    NOT = "not"
    AND = "and"
    OR = "or"
    COALESCE = "coalesce"
    # Data
    GET = "get"
    SET = "set"
    MERGE = "merge"
    MAKE_ARRAY = "make_array"
    ARRAY_MAP = "array_map"
    ARRAY_FILTER = "array_filter"
    ARRAY_CONCAT = "array_concat"
    ARRAY_LENGTH = "array_length"
    ARRAY_APPEND = "array_append"
    ARRAY_DEDUP = "array_dedup"
    GET_VAR = "get_var"
    SET_VAR = "set_var"
    SET_VARS = "set_vars"
    SET_VAR_PROPERTY = "set_var_property"
    PARSE_JSON = "parse_json"
    STRINGIFY_JSON = "stringify_json"
    AGENT_TRACE_REPORT = "agent_trace_report"
    BREAK_OBJECT = "break_object"
    SYSTEM_DATETIME = "system_datetime"
    MODEL_CATALOG = "model_catalog"
    PROVIDER_CATALOG = "provider_catalog"
    PROVIDER_MODELS = "provider_models"
    # Literals
    LITERAL_STRING = "literal_string"
    LITERAL_NUMBER = "literal_number"
    LITERAL_BOOLEAN = "literal_boolean"
    LITERAL_JSON = "literal_json"
    JSON_SCHEMA = "json_schema"
    LITERAL_ARRAY = "literal_array"
    # Effects
    ASK_USER = "ask_user"
    ANSWER_USER = "answer_user"
    LLM_CALL = "llm_call"
    WAIT_UNTIL = "wait_until"
    WAIT_EVENT = "wait_event"
    EMIT_EVENT = "emit_event"
    READ_FILE = "read_file"
    WRITE_FILE = "write_file"
    MEMORY_NOTE = "memory_note"
    MEMORY_QUERY = "memory_query"
    MEMORY_REHYDRATE = "memory_rehydrate"
    TOOL_CALLS = "tool_calls"
    TOOLS_ALLOWLIST = "tools_allowlist"
    BOOL_VAR = "bool_var"
    VAR_DECL = "var_decl"


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
    # Optional interface markers (host contracts).
    # Example: ["abstractcode.agent.v1"] to indicate this workflow can be run as an AbstractCode agent.
    interfaces: List[str] = Field(default_factory=list)
    nodes: List[VisualNode] = Field(default_factory=list)
    edges: List[VisualEdge] = Field(default_factory=list)
    entryNode: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class FlowCreateRequest(BaseModel):
    """Request to create a new flow."""

    name: str
    description: str = ""
    interfaces: List[str] = Field(default_factory=list)
    nodes: List[VisualNode] = Field(default_factory=list)
    edges: List[VisualEdge] = Field(default_factory=list)
    entryNode: Optional[str] = None


class FlowUpdateRequest(BaseModel):
    """Request to update an existing flow."""

    name: Optional[str] = None
    description: Optional[str] = None
    interfaces: Optional[List[str]] = None
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
    waiting: bool = False
    wait_key: Optional[str] = None
    prompt: Optional[str] = None
    choices: Optional[List[str]] = None
    allow_free_text: Optional[bool] = None


class ExecutionMetrics(BaseModel):
    """Optional per-step (or whole-run) execution metrics.

    These fields are best-effort and may be omitted depending on host/runtime capabilities.
    """

    duration_ms: Optional[float] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    tokens_per_s: Optional[float] = None


class ExecutionEvent(BaseModel):
    """Real-time execution event for WebSocket."""

    type: str  # "node_start", "node_complete", "flow_complete", "flow_error"
    # ISO 8601 UTC timestamp for event emission (host-side observability).
    ts: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    runId: Optional[str] = None
    nodeId: Optional[str] = None
    result: Optional[Any] = None
    error: Optional[str] = None
    meta: Optional[ExecutionMetrics] = None
