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
  | 'agent'
  | 'function'
  | 'code'
  | 'subflow'
  // Math
  | 'add' | 'subtract' | 'multiply' | 'divide' | 'modulo' | 'power' | 'abs' | 'round'
  // String
  | 'concat' | 'split' | 'join' | 'format' | 'uppercase' | 'lowercase' | 'trim' | 'substring' | 'length'
  // Control
  | 'if' | 'switch' | 'loop' | 'compare' | 'not' | 'and' | 'or'
  // Data
  | 'get' | 'set' | 'merge' | 'array_map' | 'array_filter';

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
