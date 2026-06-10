# AbstractFlow Workflow Node Catalog

This catalog is generated from `src/types/nodes.ts` by `npm run docs:llms`.
It is the stable AI-readable companion to `docs/workflow-authoring-skill.md`.

Workflows are authored as one JSON document: `{"flow_name", "nodes": [...], "edges": ["node.pin -> node.pin", ...]}`. Each document node uses `type` matching the value shown here; if several visible palette entries share a `type`, set `template` to the exact variant label shown in the document node snippet.

## Visible Authoring Templates

### artifacts / Image Artifact

- Node type: `literal_json`
- Document node: `{"id":"<unique_id>","type":"literal_json","template":"Image Artifact"}`
- Utility: Artifact reference object for an image Gateway artifact. Wire this into Edit Image image_artifact or mask_artifact.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: select with `"template": "Image Artifact"`; literal value with `literal`
- Inputs: none
- Outputs: `value` artifact_image (image_artifact)
- Default config: {
  "literalValue": {
    "$artifact": "",
    "content_type": "image/png",
    "modality": "image"
  }
}

### artifacts / Music Artifact

- Node type: `literal_json`
- Document node: `{"id":"<unique_id>","type":"literal_json","template":"Music Artifact"}`
- Utility: Artifact reference object for a music/audio Gateway artifact.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: select with `"template": "Music Artifact"`; literal value with `literal`
- Inputs: none
- Outputs: `value` artifact_audio (music_artifact)
- Default config: {
  "literalValue": {
    "$artifact": "",
    "content_type": "audio/wav",
    "modality": "music"
  }
}

### artifacts / Text Artifact

- Node type: `literal_json`
- Document node: `{"id":"<unique_id>","type":"literal_json","template":"Text Artifact"}`
- Utility: Artifact reference object for a text/plain Gateway artifact. Paste an uploaded or generated artifact id into $artifact.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: select with `"template": "Text Artifact"`; literal value with `literal`
- Inputs: none
- Outputs: `value` artifact_text (text_artifact)
- Default config: {
  "literalValue": {
    "$artifact": "",
    "content_type": "text/plain",
    "modality": "text"
  }
}

### artifacts / Video Artifact

- Node type: `literal_json`
- Document node: `{"id":"<unique_id>","type":"literal_json","template":"Video Artifact"}`
- Utility: Artifact reference object for a video Gateway artifact.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: select with `"template": "Video Artifact"`; literal value with `literal`
- Inputs: none
- Outputs: `value` artifact_video (video_artifact)
- Default config: {
  "literalValue": {
    "$artifact": "",
    "content_type": "video/mp4",
    "modality": "video"
  }
}

### artifacts / Voice Artifact

- Node type: `literal_json`
- Document node: `{"id":"<unique_id>","type":"literal_json","template":"Voice Artifact"}`
- Utility: Artifact reference object for a speech/audio Gateway artifact.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: select with `"template": "Voice Artifact"`; literal value with `literal`
- Inputs: none
- Outputs: `value` artifact_audio (voice_artifact)
- Default config: {
  "literalValue": {
    "$artifact": "",
    "content_type": "audio/wav",
    "modality": "voice"
  }
}

### control / AND

- Node type: `and`
- Document node: `{"id":"<unique_id>","type":"and"}`
- Utility: Logical AND.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `a` boolean; `b` boolean
- Outputs: `result` boolean
- Default config: none

### control / Compare

- Node type: `compare`
- Document node: `{"id":"<unique_id>","type":"compare"}`
- Utility: Compare a and b using operator op (==, !=, <, <=, >, >=).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `a` any; `op` string; `b` any
- Outputs: `result` boolean
- Default config: none

### control / For

- Node type: `for`
- Document node: `{"id":"<unique_id>","type":"for"}`
- Utility: Numeric loop from start to end with step. Outputs i and a 0-based index.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `start` number; `end` number; `step` number
- Outputs: `loop` execution; `done` execution; `i` number; `index` number
- Default config: none

### control / If/Else

- Node type: `if`
- Document node: `{"id":"<unique_id>","type":"if"}`
- Utility: Branch execution based on a boolean condition.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `condition` boolean
- Outputs: `true` execution; `false` execution
- Default config: none

### control / ForEach

- Node type: `loop`
- Document node: `{"id":"<unique_id>","type":"loop"}`
- Utility: Iterate over an array. Outputs current item and 0-based index.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `items` array
- Outputs: `loop` execution; `done` execution; `item` any; `index` number
- Default config: none

### control / NOT

- Node type: `not`
- Document node: `{"id":"<unique_id>","type":"not"}`
- Utility: Logical NOT.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `value` boolean
- Outputs: `result` boolean
- Default config: none

### control / OR

- Node type: `or`
- Document node: `{"id":"<unique_id>","type":"or"}`
- Utility: Logical OR.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `a` boolean; `b` boolean
- Outputs: `result` boolean
- Default config: none

### control / Parallel

- Node type: `parallel`
- Document node: `{"id":"<unique_id>","type":"parallel"}`
- Utility: Run multiple branches concurrently and emit Completed when all finish.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`; branch count with `branch_count`
- Inputs: `exec-in` execution
- Outputs: `then:0` execution (Then 0); `then:1` execution (Then 1); `completed` execution (Completed)
- Default config: none

### control / Sequence

- Node type: `sequence`
- Document node: `{"id":"<unique_id>","type":"sequence"}`
- Utility: Run multiple branches in order (Then 0, Then 1, ...).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`; branch count with `branch_count`
- Inputs: `exec-in` execution
- Outputs: `then:0` execution (Then 0); `then:1` execution (Then 1)
- Default config: none

### control / Switch

