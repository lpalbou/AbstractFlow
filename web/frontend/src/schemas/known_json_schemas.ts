export type JsonSchema = {
  type?: string;
  title?: string;
  description?: string;
  format?: string;
  enum?: unknown[];
  examples?: unknown[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
};

const TRACE_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'Trace',
  description: 'Lightweight trace identifiers for correlating UI/ledger with provider logs.',
  properties: {
    trace_id: {
      type: 'string',
      description: 'Provider/runtime trace id (best-effort).',
    },
  },
  additionalProperties: true,
};

const USAGE_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'Usage',
  description: 'Token usage counters (provider-dependent; fields may be missing).',
  properties: {
    input_tokens: { type: 'number', description: 'Input tokens used (best-effort).' },
    output_tokens: { type: 'number', description: 'Output tokens used (best-effort).' },
    total_tokens: { type: 'number', description: 'Total tokens used (best-effort).' },
    prompt_tokens: { type: 'number', description: 'Prompt tokens (OpenAI-style; optional).' },
    completion_tokens: { type: 'number', description: 'Completion tokens (OpenAI-style; optional).' },
  },
  additionalProperties: true,
};

const MESSAGE_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'Message',
  description: 'Canonical chat message (role + content) used by context/agents/LLM calls.',
  properties: {
    role: {
      type: 'string',
      description: 'Message role: user | assistant | system | tool (others may exist in legacy traces).',
    },
    content: { type: 'string', description: 'Message text content.' },
    timestamp: { type: 'string', description: 'Optional ISO timestamp (best-effort).', format: 'date-time' },
    metadata: {
      type: 'object',
      description: 'Optional metadata (e.g. message_id, node_id, provenance handles). Treat as opaque.',
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};

const CONTEXT_SESSION_TURN_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'Turn',
  description: 'Best-effort snapshot of one prior user/assistant turn (host-provided).',
  properties: {
    prompt: { type: 'string', description: 'User prompt for this turn.' },
    answer: { type: 'string', description: 'Assistant response for this turn.' },
    run_id: { type: 'string', description: 'Run id that produced this turn (best-effort).' },
    tools: { type: 'array', description: 'Tools used during this turn (best-effort).', items: { type: 'object', additionalProperties: true } },
  },
  additionalProperties: true,
};

const CONTEXT_SESSION_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'Session',
  description: 'Client session snapshot (host-provided; used by chat-like UIs).',
  properties: {
    id: { type: 'string', description: 'Client session id.' },
    last_run_id: { type: 'string', description: 'Most recent run id in this session (best-effort).' },
    turns: {
      type: 'array',
      description: 'Recent turns summary (best-effort; shape is host-dependent).',
      items: CONTEXT_SESSION_TURN_SCHEMA,
    },
  },
  additionalProperties: true,
};

const ATTACHMENT_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'Attachment',
  description: 'Attachment reference (file/media). Shape is host-dependent.',
  properties: {
    path: { type: 'string', description: 'File path or URI (best-effort).' },
    mime_type: { type: 'string', description: 'MIME type (best-effort).' },
  },
  additionalProperties: true,
};

const CONTEXT_EXTRA_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'Context Extra',
  description: 'Extra context fields beyond task/messages (host-defined; safe to treat as opaque).',
  properties: {
    session: CONTEXT_SESSION_SCHEMA,
    attachments: { type: 'array', description: 'Optional attachments list (files/media).', items: ATTACHMENT_SCHEMA },
  },
  additionalProperties: true,
};

export const CONTEXT_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'Context',
  description: 'Run context namespace (run.vars.context). Used to carry conversation history across nodes/runs.',
  properties: {
    task: {
      type: 'string',
      description:
        'Primary user request/task string (best-effort). Some workflows also store the latest prompt separately.',
    },
    messages: {
      type: 'array',
      description: 'Conversation transcript (context.messages). Newest message should be last.',
      items: MESSAGE_SCHEMA,
    },
    session: CONTEXT_SESSION_SCHEMA,
    attachments: { type: 'array', description: 'Optional attachments list (files/media).', items: ATTACHMENT_SCHEMA },
  },
  additionalProperties: true,
};

