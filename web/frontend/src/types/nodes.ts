/**
 * Node template definitions for the visual editor.
 */

import type { NodeType, FlowNodeData, Pin } from './flow';
import { generatePythonTransformCode, upsertPythonAvailableVariablesComments } from '../utils/codegen';

// Node template used in the palette
export interface NodeTemplate {
  type: NodeType;
  icon: string;
  label: string;
  description: string;
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
    description: 'Entry point for a workflow run. Emits exec-out and any configured inputs as outputs.',
    headerColor: '#C0392B', // Red for events (like UE4)
    inputs: [], // No inputs - this is the entry point
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
    ],
    category: 'events',
  },
  {
    type: 'on_flow_end',
    icon: '&#x23F9;', // Stop button
    label: 'On Flow End',
    description: 'Terminal node. End execution and expose the flow result via upstream data wiring.',
    headerColor: '#C0392B',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
    ],
    outputs: [],
    category: 'events',
  },
  {
    type: 'on_user_request',
    icon: '&#x1F4AC;', // Speech bubble
    label: 'On User Request',
    description: 'Entry point for a run started from a user prompt. Outputs the user message and initial context.',
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
    description: 'Entry point triggered by an agent-to-agent message (broadcast or direct).',
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
    type: 'system_datetime',
    icon: '&#x1F552;', // Clock
    label: 'System Date/Time',
    description: 'Return current time metadata (ISO string, timezone, UTC offset, locale).',
    headerColor: '#3498DB',
    inputs: [],
    outputs: [
      { id: 'iso', label: 'iso', type: 'string' },
      { id: 'timezone', label: 'timezone', type: 'string' },
      { id: 'utc_offset_minutes', label: 'utc_offset_minutes', type: 'number' },
      { id: 'locale', label: 'locale', type: 'string' },
    ],
    category: 'events',
  },
  {
    type: 'on_schedule',
    icon: '&#x23F0;', // Alarm clock
    label: 'On Schedule',
    description: 'Entry point triggered by a schedule (timestamp or recurring). Outputs the trigger time.',
    headerColor: '#C0392B',
    inputs: [
      // Configuration pins (Blueprint-style): configurable via inline quick access when unconnected.
      { id: 'schedule', label: 'timestamp', type: 'string' },
      { id: 'recurrent', label: 'recurrent', type: 'boolean' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'timestamp', label: 'time', type: 'string' },
    ],
    category: 'events',
  },
  {
    type: 'on_event',
    icon: '&#x1F4E3;', // Megaphone
    label: 'On Event',
    description: 'Entry point triggered by a durable custom event. Outputs event metadata + payload.',
    headerColor: '#C0392B', // Red for events (like UE4)
    inputs: [
      // Configuration pins (Blueprint-style): configurable via inline quick access when unconnected.
      { id: 'scope', label: 'scope', type: 'string' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'event', label: 'event', type: 'object' },
      { id: 'payload', label: 'payload', type: 'any' },
    ],
    category: 'events',
  },
  {
    type: 'wait_event',
    icon: '&#x1F514;', // Bell
    label: 'Wait Event',
    description:
      'Pause the workflow until an event matching event_key is received, then resume with event_data. Optional pins (prompt/choices/allow_free_text) enable durable “ask + wait” UX for hosts like AbstractCode.',
    headerColor: '#C0392B',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'event_key', label: 'event_key', type: 'string' },
      { id: 'prompt', label: 'prompt', type: 'string' },
      { id: 'choices', label: 'choices', type: 'array' },
      { id: 'allow_free_text', label: 'allow_free_text', type: 'boolean' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'event_data', label: 'event_data', type: 'object' },
    ],
    category: 'events',
  },
  {
    type: 'emit_event',
    icon: '&#x1F4E3;', // Megaphone
    label: 'Emit Event',
    description: 'Emit a durable event (scope/session) with payload. Useful for cross-node or cross-agent signaling.',
    headerColor: '#C0392B',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'name', label: 'name', type: 'string' },
      { id: 'scope', label: 'scope', type: 'string' },
      { id: 'payload', label: 'payload', type: 'any' },
      { id: 'session_id', label: 'session_id', type: 'string' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'delivered', label: 'delivered', type: 'number' },
      { id: 'delivered_to', label: 'delivered_to', type: 'array' },
      { id: 'wait_key', label: 'wait_key', type: 'string' },
    ],
    category: 'events',
  },
  {
    type: 'wait_until',
    icon: '&#x23F3;', // Hourglass
    label: 'Delay',
    description: 'Pause execution for a duration (seconds), then continue.',
    headerColor: '#F39C12', // Orange - timing
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'duration', label: 'duration', type: 'number' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
    ],
    category: 'events',
  },
];