- Node type: `switch`
- Document node: `{"id":"<unique_id>","type":"switch"}`
- Utility: Branch execution by matching a string value to configured cases (default branch always exists).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`; cases with `switch_cases`
- Inputs: `exec-in` execution; `value` string
- Outputs: `default` execution
- Default config: {
  "switchConfig": {
    "cases": []
  }
}

### control / While

- Node type: `while`
- Document node: `{"id":"<unique_id>","type":"while"}`
- Utility: Loop while condition is true. Outputs a pass-through item and a 0-based iteration index.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `condition` boolean
- Outputs: `loop` execution; `done` execution; `item` any; `index` number
- Default config: none

### core / Add Message

- Node type: `add_message`
- Document node: `{"id":"<unique_id>","type":"add_message"}`
- Utility: Append a canonical message to the run active context (context.messages).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `role` string: Message role (e.g. user, assistant, system, tool).; `content` string: Message content.
- Outputs: `exec-out` execution; `message` object: Message object {role, content, timestamp, metadata.message_id}.; `context` object: Updated active context object (run.vars.context).; `task` string: Convenience output for context.task.; `messages` array: Updated context.messages list.
- Default config: none

### core / Agent

- Node type: `agent`
- Document node: `{"id":"<unique_id>","type":"agent"}`
- Utility: Run an agent (ReAct) that can call tools. Outputs response, success, meta, and a runtime scratchpad.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `use_context` boolean: When true, include this run's active context messages (context.messages) as agent history. If the pin is not connected, the node checkbox is used. Default: false.; `context` object: Optional explicit context object for the agent (e.g. {messages:[...]}). If provided, context.messages overrides the inherited run context messages.; `memory` memory: Memory configuration object (KG/span/session controls). If set, overrides this node’s recall/ingest behavior; if unset, runtime defaults apply.; `provider` provider_text: Text/LLM provider id (e.g. LMStudio). If unset, uses the node’s configured provider.; `model` model: Text/LLM model id/name. If unset, uses the node’s configured model.; `system` string: Optional system prompt for this agent instance (high priority instructions).; `prompt` string: User prompt/task string for the agent to solve.; `tools` tools: Allowlist of tool names this agent can call (defense-in-depth; runtime still enforces allowlists).; `prompt_cache_binding` any: Advanced: durable exact-reuse prompt-cache binding from Gateway blocs. Accepts a binding object or binding_id string; this does not create or load blocs during the run.; `max_iterations` number: Maximum internal ReAct iterations (safety cap). Higher values allow more tool-use steps.; `max_in_tokens` number: Optional per-agent input token budget (max_input_tokens). When set, overrides the run's default _limits.max_input_tokens for the agent sub-run.; `temperature` number: Sampling temperature (0 = deterministic). If unset, uses the node’s configured temperature.; `seed` number: Seed for deterministic sampling (-1 = random/unset). If unset, uses the node’s configured seed.; `thinking` string: Reasoning/thinking control for supported models. If unset, uses the Gateway/runtime default.; `resp_schema` json_schema: Optional JSON Schema object (type=object) the final answer must conform to.
- Outputs: `exec-out` execution; `response` string: Final response text. When resp_schema is provided, the structured object is also exposed on data.; `data` object: Structured response object matching resp_schema. Visible by default when a response schema is configured.; `success` boolean: True if the Agent node completed successfully.; `meta` object: Host-facing meta envelope (schema=abstractcode.agent.v1.meta). Includes provider/model and lightweight execution metadata.; `scratchpad` object: Runtime-owned execution trace/scratchpad for observability (LLM/tool steps, timings). Includes best-effort tool_calls/tool_results extracted post-run.
- Default config: {
  "pinDefaults": {
    "max_iterations": 50
  }
}

### core / Answer User

- Node type: `answer_user`
- Document node: `{"id":"<unique_id>","type":"answer_user"}`
- Utility: Display a message to the user (UI output).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `message` string; `level` string: Message level for hosts (message|warning|error). Defaults to 'message' when unset.
- Outputs: `exec-out` execution; `message` string
- Default config: none

### core / Ask User

- Node type: `ask_user`
- Document node: `{"id":"<unique_id>","type":"ask_user"}`
- Utility: Pause execution and ask the user for input (free text or choices).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `prompt` string; `choices` array
- Outputs: `exec-out` execution; `response` string
- Default config: none

### core / Code

- Node type: `code`
- Document node: `{"id":"<unique_id>","type":"code"}`
- Utility: Run a Python transform body as `transform(_input)` in the Runtime sandbox.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`; body/function with `code`/`function_name`; permissions must remain `sandbox`
- Inputs: `exec-in` execution; `input` any; `permissions` string: Execution policy for this Code node. sandbox is the protected default. full_access requires explicit Runtime/Gateway policy and otherwise fails closed.
- Outputs: `exec-out` execution; `output` any: Value returned by transform(_input).; `success` boolean: True when the transform ran without error.; `execution` object: Execution metrics such as duration_ms, cpu_time_ms, cpu_percent, memory_rss_mb, and memory_rss_delta_mb.
- Default config: {
  "pinDefaults": {
    "permissions": "sandbox"
  },
  "codeBody": "# Available variables:\n# _input (dict)\n# input (any)\n\nreturn _input",
  "functionName": "transform"
}

### core / LLM Call

- Node type: `llm_call`
- Document node: `{"id":"<unique_id>","type":"llm_call"}`
- Utility: Single LLM call (no autonomous loop). Can optionally request tool calls via the tools allowlist.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `use_context` boolean: When true, include this run's active context messages (context.messages) in the LLM request. If the pin is not connected, the node checkbox is used. Default: false.; `context` object: Optional explicit context object for this call (e.g. {messages:[...]}). If provided, context.messages overrides inherited run context messages.; `memory` memory: Memory configuration object (KG/span/session controls). If set, overrides this call’s recall behavior; if unset, runtime defaults apply.; `provider` provider_text: Text/LLM provider id (e.g. LMStudio). If unset, uses the node’s configured provider.; `model` model: Text/LLM model id/name. If unset, uses the node’s configured model.; `system` string: Optional system prompt for this single call.; `prompt` string: User prompt/content for this single call.; `tools` tools: Allowlist of tools exposed to the model as ToolSpecs (model may request tool calls; execution is done via a Tool Calls node).; `prompt_cache_binding` any: Advanced: durable exact-reuse prompt-cache binding from Gateway blocs. Accepts a binding object or binding_id string; this does not create or load blocs during the run.; `max_in_tokens` number: Optional per-call input token budget (max_input_tokens). When set, overrides the run's default _limits.max_input_tokens for this call.; `temperature` number: Sampling temperature (0 = deterministic). If unset, uses the node’s configured temperature.; `seed` number: Seed for deterministic sampling (-1 = random/unset). If unset, uses the node’s configured seed.; `thinking` string: Reasoning/thinking control for supported models. If unset, uses the Gateway/runtime default.; `resp_schema` json_schema: Optional JSON Schema object (type=object) the assistant content must conform to.
- Outputs: `exec-out` execution; `response` string: Assistant text content (best-effort). For tool calls, content may be empty.; `data` object: Structured assistant output object matching resp_schema. Visible by default when a response schema is configured.; `success` boolean: True if the LLM call completed successfully.; `meta` object: Host-facing meta envelope (schema=abstractflow.llm_call.v1.meta). Includes provider/model, usage, trace ids, and lightweight execution metadata.; `tool_calls` array: Normalized tool call requests. This pin exists to make wiring into Tool Calls / Emit Event nodes simpler.
- Default config: none

### core / Model Residency

- Node type: `model_residency`
- Document node: `{"id":"<unique_id>","type":"model_residency"}`
- Utility: Gateway/Runtime model residency controls for listing, loading, and unloading resident models.
- Gateway capability: model_residency
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `operation` string: list_loaded, load, or unload.; `task` string: text_generation, image_generation, image_to_image, image_upscale, text_to_video, image_to_video, tts, stt, or music_generation.; `provider` provider: Provider/backend id to load or filter.; `model` model: Model id to load or filter.
- Outputs: `exec-out` execution; `success` boolean; `affected_models` array; `models` array; `error` string; `warnings` array; `result` object
- Default config: {
  "pinDefaults": {
    "operation": "load",
    "task": "text_generation"
  },
  "effectConfig": {
    "operation": "load",
    "task": "text_generation"
  }
}

### core / Subflow

- Node type: `subflow`
- Document node: `{"id":"<unique_id>","type":"subflow"}`
- Utility: Run another saved workflow (subflow) and return its output object.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`; subflow id is UI-owned; do not create an unconfigured subflow as a finished workflow
- Inputs: `exec-in` execution; `inherit_context` boolean: When true, seed the child run's context.messages from the parent's active context messages. If the pin is not connected, the node checkbox is used. Default: false.; `input` object
- Outputs: `exec-out` execution; `output` object
- Default config: none

### core / Tool Calls

- Node type: `tool_calls`
- Document node: `{"id":"<unique_id>","type":"tool_calls","pin_defaults":{"allowed_tools":["<exact_tool_name>"]}}`
- Utility: Execute one or more tool calls via the runtime. Outputs per-call results and a success boolean.
- Gateway capability: tools
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`; must include `pin_defaults.allowed_tools` when the node is created
- Inputs: `exec-in` execution; `tool_calls` array: List of tool call requests. Each entry shape: {name, arguments, call_id?}. Often comes from LLM Call.tool_calls.; `allowed_tools` array: Optional allowlist of tool names enforced by the runtime effect handler (empty list => allow none). If not connected, the node config (if any) is used.
- Outputs: `exec-out` execution; `results` array: Per-call results in input order. Each entry shape: {call_id, name, success, output, error}. When success=true, output contains the tool output and error is null; when success=false, error contains the failure message and output is null (or best-effort structured output for some tools).; `success` boolean: Aggregate: true only if all per-call results have success=true (see results[].success/results[].error for per-call failures).
- Default config: none

### data / Agent Trace Report

- Node type: `agent_trace_report`
- Document node: `{"id":"<unique_id>","type":"agent_trace_report"}`
- Utility: Render an agent scratchpad (runtime-owned node_traces) into a condensed Markdown report of actions and tool results.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `scratchpad` object: Agent scratchpad object (typically contains node_traces).
- Outputs: `result` string
- Default config: none

### data / Array Append

- Node type: `array_append`
- Document node: `{"id":"<unique_id>","type":"array_append"}`
- Utility: Append an item to an array (returns a new array).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `array` array; `item` any
- Outputs: `result` array
- Default config: none