const TOOL_CALL_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'Tool Call',
  description: 'Single tool call request: tool name + JSON-safe arguments.',
  properties: {
    call_id: { type: 'string', description: 'Optional stable id for matching results (call_id).' },
    name: { type: 'string', description: 'Tool name (must exist in the runtime tool registry).' },
    arguments: { type: 'object', description: 'Tool arguments (JSON object).', additionalProperties: true },
  },
  additionalProperties: true,
};

const TOOL_RESULT_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'Tool Result',
  description: 'Single tool execution result (matched to a tool call by call_id).',
  properties: {
    call_id: { type: 'string', description: 'Tool call id this result corresponds to (call_id).' },
    name: { type: 'string', description: 'Tool name.' },
    success: { type: 'boolean', description: 'True if the tool executed successfully.' },
    output: { type: 'object', description: 'Tool output (shape depends on tool).', additionalProperties: true },
    error: {
      type: 'string',
      description: 'Error message when success=false (null/empty when success=true).',
    },
    meta: {
      type: 'object',
      description: 'Optional tool metadata (timing, provenance, etc). Treat as opaque.',
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};

export const AGENT_META_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'Agent Meta',
  description: 'Host-facing meta envelope (small, stable fields; safe to persist in chats).',
  properties: {
    schema: {
      type: 'string',
      description:
        'Envelope type identifier for this meta object (so clients know which fields to expect). Useful for compatibility checks/migrations. Example: `abstractcode.agent.v1.meta`.',
    },
    version: { type: 'number', description: 'Schema version (currently 1).' },
    output_mode: {
      type: 'string',
      description: 'Agent output mode: unstructured (default) or structured (when a response schema is used).',
      enum: ['unstructured', 'structured'],
    },
    provider: { type: 'string', description: 'Provider id/name (e.g. lmstudio).' },
    model: { type: 'string', description: 'Model id/name.' },
    sub_run_id: { type: 'string', description: 'ReAct sub-run id used to execute this Agent node.' },
    iterations: { type: 'number', description: 'Number of internal ReAct iterations (best-effort).' },
    tool_calls: { type: 'number', description: 'Count of tool calls observed in the agent trace.' },
    tool_results: { type: 'number', description: 'Count of tool results observed in the agent trace.' },
    trace: TRACE_SCHEMA,
    warnings: { type: 'array', description: 'Optional warnings list (strings).', items: { type: 'string' } },
    debug: {
      type: 'object',
      description: 'Optional debug payload (host-facing). Prefer small, stable keys.',
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};

export const AGENT_SCRATCHPAD_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'Agent Scratchpad',
  description: 'Runtime-owned observability data for an Agent node (may be large; not ideal to persist in chats).',
  properties: {
    sub_run_id: { type: 'string', description: 'ReAct sub-run id.' },
    workflow_id: { type: 'string', description: 'Workflow id used for the ReAct subworkflow (implementation detail).' },
    task: { type: 'string', description: 'Agent task/prompt string for this run.' },
    context_extra: {
      ...CONTEXT_EXTRA_SCHEMA,
      description:
        'Additional context fields passed into the agent (excluding task/messages). This is typically derived from the input context object.',
    },
    messages: {
      type: 'array',
      description: 'Agent-internal message transcript for this run (subworkflow context.messages).',
      items: MESSAGE_SCHEMA,
    },
    node_traces: {
      type: 'object',
      description: 'Structured per-node trace map produced by the ReAct subworkflow (node_id -> trace).',
      additionalProperties: true,
    },
    steps: {
      type: 'array',
      description:
        'Flattened list derived from node_traces (UI-friendly). Each step is a small object describing an LLM/tool/wait transition.',
      items: { type: 'object', additionalProperties: true },
    },
    tool_calls: { type: 'array', description: 'Tool calls extracted from steps (best-effort).', items: TOOL_CALL_SCHEMA },
    tool_results: { type: 'array', description: 'Tool results extracted from steps (best-effort).', items: TOOL_RESULT_SCHEMA },
  },
  additionalProperties: true,
};

export const AGENT_RESULT_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'Agent Result',
  description:
    'Agent `result` output. In unstructured mode this is a minimal object (e.g. `{success:true}`). In structured-output mode this is the JSON object produced by the response schema.',
  properties: {
    success: { type: 'boolean', description: 'True if the agent completed successfully.' },
  },
  additionalProperties: true,
};

