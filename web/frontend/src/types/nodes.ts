/**
 * Node template definitions for the visual editor.
 */

import type { NodeType, FlowNodeData, Pin } from './flow';
import { generatePythonTransformCode } from '../utils/codegen';

// Node template used in the palette
export interface NodeTemplate {
  type: NodeType;
  icon: string;
  label: string;
  headerColor: string;
  inputs: Pin[];
  outputs: Pin[];
  category: string;
}

// Node categories
export interface NodeCategory {
  label: string;
  icon: string;
  nodes: NodeTemplate[];
}

// Event/Trigger nodes - Only have execution OUT (entry points for flow)
// Like UE4 Blueprint Event nodes (red title bar, white arrow on right)
const EVENT_NODES: NodeTemplate[] = [
  {
    type: 'on_flow_start',
    icon: '&#x1F3C1;', // Checkered flag
    label: 'On Flow Start',
    headerColor: '#C0392B', // Red for events (like UE4)
    inputs: [], // No inputs - this is the entry point
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
    ],
    category: 'events',
  },
  {
    type: 'on_user_request',
    icon: '&#x1F4AC;', // Speech bubble
    label: 'On User Request',
    headerColor: '#C0392B', // Red for events (like UE4)
    inputs: [], // No inputs - this is the entry point
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'message', label: 'message', type: 'string' },
      { id: 'context', label: 'context', type: 'object' },
    ],
    category: 'events',
  },
  {
    type: 'on_agent_message',
    icon: '&#x1F4E8;', // Incoming envelope
    label: 'On Agent Message',
    headerColor: '#C0392B',
    inputs: [], // No inputs - triggered by external event
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'sender', label: 'sender', type: 'agent' },
      { id: 'message', label: 'message', type: 'string' },
      { id: 'channel', label: 'channel', type: 'string' },
    ],
    category: 'events',
  },
  {
    type: 'on_schedule',
    icon: '&#x23F0;', // Alarm clock
    label: 'On Schedule',
    headerColor: '#C0392B',
    inputs: [], // No inputs - triggered by timer/schedule
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'timestamp', label: 'timestamp', type: 'string' },
    ],
    category: 'events',
  },
  {
    type: 'on_flow_end',
    icon: '&#x23F9;', // Stop button
    label: 'On Flow End',
    headerColor: '#C0392B',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
    ],
    outputs: [],
    category: 'events',
  },
];

// Core nodes
const CORE_NODES: NodeTemplate[] = [
  {
    type: 'agent',
    icon: '&#x1F916;', // Robot
    label: 'Agent',
    headerColor: '#4488FF',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'provider', label: 'provider', type: 'string' },
      { id: 'model', label: 'model', type: 'string' },
      { id: 'task', label: 'task', type: 'string' },
      { id: 'context', label: 'context', type: 'object' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'result', label: 'result', type: 'object' },
      { id: 'scratchpad', label: 'scratchpad', type: 'object' },
    ],
    category: 'core',
  },
  {
    type: 'subflow',
    icon: '&#x1F4E6;', // Package
    label: 'Subflow',
    headerColor: '#00CCCC',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'input', label: 'input', type: 'object' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'output', label: 'output', type: 'object' },
    ],
    category: 'core',
  },
  {
    type: 'code',
    icon: '&#x1F40D;', // Python snake
    label: 'Python Code',
    headerColor: '#9B59B6',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'input', label: 'input', type: 'any' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'output', label: 'output', type: 'any' },
    ],
    category: 'core',
  },
];