### data / Array Concat

- Node type: `array_concat`
- Document node: `{"id":"<unique_id>","type":"array_concat"}`
- Utility: Concatenate arrays (a then b).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `a` array; `b` array
- Outputs: `result` array
- Default config: none

### data / Array Dedup

- Node type: `array_dedup`
- Document node: `{"id":"<unique_id>","type":"array_dedup"}`
- Utility: Stable-order dedup for arrays (optionally by key path).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `array` array; `key` string
- Outputs: `result` array
- Default config: none

### data / Filter Array

- Node type: `array_filter`
- Document node: `{"id":"<unique_id>","type":"array_filter"}`
- Utility: Filter array items where item[key] == value (or item == value).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `items` array; `key` string; `value` any
- Outputs: `result` array
- Default config: none

### data / Array Length

- Node type: `array_length`
- Document node: `{"id":"<unique_id>","type":"array_length"}`
- Utility: Return the length of an array.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `array` array
- Outputs: `result` number
- Default config: none

### data / Map Array

- Node type: `array_map`
- Document node: `{"id":"<unique_id>","type":"array_map"}`
- Utility: Map array items by extracting a field (key) from objects.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `items` array; `key` string
- Outputs: `result` array
- Default config: none

### data / Break Object

- Node type: `break_object`
- Document node: `{"id":"<unique_id>","type":"break_object"}`
- Utility: Expose selected fields of an object as individual output pins (configured paths).
- Gateway capability: none
- Dynamic pin policy: dynamic outputs via the document `outputs` list (also drives `breakConfig.selectedPaths`)
- Authorable config: input defaults with `pin_defaults`
- Inputs: `object` object: Input object to decompose into selected output fields.
- Outputs: none
- Default config: {
  "breakConfig": {
    "selectedPaths": []
  }
}

### data / Coalesce

- Node type: `coalesce`
- Document node: `{"id":"<unique_id>","type":"coalesce"}`
- Utility: Return the first non-null value (A, then B, ...).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `a` any; `b` any
- Outputs: `result` any
- Default config: none

### data / Concat

- Node type: `concat`
- Document node: `{"id":"<unique_id>","type":"concat"}`
- Utility: Concatenate two strings.
- Gateway capability: none
- Dynamic pin policy: dynamic inputs via the document `inputs` list
- Authorable config: input defaults with `pin_defaults`; separator with `concat_separator`
- Inputs: `a` string; `b` string
- Outputs: `result` string
- Default config: {
  "concatConfig": {
    "separator": " "
  }
}

### data / Contains

- Node type: `contains`
- Document node: `{"id":"<unique_id>","type":"contains"}`
- Utility: True if text contains pattern.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `text` string; `pattern` string
- Outputs: `result` boolean
- Default config: none

### data / Format Tool Results

- Node type: `format_tool_results`
- Document node: `{"id":"<unique_id>","type":"format_tool_results"}`
- Utility: Convert Tool Calls results [{call_id,name,success,output,error}, ...] into a condensed human-readable digest string.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `tool_results` array: Array of tool results (typically from Tool Calls.results).
- Outputs: `result` string
- Default config: none

### data / Format

- Node type: `format`
- Document node: `{"id":"<unique_id>","type":"format"}`
- Utility: Python-style string format: template.format(**values).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `template` string; `values` object
- Outputs: `result` string
- Default config: none

### data / Get Element

- Node type: `get_element`
- Document node: `{"id":"<unique_id>","type":"get_element"}`
- Utility: Get a single array element by index (supports negative indices).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `array` array: Input array (list/tuple).; `index` number: 0-based index (negative allowed; -1 is last).; `default` any: Fallback value when index is invalid (default null).
- Outputs: `result` any: Element value (or default when not found).; `found` boolean: True when index is valid for the given array.
- Default config: none

### data / Get Random Element

- Node type: `get_random_element`
- Document node: `{"id":"<unique_id>","type":"get_random_element"}`
- Utility: Pick a random element from an array.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `array` array: Input array (list/tuple).; `default` any: Fallback value when the array is empty (default null).
- Outputs: `result` any: Random element (or default when not found).; `found` boolean: True when an element was selected.
- Default config: none

### data / Get Property

- Node type: `get`
- Document node: `{"id":"<unique_id>","type":"get"}`
- Utility: Safely read a nested path from an object (dot/bracket path) with an optional default.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `object` object; `key` string; `default` any
- Outputs: `value` any
- Default config: none

### data / Has Tools

- Node type: `has_tools`
- Document node: `{"id":"<unique_id>","type":"has_tools"}`
- Utility: True if the input array has at least one element (commonly: LLM tool_calls).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `array` array
- Outputs: `result` boolean
- Default config: none

### data / Is Empty

- Node type: `is_empty_string`
- Document node: `{"id":"<unique_id>","type":"is_empty_string"}`
- Utility: True if text is empty.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `text` string
- Outputs: `result` boolean
- Default config: none

### data / Join

- Node type: `join`
- Document node: `{"id":"<unique_id>","type":"join"}`
- Utility: Join array items into a string using a delimiter.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `items` array; `delimiter` string
- Outputs: `result` string
- Default config: none

### data / Length

- Node type: `length`
- Document node: `{"id":"<unique_id>","type":"length"}`
- Utility: String length (number of characters).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `text` string
- Outputs: `result` number
- Default config: none

### data / Lowercase

- Node type: `lowercase`
- Document node: `{"id":"<unique_id>","type":"lowercase"}`
- Utility: Convert text to lowercase.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `text` string
- Outputs: `result` string
- Default config: none

### data / Make Array

- Node type: `make_array`
- Document node: `{"id":"<unique_id>","type":"make_array"}`
- Utility: Build an array from 1+ inputs in pin order (Blueprint-style). Skips null/unset inputs.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `a` any
- Outputs: `result` array
- Default config: none

### data / Make Context

- Node type: `make_context`
- Document node: `{"id":"<unique_id>","type":"make_context"}`
- Utility: Build a context object {task, messages, ...context_extra}.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `task` string: Task / user request string (context.task).; `messages` array: Conversation messages list (context.messages).; `context_extra` object: Optional extra context fields merged into the context (task/messages win). Common: session, attachments.
- Outputs: `context` object: Context object {task, messages, ...context_extra}.
- Default config: none

### data / Make Meta

- Node type: `make_meta`
- Document node: `{"id":"<unique_id>","type":"make_meta"}`
- Utility: Build a host-facing meta envelope (Agent / LLM Call).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `schema` string: Schema identifier (default: abstractcode.agent.v1.meta).; `version` number: Schema version number (default: 1).; `output_mode` string: Output mode: unstructured | structured.; `provider` provider_text: Text/LLM provider id/name (e.g. lmstudio).; `model` model: Text/LLM model id/name.; `sub_run_id` string: Optional sub-run id (Agent nodes).; `iterations` number: Optional iteration count (Agent nodes).; `tool_calls` number: Optional tool call count.; `tool_results` number: Optional tool result count.; `finish_reason` string: Optional finish reason (LLM Call nodes).; `gen_time` number: Optional generation time (LLM Call nodes).; `ttft_ms` number: Optional time-to-first-token in ms (LLM Call nodes).; `usage` object: Usage object (e.g. {input_tokens, output_tokens}).; `trace` object: Optional trace object (e.g. {trace_id:"..."}). Treat as opaque.; `warnings` array: Optional list of warning strings.; `debug` object: Optional debug payload (host-facing).; `extra` object: Optional extra fields merged into the meta object (reserved keys win).
- Outputs: `meta` object: Meta object (portable host-friendly envelope).
- Default config: none

### data / Build JSON

- Node type: `make_object`
- Document node: `{"id":"<unique_id>","type":"make_object"}`
- Utility: Build a JSON object from live input pins. Use the JSON literal node for static objects.
- Gateway capability: none
- Dynamic pin policy: dynamic inputs via the document `inputs` list
- Authorable config: input defaults with `pin_defaults`
- Inputs: `value` any: First object field. Rename/add fields in the Properties panel.
- Outputs: `result` object
- Default config: none