// Core nodes
const CORE_NODES: NodeTemplate[] = [
  {
    type: 'subflow',
    icon: '&#x1F4E6;', // Package
    label: 'Subflow',
    description: 'Run another saved workflow (subflow) and return its output object.',
    headerColor: '#00CCCC',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      {
        id: 'inherit_context',
        label: 'inherit_context',
        type: 'boolean',
        description:
          "When true, seed the child run's context.messages from the parent's active context messages. If the pin is not connected, the node checkbox is used. Default: false.",
      },
      { id: 'input', label: 'input', type: 'object' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'output', label: 'output', type: 'object' },
    ],
    category: 'core',
  },
  {
    type: 'agent',
    icon: '&#x1F916;', // Robot
    label: 'Agent',
    description: 'Run an agent (ReAct) that can call tools. Outputs a structured result and scratchpad.',
    headerColor: '#4488FF',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      {
        id: 'include_context',
        label: 'use_context',
        type: 'boolean',
        description:
          "When true, include this run's active context messages (context.messages) as agent history. If the pin is not connected, the node checkbox is used. Default: false.",
      },
      { id: 'provider', label: 'provider', type: 'provider', description: 'LLM provider id (e.g. LMStudio). If unset, uses the node’s configured provider.' },
      { id: 'model', label: 'model', type: 'model', description: 'LLM model id/name. If unset, uses the node’s configured model.' },
      { id: 'temperature', label: 'temperature', type: 'number', description: 'Sampling temperature (0 = deterministic). If unset, uses the node’s configured temperature.' },
      { id: 'seed', label: 'seed', type: 'number', description: 'Seed for deterministic sampling (-1 = random/unset). If unset, uses the node’s configured seed.' },
      { id: 'max_iterations', label: 'max_iterations', type: 'number', description: 'Maximum internal ReAct iterations (safety cap). Higher values allow more tool-use steps.' },
      { id: 'system', label: 'system', type: 'string', description: 'Optional system prompt for this agent instance (high priority instructions).' },
      { id: 'task', label: 'prompt', type: 'string', description: 'The task/user prompt for the agent to solve.' },
      { id: 'tools', label: 'tools', type: 'tools', description: 'Allowlist of tool names this agent can call (defense-in-depth; runtime still enforces allowlists).' },
      { id: 'response_schema', label: 'structured_output', type: 'object', description: 'Optional JSON Schema object (type=object) the final answer must conform to.' },
      { id: 'context', label: 'context', type: 'object', description: 'Optional explicit context object for the agent (e.g. {messages:[...]}). If provided, it can override inherited run context.' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'result', label: 'result', type: 'object', description: 'Structured final agent result (answer + metadata/tool calls depending on agent).' },
      {
        id: 'tool_calls',
        label: 'tool_calls',
        type: 'array',
        description:
          'Best-effort list of tool call requests extracted from the agent scratchpad trace (post-run). For real-time tool observability, subscribe to the ledger/node_traces stream.',
      },
      {
        id: 'tool_results',
        label: 'tool_results',
        type: 'array',
        description:
          'Best-effort list of tool results extracted from the agent scratchpad trace (post-run). For real-time tool observability, subscribe to the ledger/node_traces stream.',
      },
      { id: 'scratchpad', label: 'scratchpad', type: 'object', description: 'Runtime-owned execution trace/scratchpad for observability (LLM/tool steps, timings).' },
    ],
    category: 'core',
  },
  {
    type: 'llm_call',
    icon: '&#x1F4AD;', // Thought bubble
    label: 'LLM Call',
    description: 'Single LLM call (no autonomous loop). Can optionally request tool calls via the tools allowlist.',
    headerColor: '#3498DB', // Blue - AI
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      {
        id: 'include_context',
        label: 'use_context',
        type: 'boolean',
        description:
          "When true, include this run's active context messages (context.messages) in the LLM request. If the pin is not connected, the node checkbox is used. Default: false.",
      },
      { id: 'provider', label: 'provider', type: 'provider', description: 'LLM provider id (e.g. LMStudio). If unset, uses the node’s configured provider.' },
      { id: 'model', label: 'model', type: 'model', description: 'LLM model id/name. If unset, uses the node’s configured model.' },
      { id: 'temperature', label: 'temperature', type: 'number', description: 'Sampling temperature (0 = deterministic). If unset, uses the node’s configured temperature.' },
      { id: 'seed', label: 'seed', type: 'number', description: 'Seed for deterministic sampling (-1 = random/unset). If unset, uses the node’s configured seed.' },
      { id: 'system', label: 'system', type: 'string', description: 'Optional system prompt for this single call.' },
      { id: 'prompt', label: 'prompt', type: 'string', description: 'User prompt/content for this single call.' },
      { id: 'tools', label: 'tools', type: 'tools', description: 'Allowlist of tools exposed to the model as ToolSpecs (model may request tool calls; execution is done via a Tool Calls node).' },
      { id: 'response_schema', label: 'structured_output', type: 'object', description: 'Optional JSON Schema object (type=object) the assistant content must conform to.' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'response', label: 'response', type: 'string', description: 'Assistant text content (best-effort). For tool calls, content may be empty.' },
      {
        id: 'tool_calls',
        label: 'tool_calls',
        type: 'array',
        description:
          'Normalized tool call requests (same as result.tool_calls). This pin exists to make wiring into Tool Calls / Emit Event nodes simpler.',
      },
      { id: 'result', label: 'result', type: 'object', description: 'Full normalized LLM result (content, tool_calls, usage, provider/model metadata, trace_id).' },
    ],
    category: 'core',
  },
  {
    type: 'tool_calls',
    icon: '&#x1F528;', // Hammer
    label: 'Tool Calls',
    description: 'Execute one or more tool calls via the runtime. Outputs per-call results and a success boolean.',
    headerColor: '#16A085', // Teal - IO/tools
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      {
        id: 'tool_calls',
        label: 'tool_calls',
        type: 'array',
        description:
          'List of tool call requests. Each entry shape: {name, arguments, call_id?}. Often comes from LLM Call.result.tool_calls.',
      },
      {
        id: 'allowed_tools',
        label: 'allowed_tools',
        type: 'array',
        description:
          'Optional allowlist of tool names enforced by the runtime effect handler (empty list => allow none). If not connected, the node config (if any) is used.',
      },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      {
        id: 'results',
        label: 'results',
        type: 'array',
        description:
          'Per-call results in input order (each entry includes output/error metadata). Use this for debugging or to feed structured tool outputs into the graph.',
      },
      {
        id: 'success',
        label: 'success',
        type: 'boolean',
        description: 'True if all tool calls succeeded (no per-call error).',
      },
    ],
    category: 'core',
  },
  {
    type: 'ask_user',
    icon: '&#x2753;', // Question mark
    label: 'Ask User',
    description: 'Pause execution and ask the user for input (free text or choices).',
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
    category: 'core',
  },
  {
    type: 'answer_user',
    icon: '&#x1F4AC;', // Speech bubble
    label: 'Answer User',
    description: 'Display a message to the user (UI output).',
    headerColor: '#9B59B6', // Purple - human interaction
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'message', label: 'message', type: 'string' },
      {
        id: 'level',
        label: 'level',
        type: 'string',
        description: "Message level for hosts (message|warning|error). Defaults to 'message' when unset.",
      },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'message', label: 'message', type: 'string' },
    ],
    category: 'core',
  },
  {
    type: 'code',
    icon: '&#x1F40D;', // Python snake
    label: 'Python Code',
    description: 'Run a Python transform function `transform(input)` (portable only when a Python host is available).',
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
  { type: 'add', icon: '+', label: 'Add', description: 'Add two numbers.', headerColor: '#27AE60', inputs: [{ id: 'a', label: 'a', type: 'number' }, { id: 'b', label: 'b', type: 'number' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'subtract', icon: '-', label: 'Subtract', description: 'Compute a - b.', headerColor: '#27AE60', inputs: [{ id: 'a', label: 'a', type: 'number' }, { id: 'b', label: 'b', type: 'number' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'multiply', icon: '&#xD7;', label: 'Multiply', description: 'Multiply two numbers.', headerColor: '#27AE60', inputs: [{ id: 'a', label: 'a', type: 'number' }, { id: 'b', label: 'b', type: 'number' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'divide', icon: '&#xF7;', label: 'Divide', description: 'Compute a / b (error on division by zero).', headerColor: '#27AE60', inputs: [{ id: 'a', label: 'a', type: 'number' }, { id: 'b', label: 'b', type: 'number' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'modulo', icon: '%', label: 'Modulo', description: 'Compute a % b (error on modulo by zero).', headerColor: '#27AE60', inputs: [{ id: 'a', label: 'a', type: 'number' }, { id: 'b', label: 'b', type: 'number' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'power', icon: 'x^y', label: 'Power', description: 'Compute base ** exp.', headerColor: '#27AE60', inputs: [{ id: 'base', label: 'base', type: 'number' }, { id: 'exp', label: 'exp', type: 'number' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'abs', icon: '|x|', label: 'Absolute', description: 'Absolute value of a number.', headerColor: '#27AE60', inputs: [{ id: 'value', label: 'value', type: 'number' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'math' },
  { type: 'round', icon: '&#x223C;', label: 'Round', description: 'Round a number to N decimals.', headerColor: '#27AE60', inputs: [{ id: 'value', label: 'value', type: 'number' }, { id: 'decimals', label: 'decimals', type: 'number' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'math' },
];

// String nodes - Pure functions (no execution pins, just data in/out)
const STRING_NODES: NodeTemplate[] = [
  { type: 'concat', icon: '&#x2795;', label: 'Concat', description: 'Concatenate two strings.', headerColor: '#E74C3C', inputs: [{ id: 'a', label: 'a', type: 'string' }, { id: 'b', label: 'b', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'split', icon: '&#x2702;', label: 'Split', description: 'Split text by a delimiter into an array (with trimming/drop-empty defaults).', headerColor: '#E74C3C', inputs: [{ id: 'text', label: 'text', type: 'string' }, { id: 'delimiter', label: 'delimiter', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'array' }], category: 'string' },
  { type: 'join', icon: '&#x1F517;', label: 'Join', description: 'Join array items into a string using a delimiter.', headerColor: '#E74C3C', inputs: [{ id: 'items', label: 'items', type: 'array' }, { id: 'delimiter', label: 'delimiter', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'format', icon: '&#x1F4DD;', label: 'Format', description: 'Python-style string format: template.format(**values).', headerColor: '#E74C3C', inputs: [{ id: 'template', label: 'template', type: 'string' }, { id: 'values', label: 'values', type: 'object' }], outputs: [{ id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'string_template', icon: '&#x1F9FE;', label: 'String Template', description: 'Render a template like \"Hello {{user.name}}\" using a vars object (supports filters).', headerColor: '#E74C3C', inputs: [{ id: 'template', label: 'template', type: 'string' }, { id: 'vars', label: 'vars', type: 'object' }], outputs: [{ id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'uppercase', icon: 'AA', label: 'Uppercase', description: 'Convert text to UPPERCASE.', headerColor: '#E74C3C', inputs: [{ id: 'text', label: 'text', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'lowercase', icon: 'aa', label: 'Lowercase', description: 'Convert text to lowercase.', headerColor: '#E74C3C', inputs: [{ id: 'text', label: 'text', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'trim', icon: '&#x2702;', label: 'Trim', description: 'Trim whitespace from both ends of a string.', headerColor: '#E74C3C', inputs: [{ id: 'text', label: 'text', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'substring', icon: '&#x1F4CC;', label: 'Substring', description: 'Extract a substring by start/end indices (end is optional).', headerColor: '#E74C3C', inputs: [{ id: 'text', label: 'text', type: 'string' }, { id: 'start', label: 'start', type: 'number' }, { id: 'end', label: 'end', type: 'number' }], outputs: [{ id: 'result', label: 'result', type: 'string' }], category: 'string' },
  { type: 'length', icon: '#', label: 'Length', description: 'String length (number of characters).', headerColor: '#E74C3C', inputs: [{ id: 'text', label: 'text', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'string' },
];

// Control flow nodes
// If/Else and ForEach need execution pins (they control flow)
// Compare and logic gates (NOT, AND, OR) are pure functions (no execution pins)
const CONTROL_NODES: NodeTemplate[] = [
  // Execution nodes - ordered by intent: loops → branching → conditions
  // Loops
  { type: 'loop', icon: '&#x1F501;', label: 'ForEach', description: 'Iterate over an array. Outputs current item and 0-based index.', headerColor: '#F39C12', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'items', label: 'items', type: 'array' }], outputs: [{ id: 'loop', label: 'loop', type: 'execution' }, { id: 'done', label: 'done', type: 'execution' }, { id: 'item', label: 'item', type: 'any' }, { id: 'index', label: 'index', type: 'number' }], category: 'control' },
  { type: 'for', icon: '&#x1F522;', label: 'For', description: 'Numeric loop from start to end with step. Outputs i and a 0-based index.', headerColor: '#F39C12', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'start', label: 'start', type: 'number' }, { id: 'end', label: 'end', type: 'number' }, { id: 'step', label: 'step', type: 'number' }], outputs: [{ id: 'loop', label: 'loop', type: 'execution' }, { id: 'done', label: 'done', type: 'execution' }, { id: 'i', label: 'i', type: 'number' }, { id: 'index', label: 'index', type: 'number' }], category: 'control' },
  { type: 'while', icon: '&#x267B;', label: 'While', description: 'Loop while condition is true. Outputs a pass-through item and a 0-based iteration index.', headerColor: '#F39C12', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'condition', label: 'condition', type: 'boolean' }], outputs: [{ id: 'loop', label: 'loop', type: 'execution' }, { id: 'done', label: 'done', type: 'execution' }, { id: 'item', label: 'item', type: 'any' }, { id: 'index', label: 'index', type: 'number' }], category: 'control' },

  // Branching
  { type: 'if', icon: '&#x2753;', label: 'If/Else', description: 'Branch execution based on a boolean condition.', headerColor: '#F39C12', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'condition', label: 'condition', type: 'boolean' }], outputs: [{ id: 'true', label: 'true', type: 'execution' }, { id: 'false', label: 'false', type: 'execution' }], category: 'control' },
  {
    type: 'switch',
    icon: '&#x1F500;', // Shuffle
    label: 'Switch',
    description: 'Branch execution by matching a string value to configured cases (default branch always exists).',
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
    description: 'Run multiple branches in order (Then 0, Then 1, ...).',
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
    description: 'Run multiple branches concurrently and emit Completed when all finish.',
    headerColor: '#F39C12',
    inputs: [{ id: 'exec-in', label: '', type: 'execution' }],
    outputs: [
      { id: 'then:0', label: 'Then 0', type: 'execution' },
      { id: 'then:1', label: 'Then 1', type: 'execution' },
      { id: 'completed', label: 'Completed', type: 'execution' },
    ],
    category: 'control',
  },

  // Pure functions - just produce data
  {
    type: 'compare',
    icon: '=?',
    label: 'Compare',
    description: 'Compare a and b using operator op (==, !=, <, <=, >, >=).',
    headerColor: '#F39C12',
    inputs: [
      { id: 'a', label: 'a', type: 'any' },
      { id: 'op', label: 'op', type: 'string' },
      { id: 'b', label: 'b', type: 'any' },
    ],
    outputs: [{ id: 'result', label: 'result', type: 'boolean' }],
    category: 'control',
  },
  { type: 'and', icon: '&&', label: 'AND', description: 'Logical AND.', headerColor: '#F39C12', inputs: [{ id: 'a', label: 'a', type: 'boolean' }, { id: 'b', label: 'b', type: 'boolean' }], outputs: [{ id: 'result', label: 'result', type: 'boolean' }], category: 'control' },
  { type: 'or', icon: '||', label: 'OR', description: 'Logical OR.', headerColor: '#F39C12', inputs: [{ id: 'a', label: 'a', type: 'boolean' }, { id: 'b', label: 'b', type: 'boolean' }], outputs: [{ id: 'result', label: 'result', type: 'boolean' }], category: 'control' },
  { type: 'not', icon: '!', label: 'NOT', description: 'Logical NOT.', headerColor: '#F39C12', inputs: [{ id: 'value', label: 'value', type: 'boolean' }], outputs: [{ id: 'result', label: 'result', type: 'boolean' }], category: 'control' },
];

// Data nodes - Pure functions (no execution pins, just data in/out)
const DATA_NODES: NodeTemplate[] = [
  { type: 'coalesce', icon: '&#x21C4;', label: 'Coalesce', description: 'Return the first non-null value (A, then B, ...).', headerColor: '#3498DB', inputs: [{ id: 'a', label: 'a', type: 'any' }, { id: 'b', label: 'b', type: 'any' }], outputs: [{ id: 'result', label: 'result', type: 'any' }], category: 'data' },
  { type: 'get', icon: '&#x1F4E5;', label: 'Get Property', description: 'Safely read a nested path from an object (dot/bracket path) with an optional default.', headerColor: '#3498DB', inputs: [{ id: 'object', label: 'object', type: 'object' }, { id: 'key', label: 'key', type: 'string' }, { id: 'default', label: 'default', type: 'any' }], outputs: [{ id: 'value', label: 'value', type: 'any' }], category: 'data' },
  { type: 'set', icon: '&#x1F4E4;', label: 'Set Property', description: 'Pure transform: return a new object with key set. To persist state, use Set Variable (dotted path) or Set Variable Property.', headerColor: '#3498DB', inputs: [{ id: 'object', label: 'object', type: 'object' }, { id: 'key', label: 'key', type: 'string' }, { id: 'value', label: 'value', type: 'any' }], outputs: [{ id: 'result', label: 'result', type: 'object' }], category: 'data' },
  { type: 'merge', icon: '&#x1F517;', label: 'Merge Objects', description: 'Shallow merge two objects (b overrides a).', headerColor: '#3498DB', inputs: [{ id: 'a', label: 'a', type: 'object' }, { id: 'b', label: 'b', type: 'object' }], outputs: [{ id: 'result', label: 'result', type: 'object' }], category: 'data' },
  { type: 'make_array', icon: '[]', label: 'Make Array', description: 'Build an array from 1+ inputs in pin order (Blueprint-style). Skips null/unset inputs.', headerColor: '#3498DB', inputs: [{ id: 'a', label: 'a', type: 'any' }], outputs: [{ id: 'result', label: 'result', type: 'array' }], category: 'data' },
  { type: 'array_length', icon: '#', label: 'Array Length', description: 'Return the length of an array.', headerColor: '#3498DB', inputs: [{ id: 'array', label: 'array', type: 'array' }], outputs: [{ id: 'result', label: 'result', type: 'number' }], category: 'data' },
  { type: 'array_append', icon: '&#x2795;', label: 'Array Append', description: 'Append an item to an array (returns a new array).', headerColor: '#3498DB', inputs: [{ id: 'array', label: 'array', type: 'array' }, { id: 'item', label: 'item', type: 'any' }], outputs: [{ id: 'result', label: 'result', type: 'array' }], category: 'data' },
  { type: 'array_dedup', icon: '&#x1F5C3;', label: 'Array Dedup', description: 'Stable-order dedup for arrays (optionally by key path).', headerColor: '#3498DB', inputs: [{ id: 'array', label: 'array', type: 'array' }, { id: 'key', label: 'key', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'array' }], category: 'data' },
  { type: 'array_map', icon: '&#x1F5FA;', label: 'Map Array', description: 'Map array items by extracting a field (key) from objects.', headerColor: '#3498DB', inputs: [{ id: 'items', label: 'items', type: 'array' }, { id: 'key', label: 'key', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'array' }], category: 'data' },
  { type: 'array_filter', icon: '&#x1F50D;', label: 'Filter Array', description: 'Filter array items where item[key] == value (or item == value).', headerColor: '#3498DB', inputs: [{ id: 'items', label: 'items', type: 'array' }, { id: 'key', label: 'key', type: 'string' }, { id: 'value', label: 'value', type: 'any' }], outputs: [{ id: 'result', label: 'result', type: 'array' }], category: 'data' },
  { type: 'array_concat', icon: '&#x2795;', label: 'Array Concat', description: 'Concatenate arrays (a then b).', headerColor: '#3498DB', inputs: [{ id: 'a', label: 'a', type: 'array' }, { id: 'b', label: 'b', type: 'array' }], outputs: [{ id: 'result', label: 'result', type: 'array' }], category: 'data' },
  { type: 'parse_json', icon: '&#x1F5C2;', label: 'Parse JSON', description: 'Parse JSON (or JSON-ish) text into an object/array suitable for downstream nodes.', headerColor: '#3498DB', inputs: [{ id: 'text', label: 'text', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'object' }], category: 'data' },
  {
    type: 'stringify_json',
    icon: '&#x1F4DD;', // Memo
    label: 'Stringify JSON',
    description: 'Render a JSON value (object/array/scalar) into a string. Mode: none | beautify | minified.',
    headerColor: '#3498DB',
    inputs: [
      { id: 'value', label: 'value', type: 'any', description: 'JSON value (or JSON-ish string) to stringify.' },
      { id: 'mode', label: 'mode', type: 'string', description: 'Rendering mode: none | beautify | minified. Default beautify.' },
    ],
    outputs: [{ id: 'result', label: 'result', type: 'string' }],
    category: 'data',
  },
  {
    type: 'agent_trace_report',
    icon: '&#x1F4CB;', // Clipboard
    label: 'Agent Trace Report',
    description: 'Render an agent scratchpad (runtime-owned node_traces) into a condensed Markdown report of actions and tool results.',
    headerColor: '#3498DB',
    inputs: [
      { id: 'scratchpad', label: 'scratchpad', type: 'object', description: 'Agent scratchpad object (typically contains node_traces).' },
    ],
    outputs: [{ id: 'result', label: 'result', type: 'string' }],
    category: 'data',
  },
  {
    type: 'break_object',
    icon: '&#x1F9E9;', // Puzzle piece
    label: 'Break Object',
    description: 'Expose selected fields of an object as individual output pins (configured paths).',
    headerColor: '#3498DB',
    inputs: [{ id: 'object', label: 'object', type: 'object' }],
    outputs: [], // Dynamic pins based on selected paths
    category: 'data',
  },
];

// Variable nodes (Blueprint-style)
const VARIABLE_NODES: NodeTemplate[] = [
  {
    type: 'var_decl',
    icon: '𝑥',
    label: 'Variable',
    description: 'Declare a workflow-scope typed variable (name/type/default) and output its current value.',
    headerColor: '#16A085', // Teal
    inputs: [],
    outputs: [
      { id: 'name', label: 'name', type: 'string' },
      { id: 'value', label: 'value', type: 'any' },
    ],
    category: 'variables',
  },
  {
    type: 'bool_var',
    icon: '&#x1F7E5;', // Red square (boolean-ish)
    label: 'Bool Variable',
    description: 'Declare a workflow-scope boolean variable (name + default).',
    headerColor: '#16A085', // Teal (variables)
    inputs: [],
    outputs: [
      { id: 'name', label: 'name', type: 'string' },
      { id: 'value', label: 'value', type: 'boolean' },
    ],
    category: 'variables',
  },
  {
    type: 'get_var',
    icon: '&#x1F4E5;', // Reuse "inbox tray" as a getter-ish icon
    label: 'Get Variable',
    description: 'Read a variable from workflow state by name.',
    headerColor: '#16A085', // Teal
    inputs: [{ id: 'name', label: 'name', type: 'string' }],
    outputs: [{ id: 'value', label: 'value', type: 'any' }],
    category: 'variables',
  },
  {
    type: 'set_var',
    icon: '&#x1F4E4;', // Reuse "outbox tray" as a setter-ish icon
    label: 'Set Variable',
    description: 'Write a variable into workflow state by name (supports dotted paths for nested updates; updates run vars).',
    headerColor: '#16A085',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'name', label: 'name', type: 'string' },
      { id: 'value', label: 'value', type: 'any' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'value', label: 'value', type: 'any' },
    ],
    category: 'variables',
  },
  {
    type: 'set_var_property',
    icon: '&#x1F4E4;', // Setter-ish
    label: 'Set Variable Property',
    description: 'Update a nested property on an object variable in workflow state (name + key), then continue.',
    headerColor: '#16A085',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'name', label: 'name', type: 'string' },
      { id: 'key', label: 'key', type: 'string' },
      { id: 'value', label: 'value', type: 'any' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'value', label: 'value', type: 'object' },
    ],
    category: 'variables',
  },
  {
    type: 'set_vars',
    icon: '&#x1F4E4;&#xFE0F;', // Outbox tray (plural setter)
    label: 'Set Variables',
    description: 'Write multiple variables into workflow state in a single step (updates is an object of name→value).',
    headerColor: '#16A085',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'updates', label: 'updates', type: 'object' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'updates', label: 'updates', type: 'object' },
    ],
    category: 'variables',
  },
];

// Literal/Value nodes - Output constant values (no execution pins, no inputs)
// Colors match the output type for visual consistency
const LITERAL_NODES: NodeTemplate[] = [
  {
    type: 'literal_string',
    icon: '"',
    label: 'String',
    description: 'String literal value.',
    headerColor: '#FF00FF', // Magenta - matches string pin color
    inputs: [],
    outputs: [{ id: 'value', label: 'value', type: 'string' }],
    category: 'literals',
  },
  {
    type: 'literal_number',
    icon: '#',
    label: 'Number',
    description: 'Number literal value.',
    headerColor: '#00FF00', // Green - matches number pin color
    inputs: [],
    outputs: [{ id: 'value', label: 'value', type: 'number' }],
    category: 'literals',
  },
  {
    type: 'literal_boolean',
    icon: '?',
    label: 'Boolean',
    description: 'Boolean literal value.',
    headerColor: '#FF0000', // Red - matches boolean pin color
    inputs: [],
    outputs: [{ id: 'value', label: 'value', type: 'boolean' }],
    category: 'literals',
  },
  {
    type: 'literal_json',
    icon: '{}',
    label: 'JSON',
    description: 'Object (JSON) literal value.',
    headerColor: '#00FFFF', // Cyan - matches object pin color
    inputs: [],
    outputs: [{ id: 'value', label: 'value', type: 'object' }],
    category: 'literals',
  },
  {
    type: 'json_schema',
    icon: '&#x1F4CB;', // Clipboard
    label: 'JSON Schema',
    description:
      'Define a JSON Schema object for structured outputs. Connect to LLM/Agent `structured_output` (response_schema).',
    headerColor: '#00FFFF', // object pin color (schema is an object)
    inputs: [],
    outputs: [{ id: 'value', label: 'schema', type: 'object' }],
    category: 'literals',
  },
  {
    type: 'literal_array',
    icon: '[]',
    label: 'Array',
    description: 'Array literal value.',
    headerColor: '#FF8800', // Orange - matches array pin color
    inputs: [],
    outputs: [{ id: 'value', label: 'value', type: 'array' }],
    category: 'literals',
  },
  {
    type: 'provider_catalog',
    icon: '&#x1F4E6;', // Package-ish (catalog)
    label: 'Provider Catalog',
    description: 'List available LLM providers (optionally filtered by an allowlist).',
    headerColor: '#3498DB',
    inputs: [{ id: 'allowed_providers', label: 'allowed_providers', type: 'array' }],
    outputs: [{ id: 'providers', label: 'providers', type: 'array' }],
    category: 'literals',
  },
  {
    type: 'provider_models',
    icon: '&#x1F4DA;', // Books
    label: 'Models Catalog',
    description: 'List models for a provider. Optionally restrict the list by selecting allowed models in the node config.',
    headerColor: '#3498DB',
    inputs: [
      {
        id: 'provider',
        label: 'provider',
        type: 'provider',
        description: 'Provider id to list models for. If this pin is not connected, the node’s selected provider is used.',
      },
    ],
    outputs: [
      { id: 'provider', label: 'provider', type: 'provider', description: 'Resolved provider id used to compute the models list.' },
      {
        id: 'models',
        label: 'models',
        type: 'array',
        description: 'Array of model ids/names for the provider (filtered to the selected allowed models when set).',
      },
    ],
    category: 'literals',
  },
  {
    type: 'tools_allowlist',
    icon: '&#x1F9F0;', // Toolbox
    label: 'Tools Allowlist',
    description: 'Select an allowlist of tool names once and reuse it across LLM/Agent/Tool Calls nodes.',
    headerColor: '#FF8800', // Orange - array output
    inputs: [],
    outputs: [{ id: 'tools', label: 'tools', type: 'tools' }],
    category: 'literals',
  },
  {
    type: 'tool_parameters',
    icon: '&#x2699;', // Gear
    label: 'Tool Parameters',
    description: 'Pick a tool and set its arguments (typed + defaults). Outputs a tool call object for Tool Calls.',
    headerColor: '#FF8800', // Orange - tools/config
    inputs: [], // Dynamic pins based on selected tool
    outputs: [
      {
        id: 'tool_call',
        label: 'tool_call',
        type: 'object',
        description: 'Single tool call request object: {name, arguments, call_id?}.',
      },
    ],
    category: 'literals',
  },
];

// Memory nodes - Durable memory operations + file IO.
// These nodes have execution pins and represent side effects users conceptually associate with "Memory / IO".
const MEMORY_NODES: NodeTemplate[] = [
  {
    type: 'read_file',
    icon: '&#x1F4C4;', // Page facing up
    label: 'Read File',
    description: 'Read a file from disk and output its content.',
    headerColor: '#16A085', // Teal - IO
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'file_path', label: 'file_path', type: 'string' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'content', label: 'content', type: 'any' },
    ],
    category: 'memory',
  },
  {
    type: 'write_file',
    icon: '&#x1F4BE;', // Floppy disk
    label: 'Write File',
    description: 'Write content to a file on disk (creates parent folders if needed).',
    headerColor: '#16A085', // Teal - IO
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'file_path', label: 'file_path', type: 'string' },
      { id: 'content', label: 'content', type: 'any' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'bytes', label: 'bytes', type: 'number' },
      { id: 'file_path', label: 'file_path', type: 'string' },
    ],
    category: 'memory',
  },
  {
    type: 'memory_note',
    icon: '&#x1F4DD;', // Memo
    label: 'Memorize',
    description: 'Store a durable memory note with optional tags/sources and a scope (run/session/global).',
    headerColor: '#2ECC71', // Green - memory
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      {
        id: 'keep_in_context',
        label: 'in_context',
        type: 'boolean',
        description:
          "When true, also insert the stored note into this run's context.messages (synthetic system message). If the pin is not connected, the node checkbox is used. Default: false.",
      },
      {
        id: 'scope',
        label: 'scope',
        type: 'string',
        description:
          'Where to store/index the note: run (this run), session (all runs with the same session_id; owned by an internal session memory run), or global (shared global memory run). If session_id is missing, session falls back to the run-tree root.',
      },
      { id: 'content', label: 'content', type: 'string', description: 'The note text to store durably (keep it short; prefer references in sources for large payloads).' },
      { id: 'location', label: 'location', type: 'string', description: 'Optional location label (where the note was produced, e.g. "flow:my_flow/node-12"). Useful for filtering.' },
      { id: 'tags', label: 'tags', type: 'object', description: 'Key/value tags for filtering (e.g. {topic:"memory", person:"laurent"}). Values must be strings.' },
      { id: 'sources', label: 'sources', type: 'object', description: 'Optional provenance refs (e.g. {run_id, span_ids, message_ids}). The note stores refs, not the full source content.' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'note_id', label: 'note_id', type: 'string', description: 'The stored note’s span_id / artifact_id. Use it for Recall into context (span_ids) or for precise Recall.' },
    ],
    category: 'memory',
  },
  {
    type: 'memory_query',
    icon: '&#x1F50D;', // Magnifying glass
    label: 'Recall',
    description: 'Query memory by text/tags and return structured results plus a rendered summary.',
    headerColor: '#2ECC71', // Green - memory
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'query', label: 'query', type: 'string', description: 'Keyword query (substring match over span metadata and small previews). Combined with tags/authors/locations using AND semantics.' },
      { id: 'limit', label: 'limit', type: 'number', description: 'Maximum number of spans to return (limit_spans). Default: 5.' },
      { id: 'tags', label: 'tags', type: 'object', description: 'Tag filters as key→string or key→list[string]. Reserved key "kind" is ignored.' },
      { id: 'tags_mode', label: 'tags_mode', type: 'string', description: 'How to combine tag keys: all (AND) or any (OR). Within a single key, list values are OR.' },
      { id: 'usernames', label: 'usernames', type: 'array', description: 'Filter by created_by (actor id). Case-insensitive exact match. Empty means no filter.' },
      { id: 'locations', label: 'locations', type: 'array', description: 'Filter by location metadata (or tags.location). Case-insensitive exact match.' },
      { id: 'since', label: 'since', type: 'string', description: 'ISO8601 start time. Matches spans whose [from,to] intersects this range.' },
      { id: 'until', label: 'until', type: 'string', description: 'ISO8601 end time. Matches spans whose [from,to] intersects this range.' },
      {
        id: 'scope',
        label: 'scope',
        type: 'string',
        description:
          'Which span index to query: run | session | global | all. (all queries run+session+global. session uses session_id authority; if session_id is missing, it falls back to the run-tree root.)',
      },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'results', label: 'results', type: 'array', description: 'Structured match list (meta.matches). Use it to extract span_ids for Recall into context.' },
      { id: 'rendered', label: 'rendered', type: 'string', description: 'Human-readable recall summary (tool-style output string).' },
    ],
    category: 'memory',
  },
  {
    type: 'memory_tag',
    icon: '&#x1F3F7;', // Label
    label: 'Tag memory',
    description: 'Apply/merge tags onto an existing memory span record (conversation span or memory note).',
    headerColor: '#2ECC71', // Green - memory
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'span_id', label: 'span_id', type: 'string', description: 'Target span_id (artifact id). Also accepts a 1-based span index as a string/number in some hosts.' },
      { id: 'tags', label: 'tags', type: 'object', description: 'Key/value tags to set (values must be strings). Reserved key "kind" is ignored.' },
      { id: 'merge', label: 'merge', type: 'boolean', description: 'When true, merges with existing tags. When false, replaces the tag dict. Default: true.' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'success', label: 'success', type: 'boolean', description: 'Whether the tag operation succeeded.' },
      { id: 'rendered', label: 'rendered', type: 'string', description: 'Human-readable result string.' },
    ],
    category: 'memory',
  },
  {
    type: 'memory_compact',
    icon: '&#x1F5DC;', // Clamp (compression)
    label: 'Compact memory',
    description:
      'Runtime-owned compaction: archives older messages into an artifact span and inserts a summary message with an LLM-visible span_id handle.',
    headerColor: '#2ECC71', // Green - memory
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'preserve_recent', label: 'preserve_recent', type: 'number', description: 'Number of most recent non-system messages to keep verbatim (default 6).' },
      { id: 'compression_mode', label: 'compression_mode', type: 'string', description: 'light | standard | heavy (default standard).' },
      { id: 'focus', label: 'focus', type: 'string', description: 'Optional topic/focus hint for the compaction summary.' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'span_id', label: 'span_id', type: 'string', description: 'The archived conversation span_id (artifact id). Use it for tagging or recall.' },
    ],
    category: 'memory',
  },
  {
    type: 'memory_rehydrate',
    icon: '&#x1F4AC;', // Speech balloon
    label: 'Recall into context',
    description: 'Insert recalled message spans into the active context so future LLM/Agent calls can “see” them.',
    headerColor: '#2ECC71', // Green - memory
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'span_ids', label: 'span_ids', type: 'array', description: 'List of span_ids (artifact_ids) to insert into context.messages. Typically comes from Recall results.' },
      { id: 'placement', label: 'placement', type: 'string', description: 'Where to insert: after_summary | after_system | end.' },
      { id: 'max_messages', label: 'max_messages', type: 'number', description: 'Optional cap on inserted messages across all spans (None/empty = unlimited). Useful to avoid huge contexts.' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'inserted', label: 'inserted', type: 'number', description: 'Number of messages inserted into context.messages.' },
      { id: 'skipped', label: 'skipped', type: 'number', description: 'Number of messages skipped (usually due to dedup).' },
    ],
    category: 'memory',
  },
];

// Math nodes - keep as a dedicated category for scanability.
const PALETTE_MATH_NODES: NodeTemplate[] = [
  ...MATH_NODES.map((n) => ({ ...n, category: 'math' })),
];

// Data/Utils nodes - pure utilities for manipulating values.
// Keep literals + variables as separate categories for palette scanability.
const PALETTE_DATA_NODES: NodeTemplate[] = [
  ...STRING_NODES.map((n) => ({ ...n, category: 'data' })),
  ...DATA_NODES.map((n) => ({ ...n, category: 'data' })),
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
  memory: {
    label: 'Memory',
    icon: '&#x1F9E0;', // Brain
    nodes: MEMORY_NODES,
  },
  control: {
    label: 'Control',
    icon: '&#x1F500;', // Shuffle
    nodes: CONTROL_NODES,
  },
  literals: {
    label: 'Literals',
    icon: '&#x270F;', // Pencil - constants/values
    nodes: LITERAL_NODES,
  },
  variables: {
    label: 'Variables',
    icon: '&#x1F4E6;', // Package-ish
    nodes: VARIABLE_NODES,
  },
  math: {
    label: 'Math',
    icon: '&#x1F522;', // 123
    nodes: PALETTE_MATH_NODES,
  },
  data: {
    label: 'Transforms',
    icon: '&#x1F6E0;', // Hammer & wrench
    nodes: PALETTE_DATA_NODES,
  },
};

const ALL_NODE_TEMPLATES: NodeTemplate[] = Object.values(NODE_CATEGORIES).flatMap((cat) => cat.nodes);
const NODE_TEMPLATE_BY_TYPE: Map<NodeType, NodeTemplate> = new Map(
  ALL_NODE_TEMPLATES.map((t) => [t.type, t])
);

// Get all node templates flattened
export function getAllNodeTemplates(): NodeTemplate[] {
  return ALL_NODE_TEMPLATES;
}

// Get template by type
export function getNodeTemplate(type: NodeType): NodeTemplate | undefined {
  return NODE_TEMPLATE_BY_TYPE.get(type);
}

// Create default node data from template
export function createNodeData(template: NodeTemplate): FlowNodeData {
  const defaultCodeBodyBase = 'return input';
  const defaultCodeBody = template.type === 'code'
    ? upsertPythonAvailableVariablesComments(defaultCodeBodyBase, template.inputs)
    : defaultCodeBodyBase;

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
    ...(template.type === 'json_schema' && {
      literalValue: {
        type: 'object',
        properties: { data: { type: 'string' } },
        required: ['data'],
      },
    }),
    ...(template.type === 'literal_array' && { literalValue: [] }),
    ...(template.type === 'tool_parameters' && { toolParametersConfig: { tool: '' } }),
    ...(template.type === 'break_object' && { breakConfig: { selectedPaths: [] } }),
    ...(template.type === 'concat' && { concatConfig: { separator: ' ' } }),
    ...(template.type === 'switch' && { switchConfig: { cases: [] } }),
    ...(template.type === 'on_event' && { eventConfig: { name: 'my_event', scope: 'session' } }),
    ...(template.type === 'on_schedule' && { eventConfig: { schedule: '15s', recurrent: true } }),
    ...(template.type === 'model_catalog' && { modelCatalogConfig: { allowedProviders: [], allowedModels: [], index: 0 } }),
    ...(template.type === 'provider_models' && { providerModelsConfig: { provider: '', allowedModels: [] } }),
    ...(template.type === 'emit_event' && { effectConfig: { name: 'my_event', scope: 'session', sessionId: '' } }),
  };
}

/**
 * Best-effort: merge template pin documentation into a node's pins.
 *
 * Why:
 * - Older saved flows may have `inputs/outputs` persisted without `description`.
 * - We want tooltips to appear reliably even for legacy flows, without forcing migrations.
 *
 * Rules:
 * - Never overwrite an explicit pin.description already stored on the node.
 * - Only merge by pin id; dynamic pins remain untouched.
 */
export function mergePinDocsFromTemplate(
  templateData: FlowNodeData,
  nodeData: FlowNodeData
): FlowNodeData {
  const mergePins = (templatePins: Pin[], pins: Pin[]): Pin[] => {
    const byId = new Map(templatePins.map((p) => [p.id, p] as const));
    return pins.map((p) => {
      const t = byId.get(p.id);
      if (!t) return p;
      const hasOwn = typeof p.description === 'string' && p.description.trim().length > 0;
      if (hasOwn) return p;
      const templ = typeof t.description === 'string' && t.description.trim().length > 0 ? t.description : undefined;
      return templ ? { ...p, description: templ } : p;
    });
  };

  return {
    ...nodeData,
    inputs: mergePins(templateData.inputs, nodeData.inputs),
    outputs: mergePins(templateData.outputs, nodeData.outputs),
  };
}