export const LLM_META_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'LLM Meta',
  description: 'Host-facing meta envelope for a single LLM Call node (small, stable fields).',
  properties: {
    schema: {
      type: 'string',
      description:
        'Envelope type identifier for this meta object (so clients know which fields to expect). Useful for compatibility checks/migrations. Example: `abstractflow.llm_call.v1.meta`.',
    },
    version: { type: 'number', description: 'Schema version (currently 1).' },
    output_mode: {
      type: 'string',
      description: 'LLM output mode: unstructured (default) or structured (when a response schema is used).',
      enum: ['unstructured', 'structured'],
    },
    provider: { type: 'string', description: 'Provider id/name (e.g. lmstudio).' },
    model: { type: 'string', description: 'Model id/name.' },
    finish_reason: { type: 'string', description: 'Finish reason (e.g. stop, length, tool_calls).' },
    tool_calls: { type: 'number', description: 'Count of requested tool calls.' },
    usage: USAGE_SCHEMA,
    trace: TRACE_SCHEMA,
    gen_time: { type: 'number', description: 'Generation time (best-effort, provider-dependent).' },
    ttft_ms: { type: 'number', description: 'Time to first token in milliseconds (best-effort, provider-dependent).' },
    warnings: { type: 'array', description: 'Optional warnings list (strings).', items: { type: 'string' } },
    debug: {
      type: 'object',
      description: 'Optional debug payload (host-facing). Prefer small, stable keys.',
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};

export const LLM_RESULT_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'LLM Result',
  description: 'Normalized LLM_CALL result envelope (content/tool calls/usage/metadata).',
  properties: {
    content: { type: 'string', description: 'Assistant text content (may be empty for tool-call turns).' },
    reasoning: { type: 'string', description: 'Provider-specific reasoning text (when available).' },
    data: { type: 'object', description: 'Structured output object when a response schema is used.', additionalProperties: true },
    tool_calls: { type: 'array', description: 'Requested tool calls (normalized).', items: TOOL_CALL_SCHEMA },
    usage: USAGE_SCHEMA,
    model: { type: 'string', description: 'Resolved model id/name.' },
    finish_reason: { type: 'string', description: 'Finish reason (e.g. stop, length, tool_calls).' },
    metadata: { type: 'object', description: 'Provider/runtime metadata (debug/observability).', additionalProperties: true },
    trace_id: { type: 'string', description: 'Trace id (best-effort).' },
  },
  additionalProperties: true,
};

export const EVENT_ENVELOPE_SCHEMA: JsonSchema = {
  type: 'object',
  title: 'Event',
  description: 'Durable event envelope (as delivered to On Event nodes).',
  properties: {
    event_id: { type: 'string', description: 'Unique event id (run-scoped).' },
    name: { type: 'string', description: 'Event name (e.g. abstract.status, my_event).' },
    scope: { type: 'string', description: 'Event scope (session|run|global; host-dependent).' },
    session_id: { type: 'string', description: 'Session id (when scoped to a session).' },
    payload: { type: 'object', description: 'Event payload (JSON-safe).', additionalProperties: true },
    emitted_at: { type: 'string', description: 'Emit timestamp (ISO).', format: 'date-time' },
    emitter: {
      type: 'object',
      description: 'Emitter metadata (best-effort).',
      properties: {
        run_id: { type: 'string', description: 'Emitter run id.' },
        workflow_id: { type: 'string', description: 'Emitter workflow id.' },
        node_id: { type: 'string', description: 'Emitter node id.' },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};