### data / Make Scratchpad

- Node type: `make_scratchpad`
- Document node: `{"id":"<unique_id>","type":"make_scratchpad"}`
- Utility: Build a scratchpad/trace envelope (commonly from Agent outputs).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `sub_run_id` string: Optional sub-run id associated with the trace.; `workflow_id` string: Optional workflow id associated with the trace.; `task` string: Agent task/prompt string for this run.; `messages` array: Agent-internal transcript messages for this run.; `context_extra` object: Additional context fields passed into the agent (excluding task/messages).; `node_traces` object: Per-node trace mapping (node_id -> trace object).; `steps` array: Flattened trace steps list (optional; used by some UIs).; `tool_calls` array: Tool calls extracted from steps (best-effort).; `tool_results` array: Tool results extracted from steps (best-effort).
- Outputs: `scratchpad` object: Scratchpad object containing trace info.
- Default config: none

### data / Merge Objects

- Node type: `merge`
- Document node: `{"id":"<unique_id>","type":"merge"}`
- Utility: Shallow merge two objects (b overrides a).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `a` object; `b` object
- Outputs: `result` object
- Default config: none

### data / Parse JSON

- Node type: `parse_json`
- Document node: `{"id":"<unique_id>","type":"parse_json"}`
- Utility: Parse JSON (or JSON-ish) text into an object/array suitable for downstream nodes.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `text` string
- Outputs: `result` object
- Default config: none

### data / Replace

- Node type: `replace`
- Document node: `{"id":"<unique_id>","type":"replace"}`
- Utility: Replace pattern with replacement (mode: first|all).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `text` string; `pattern` string; `replacement` string; `mode` string: Replacement mode: 'first' or 'all' (default: all).
- Outputs: `result` string
- Default config: none

### data / Set Property

- Node type: `set`
- Document node: `{"id":"<unique_id>","type":"set"}`
- Utility: Pure transform: return a new object with key set. To persist state, use Set Variable (dotted path) or Set Variable Property.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `object` object; `key` string; `value` any
- Outputs: `result` object
- Default config: none

### data / Split

- Node type: `split`
- Document node: `{"id":"<unique_id>","type":"split"}`
- Utility: Split text by a delimiter into an array (with trimming/drop-empty defaults).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `text` string; `delimiter` string
- Outputs: `result` array
- Default config: none

### data / String Template

- Node type: `string_template`
- Document node: `{"id":"<unique_id>","type":"string_template"}`
- Utility: Render a template like "Hello {{user.name}}" using a vars object (supports filters).
- Gateway capability: none
- Dynamic pin policy: dynamic inputs via the document `inputs` list
- Authorable config: input defaults with `pin_defaults`; template text with `literal` or `pin_defaults.template`
- Inputs: `template` string; `vars` object
- Outputs: `result` string
- Default config: none

### data / Stringify JSON

- Node type: `stringify_json`
- Document node: `{"id":"<unique_id>","type":"stringify_json"}`
- Utility: Render a JSON value (object/array/scalar) into a string. Mode: none | beautify | minified.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `value` any: JSON value (or JSON-ish string) to stringify.; `mode` string: Rendering mode: none | beautify | minified. Default beautify.
- Outputs: `result` string
- Default config: none

### data / Substring

- Node type: `substring`
- Document node: `{"id":"<unique_id>","type":"substring"}`
- Utility: Extract a substring by start/end indices (end is optional).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `text` string; `start` number; `end` number
- Outputs: `result` string
- Default config: none

### data / Trim

- Node type: `trim`
- Document node: `{"id":"<unique_id>","type":"trim"}`
- Utility: Trim whitespace from both ends of a string.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `text` string
- Outputs: `result` string
- Default config: none

### data / Uppercase

- Node type: `uppercase`
- Document node: `{"id":"<unique_id>","type":"uppercase"}`
- Utility: Convert text to UPPERCASE.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `text` string
- Outputs: `result` string
- Default config: none

### events / Emit Event

- Node type: `emit_event`
- Document node: `{"id":"<unique_id>","type":"emit_event"}`
- Utility: Emit a durable event (scope/session) with payload. Useful for cross-node or cross-agent signaling.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `name` string; `scope` string; `payload` any; `session_id` string
- Outputs: `exec-out` execution; `delivered` number; `delivered_to` array; `wait_key` string
- Default config: {
  "effectConfig": {
    "name": "my_event",
    "scope": "session",
    "sessionId": ""
  }
}

### events / On Agent Message

- Node type: `on_agent_message`
- Document node: `{"id":"<unique_id>","type":"on_agent_message"}`
- Utility: Entry point triggered by an agent-to-agent message (broadcast or direct).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: event settings with `event`
- Inputs: none
- Outputs: `exec-out` execution; `sender` agent; `message` string; `channel` string
- Default config: none

### events / On Event

- Node type: `on_event`
- Document node: `{"id":"<unique_id>","type":"on_event"}`
- Utility: Entry point triggered by a durable custom event. Outputs event metadata + payload.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`; event settings with `event`
- Inputs: `scope` string
- Outputs: `exec-out` execution; `event` object; `payload` any
- Default config: {
  "eventConfig": {
    "name": "my_event",
    "scope": "session"
  }
}

### events / On Flow End

- Node type: `on_flow_end`
- Document node: `{"id":"<unique_id>","type":"on_flow_end"}`
- Utility: Terminal node. End execution and expose the flow result via upstream data wiring.
- Gateway capability: none
- Dynamic pin policy: dynamic inputs via the document `inputs` list
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution
- Outputs: none
- Default config: none

### events / On Flow Start

- Node type: `on_flow_start`
- Document node: `{"id":"<unique_id>","type":"on_flow_start"}`
- Utility: Entry point for a workflow run. Emits exec-out and any configured inputs as outputs.
- Gateway capability: none
- Dynamic pin policy: dynamic outputs via the document `outputs` list
- Authorable config: no node-specific document config beyond label/pin_defaults
- Inputs: none
- Outputs: `exec-out` execution
- Default config: none

### events / On Schedule

- Node type: `on_schedule`
- Document node: `{"id":"<unique_id>","type":"on_schedule"}`
- Utility: Entry point triggered by a schedule (timestamp or recurring). Outputs the trigger time.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`; event settings with `event`
- Inputs: `schedule` string (timestamp); `recurrent` boolean
- Outputs: `exec-out` execution; `timestamp` string (time)
- Default config: {
  "eventConfig": {
    "schedule": "15s",
    "recurrent": true
  }
}

### events / On User Request

- Node type: `on_user_request`
- Document node: `{"id":"<unique_id>","type":"on_user_request"}`
- Utility: Entry point for a run started from a user prompt. Outputs the user message and initial context.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: no node-specific document config beyond label/pin_defaults
- Inputs: none
- Outputs: `exec-out` execution; `message` string; `context` object
- Default config: none

### events / System Date/Time

- Node type: `system_datetime`
- Document node: `{"id":"<unique_id>","type":"system_datetime"}`
- Utility: Return current time metadata (ISO string, timezone, UTC offset, locale).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: no node-specific document config beyond label/pin_defaults
- Inputs: none
- Outputs: `iso` string; `timezone` string; `utc_offset_minutes` number; `locale` string
- Default config: none

### events / Wait Event

- Node type: `wait_event`
- Document node: `{"id":"<unique_id>","type":"wait_event"}`
- Utility: Pause the workflow until an event matching event_key is received, then resume with event_data. Optional pins (prompt/choices/allow_free_text) enable durable “ask + wait” UX for hosts like AbstractCode.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `event_key` string; `prompt` string; `choices` array; `allow_free_text` boolean
- Outputs: `exec-out` execution; `event_data` object
- Default config: none

### events / Delay

- Node type: `wait_until`
- Document node: `{"id":"<unique_id>","type":"wait_until"}`
- Utility: Pause execution for a duration (seconds), then continue.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `duration` number
- Outputs: `exec-out` execution
- Default config: none

### literals / JSON Schema

