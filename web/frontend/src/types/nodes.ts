/**
 * Node template definitions for the visual editor.
 */

import type { NodeType, FlowNodeData, Pin } from './flow';

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

// Core nodes
const CORE_NODES: NodeTemplate[] = [
  {
    type: 'agent',
    icon: '&#x1F916;', // Robot
    label: 'Agent',
    headerColor: '#4488FF',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'task', label: 'task', type: 'string' },
      { id: 'context', label: 'context', type: 'object' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'result', label: 'result', type: 'object' },
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

// Math nodes
const MATH_NODES: NodeTemplate[] = [
  { type: 'add', icon: '+', label: 'Add', headerColor: '#27AE60', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'a', label: 'a', type: 'number' }, { id: 'b', label: 'b', type: 'number' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'subtract', icon: '-', label: 'Subtract', headerColor: '#27AE60', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'a', label: 'a', type: 'number' }, { id: 'b', label: 'b', type: 'number' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'multiply', icon: '&#xD7;', label: 'Multiply', headerColor: '#27AE60', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'a', label: 'a', type: 'number' }, { id: 'b', label: 'b', type: 'number' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'divide', icon: '&#xF7;', label: 'Divide', headerColor: '#27AE60', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'a', label: 'a', type: 'number' }, { id: 'b', label: 'b', type: 'number' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'abs', icon: '|x|', label: 'Absolute', headerColor: '#27AE60', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'value', label: 'value', type: 'number' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'round', icon: '&#x223C;', label: 'Round', headerColor: '#27AE60', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'value', label: 'value', type: 'number' }, { id: 'decimals', label: 'decimals', type: 'number' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'number' }], category: 'math' },
];

// String nodes
const STRING_NODES: NodeTemplate[] = [
  { type: 'concat', icon: '&#x2795;', label: 'Concat', headerColor: '#E74C3C', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'a', label: 'a', type: 'string' }, { id: 'b', label: 'b', type: 'string' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'split', icon: '&#x2702;', label: 'Split', headerColor: '#E74C3C', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'text', label: 'text', type: 'string' }, { id: 'delimiter', label: 'delimiter', type: 'string' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'array' }], category: 'string' },
  { type: 'join', icon: '&#x1F517;', label: 'Join', headerColor: '#E74C3C', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'items', label: 'items', type: 'array' }, { id: 'delimiter', label: 'delimiter', type: 'string' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'uppercase', icon: 'AA', label: 'Uppercase', headerColor: '#E74C3C', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'text', label: 'text', type: 'string' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'lowercase', icon: 'aa', label: 'Lowercase', headerColor: '#E74C3C', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'text', label: 'text', type: 'string' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'length', icon: '#', label: 'Length', headerColor: '#E74C3C', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'text', label: 'text', type: 'string' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'number' }], category: 'string' },
];

// Control flow nodes
const CONTROL_NODES: NodeTemplate[] = [
  { type: 'if', icon: '&#x2753;', label: 'If/Else', headerColor: '#F39C12', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'condition', label: 'condition', type: 'boolean' }], outputs: [{ id: 'true', label: 'true', type: 'execution' }, { id: 'false', label: 'false', type: 'execution' }], category: 'control' },
  { type: 'compare', icon: '=?', label: 'Compare', headerColor: '#F39C12', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'a', label: 'a', type: 'any' }, { id: 'b', label: 'b', type: 'any' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'boolean' }], category: 'control' },
  { type: 'not', icon: '!', label: 'NOT', headerColor: '#F39C12', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'value', label: 'value', type: 'boolean' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'boolean' }], category: 'control' },
  { type: 'and', icon: '&&', label: 'AND', headerColor: '#F39C12', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'a', label: 'a', type: 'boolean' }, { id: 'b', label: 'b', type: 'boolean' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'boolean' }], category: 'control' },
  { type: 'or', icon: '||', label: 'OR', headerColor: '#F39C12', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'a', label: 'a', type: 'boolean' }, { id: 'b', label: 'b', type: 'boolean' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'boolean' }], category: 'control' },
  { type: 'loop', icon: '&#x1F501;', label: 'ForEach', headerColor: '#F39C12', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'items', label: 'items', type: 'array' }], outputs: [{ id: 'loop', label: 'loop', type: 'execution' }, { id: 'done', label: 'done', type: 'execution' }, { id: 'item', label: 'item', type: 'any' }, { id: 'index', label: 'index', type: 'number' }], category: 'control' },
];

// Data nodes
const DATA_NODES: NodeTemplate[] = [
  { type: 'get', icon: '&#x1F4E5;', label: 'Get Property', headerColor: '#3498DB', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'object', label: 'object', type: 'object' }, { id: 'key', label: 'key', type: 'string' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'value', label: 'value', type: 'any' }], category: 'data' },
  { type: 'set', icon: '&#x1F4E4;', label: 'Set Property', headerColor: '#3498DB', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'object', label: 'object', type: 'object' }, { id: 'key', label: 'key', type: 'string' }, { id: 'value', label: 'value', type: 'any' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'object' }], category: 'data' },
  { type: 'merge', icon: '&#x1F517;', label: 'Merge Objects', headerColor: '#3498DB', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'a', label: 'a', type: 'object' }, { id: 'b', label: 'b', type: 'object' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'object' }], category: 'data' },
  { type: 'array_map', icon: '&#x1F5FA;', label: 'Map Array', headerColor: '#3498DB', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'items', label: 'items', type: 'array' }, { id: 'key', label: 'key', type: 'string' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'array' }], category: 'data' },
  { type: 'array_filter', icon: '&#x1F50D;', label: 'Filter Array', headerColor: '#3498DB', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'items', label: 'items', type: 'array' }, { id: 'key', label: 'key', type: 'string' }, { id: 'value', label: 'value', type: 'any' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'result', label: 'result', type: 'array' }], category: 'data' },
];

// All categories
export const NODE_CATEGORIES: Record<string, NodeCategory> = {
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
  return {
    nodeType: template.type,
    label: template.label,
    icon: template.icon,
    headerColor: template.headerColor,
    inputs: [...template.inputs],
    outputs: [...template.outputs],
    // Default code for code nodes
    ...(template.type === 'code' && {
      code: 'def transform(input):\n    return input',
      functionName: 'transform',
    }),
  };
}
