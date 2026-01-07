/**
 * Type definitions for the AbstractFlow visual editor.
 */

// Pin types with their colors (Blueprint-inspired)
export type PinType =
  | 'execution' // White #FFFFFF - Flow control
  | 'string'    // Magenta #FF00FF - Text data
  | 'number'    // Green #00FF00 - Integer/Float
  | 'boolean'   // Red #FF0000 - True/False
  | 'object'    // Cyan #00FFFF - JSON objects
  | 'array'     // Orange #FF8800 - Collections
  | 'tools'     // Orange - Tool allowlist (string[])
  | 'provider'  // Cyan-blue - LLM provider id/name (string-like)
  | 'model'     // Purple - LLM model id/name (string-like)
  | 'agent'     // Blue #4488FF - Agent reference
  | 'any';      // Gray #888888 - Accepts any type

// Pin colors
export const PIN_COLORS: Record<PinType, string> = {
  execution: '#FFFFFF',
  string: '#FF00FF',
  number: '#00FF00',
  boolean: '#FF0000',
  object: '#00FFFF',
  array: '#FF8800',
  tools: '#FF8800',
  provider: '#00D2FF',
  model: '#9D4EDD',
  agent: '#4488FF',
  any: '#888888',
};

// A connection point on a node
export interface Pin {
  id: string;
  label: string;
  type: PinType;
  /**
   * Optional pin documentation (shown as a delayed tooltip on hover in the editor).
   * Keep it short and action-oriented: what this pin represents + how it affects runtime behavior.
   */
  description?: string;
}

// JSON-serializable values used for pin defaults and literals.
export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

// Node types
export type NodeType =
  // Event/Trigger nodes (only exec OUT - entry points for flow)
  | 'on_flow_start'      // Triggered when a flow starts running
  | 'on_user_request'    // Triggered by user input
  | 'on_agent_message'   // Triggered by inter-agent communication
  | 'on_schedule'        // Triggered by scheduled events
  | 'on_event'           // Triggered by a custom durable event (session-scoped by default)
  // Flow IO nodes
  | 'on_flow_end'        // Terminal node to expose flow outputs
  // Core execution nodes (exec IN and OUT)
  | 'agent'
  | 'function'
  | 'code'
  | 'subflow'
  // Math - Pure functions (no exec pins)
  | 'add' | 'subtract' | 'multiply' | 'divide' | 'modulo' | 'power' | 'abs' | 'round'
  // String - Pure functions (no exec pins)
  | 'concat' | 'split' | 'join' | 'format' | 'string_template' | 'uppercase' | 'lowercase' | 'trim' | 'substring' | 'length'
  // Control - if/loop/while have exec, logic gates are pure
  | 'if' | 'switch' | 'loop' | 'while' | 'sequence' | 'parallel' | 'compare' | 'not' | 'and' | 'or' | 'coalesce'
  | 'for'
  // Data - Pure functions (no exec pins)
  | 'get' | 'set' | 'merge' | 'make_array' | 'array_map' | 'array_filter' | 'array_concat' | 'array_length' | 'array_append' | 'array_dedup'
  | 'get_var' | 'set_var' | 'set_vars' | 'set_var_property'
  | 'parse_json' | 'stringify_json' | 'agent_trace_report' | 'break_object' | 'system_datetime'
  | 'provider_catalog' | 'provider_models'
  // Backward-compat: deprecated
  | 'model_catalog'
  // Literals - Pure value nodes (no exec pins, no inputs)
  | 'literal_string' | 'literal_number' | 'literal_boolean' | 'literal_json' | 'literal_array'
  | 'json_schema'
  // Effects - Side-effect nodes (require execution pins)
  | 'ask_user'
  | 'answer_user'
  | 'llm_call'
  | 'wait_until'
  | 'wait_event'
  | 'emit_event'
  | 'read_file'
  | 'write_file'
  | 'memory_note'
  | 'memory_query'
  | 'memory_rehydrate'
  | 'tool_calls'
  | 'tools_allowlist'
  | 'bool_var'
  | 'var_decl';

export const ENTRY_NODE_TYPES: NodeType[] = [
  'on_flow_start',
  'on_user_request',
  'on_agent_message',
  'on_schedule',
  'on_event',
];

export function isEntryNodeType(nodeType: NodeType): boolean {
  return ENTRY_NODE_TYPES.includes(nodeType);
}