- Node type: `json_schema`
- Document node: `{"id":"<unique_id>","type":"json_schema"}`
- Utility: Define a JSON Schema object for schema-constrained responses. Connect to `resp_schema` on LLM Call / Agent nodes.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: literal value with `literal`
- Inputs: none
- Outputs: `value` json_schema (schema)
- Default config: {
  "literalValue": {
    "type": "object",
    "properties": {
      "data": {
        "type": "string"
      }
    },
    "required": [
      "data"
    ]
  }
}

### literals / Array

- Node type: `literal_array`
- Document node: `{"id":"<unique_id>","type":"literal_array","template":"Array"}`
- Utility: Array literal value.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: select with `"template": "Array"`; literal value with `literal`
- Inputs: none
- Outputs: `value` array
- Default config: none

### literals / Assertions

- Node type: `literal_array`
- Document node: `{"id":"<unique_id>","type":"literal_array","template":"Assertions"}`
- Utility: KG assertion list literal value (assertion[]).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: select with `"template": "Assertions"`; literal value with `literal`
- Inputs: none
- Outputs: `value` assertions (assertions)
- Default config: none

### literals / Boolean

- Node type: `literal_boolean`
- Document node: `{"id":"<unique_id>","type":"literal_boolean"}`
- Utility: Boolean literal value.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: literal value with `literal`
- Inputs: none
- Outputs: `value` boolean
- Default config: {
  "literalValue": false
}

### literals / Assertion

- Node type: `literal_json`
- Document node: `{"id":"<unique_id>","type":"literal_json","template":"Assertion"}`
- Utility: KG assertion literal value (subject/predicate/object + optional metadata).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: select with `"template": "Assertion"`; literal value with `literal`
- Inputs: none
- Outputs: `value` assertion (assertion)
- Default config: none

### literals / JSON

- Node type: `literal_json`
- Document node: `{"id":"<unique_id>","type":"literal_json","template":"JSON"}`
- Utility: Object (JSON) literal value.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: select with `"template": "JSON"`; literal value with `literal`
- Inputs: none
- Outputs: `value` object
- Default config: none

### literals / Memory

- Node type: `literal_json`
- Document node: `{"id":"<unique_id>","type":"literal_json","template":"Memory"}`
- Utility: Memory configuration object for Agent/LLM Call recall and KG settings.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: select with `"template": "Memory"`; literal value with `literal`
- Inputs: none
- Outputs: `value` memory (memory)
- Default config: {
  "literalValue": {
    "use_session_attachments": true,
    "use_span_memory": false,
    "use_semantic_search": false,
    "use_kg_memory": true,
    "memory_query": "",
    "memory_scope": "session",
    "recall_level": "standard",
    "max_span_messages": 24,
    "kg_max_input_tokens": 1200,
    "kg_limit": 80,
    "kg_min_score": 0.35,
    "kg_write_scope": "session",
    "kg_domain_focus": "",
    "kg_max_out_tokens": 0
  }
}

### literals / Number

- Node type: `literal_number`
- Document node: `{"id":"<unique_id>","type":"literal_number"}`
- Utility: Number literal value.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: literal value with `literal`
- Inputs: none
- Outputs: `value` number
- Default config: {
  "literalValue": 0
}

### literals / String

- Node type: `literal_string`
- Document node: `{"id":"<unique_id>","type":"literal_string"}`
- Utility: String literal value.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: literal value with `literal`
- Inputs: none
- Outputs: `value` string
- Default config: {
  "literalValue": ""
}

### literals / Provider Catalog

- Node type: `provider_catalog`
- Document node: `{"id":"<unique_id>","type":"provider_catalog"}`
- Utility: List available LLM providers (optionally filtered by an allowlist).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `allowed_providers` array
- Outputs: `providers` array
- Default config: none

### literals / Models Catalog

