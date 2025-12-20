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
  agent: '#4488FF',
  any: '#888888',
};

// A connection point on a node
export interface Pin {
  id: string;
  label: string;
  type: PinType;
}

// Node types
export type NodeType =
  // Event/Trigger nodes (only exec OUT - entry points for flow)
  | 'on_flow_start'      // Triggered when a flow starts running
  | 'on_user_request'    // Triggered by user input
  | 'on_agent_message'   // Triggered by inter-agent communication
  | 'on_schedule'        // Triggered by scheduled events
  // Core execution nodes (exec IN and OUT)
  | 'agent'
  | 'function'
  | 'code'
  | 'subflow'
  // Math - Pure functions (no exec pins)
  | 'add' | 'subtract' | 'multiply' | 'divide' | 'modulo' | 'power' | 'abs' | 'round'
  // String - Pure functions (no exec pins)
  | 'concat' | 'split' | 'join' | 'format' | 'uppercase' | 'lowercase' | 'trim' | 'substring' | 'length'
  // Control - if/loop have exec, logic gates are pure
  | 'if' | 'switch' | 'loop' | 'compare' | 'not' | 'and' | 'or'
  // Data - Pure functions (no exec pins)
  | 'get' | 'set' | 'merge' | 'array_map' | 'array_filter'
  // Literals - Pure value nodes (no exec pins, no inputs)
  | 'literal_string' | 'literal_number' | 'literal_boolean' | 'literal_json' | 'literal_array'
  // Effects - Side-effect nodes (require execution pins)
  | 'ask_user' | 'llm_call' | 'wait_until' | 'wait_event' | 'memory_note' | 'memory_query';

// Node data stored in React Flow nodes
export interface FlowNodeData {
  nodeType: NodeType;
  label: string;
  icon: string;
  headerColor: string;
  inputs: Pin[];
  outputs: Pin[];
  // Node-specific config
  code?: string;           // For code nodes
  functionName?: string;   // For code nodes
  inputKey?: string;       // Input key mapping
  outputKey?: string;      // Output key mapping
  agentConfig?: {          // For agent nodes
    provider?: string;
    model?: string;
  };
  subflowId?: string;      // For subflow nodes
  // Event node configuration
  eventConfig?: {
    channel?: string;        // For on_agent_message: channel to listen to
    agentFilter?: string;    // For on_agent_message: specific agent to listen to
    schedule?: string;       // For on_schedule: cron expression or interval
    description?: string;    // Description of what triggers this event
  };
  // Literal node value
  literalValue?: string | number | boolean | object;
  // Effect node configuration
  effectConfig?: {
    provider?: string;     // For llm_call
    model?: string;        // For llm_call
    temperature?: number;  // For llm_call
    allowFreeText?: boolean; // For ask_user
    durationType?: 'seconds' | 'minutes' | 'hours' | 'timestamp'; // For wait_until
  };
}

// Visual flow definition
export interface VisualFlow {
  id: string;
  name: string;
  description?: string;
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
  type: 'node_start' | 'node_complete' | 'flow_start' | 'flow_complete' | 'flow_error' | 'flow_waiting';
  nodeId?: string;
  result?: unknown;
  error?: string;
}

// Flow run result
export interface FlowRunResult {
  success: boolean;
  result?: unknown;
  error?: string;
  run_id?: string;
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