// Node data stored in React Flow nodes
export interface FlowNodeData {
  nodeType: NodeType;
  label: string;
  icon: string;
  headerColor: string;
  inputs: Pin[];
  outputs: Pin[];
  /**
   * Blueprint-style default values for *unconnected* input pins.
   * Keys are pin ids; values are JSON-serializable (persisted in the flow JSON).
   */
  pinDefaults?: Record<string, JsonValue>;
  // Node-specific config
  code?: string;           // For code nodes
  codeBody?: string;       // For code nodes (body-only editor)
  functionName?: string;   // For code nodes
  inputKey?: string;       // Input key mapping
  outputKey?: string;      // Output key mapping
  agentConfig?: {          // For agent nodes
    provider?: string;
    model?: string;
    tools?: string[];      // Allowlisted tool names (0..N)
    include_context?: boolean; // When true, include run context/messages as history (Recall into context)
    outputSchema?: {       // Optional structured output schema
      enabled?: boolean;
      mode?: 'fields' | 'json';
      jsonSchema?: Record<string, any>; // JSON Schema object (subset)
    };
  };
  subflowId?: string;      // For subflow nodes
  // Event node configuration
  eventConfig?: {
    // For on_event
    name?: string;
    scope?: 'session' | 'workflow' | 'run' | 'global';
    channel?: string;        // For on_agent_message: channel to listen to
    agentFilter?: string;    // For on_agent_message: specific agent to listen to
    schedule?: string;       // For on_schedule: cron expression or interval
    recurrent?: boolean;     // For on_schedule: re-arm after firing
    description?: string;    // Description of what triggers this event
  };
  // Literal node value
  literalValue?: JsonValue;
  // Break Object node configuration
  breakConfig?: {
    selectedPaths?: string[];
  };
  // Concat node configuration
  concatConfig?: {
    separator?: string; // Default: " "
  };
  // Switch node configuration
  switchConfig?: {
    cases?: { id: string; value: string }[];
  };
  // Effect node configuration
  effectConfig?: {
    provider?: string;     // For llm_call
    model?: string;        // For llm_call
    temperature?: number;  // For llm_call
    tools?: string[];      // For llm_call (tool allowlist; resolved to ToolSpecs at execution)
    include_context?: boolean; // For llm_call: include run context/messages as history (Recall into context)
    allowFreeText?: boolean; // For ask_user
    durationType?: 'seconds' | 'minutes' | 'hours' | 'timestamp'; // For wait_until
    allowed_tools?: string[]; // For tool_calls (tool name allowlist; empty => allow none)
    // For emit_event
    name?: string;
    scope?: 'session' | 'workflow' | 'run' | 'global';
    sessionId?: string; // Optional target session id when not connected via pin
    // For memory_note
    keep_in_context?: boolean; // When true, store the note AND rehydrate it into context.messages (as a synthetic system message).
    // For subflow
    inherit_context?: boolean; // When true, seed the child run's context.messages from the parent run's active context view.
  };

  // Model Catalog node configuration
  modelCatalogConfig?: {
    // Optional allowlists to restrict the catalog; when empty/undefined, everything is allowed.
    allowedProviders?: string[];
    allowedModels?: string[]; // Supports either "provider/model" ids or raw model names.
    // Selection of an active pair (used to output `provider` + `model`).
    index?: number; // Default: 0
  };

  providerModelsConfig?: {
    provider?: string;
    allowedModels?: string[];
  };
}

// Visual flow definition
export interface VisualFlow {
  id: string;
  name: string;
  description?: string;
  /**
   * Optional interface markers for host contracts.
   * Example: ["abstractcode.agent.v1"] to indicate this workflow can be run as an AbstractCode agent.
   */
  interfaces?: string[];
  nodes: VisualNode[];
  edges: VisualEdge[];
  entryNode?: string;
  created_at?: string;
  updated_at?: string;
}

export interface VisualNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface VisualEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  animated?: boolean;
}

// Execution events from WebSocket
export interface ExecutionEvent {
  type:
    | 'node_start'
    | 'node_complete'
    | 'flow_start'
    | 'flow_complete'
    | 'flow_error'
    | 'flow_waiting'
    | 'flow_paused'
    | 'flow_resumed'
    | 'flow_cancelled'
    | 'trace_update';
  // ISO 8601 UTC timestamp for event emission (host-side observability).
  ts?: string;
  runId?: string;
  nodeId?: string;
  result?: unknown;
  // trace_update payload (runtime-owned node traces; streamed as deltas)
  steps?: unknown[];
  error?: string;
  meta?: ExecutionMetrics;
  // Waiting payload (for ASK_USER / WAIT_EVENT / subworkflow bubbling)
  prompt?: string;
  choices?: string[];
  allow_free_text?: boolean;
  wait_key?: string;
  reason?: string;
}

export interface ExecutionMetrics {
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  tokens_per_s?: number;
}

// Flow run result
export interface FlowRunResult {
  success: boolean;
  result?: unknown;
  error?: string;
  run_id?: string;
}

// Persisted run summary (for run history UX)
export interface RunSummary {
  run_id: string;
  workflow_id?: string | null;
  status: string;
  current_node?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  parent_run_id?: string | null;
  error?: string | null;
  wait_reason?: string | null;
  wait_key?: string | null;
  paused?: boolean;
  // Present only when the run is waiting for real user input (not pause/subworkflow)
  prompt?: string | null;
  choices?: string[] | null;
  allow_free_text?: boolean | null;
}

export interface RunHistoryResponse {
  run: RunSummary;
  events: ExecutionEvent[];
}

// Provider information from AbstractCore
export interface ProviderInfo {
  name: string;
  display_name: string;
  status: string;
  model_count: number;
  description?: string;
  local_provider?: boolean;
  models?: string[];
}