- Node type: `provider_models`
- Document node: `{"id":"<unique_id>","type":"provider_models"}`
- Utility: List models for a provider. Optionally restrict the list by capability route and selected allowed models.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`; provider models config is UI-owned; use provider/capability pins when possible
- Inputs: `provider` provider_text: Provider id to list models for. If this pin is not connected, the node’s selected provider is used.; `capability_route` string: Optional comma-separated route filter such as output.text or input.image,output.text.
- Outputs: `provider` provider_text: Resolved provider id used to compute the models list.; `models` array: Array of model ids/names for the provider (filtered to the selected allowed models when set).
- Default config: {
  "providerModelsConfig": {
    "provider": "",
    "capabilityRoute": "output.text",
    "allowedModels": []
  }
}

### literals / Tool Parameters

- Node type: `tool_parameters`
- Document node: `{"id":"<unique_id>","type":"tool_parameters"}`
- Utility: Pick a tool and set its arguments (typed + defaults). Outputs a tool call object for Tool Calls.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: tool and argument pins with `tool` + `tool_parameters`
- Inputs: none
- Outputs: `tool_call` object: Single tool call request object: {name, arguments, call_id?}.
- Default config: {
  "toolParametersConfig": {
    "tool": ""
  }
}

### literals / Tools Allowlist

- Node type: `tools_allowlist`
- Document node: `{"id":"<unique_id>","type":"tools_allowlist"}`
- Utility: Select an allowlist of tool names once and reuse it across LLM/Agent/Tool Calls nodes.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: tool names array with `literal`
- Inputs: none
- Outputs: `tools` tools
- Default config: none

### math / Absolute

- Node type: `abs`
- Document node: `{"id":"<unique_id>","type":"abs"}`
- Utility: Absolute value of a number.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `value` number
- Outputs: `result` number
- Default config: none

### math / Add

- Node type: `add`
- Document node: `{"id":"<unique_id>","type":"add"}`
- Utility: Add two numbers.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `a` number; `b` number
- Outputs: `result` number
- Default config: none

### math / Divide

- Node type: `divide`
- Document node: `{"id":"<unique_id>","type":"divide"}`
- Utility: Compute a / b (error on division by zero).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `a` number; `b` number
- Outputs: `result` number
- Default config: none

### math / Modulo

- Node type: `modulo`
- Document node: `{"id":"<unique_id>","type":"modulo"}`
- Utility: Compute a % b (error on modulo by zero).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `a` number; `b` number
- Outputs: `result` number
- Default config: none

### math / Multiply

- Node type: `multiply`
- Document node: `{"id":"<unique_id>","type":"multiply"}`
- Utility: Multiply two numbers.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `a` number; `b` number
- Outputs: `result` number
- Default config: none

### math / Power

- Node type: `power`
- Document node: `{"id":"<unique_id>","type":"power"}`
- Utility: Compute base ** exp.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `base` number; `exp` number
- Outputs: `result` number
- Default config: none

### math / Random Float

- Node type: `random_float`
- Document node: `{"id":"<unique_id>","type":"random_float"}`
- Utility: Generate a random float in [min, max].
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `min` number: Minimum (inclusive).; `max` number: Maximum (inclusive).
- Outputs: `result` number
- Default config: none

### math / Random Int

- Node type: `random_int`
- Document node: `{"id":"<unique_id>","type":"random_int"}`
- Utility: Generate a random integer in [min, max] (inclusive).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `min` number: Minimum integer (inclusive).; `max` number: Maximum integer (inclusive).
- Outputs: `result` number
- Default config: none

### math / Round

- Node type: `round`
- Document node: `{"id":"<unique_id>","type":"round"}`
- Utility: Round a number to N decimals.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `value` number; `decimals` number
- Outputs: `result` number
- Default config: none

### math / Subtract

- Node type: `subtract`
- Document node: `{"id":"<unique_id>","type":"subtract"}`
- Utility: Compute a - b.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `a` number; `b` number
- Outputs: `result` number
- Default config: none

### media / Edit Image

- Node type: `edit_image`
- Document node: `{"id":"<unique_id>","type":"edit_image"}`
- Utility: Edit or transform an input image through Gateway image editing and return an image artifact.
- Gateway capability: edited_image
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `prompt` string: Instruction for the image edit.; `image_artifact` artifact_image: Source image artifact ref. Wire from Generate Image, or use an uploaded/selected artifact.; `mask_artifact` artifact_image: Optional mask artifact ref.; `image_provider` provider_image (provider): Optional image edit provider/backend.; `image_model` model (model): Optional image edit model id for the selected provider.; `format` string: png, jpg, or webp.; `seed` number; `steps` number; `guidance_scale` number (guidance); `strength` number: Optional edit strength for image-to-image backends.; `negative_prompt` string (negative); `extra` object: Optional provider-specific image edit options.
- Outputs: `exec-out` execution; `image_artifact` artifact_image: Artifact ref for the edited image.; `artifact_ref` artifact; `artifact_id` string; `content_type` string; `outputs` object; `meta` object; `success` boolean
- Default config: {
  "pinDefaults": {
    "format": "png",
    "steps": 20
  }
}

### media / Generate Image

- Node type: `generate_image`
- Document node: `{"id":"<unique_id>","type":"generate_image"}`
- Utility: Generate an image through Gateway vision capability and return an artifact reference.
- Gateway capability: generated_image
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `prompt` string: Image prompt.; `image_provider` provider_image (provider): Optional image provider/backend.; `image_model` model (model): Optional image model id for the selected image provider.; `width` number; `height` number; `format` string: png, jpg, or webp.; `seed` number; `steps` number; `guidance_scale` number (guidance); `negative_prompt` string (negative)
- Outputs: `exec-out` execution; `image_artifact` artifact_image: Artifact ref for the generated image.; `artifact_ref` artifact; `artifact_id` string; `content_type` string; `outputs` object; `meta` object; `success` boolean
- Default config: {
  "pinDefaults": {
    "format": "png",
    "steps": 20
  }
}

### media / Generate Music

- Node type: `generate_music`
- Document node: `{"id":"<unique_id>","type":"generate_music"}`
- Utility: Generate music through Gateway music capability and return an audio artifact.
- Gateway capability: generated_music
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `prompt` string: Music prompt.; `music_provider` provider_music (provider): Optional Gateway music backend/provider.; `music_model` model (model): Optional music model id for the selected music provider.; `lyrics` string: Optional lyrics for vocal music backends.; `duration_s` number: Optional requested duration in seconds.; `format` string: wav, mp3, or flac.; `seed` number; `num_inference_steps` number (steps); `guidance_scale` number (guidance); `instrumental` boolean; `enhance_prompt` boolean (enhance); `structure_prompt` boolean (structure); `auto_lyrics` boolean; `text_planner_mode` string (planner); `vocal_language` string (language); `negative_prompt` string (negative); `sample_rate` number; `bpm` number; `keyscale` string (key); `timesignature` string (time); `composition_plan` object (plan); `positive_styles` array (styles); `negative_styles` array (avoid_styles); `planning` boolean; `extra` object: Optional provider-specific music-generation options.
- Outputs: `exec-out` execution; `music_artifact` artifact_audio: Artifact ref for generated music.; `audio_artifact` artifact_audio: Alias artifact ref for audio-compatible downstream nodes.; `artifact_ref` artifact; `artifact_id` string; `content_type` string; `outputs` object; `meta` object; `success` boolean
- Default config: {
  "pinDefaults": {
    "format": "wav"
  }
}

### media / Generate Video

- Node type: `generate_video`
- Document node: `{"id":"<unique_id>","type":"generate_video"}`
- Utility: Generate a video through Gateway vision capability and return a video artifact.
- Gateway capability: generated_video
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `prompt` string: Video prompt.; `video_provider` provider_video (provider): Optional video provider/backend.; `video_model` model (model): Optional video model id for the selected video provider.; `width` number; `height` number; `frames` number; `fps` number; `format` string: mp4, mov, or gif.; `seed` number; `steps` number; `guidance_scale` number (guidance); `negative_prompt` string (negative); `extra` object: Optional provider-specific video-generation options.
- Outputs: `exec-out` execution; `video_artifact` artifact_video: Artifact ref for the generated video.; `artifact_ref` artifact; `artifact_id` string; `content_type` string; `outputs` object; `meta` object; `success` boolean
- Default config: {
  "pinDefaults": {
    "format": "mp4",
    "width": 512,
    "height": 512,
    "frames": 41,
    "fps": 24,
    "steps": 20,
    "guidance_scale": 5
  }
}

### media / Generate Voice

- Node type: `generate_voice`
- Document node: `{"id":"<unique_id>","type":"generate_voice"}`
- Utility: Generate speech audio through Gateway voice capability and return an audio artifact.
- Gateway capability: generated_voice
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `text` string: Text to speak.; `tts_provider` provider_voice (provider): Optional media/voice provider id.; `tts_model` model (model): Optional TTS model/language/voice model for the selected provider.; `voice` string: Optional base or cloned voice for the selected provider.; `profile` string: Optional voice profile override.; `quality_preset` string (quality): Optional AbstractVoice quality preset: low, standard, or high.; `format` string: wav or mp3.; `speed` number; `instructions` string
- Outputs: `exec-out` execution; `audio_artifact` artifact_audio: Artifact ref for generated audio.; `artifact_ref` artifact; `artifact_id` string; `content_type` string; `outputs` object; `meta` object; `success` boolean
- Default config: {
  "pinDefaults": {
    "format": "wav",
    "quality_preset": "standard",
    "speed": 1
  }
}

### media / Image To Video

- Node type: `image_to_video`
- Document node: `{"id":"<unique_id>","type":"image_to_video"}`
- Utility: Animate an input image through Gateway image-to-video capability and return a video artifact.
- Gateway capability: image_to_video
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `prompt` string: Instruction for the image-to-video generation.; `source_image` artifact_image: Source image artifact ref.; `video_provider` provider_video (provider): Optional image-to-video provider/backend.; `video_model` model (model): Optional image-to-video model id for the selected provider.; `width` number; `height` number; `frames` number; `fps` number; `format` string: mp4, mov, or gif.; `seed` number; `steps` number; `guidance_scale` number (guidance); `strength` number: Optional conditioning strength for image-to-video backends.; `negative_prompt` string (negative); `extra` object: Optional provider-specific image-to-video options.
- Outputs: `exec-out` execution; `video_artifact` artifact_video: Artifact ref for the generated video.; `artifact_ref` artifact; `artifact_id` string; `content_type` string; `outputs` object; `meta` object; `success` boolean
- Default config: {
  "pinDefaults": {
    "format": "mp4",
    "width": 512,
    "height": 512,
    "frames": 41,
    "fps": 24,
    "steps": 20,
    "guidance_scale": 5
  }
}

### media / Listen Voice

- Node type: `listen_voice`
- Document node: `{"id":"<unique_id>","type":"listen_voice"}`
- Utility: Pause the workflow and ask the host UI to capture a voice/audio response.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `prompt` string; `language` string; `stt_provider` provider_voice (provider): Optional STT provider id for host-side voice transcription.; `stt_model` model (model): Optional STT model id for the selected voice provider.; `max_duration_s` number; `wait_key` string
- Outputs: `exec-out` execution; `audio_artifact` artifact_audio; `artifact_ref` artifact; `artifact_id` string; `text` string
- Default config: {
  "pinDefaults": {
    "max_duration_s": 30
  }
}

### media / Transcribe Audio

- Node type: `transcribe_audio`
- Document node: `{"id":"<unique_id>","type":"transcribe_audio"}`
- Utility: Transcribe an audio artifact through Gateway audio capability.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `audio_artifact` artifact_audio: Audio artifact ref.; `stt_provider` provider_voice (provider): Optional audio/STT provider id.; `language` string; `stt_model` model (model): Optional STT model id for the selected voice provider.; `prompt` string; `format` string; `temperature` number
- Outputs: `exec-out` execution; `text` string; `transcript_artifact` artifact_text; `artifact_ref` artifact; `artifact_id` string; `meta` object; `success` boolean
- Default config: {
  "pinDefaults": {
    "format": "json",
    "temperature": 0
  }
}

### media / Restore / Upscale Image

- Node type: `upscale_image`
- Document node: `{"id":"<unique_id>","type":"upscale_image"}`
- Utility: Restore or upscale an input image through Gateway image upscaling and return an image artifact.
- Gateway capability: upscaled_image
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `image_artifact` artifact_image: Source image artifact ref. Wire from an image node, or use an uploaded/selected artifact.; `image_provider` provider_image (provider): Optional image upscaler provider/backend.; `image_model` model (model): Optional image upscaler model id for the selected provider.; `scale` string: Upscale factor such as 2x.; `resolution` string: Target shortest edge in pixels or scale factor such as 2x.; `softness` number: Optional restoration softness in [0.0, 1.0].; `seed` number; `quantize` number: Optional backend quantization hint.; `vae_tiling` boolean: Force tiled VAE encode/decode when true, explicitly disable it when false, or leave unset for the MLX-Gen SeedVR2 runtime policy.; `format` string: png, jpg, or webp.; `extra` object: Optional provider-specific image upscaler options.
- Outputs: `exec-out` execution; `image_artifact` artifact_image: Artifact ref for the upscaled image.; `artifact_ref` artifact; `artifact_id` string; `content_type` string; `outputs` object; `meta` object; `success` boolean
- Default config: {
  "pinDefaults": {
    "format": "png",
    "resolution": "2x",
    "softness": 0.25
  }
}

### memory / MemAct Compose

- Node type: `memact_compose`
- Document node: `{"id":"<unique_id>","type":"memact_compose"}`
- Utility: Map KG query results (packets/items) into MemAct CURRENT CONTEXT and render a MemAct system prompt for inspection.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `kg_result` object: Connect memory_kg_query.raw (or the full node output).; `stimulus` string: Optional stimulus label for trace (defaults to query_text/task).; `marker` string: Prefix marker used to replace previous KG-composed context entries. Default: KG:; `max_items` number: Optional cap on inserted packets (after packetization/packing).
- Outputs: `exec-out` execution; `ok` boolean: True when composition succeeded.; `delta` object: MemAct delta applied to Active Memory (current_context added/removed).; `trace` object: JSON-safe composition trace (selected packets, budgets, warnings).; `active_memory` object: Raw MemAct Active Memory object (run.vars._runtime.active_memory).; `memact_blocks` array: Rendered MemAct block list (for UI/debug).; `memact_system_prompt` string: Rendered MemAct system prompt (memory blueprints + blocks).
- Default config: none

### memory / Compact memory

- Node type: `memory_compact`
- Document node: `{"id":"<unique_id>","type":"memory_compact"}`
- Utility: Runtime-owned compaction: archives older messages into an artifact span and inserts a summary message with an LLM-visible span_id handle.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `preserve_recent` number: Number of most recent non-system messages to keep verbatim (default 6).; `compression_mode` string: light | standard | heavy (default standard).; `focus` string: Optional topic/focus hint for the compaction summary.
- Outputs: `exec-out` execution; `span_id` string: The archived conversation span_id (artifact id). Use it for tagging or recall.
- Default config: none

### memory / KG Assert

- Node type: `memory_kg_assert`
- Document node: `{"id":"<unique_id>","type":"memory_kg_assert"}`
- Utility: Append triple assertions into AbstractMemory (provenance-first, no destructive updates).
- Gateway capability: kg_memory
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `assertions` assertions: List of {subject,predicate,object,...} assertion objects.; `scope` string: run | session | global. Determines the owner_id when not explicitly provided.; `span_id` string: Optional provenance pointer to a runtime span/artifact id.; `owner_id` string: Optional explicit owner id override (advanced; normally derived from scope).; `attributes_defaults` object: Optional attributes merged into each assertion.attributes (defaults only; assertion keys win).; `allow_custom_predicates` boolean: If true, allow custom predicates under the ex:* namespace (advanced; default false).
- Outputs: `exec-out` execution; `assertion_ids` array: IDs assigned by the store (implementation-specific).; `count` number: Number of asserted triples.; `ok` boolean: True when assertion succeeded.
- Default config: none

### memory / KG Query

- Node type: `memory_kg_query`
- Document node: `{"id":"<unique_id>","type":"memory_kg_query"}`
- Utility: Query the AbstractMemory triple store (pattern filters + optional semantic query_text).
- Gateway capability: kg_memory
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `query_text` string: Optional semantic query. Requires embeddings to be configured in the host.; `subject` string: Optional subject filter (case-insensitive exact match).; `predicate` string: Optional predicate filter (case-insensitive exact match).; `object` string: Optional object filter (case-insensitive exact match).; `since` string: Optional observed_at lower bound (ISO8601).; `until` string: Optional observed_at upper bound (ISO8601).; `active_at` string: Optional validity window selector (ISO8601). Filters assertions active at that time.; `scope` string: run | session | global | all (fan-out over run+session+global).; `recall_level` string: Recall effort policy: urgent | standard | deep (optional; when set, applies bounded budgets and no-silent-downgrade semantics).; `owner_id` string: Optional explicit owner id override (advanced; normally derived from scope).; `min_score` number: Optional cosine similarity threshold (semantic query_text only). Range ~[-1..1]; start with 0.2–0.4.; `max_input_tokens` number: Optional token budget for Active Memory packing (KG → prompt). If set, returns active_memory_text + packets.; `model` model: Optional text model id used for token estimation (improves budgeting accuracy).; `limit` number: Max assertions to return (default 100).
- Outputs: `exec-out` execution; `items` assertions: List of triple assertions (dicts).; `count` number: Number of returned assertions.; `ok` boolean: True when query succeeded.; `packets` array: Packed Memory Packets (v0) for Active Memory injection (when max_input_tokens is set).; `active_memory_text` string: Token-budgeted Active Memory block (when max_input_tokens is set).; `packed_count` number: Number of packets included in active_memory_text.; `dropped` number: Packets dropped due to the Active Memory token budget.; `estimated_tokens` number: Estimated token count of active_memory_text.; `raw` object: Raw result object (debug).
- Default config: none

### memory / KG Resolve Entity

- Node type: `memory_kg_resolve`
- Document node: `{"id":"<unique_id>","type":"memory_kg_resolve"}`
- Utility: Resolve candidate ex:* entity ids by label (+ optional rdf:type filter), using bounded exact-match rules and optional semantic fallback.
- Gateway capability: kg_memory
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `label` string: Entity label text to resolve (case-insensitive; whitespace collapsed).; `expected_type` string: Optional rdf:type filter (e.g. schema:person, skos:concept).; `scope` string: run | session | global | all (fan-out over run+session+global).; `recall_level` string: Recall effort policy: urgent | standard | deep (optional; no silent downgrade).; `max_candidates` number: Optional cap on returned candidates (default depends on recall_level; max 50).; `min_score` number: Optional cosine similarity threshold for semantic fallback (when enabled).; `include_semantic` boolean: Optional override to disable/enable semantic fallback (defaults depend on recall_level).; `owner_id` string: Optional explicit owner id override (advanced; normally derived from scope).
- Outputs: `exec-out` execution; `candidates` array: Resolved candidates (bounded list): {id,label,types,scope,owner_id,score,evidence}.; `count` number: Number of returned candidates.; `ok` boolean: True when the resolver executed successfully.; `raw` object: Raw result object (debug).
- Default config: none

### memory / Memorize

- Node type: `memory_note`
- Document node: `{"id":"<unique_id>","type":"memory_note"}`
- Utility: Store a durable memory note with optional tags/sources and a scope (run/session/global).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `keep_in_context` boolean (in_context): When true, also insert the stored note into this run's context.messages (synthetic system message). If the pin is not connected, the node checkbox is used. Default: false.; `scope` string: Where to store/index the note: run (this run), session (all runs with the same session_id; owned by an internal session memory run), or global (shared global memory run). If session_id is missing, session falls back to the run-tree root.; `content` string: The note text to store durably (keep it short; prefer references in sources for large payloads).; `location` string: Optional location label (where the note was produced, e.g. "flow:my_flow/node-12"). Useful for filtering.; `tags` object: Key/value tags for filtering (e.g. {topic:"memory", person:"laurent"}). Values must be strings.; `sources` object: Optional provenance refs (e.g. {run_id, span_ids, message_ids}). The note stores refs, not the full source content.
- Outputs: `exec-out` execution; `note_id` string: The stored note’s span_id / artifact_id. Use it for Recall into context (span_ids) or for precise Recall.
- Default config: none

### memory / Recall

- Node type: `memory_query`
- Document node: `{"id":"<unique_id>","type":"memory_query"}`
- Utility: Query memory by text/tags and return structured results plus a rendered summary.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `query` string: Keyword query (substring match over span metadata and small previews). Combined with tags/authors/locations using AND semantics.; `recall_level` string: Recall effort policy: urgent | standard | deep (optional; when set, applies bounded budgets and no-silent-downgrade semantics).; `limit` number: Maximum number of spans to return (limit_spans). Default: 5.; `tags` object: Tag filters as key→string or key→list[string]. Reserved key "kind" is ignored.; `tags_mode` string: How to combine tag keys: all (AND) or any (OR). Within a single key, list values are OR.; `usernames` array: Filter by created_by (actor id). Case-insensitive exact match. Empty means no filter.; `locations` array: Filter by location metadata (or tags.location). Case-insensitive exact match.; `since` string: ISO8601 start time. Matches spans whose [from,to] intersects this range.; `until` string: ISO8601 end time. Matches spans whose [from,to] intersects this range.; `scope` string: Which span index to query: run | session | global | all. (all queries run+session+global. session uses session_id authority; if session_id is missing, it falls back to the run-tree root.)
- Outputs: `exec-out` execution; `results` array: Structured match list (meta.matches). Use it to extract span_ids for Recall into context.; `rendered` string: Human-readable recall summary (tool-style output string).
- Default config: none

### memory / Recall into context

- Node type: `memory_rehydrate`
- Document node: `{"id":"<unique_id>","type":"memory_rehydrate"}`
- Utility: Insert recalled message spans into the active context so future LLM/Agent calls can “see” them.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `span_ids` array: List of span_ids (artifact_ids) to insert into context.messages. Typically comes from Recall results.; `placement` string: Where to insert: after_summary | after_system | end.; `recall_level` string: Recall effort policy: urgent | standard | deep (optional; when set, applies bounded budgets and no-silent-downgrade semantics).; `max_messages` number: Optional cap on inserted messages across all spans (None/empty = unlimited). Useful to avoid huge contexts.
- Outputs: `exec-out` execution; `inserted` number: Number of messages inserted into context.messages.; `skipped` number: Number of messages skipped (usually due to dedup).
- Default config: none

### memory / Tag memory

- Node type: `memory_tag`
- Document node: `{"id":"<unique_id>","type":"memory_tag"}`
- Utility: Apply/merge tags onto an existing memory span record (conversation span or memory note).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `span_id` string: Target span_id (artifact id). Also accepts a 1-based span index as a string/number in some hosts.; `scope` string: Which span index to tag: run | session | global | all. (all tags every matching record across run+session+global; indices are not allowed with all.); `tags` object: Key/value tags to set (values must be strings). Reserved key "kind" is ignored.; `merge` boolean: When true, merges with existing tags. When false, replaces the tag dict. Default: true.
- Outputs: `exec-out` execution; `success` boolean: Whether the tag operation succeeded.; `rendered` string: Human-readable result string.
- Default config: none

### memory / Read File

- Node type: `read_file`
- Document node: `{"id":"<unique_id>","type":"read_file"}`
- Utility: Read a file from disk and output its content.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `file_path` string
- Outputs: `exec-out` execution; `content` any
- Default config: none

### memory / Read PDF

- Node type: `read_pdf`
- Document node: `{"id":"<unique_id>","type":"read_pdf"}`
- Utility: Extract text and metadata from a PDF file using the Runtime permissive PDF reader.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `file_path` string; `page_start` number: Optional 1-based first page to read.; `page_end` number: Optional 1-based last page to read.; `max_chars` number: Optional explicit text limit. If used, output warnings include #TRUNCATION.
- Outputs: `exec-out` execution; `content` string; `pages` number; `processed_pages` number; `metadata` object; `warnings` array; `truncated` boolean; `file_path` string; `content_type` string
- Default config: none

### memory / Write File

- Node type: `write_file`
- Document node: `{"id":"<unique_id>","type":"write_file"}`
- Utility: Write content to a file on disk (creates parent folders if needed).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `file_path` string; `content` any
- Outputs: `exec-out` execution; `bytes` number; `file_path` string
- Default config: none

### memory / Write PDF

- Node type: `write_pdf`
- Document node: `{"id":"<unique_id>","type":"write_pdf"}`
- Utility: Render text or Markdown-style report content to a real PDF file using the Runtime permissive PDF writer.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `file_path` string; `content` any; `title` string: Optional PDF document title.
- Outputs: `exec-out` execution; `bytes` number; `file_path` string; `sha256` string; `content_type` string
- Default config: none

### schema / Add Schema Fields

- Node type: `edit_json_schema`
- Document node: `{"id":"<unique_id>","type":"edit_json_schema"}`
- Utility: Add fields to an incoming JSON Schema object. Existing schema fields are preserved; if the input is unavailable, outputs only the added fields.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`; literal value with `literal`
- Inputs: `schema` json_schema: Base JSON Schema object. Leave unconnected to output only the added fields.
- Outputs: `schema` json_schema: JSON Schema with added fields.
- Default config: none