// Math nodes - Pure functions (no execution pins, just data in/out)
const MATH_NODES: NodeTemplate[] = [
  { type: 'add', icon: '+', label: 'Add', headerColor: '#27AE60', inputs: [{ id: 'a', label: 'a', type: 'number' }, { id: 'b', label: 'b', type: 'number' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'subtract', icon: '-', label: 'Subtract', headerColor: '#27AE60', inputs: [{ id: 'a', label: 'a', type: 'number' }, { id: 'b', label: 'b', type: 'number' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'multiply', icon: '&#xD7;', label: 'Multiply', headerColor: '#27AE60', inputs: [{ id: 'a', label: 'a', type: 'number' }, { id: 'b', label: 'b', type: 'number' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'divide', icon: '&#xF7;', label: 'Divide', headerColor: '#27AE60', inputs: [{ id: 'a', label: 'a', type: 'number' }, { id: 'b', label: 'b', type: 'number' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'abs', icon: '|x|', label: 'Absolute', headerColor: '#27AE60', inputs: [{ id: 'value', label: 'value', type: 'number' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'round', icon: '&#x223C;', label: 'Round', headerColor: '#27AE60', inputs: [{ id: 'value', label: 'value', type: 'number' }, { id: 'decimals', label: 'decimals', type: 'number' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'math' },
];

// String nodes - Pure functions (no execution pins, just data in/out)
const STRING_NODES: NodeTemplate[] = [
  { type: 'concat', icon: '&#x2795;', label: 'Concat', headerColor: '#E74C3C', inputs: [{ id: 'a', label: 'a', type: 'string' }, { id: 'b', label: 'b', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'split', icon: '&#x2702;', label: 'Split', headerColor: '#E74C3C', inputs: [{ id: 'text', label: 'text', type: 'string' }, { id: 'delimiter', label: 'delimiter', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'array' }], category: 'string' },
  { type: 'join', icon: '&#x1F517;', label: 'Join', headerColor: '#E74C3C', inputs: [{ id: 'items', label: 'items', type: 'array' }, { id: 'delimiter', label: 'delimiter', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'uppercase', icon: 'AA', label: 'Uppercase', headerColor: '#E74C3C', inputs: [{ id: 'text', label: 'text', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'lowercase', icon: 'aa', label: 'Lowercase', headerColor: '#E74C3C', inputs: [{ id: 'text', label: 'text', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'length', icon: '#', label: 'Length', headerColor: '#E74C3C', inputs: [{ id: 'text', label: 'text', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'string' },
];

// Control flow nodes
// If/Else and ForEach need execution pins (they control flow)
// Compare and logic gates (NOT, AND, OR) are pure functions (no execution pins)
const CONTROL_NODES: NodeTemplate[] = [
  // Execution nodes - control the flow
  { type: 'if', icon: '&#x2753;', label: 'If/Else', headerColor: '#F39C12', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'condition', label: 'condition', type: 'boolean' }], outputs: [{ id: 'true', label: 'true', type: 'execution' }, { id: 'false', label: 'false', type: 'execution' }], category: 'control' },
  { type: 'while', icon: '&#x267B;', label: 'While', headerColor: '#F39C12', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'condition', label: 'condition', type: 'boolean' }], outputs: [{ id: 'loop', label: 'loop', type: 'execution' }, { id: 'done', label: 'done', type: 'execution' }], category: 'control' },
	  {
	    type: 'switch',
	    icon: '&#x1F500;', // Shuffle
	    label: 'Switch',
	    headerColor: '#F39C12',
	    inputs: [
	      { id: 'exec-in', label: '', type: 'execution' },
	      { id: 'value', label: 'value', type: 'string' },
	    ],
	    outputs: [
	      { id: 'default', label: 'default', type: 'execution' },
	    ],
	    category: 'control',
	  },
  {
    type: 'sequence',
    icon: '&#x21E5;', // Rightwards arrow to bar (sequence-ish)
    label: 'Sequence',
    headerColor: '#F39C12',
    inputs: [{ id: 'exec-in', label: '', type: 'execution' }],
    outputs: [
      { id: 'then:0', label: 'Then 0', type: 'execution' },
      { id: 'then:1', label: 'Then 1', type: 'execution' },
    ],
    category: 'control',
  },
  {
    type: 'parallel',
    icon: '&#x2225;', // Parallel lines
    label: 'Parallel',
    headerColor: '#F39C12',
    inputs: [{ id: 'exec-in', label: '', type: 'execution' }],
    outputs: [
      { id: 'then:0', label: 'Then 0', type: 'execution' },
      { id: 'then:1', label: 'Then 1', type: 'execution' },
      { id: 'completed', label: 'Completed', type: 'execution' },
    ],
    category: 'control',
  },
  { type: 'loop', icon: '&#x1F501;', label: 'ForEach', headerColor: '#F39C12', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'items', label: 'items', type: 'array' }], outputs: [{ id: 'loop', label: 'loop', type: 'execution' }, { id: 'done', label: 'done', type: 'execution' }, { id: 'item', label: 'item', type: 'any' }, { id: 'index', label: 'index', type: 'number' }], category: 'control' },
  // Pure functions - just produce data
  { type: 'compare', icon: '=?', label: 'Compare', headerColor: '#F39C12', inputs: [{ id: 'a', label: 'a', type: 'any' }, { id: 'b', label: 'b', type: 'any' }], outputs: [{ id: 'result', label: 'result', type: 'boolean' }], category: 'control' },
  { type: 'not', icon: '!', label: 'NOT', headerColor: '#F39C12', inputs: [{ id: 'value', label: 'value', type: 'boolean' }], outputs: [{ id: 'result', label: 'result', type: 'boolean' }], category: 'control' },
  { type: 'and', icon: '&&', label: 'AND', headerColor: '#F39C12', inputs: [{ id: 'a', label: 'a', type: 'boolean' }, { id: 'b', label: 'b', type: 'boolean' }], outputs: [{ id: 'result', label: 'result', type: 'boolean' }], category: 'control' },
  { type: 'or', icon: '||', label: 'OR', headerColor: '#F39C12', inputs: [{ id: 'a', label: 'a', type: 'boolean' }, { id: 'b', label: 'b', type: 'boolean' }], outputs: [{ id: 'result', label: 'result', type: 'boolean' }], category: 'control' },
];

// Data nodes - Pure functions (no execution pins, just data in/out)
const DATA_NODES: NodeTemplate[] = [
  { type: 'get', icon: '&#x1F4E5;', label: 'Get Property', headerColor: '#3498DB', inputs: [{ id: 'object', label: 'object', type: 'object' }, { id: 'key', label: 'key', type: 'string' }], outputs: [{ id: 'value', label: 'value', type: 'any' }], category: 'data' },
  { type: 'set', icon: '&#x1F4E4;', label: 'Set Property', headerColor: '#3498DB', inputs: [{ id: 'object', label: 'object', type: 'object' }, { id: 'key', label: 'key', type: 'string' }, { id: 'value', label: 'value', type: 'any' }], outputs: [{ id: 'result', label: 'result', type: 'object' }], category: 'data' },
  { type: 'merge', icon: '&#x1F517;', label: 'Merge Objects', headerColor: '#3498DB', inputs: [{ id: 'a', label: 'a', type: 'object' }, { id: 'b', label: 'b', type: 'object' }], outputs: [{ id: 'result', label: 'result', type: 'object' }], category: 'data' },
  { type: 'array_map', icon: '&#x1F5FA;', label: 'Map Array', headerColor: '#3498DB', inputs: [{ id: 'items', label: 'items', type: 'array' }, { id: 'key', label: 'key', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'array' }], category: 'data' },
  { type: 'array_filter', icon: '&#x1F50D;', label: 'Filter Array', headerColor: '#3498DB', inputs: [{ id: 'items', label: 'items', type: 'array' }, { id: 'key', label: 'key', type: 'string' }, { id: 'value', label: 'value', type: 'any' }], outputs: [{ id: 'result', label: 'result', type: 'array' }], category: 'data' },
  { type: 'array_concat', icon: '&#x2795;', label: 'Array Concat', headerColor: '#3498DB', inputs: [{ id: 'a', label: 'a', type: 'array' }, { id: 'b', label: 'b', type: 'array' }], outputs: [{ id: 'result', label: 'result', type: 'array' }], category: 'data' },
  {
    type: 'system_datetime',
    icon: '&#x1F552;', // Clock
    label: 'System Date/Time',
    headerColor: '#3498DB',
    inputs: [],
    outputs: [
      { id: 'iso', label: 'iso', type: 'string' },
      { id: 'timezone', label: 'timezone', type: 'string' },
      { id: 'utc_offset_minutes', label: 'utc_offset_minutes', type: 'number' },
      { id: 'locale', label: 'locale', type: 'string' },
    ],
    category: 'data',
  },
  {
    type: 'break_object',
    icon: '&#x1F9E9;', // Puzzle piece
    label: 'Break Object',
    headerColor: '#3498DB',
    inputs: [{ id: 'object', label: 'object', type: 'object' }],
    outputs: [], // Dynamic pins based on selected paths
    category: 'data',
  },
  {
    type: 'provider_catalog',
    icon: '&#x1F4E6;', // Package-ish (catalog)
    label: 'Provider Catalog',
    headerColor: '#3498DB',
    inputs: [{ id: 'allowed_providers', label: 'allowed_providers', type: 'array' }],
    outputs: [{ id: 'providers', label: 'providers', type: 'array' }],
    category: 'data',
  },
  {
    type: 'provider_models',
    icon: '&#x1F4DA;', // Books
    label: 'Provider Models',
    headerColor: '#3498DB',
    inputs: [
      { id: 'provider', label: 'provider', type: 'string' },
      { id: 'allowed_models', label: 'allowed_models', type: 'array' },
    ],
    outputs: [
      { id: 'provider', label: 'provider', type: 'string' },
      { id: 'models', label: 'models', type: 'array' },
    ],
    category: 'data',
  },
];

// Literal/Value nodes - Output constant values (no execution pins, no inputs)
// Colors match the output type for visual consistency
const LITERAL_NODES: NodeTemplate[] = [
  {
    type: 'literal_string',
    icon: '"',
    label: 'String',
    headerColor: '#FF00FF', // Magenta - matches string pin color
    inputs: [],
    outputs: [{ id: 'value', label: 'value', type: 'string' }],
    category: 'literals',
  },
  {
    type: 'literal_number',
    icon: '#',
    label: 'Number',
    headerColor: '#00FF00', // Green - matches number pin color
    inputs: [],
    outputs: [{ id: 'value', label: 'value', type: 'number' }],
    category: 'literals',
  },
  {
    type: 'literal_boolean',
    icon: '?',
    label: 'Boolean',
    headerColor: '#FF0000', // Red - matches boolean pin color
    inputs: [],
    outputs: [{ id: 'value', label: 'value', type: 'boolean' }],
    category: 'literals',
  },
  {
    type: 'literal_json',
    icon: '{}',
    label: 'JSON',
    headerColor: '#00FFFF', // Cyan - matches object pin color
    inputs: [],
    outputs: [{ id: 'value', label: 'value', type: 'object' }],
    category: 'literals',
  },
  {
    type: 'literal_array',
    icon: '[]',
    label: 'Array',
    headerColor: '#FF8800', // Orange - matches array pin color
    inputs: [],
    outputs: [{ id: 'value', label: 'value', type: 'array' }],
    category: 'literals',
  },
];

// Effect nodes - Side effects that integrate with AbstractRuntime
// These nodes have execution pins and can pause/resume flows
const EFFECT_NODES: NodeTemplate[] = [
  {
    type: 'ask_user',
    icon: '&#x2753;', // Question mark
    label: 'Ask User',
    headerColor: '#9B59B6', // Purple - human interaction
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'prompt', label: 'prompt', type: 'string' },
      { id: 'choices', label: 'choices', type: 'array' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'response', label: 'response', type: 'string' },
    ],
    category: 'effects',
  },
  {
    type: 'answer_user',
    icon: '&#x1F4AC;', // Speech bubble
    label: 'Answer User',
    headerColor: '#9B59B6', // Purple - human interaction
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'message', label: 'message', type: 'string' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'message', label: 'message', type: 'string' },
    ],
    category: 'effects',
  },
  {
    type: 'llm_call',
    icon: '&#x1F4AD;', // Thought bubble
    label: 'LLM Call',
    headerColor: '#3498DB', // Blue - AI
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'provider', label: 'provider', type: 'string' },
      { id: 'model', label: 'model', type: 'string' },
      { id: 'prompt', label: 'prompt', type: 'string' },
      { id: 'system', label: 'system', type: 'string' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'response', label: 'response', type: 'string' },
    ],
    category: 'effects',
  },
  {
    type: 'wait_until',
    icon: '&#x23F3;', // Hourglass
    label: 'Delay',
    headerColor: '#F39C12', // Orange - timing
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'duration', label: 'duration', type: 'number' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
    ],
    category: 'effects',
  },
  {
    type: 'wait_event',
    icon: '&#x1F514;', // Bell
    label: 'Wait Event',
    headerColor: '#E74C3C', // Red - waiting
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'event_key', label: 'event_key', type: 'string' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'event_data', label: 'event_data', type: 'object' },
    ],
    category: 'effects',
  },
  {
    type: 'memory_note',
    icon: '&#x1F4DD;', // Memo
    label: 'Add Note',
    headerColor: '#2ECC71', // Green - memory
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'content', label: 'content', type: 'string' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'note_id', label: 'note_id', type: 'string' },
    ],
    category: 'effects',
  },
  {
    type: 'memory_query',
    icon: '&#x1F50D;', // Magnifying glass
    label: 'Query Memory',
    headerColor: '#2ECC71', // Green - memory
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'query', label: 'query', type: 'string' },
      { id: 'limit', label: 'limit', type: 'number' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'results', label: 'results', type: 'array' },
    ],
    category: 'effects',
  },
];

// All categories
export const NODE_CATEGORIES: Record<string, NodeCategory> = {
  events: {
    label: 'Events',
    icon: '&#x1F514;', // Bell - for events/triggers
    nodes: EVENT_NODES,
  },
  core: {
    label: 'Core',
    icon: '&#x26A1;', // Lightning
    nodes: CORE_NODES,
  },
  math: {
    label: 'Math',
    icon: '&#x1F522;', // Numbers
    nodes: MATH_NODES,
  },
  string: {
    label: 'String',
    icon: '&#x1F4DD;', // Memo
    nodes: STRING_NODES,
  },
  control: {
    label: 'Control',
    icon: '&#x1F500;', // Shuffle
    nodes: CONTROL_NODES,
  },
  data: {
    label: 'Data',
    icon: '&#x1F4CA;', // Chart
    nodes: DATA_NODES,
  },
  literals: {
    label: 'Literals',
    icon: '&#x270F;', // Pencil - for constants/values
    nodes: LITERAL_NODES,
  },
  effects: {
    label: 'Effects',
    icon: '&#x26A1;', // Lightning bolt - side effects
    nodes: EFFECT_NODES,
  },
};

// Get all node templates flattened
export function getAllNodeTemplates(): NodeTemplate[] {
  return Object.values(NODE_CATEGORIES).flatMap(cat => cat.nodes);
}

// Get template by type
export function getNodeTemplate(type: NodeType): NodeTemplate | undefined {
  return getAllNodeTemplates().find(t => t.type === type);
}

// Create default node data from template
export function createNodeData(template: NodeTemplate): FlowNodeData {
  const defaultCodeBody = 'return input';

  return {
    nodeType: template.type,
    label: template.label,
    icon: template.icon,
    headerColor: template.headerColor,
    inputs: [...template.inputs],
    outputs: [...template.outputs],
    // Default code for code nodes
    ...(template.type === 'code' && {
      codeBody: defaultCodeBody,
      code: generatePythonTransformCode(template.inputs, defaultCodeBody),
      functionName: 'transform',
    }),
    // Default literal values
    ...(template.type === 'literal_string' && { literalValue: '' }),
    ...(template.type === 'literal_number' && { literalValue: 0 }),
    ...(template.type === 'literal_boolean' && { literalValue: false }),
    ...(template.type === 'literal_json' && { literalValue: {} }),
    ...(template.type === 'literal_array' && { literalValue: [] }),
    ...(template.type === 'break_object' && { breakConfig: { selectedPaths: [] } }),
    ...(template.type === 'concat' && { concatConfig: { separator: ' ' } }),
    ...(template.type === 'switch' && { switchConfig: { cases: [] } }),
    ...(template.type === 'model_catalog' && { modelCatalogConfig: { allowedProviders: [], allowedModels: [], index: 0 } }),
    ...(template.type === 'provider_models' && { providerModelsConfig: { provider: '', allowedModels: [] } }),
  };
}