### variables / Bool Variable

- Node type: `bool_var`
- Document node: `{"id":"<unique_id>","type":"bool_var"}`
- Utility: Declare a workflow-scope boolean variable (name + default).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: no node-specific document config beyond label/pin_defaults
- Inputs: none
- Outputs: `name` string; `value` boolean
- Default config: none

### variables / Get Context

- Node type: `get_context`
- Document node: `{"id":"<unique_id>","type":"get_context"}`
- Utility: Read the current run's context namespace (run.vars.context).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: no node-specific document config beyond label/pin_defaults
- Inputs: none
- Outputs: `context` object: Full context object from workflow state (run.vars.context).; `task` string: Convenience output for context.task.; `messages` array: Convenience output for context.messages (conversation history).
- Default config: none

### variables / Get Variable

- Node type: `get_var`
- Document node: `{"id":"<unique_id>","type":"get_var"}`
- Utility: Read a variable from workflow state by name.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `name` string
- Outputs: `value` any
- Default config: none

### variables / Set Variable Property

- Node type: `set_var_property`
- Document node: `{"id":"<unique_id>","type":"set_var_property"}`
- Utility: Update a nested property on an object variable in workflow state (name + key), then continue.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `name` string; `key` string; `value` any
- Outputs: `exec-out` execution; `value` object
- Default config: none

### variables / Set Variable

- Node type: `set_var`
- Document node: `{"id":"<unique_id>","type":"set_var"}`
- Utility: Write a variable into workflow state by name (supports dotted paths for nested updates; updates run vars).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `name` string; `value` any
- Outputs: `exec-out` execution; `value` any
- Default config: none

### variables / Set Variables

- Node type: `set_vars`
- Document node: `{"id":"<unique_id>","type":"set_vars"}`
- Utility: Write multiple variables into workflow state in a single step (updates is an object of name→value).
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: input defaults with `pin_defaults`
- Inputs: `exec-in` execution; `updates` object
- Outputs: `exec-out` execution; `updates` object
- Default config: none

### variables / Variable

- Node type: `var_decl`
- Document node: `{"id":"<unique_id>","type":"var_decl"}`
- Utility: Declare a workflow-scope typed variable (name/type/default) and output its current value.
- Gateway capability: none
- Dynamic pin policy: template pins only
- Authorable config: no node-specific document config beyond label/pin_defaults
- Inputs: none
- Outputs: `name` string; `value` any
- Default config: none

## Hidden Or Deprecated Templates

- `call_tool` / Call Tool: rejected by the authoring validator (hidden, deprecated).
- `image_to_image` / Image To Image: rejected by the authoring validator (hidden).
- `text_to_video` / Text To Video: rejected by the authoring validator (hidden).
