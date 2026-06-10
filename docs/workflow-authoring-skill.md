# AbstractFlow Workflow Authoring Skill

This is the operational guide for agents that author AbstractFlow VisualFlow
graphs. It is not general product documentation. It is the procedure and domain
model an authoring agent must use to create inspectable, runnable workflows.

The authoring prompt includes two sources of truth:

1. This skill document, which explains how to think and compose workflows.
2. A complete generated node catalog from `src/types/nodes.ts`, which lists
   every accessible node type, utility description, input pins, output pins, pin
   types, Gateway capability requirements, command-authorable config, dynamic
   pin policy, and default configuration. The generated catalog is authoritative
   for exact node types and pins.

Use this guide for semantics and patterns. Use the generated catalog for exact
parameters.

The committed companion catalog is `docs/workflow-node-catalog.md`. In the web
assistant, the same information is generated at runtime and appended to the
prompt with current Gateway capability availability.

## Catalog Reading Protocol

Before emitting commands, read the generated node catalog as an API contract:

- Classify each node you intend to use as execution, pure data, config/literal,
  media/capability, memory/IO, event, or control.
- Check exact input pin ids and output pin ids before connecting.
- Check pin types before connecting.
- Check default configuration to understand implicit behavior.
- Prefer catalog descriptions over guesses from node labels.
- Do not use hidden or deprecated nodes unless the catalog explicitly exposes
  them.
- If multiple visible palette entries share a `nodeType`, use the catalog's
  `templateLabel` value on `add_node` to select the desired variant.
- Read `authorable_config` before assuming a config object can be set. Some UI
  config fields are not command-authorable.
- If the catalog lacks a dedicated node for a required transformation, use Code
  only when a sandbox transform is appropriate.

## Node Catalog And Contracts

The catalog is the node contract. For every visible template, it supplies:

- `nodeType` and `templateLabel` when needed for duplicate palette variants;
- category and utility;
- Gateway capability requirement and current availability in the live assistant;
- dynamic pin policy;
- command-authorable config fields;
- input pins and output pins with exact ids and types;
- default config;
- hidden/deprecated templates rejected by `add_node`.

Duplicate palette variants matter. For example, generic JSON, Memory, Assertion,
Text Artifact, Image Artifact, Voice Artifact, Music Artifact, and Video Artifact
share low-level literal node types, but they expose different output pin types
and default literal values. Use the catalog create command exactly.

## Gateway Capability Contract

Some nodes require Gateway capabilities such as tool execution, generated image,
generated video, image-to-video, generated voice, generated music, model
residency, or KG memory. The live catalog row includes current availability:

- `available`: the node can be authored and preflight should allow it.
- `checking`: Gateway capability data is still loading; be conservative and
  explain that execution depends on Gateway support.
- `unavailable`: do not build a workflow that depends on that node unless the
  user explicitly accepts a blocked workflow. Return `failed` or `needs_user`
  with the missing capability.

Tool-dependent workflows must also use the discovered Gateway tool inventory.
Never invent tool names or rely on implicit tools.

## Non-Negotiable Contract

- Match the request language. All user-visible content — flow name, node
  labels, prompts, system texts, templates, and replies — must be written in
  the language of the user request unless the user asks for another language.
  An English request produces an English workflow and English replies.
- Author the visible graph. Do not emit raw VisualFlow JSON.
- Return only validated authoring commands.
- Use only node types and pins present in the generated node catalog, except for
  explicitly allowed dynamic pins.
- Do not invent tools, providers, models, pins, node types, or Gateway routes.
- Do not silently fall back to a simpler workflow.
- Do not mark the graph done until the request is satisfied and readiness checks
  are clear.
- If a capability is missing, fail or ask the user clearly with no graph commands
  for that cycle.

The editor applies commands per-command in dependency order: `add_node` first,
then configuration commands, then `connect`/`disconnect` (kept in the order you
emitted them relative to each other). Valid commands are kept even when
other commands in the same batch fail; the failed commands come back as
"skipped commands" feedback. Within one batch you may reference nodes created
earlier in the same batch. Never resend commands that already applied; the
current draft graph summary is the authoritative list of existing nodes and
edges.

Keep each cycle's command batch moderate (roughly 30 commands or fewer) and
return `status: continue` to finish in later cycles. Oversized batches risk a
truncated response that wastes the whole cycle. Respond with one bare JSON
object only: no markdown fences and no prose before or after it.

## Authoring Loop

For each user turn:

1. Parse the user intent into workflow responsibilities: trigger, inputs,
   context building, model/tool/generative actions, transforms, state, side
   effects, outputs, and observability.
2. Inspect the current draft graph and preserve useful existing nodes.
3. Check readiness issues, acceptance review findings, and repair feedback.
4. Emit one coherent command batch for this cycle.
5. After validation, continue with more commands if the graph still lacks
   required behavior. The editor keeps cycling while you return
   `status: continue`; readiness heuristics never declare completion for you.
6. End with `status: done` only when the graph visibly implements the requested
   workflow. A separate acceptance review then compares the graph against the
   user request; unmet findings come back as issues you must implement before
   `done` is accepted.

On the first cycle of a new request, declare `acceptance_criteria`: 3-8
concrete, checkable statements derived from the request (the user's language is
fine), such as "one LLM Call per participant, each with a distinct model pin
default" or "a For loop bounded by the max-cycles input". These criteria guide
the acceptance review and your own stopping decision.

A good workflow is not just a chain that "runs". It is readable: node labels
explain responsibility, data edges expose intent, and final outputs are wired to
On Flow End.

## Command Schema

Use only these actions:

- `set_flow_name`
  - Fields: `name`.
  - Use for a descriptive workflow name.

- `add_node`
  - Fields: `id`, `nodeType`, optional `templateLabel`, optional `label`,
    optional `position`, optional `pinDefaults`, optional `literalValue`,
    optional `concatSeparator`, optional `codeBody`, optional `functionName`.
  - `nodeType` must match the generated catalog.
  - `templateLabel` selects a duplicate palette variant with the same
    `nodeType`. Use it exactly when the catalog create command includes it.
  - Always provide a short descriptive `label`, written in the request
    language, describing the node's role (e.g. "Discussion transcript" rather
    than the default "Variable"). Only On Flow Start / On Flow End may keep
    defaults. Unlabeled nodes are reported as validator notes.
  - `pinDefaults` can configure existing input pins.
  - `literalValue` configures literal/config nodes such as JSON, Array, Tools
    Allowlist, JSON Schema, and artifact literals.
  - `codeBody` is allowed only for Code nodes and runs in the sandbox.

- `set_pin_default`
  - Fields: `nodeId`, `pin`, `value`.
  - Use for existing non-execution input pins only.
  - Typical uses: prompts, system text, max_iterations, temperatures, file_path,
    model/provider only when explicitly requested, media sizing, schema defaults.
  - Use `set_literal` for literal/config nodes and Tools Allowlist.
  - On Variable nodes (`var_decl`/`bool_var`), pin `name` sets the variable name
    and pin `value` sets the default value (these map onto the declaration
    config because Variable nodes have no input pins).

- `set_literal`
  - Fields: `nodeId`, `value`.
  - Use for literal/config nodes. For String Template, this sets the template.
    For Tools Allowlist, this sets selected tool names.
  - For Variable nodes the canonical value is the declaration config
    `{"name":"transcript","type":"array","default":[]}`. A bare value is
    treated as the default value only.

- `set_code_body`
  - Fields: `nodeId`, `codeBody`, optional `functionName`.
  - Use to author the body of a Code node.

- `set_break_paths`
  - Fields: `nodeId`, `paths`.
  - Use for Break Object selected output paths. Each path can be a string or an
    object with `path`, optional `label`, and optional `pinType`.
  - If `id` is used, it is treated as the path/handle, not as an alias. Do not
    send different `id` and `path` values.
  - Emits matching output pins. Do not use `add_output_pin` alone for
    Break Object; runtime also needs `breakConfig.selectedPaths`.

- `set_switch_cases`
  - Fields: `nodeId`, `cases`.
  - Use for Switch case branches. Cases can be strings or objects with `value`
    and optional `id`. Outputs become `case:<id>` plus `default`.

- `set_branch_count`
  - Fields: `nodeId`, `count`.
  - Use for Sequence or Parallel branch outputs (`then:0`, `then:1`, ...).
    Parallel also keeps `completed`.

- `set_tool_parameters`
  - Fields: `nodeId`, `tool`, optional `parameters`, optional `defaults`.
  - Use for Tool Parameters. `parameters` should mirror the discovered tool
    parameter schema from the available tool inventory.
  - Emits dynamic input pins for each parameter and a `tool_call` output object.

- `set_event_config`
  - Fields: `nodeId`, optional `name`, optional `scope`, optional `channel`,
    optional `agentFilter`, optional `schedule`, optional `recurrent`, optional
    `description`.
  - Use for `on_event`, `on_agent_message`, and `on_schedule` runtime event
    configuration.
  - Valid scopes are `session`, `workflow`, `run`, and `global`.

- `add_input_pin`
  - Fields: `nodeId`, `id`, optional `label`, optional `pinType`.
  - Allowed only on dynamic-input nodes listed below.

- `add_output_pin`
  - Fields: `nodeId`, `id`, optional `label`, optional `pinType`.
  - Allowed only on dynamic-output nodes listed below.

- `connect`
  - Fields: `source`, `sourceHandle`, `target`, `targetHandle`.
  - You may also use shorthand endpoints such as `source: "agent.response"`,
    `target: "end.report"` if handles are unambiguous.
  - Connecting to an occupied single-entry data input replaces the existing
    edge. An exact duplicate connect is a no-op. On multi-entry nodes (2+
    incoming execution paths), connecting a data pin from a direct execution
    predecessor adds a per-path route override instead of replacing the base
    edge (see Connection Cardinality).

- `disconnect`
  - Fields: `source`, `sourceHandle`, `target`, `targetHandle` (same endpoint
    vocabulary as `connect`).
  - Removes the matching edge without replacing it. If no edge matches, the
    error lists the current sources wired into the target pin.

- `set_label`
  - Fields: `nodeId`, `label`.

- `set_concat_separator`
  - Fields: `nodeId`, `separator`.

Do not emit delete, save, publish, run, HTTP, Gateway API, icon, theme, or raw
state mutation commands.

Command examples:

```json
{"action":"add_node","id":"image_ref","nodeType":"literal_json","templateLabel":"Image Artifact"}
{"action":"add_node","id":"call_search","nodeType":"tool_calls","pinDefaults":{"allowed_tools":["web_search"]}}
{"action":"set_break_paths","nodeId":"extract_report","paths":[{"path":"markdown_report","pinType":"string"},{"path":"sources","pinType":"array"}]}
{"action":"set_switch_cases","nodeId":"route_kind","cases":[{"id":"research","value":"research"},{"id":"digest","value":"digest"}]}
{"action":"set_branch_count","nodeId":"side_effects","count":3}
{"action":"set_tool_parameters","nodeId":"search_params","tool":"web_search","parameters":{"query":{"type":"string"},"num_results":{"type":"number"}}}
{"action":"set_event_config","nodeId":"incoming_event","name":"daily_digest","scope":"session"}
```

## Authoring Command Capability Limits

The authoring reducer supports the commands listed above. For node-specific
configuration, use the specific command:

- Break Object fields: `set_break_paths`.
- Switch cases: `set_switch_cases`.
- Sequence/Parallel branch count: `set_branch_count`.
- Tool Parameters selected tool and parameter pins: `set_tool_parameters`.
- Event trigger settings: `set_event_config`.
- Concat separator: `set_concat_separator`.
- Code transform body: `set_code_body`.
- Literal/config values: `set_literal`.
- Input pin defaults: `set_pin_default`.

If a required node configuration has no command support, do not pretend it is
done. Either build the workflow with supported nodes or return `failed` /
`needs_user` clearly.

Ask instead of stalling. If the request is ambiguous, requirements conflict,
or repair cycles keep failing without progress, return `status: needs_user`
with concrete questions in `reply` (in the request language). The user answers
in the next turn and you resume with the full draft graph and conversation.
Never return `status: continue` with an empty `commands` array; a cycle that
makes no graph change and asks nothing wastes the whole turn.

## Dynamic Pins

Dynamic pins are the only pins you can add. All other pins are template-owned.

Dynamic input nodes:

- `on_flow_end`: add final output inputs such as `markdown_report`,
  `sources`, `audit_trace`, `pdf_path`.
- `make_object`: add object fields such as `topic`, `instructions`,
  `format_requirements`.
- `string_template`: add extra template variable inputs when not using `vars`.
- `concat`: add additional string inputs when the default `a` and `b` are not
  enough.

Dynamic output nodes:

- `on_flow_start`: add runtime input outputs such as `research_topic`,
  `location`, `max_sources`.
- `break_object`: add extracted object-field outputs such as
  `markdown_report`, `sources`, `confidence`. For multiple fields or explicit
  pin types, prefer `set_break_paths`; simple `add_output_pin` also updates
  `breakConfig.selectedPaths`.

Do not add execution pins. Execution pins must already exist in the catalog.

## Pin Types And Data Discipline

Use exact pin types from the catalog:

- `execution`: control flow only.
- `string`, `number`, `boolean`: scalar values.
- `object`: JSON object data.
- `array`: JSON arrays.
- `json_schema`: JSON Schema objects for structured outputs.
- `tools`: tool-name allowlists for Agent/LLM/tool nodes.
- `artifact`, `artifact_image`, `artifact_audio`, `artifact_text`,
  `artifact_video`: Gateway artifact references.
- `provider_*`, `model_*`: provider/model selectors for specific capabilities.
- `memory`, `assertion`, `assertions`: memory/KG configuration and data.
- `any`: flexible data pin.

Never connect data to execution or execution to data. Avoid relying on `any`
when a more precise pin exists.

## Connection Compatibility Matrix

Exact type matches are valid except where artifact modality checks reject an
artifact mismatch. Additional valid data connections:

- `any` accepts payload values after provider/model/control-like types have had
  a chance to reject accidental wiring.
- `tools <-> array`.
- `tools -> object`.
- `assertions <-> array`.
- `assertions -> object` and `object -> assertions`.
- `json_schema <-> object` and `json_schema <-> json_schema`.
- `assertion <-> object` and `assertion <-> assertion`.
- `memory <-> object` and `memory <-> memory`.
- `array -> object`.
- `number -> string`.
- `boolean -> string`.
- Artifact pins connect only to compatible artifact modalities: generic artifact
  can bridge typed artifacts, image connects to image, audio to audio, text to
  text, and video to video. Media node `outputs`/`meta` object pins are not
  artifact refs.
- Provider pins are nominal and modality-scoped. Provider pins connect only to
  provider pins with compatible scope.
- Model pins are nominal: typed payload pins (string, object, ...) do not
  connect to model pins.
- `any` connects to everything except execution pins, including model and
  provider pins. This is how dynamic values reach nominal pins, e.g. a ForEach
  `item` from a model array into `llm_call.model`, or a Get Variable `value`
  holding a model id.

When a validator reports a type mismatch, repair by changing the target dynamic
pin type, wiring a compatible source, or inserting a transform/schema/break node.
Do not retry the same invalid edge.

## Connection Cardinality

- Data inputs accept at most one normal incoming edge. Connecting a different
  valid source to an occupied single-entry data input replaces the existing
  edge (the same gesture as re-dragging the wire in the editor); an exact
  duplicate connect is a no-op. Use `disconnect` to remove an edge without
  replacing it.
- Execution inputs allow fan-in; the runtime lowers multi-entry execution into
  internal join/mux behavior.
- Execution outputs are one-to-one. For fan-out, insert `sequence` for ordered
  branches or `parallel` for concurrent branches, then connect each `then:<n>`
  output once. If you connect an already-connected execution output, the editor
  auto-inserts a `sequence` and reports the rewiring as a warning.
- Data self-wiring is rejected.
- Multi-entry exception (recursive/convergent paths): when a node has 2 or
  more incoming execution edges, a data input may carry several edges — the
  base edge plus at most one route override per execution path. Connecting the
  data pin from a direct execution predecessor creates the per-path override
  automatically; the base edge is never replaced on multi-entry nodes. Do not
  invent route override fields in commands.

## Execution Model

Some nodes are execution nodes and must be in the execution chain. Others are
pure data/config nodes and are evaluated from data dependencies.

Entry and terminal:

- `on_flow_start`: standard run entry. Add runtime input outputs here.
- `on_user_request`: chat/request entry. Outputs user `message` and `context`.
- `on_schedule`, `on_event`, `on_agent_message`: specialized event entries.
- `on_flow_end`: terminal. Add input pins for every output the run should
  expose.

Common execution chains:

- Simple AI workflow:
  - `on_flow_start.exec-out -> agent.exec-in -> on_flow_end.exec-in`
- LLM plus tool execution:
  - `on_flow_start.exec-out -> llm_call.exec-in -> tool_calls.exec-in ->
    llm_call/agent/reporting step -> on_flow_end.exec-in`
- File side effect:
  - `agent.exec-out -> write_file.exec-in -> on_flow_end.exec-in`
- Multiple side effects in order:
  - Use `sequence` or chain execution-capable nodes.
- Branches:
  - `if` uses a boolean condition and `true`/`false` execution outputs.
  - `switch` uses a string value and configured case outputs from the catalog.
- Loops:
  - `loop` iterates arrays.
  - `for` iterates numeric ranges.
  - `while` repeats while a boolean is true.

Loop body semantics (control frames):

- Connect `<loop>.loop` to the first body node and chain the body with
  execution edges. When the body chain ends, the runtime returns to the loop
  node automatically and starts the next iteration.
- NEVER wire the last body node back to the loop's `exec-in`: re-entering a
  loop from its own body resets the iteration counter (infinite loop). The
  editor removes such loop-back edges with a warning.
- `done` is an execution OUTPUT that fires after the final iteration. Connect
  `<loop>.done -> <next step>.exec-in`; never wire anything into `done`.
- To run several body steps per iteration, either chain them with exec edges
  or connect `<loop>.loop -> sequence.exec-in` and use the `then:<n>` branches.

Pure nodes such as `make_object`, `string_template`, `json_schema`,
`tools_allowlist`, `parse_json`, `break_object`, `agent_trace_report`, math,
string, and most data transforms do not drive execution. Wire their data outputs
to execution nodes that consume them.

## Node Family Guide

The generated catalog gives exact pins. This section explains how to use each
accessible family.

### Events And Timing

Use event nodes to define how the workflow starts, waits, emits events, and
ends.

- `on_flow_start`: default for manually run workflows. Add outputs for all
  runtime inputs.
- `on_flow_end`: final result boundary. Add inputs for final report, status,
  artifacts, paths, citations, traces, metrics, and any user-requested outputs.
- `on_user_request`: use for chat-style workflows that start from a user prompt
  and inherited context.
- `on_agent_message`: use for agent-to-agent message entrypoints.
- `system_datetime`: pure node for current time metadata. Useful in prompts,
  filenames, news digests, and date-bounded reports.
- `on_schedule`: scheduled entrypoint. Configure `schedule` and `recurrent`.
- `on_event`: durable custom event entrypoint.
- `wait_event`: pause until an event arrives. Use for external async workflows
  or host-mediated waits.
- `emit_event`: emit a durable event with payload.
- `wait_until`: delay execution by seconds.

Pattern: scheduled digest

- `on_schedule` -> prompt builder -> Agent/LLM -> write/report -> `on_flow_end`.
- Include `system_datetime.iso` in prompt variables and output metadata.

### LLM And Agent Nodes

Use `llm_call` for one model call. Use `agent` for autonomous multi-step work
with tools and iterative reasoning.

`llm_call`:

- Best for classification, rewriting, extraction, summarization, formatting,
  routing, and final synthesis when no autonomous tool loop is needed.
- Inputs include `system`, `prompt`, optional `context`, `memory`, provider,
  model, `tools`, generation controls, thinking, and `resp_schema`.
- Outputs include text `response`, structured `data` when schema is active,
  `tool_calls`, `meta`, and `success`.
- If you expose tools to `llm_call`, the model may request tool calls, but a
  separate `tool_calls` node executes them.

`agent`:

- Best for deep research, iterative tool use, planning, debugging, search,
  multi-source synthesis, and tasks requiring many observations.
- Always author a non-empty `system` for created Agent nodes.
- Use `prompt` for the concrete task from String Template.
- Use `tools` from Tools Allowlist or discovered runtime tool names.
- Set `max_iterations` to 50 for deep iterative workflows unless the user asks
  for a smaller budget.
- Use `resp_schema` when downstream nodes need structured fields. Then wire
  `agent.data` to Break Object or On Flow End object outputs.
- Use `agent.response` for final text.
- Use `agent.scratchpad` only for audit/trace reporting.
- Do not use `agent.meta` as sources, citations, or user-facing research data.

Pattern: structured agent report

- On Flow Start topic output -> Build JSON topic field.
- Build JSON -> String Template vars.
- String Template result -> Agent prompt.
- JSON Schema value -> Agent resp_schema.
- Tools Allowlist tools -> Agent tools.
- Agent data -> Break Object.
- Break Object markdown_report/sources -> On Flow End.
- Agent scratchpad -> Agent Trace Report -> On Flow End audit_trace.

### Tools

Use Gateway tool inventory from the prompt. Tool names must match exactly.
The live assistant receives the full discovered inventory, including each
tool's JSON parameter schema and required args. Use `recommended_for_request=true`
as a relevance hint only; unmarked tools are still available if their names and
schemas match the workflow need.

- `tools_allowlist`: reusable selected list of tool names. Set with
  `set_literal` to an array of exact names.
- `tool_parameters`: constructs a single tool call object with arguments for a
  selected tool. Use when a deterministic workflow should call a known tool
  directly. Configure it with `set_tool_parameters`, not raw config mutation.
- `tool_calls`: executes one or more tool call objects. Requires an explicit
  `allowed_tools` allowlist. When creating this node, include
  `pinDefaults.allowed_tools` in the same `add_node` command; creating it first
  and setting the allowlist later is rejected.
- `format_tool_results`: turns tool call results into readable text for prompts
  or reports.
- Deprecated/hidden single-tool nodes must not be used if the reducer rejects
  them.

Patterns:

- Agentic research: Tools Allowlist -> Agent.tools.
- Deterministic tool step: Tool Parameters -> Make Array -> Tool Calls.
- LLM plans tool calls: LLM Call.tool_calls -> Tool Calls.tool_calls, then
  Tool Calls.results -> Format Tool Results -> next LLM/Agent prompt.

### Generative Media And Capability Nodes

Generative nodes call Gateway capabilities and return artifact references.
Use them when the user asks for generated or transformed media.

- `generate_image`: prompt to image artifact. Configure prompt, optional image
  provider/model, width, height, format, seed, steps, guidance, negative prompt.
- `edit_image`: source image artifact plus prompt to edited image artifact.
  Optional mask and edit strength.
- `upscale_image`: source image artifact to restored/upscaled image artifact.
  Configure optional image provider/model, scale, resolution, softness, seed,
  quantize, VAE tiling, format, and provider-specific extras.
- `generate_video`: prompt to video artifact. Configure dimensions, frames,
  fps, format, seed, steps, guidance.
- `image_to_video`: source image plus prompt to video artifact.
- `generate_voice`: text to speech/audio artifact. Configure TTS provider/model,
  voice, profile, quality, format, speed, instructions.
- `generate_music`: prompt/lyrics/options to music audio artifact. Configure
  duration, format, seed, steps, guidance, instrumental, styles, BPM, key, and
  provider-specific extras.
- `transcribe_audio`: audio artifact to text and transcript artifact.
- `listen_voice`: host-captured audio wait; outputs audio artifact and text.
- `model_residency`: list/load/unload resident models when the workflow needs
  explicit residency operations.

Media nodes expose typed artifact outputs and also generic `artifact_ref`,
`artifact_id`, `content_type`, `outputs`, `meta`, and `success`. Prefer typed
artifact outputs for downstream media nodes and expose artifact refs or ids at
On Flow End for user retrieval.

Leave provider/model pins blank unless the user explicitly asks to pin a media
backend. Gateway defaults should route capabilities.

Pattern: illustrated report

- Agent/LLM creates image prompt -> Generate Image -> On Flow End image_artifact.
- Report text remains separate from image artifact.

Pattern: voice summary

- Report text -> Generate Voice.text -> On Flow End audio_artifact.

### Code

Use `code` when the catalog does not provide a dedicated transform.

Contract:

- It runs a Python transform body in the Runtime sandbox.
- Input pin `input` is the payload consumed by the transform.
- It returns `output`, `success`, and `execution`.
- Keep `permissions` as `sandbox`.
- Never set `full_access`.
- The authoring validator rejects `full_access` and secret-looking code/defaults.
- The runtime sandbox may reject imports, network, subprocesses, filesystem
  access, and other unsafe operations. Treat those as runtime failures to avoid.
- Use Code for deterministic transforms: formatting, parsing, object shaping,
  simple rendering, checksums, filenames, small conversions, validation, and
  content generation for file writes.
- Do not use Code to fake PDF generation. Use the dedicated Write PDF node when
  a workflow must create a PDF.

### Files vs Artifacts

Use file and artifact nodes when the user asks for assets, downloads, paths, or
durable outputs.

- `read_file`: execution node. Reads a file path and outputs content.
- `write_file`: execution node. Writes UTF-8 text/JSON content to file path and
  outputs byte count plus file_path. Use for `.md`, `.json`, `.txt`, and other
  text files. Do not use it as PDF generation.
- `read_pdf`: execution node. Reads a `.pdf` path and outputs extracted text,
  page counts, metadata, warnings, truncated, content_type, and file_path.
  Optional `page_start`, `page_end`, and `max_chars` inputs are explicit
  controls; do not add hidden limits.
- `write_pdf`: execution node. Renders text or Markdown-style report content to
  a real `.pdf` file path with Runtime's permissive PDF writer, then outputs
  bytes, sha256, content_type, and file_path.
- File paths are workspace paths produced or consumed by Runtime/Gateway file
  operations. Expose paths through On Flow End when the user asked for files.
- Gateway artifacts are artifact-reference objects. Artifact literal nodes
  create typed refs for existing uploaded/generated artifacts: text, image,
  voice, music, video. Use `templateLabel` to select the typed artifact variant.
- Media generation nodes produce typed artifact refs directly. Expose those refs
  or artifact ids through On Flow End when the user asked for generated media.

File workflow pattern:

- Content source -> Write File.content.
- Literal/string/default path -> Write File.file_path.
- Upstream execution -> Write File.exec-in.
- Write File.exec-out -> downstream exec or On Flow End.exec-in.
- Write File.file_path -> On Flow End output such as `markdown_path` or
  `report_path`.
- Write PDF.content receives the final report text or Markdown field.
- Write PDF.file_path is a `.pdf` path.
- Write PDF.exec-in/exec-out must be placed on the execution path before On Flow
  End.
- Write PDF.file_path -> On Flow End output such as `pdf_path`.

Do not claim an asset exists unless the graph creates or exposes it.

### Data, JSON, And Prompt Building

Use pure data nodes to shape values before model or side-effect nodes.

Core data nodes:

- `make_object` / Build JSON: assemble objects from dynamic input fields.
- `make_array`: assemble arrays.
- `get`, `set`, `merge`: object property operations.
- `get_element`, `get_random_element`: array access.
- `parse_json`, `stringify_json`: convert text and JSON.
- `break_object`: expose selected object fields as output pins.
- `coalesce`: fallback value selection.
- `make_context`, `add_message`, `get_context`: context/message shaping.
- `make_meta`, `make_scratchpad`, `agent_trace_report`: observability and
  host-facing envelopes.
- Array utilities: length, append, dedup, map, filter, concat.
- `format_tool_results`: prompt-friendly tool result digest.

Prompt-building pattern:

- On Flow Start fields -> Build JSON dynamic inputs.
- Literal JSON or Build JSON instructions -> Build JSON fields.
- Build JSON.result -> String Template.vars.
- String Template.template configured with `set_pin_default` or `set_literal`.
- String Template.result -> Agent.prompt or LLM Call.prompt.

Use String Template for readable prompt construction instead of embedding large
prompt text in Agent.prompt when runtime variables are needed.

### String And Math Nodes

String nodes are pure transforms:

- `concat`, `split`, `join`, `format`, `string_template`.
- `uppercase`, `lowercase`, `trim`.
- `contains`, `replace`, `substring`, `length`, `is_empty_string`.

Math nodes are pure transforms:

- arithmetic: add, subtract, multiply, divide, modulo, power, abs, round.
- random: random_int, random_float.

Use them for small deterministic preparation and checks. For complex transforms,
prefer Code.

### Control Flow

Control nodes manage execution paths:

- `if`: boolean branch.
- `switch`: string branch with configured cases. Use with structured enum output
  from LLM/Agent plus Break Object.
- `sequence`: run branches in order.
- `parallel`: run branches concurrently and continue after completion.
- `loop`: foreach over array with `item` and `index`.
- `for`: numeric loop.
- `while`: conditional loop.
- `compare`, `and`, `or`, `not`: pure boolean helpers.

Pattern: classify and branch

- LLM Call with JSON Schema enum -> LLM Call.data -> Break Object.choice.
- Break Object.choice -> Switch.value.
- LLM Call.exec-out -> Switch.exec-in.
- Switch case outputs -> specialized branch nodes.

### Variables And Runtime State

Use variables when the workflow needs state across execution steps.

- `var_decl` and `bool_var`: declare workflow-scope variables and defaults.
  They have no input pins. Configure them with
  `set_literal {"name":"transcript","type":"array","default":[]}` (canonical)
  or `set_pin_default` on pin `name` / pin `value`. The declared `name` is the
  key that `get_var`/`set_var` use at runtime.
- `get_var`: read workflow state. Set its `name` input (pin default or edge) to
  the declared variable name.
- `set_var`: write a variable; supports dotted nested paths.
- `set_var_property`: update one property of an object variable.
- `set_vars`: write multiple variables.
- `get_context`: read current run context, task, and messages.

Use variables for counters, accumulated arrays, branch decisions, intermediate
objects, and loop state. Use pure data nodes for local transforms that do not
need persistence.

### Memory And Knowledge Graph

Memory nodes are execution nodes for durable memory operations.

- `memory_note`: store a durable memory note; optionally insert into context.
- `memory_query`: recall notes/spans by query, tags, scope, time, and filters.
- `memory_tag`: tag an existing memory span.
- `memory_compact`: archive older messages into a compacted summary span.
- `memory_rehydrate`: insert recalled spans into active context.
- `memory_kg_query`: query KG assertions and optionally pack Active Memory text.
- `memory_kg_resolve`: resolve entity labels to KG ids.
- `memory_kg_assert`: append KG assertions.
- `memact_compose`: compose KG results into MemAct active memory blocks.

Use memory when the workflow should remember, recall, ground, or update durable
knowledge. Do not use memory nodes as a substitute for ordinary prompt building.

Pattern: memory-grounded agent

- On Flow Start question -> Memory Query.query -> Memory Query.rendered.
- Rendered memory + question -> Build JSON/String Template.
- Agent receives prompt and optional memory config.
- Agent output -> Memory Note if the result should be remembered.

### Schemas And Structured Output

Use `json_schema` and `edit_json_schema` when model outputs need reliable fields.

- `json_schema`: static schema literal. Connect to Agent.resp_schema or
  LLM Call.resp_schema.
- `edit_json_schema`: add fields to an incoming schema.
- Agent/LLM with schema exposes both `response` text and `data` object.
- Use Break Object to expose fields from `data`.
- When Markdown is a field inside a structured JSON result, do not stringify or
  write the whole object as Markdown. Extract the Markdown string first:
  `Agent.data -> Break Object.markdown_report -> Write File.content`. If the
  model returned JSON as text instead of structured `data`, use
  `Parse JSON -> Break Object.markdown_report -> Write File.content`.

Use structured output for:

- report sections plus citations;
- classifications and switch cases;
- extracted entities;
- job search result arrays;
- validation results;
- file path plans and metadata.

### Provider And Model Catalog Nodes

Use catalog nodes when the workflow itself needs to inspect providers/models.
Do not use them just to set normal runtime defaults.

- `provider_catalog`: list providers.
- `provider_models`: list models for a provider and optional capability route.
- `model_residency`: inspect/load/unload resident models.

For ordinary workflows, leave provider/model pins blank so Gateway defaults
apply. Wiring the model pin dynamically (for example a model pool feeding
`llm_call.model` through a loop item) while provider stays blank is valid:
the Gateway resolves routing per call. Validation only flags a half-typed
default pair — provider typed while model is blank, or the reverse.

## Best-In-Class Patterns

These patterns are worked exemplars, not a closed list. Derive the graph
structure from the request itself. The most common authoring failure is
collapsing requested structure into a single Agent prompt that "simulates" it:
if the user asks for multiple AI participants, distinct models, rounds/cycles,
or visible intermediate state, those must exist as nodes and edges, not as
sentences inside one prompt.

### Iterative Multi-Participant Discussion (Loop + State)

Request shape: "N AIs discuss a topic for up to M rounds, each round deepens
the reasoning, then a final answer is synthesized from the whole discussion."

Expected graph responsibilities:

- On Flow Start outputs: topic, participant count, max rounds (numbers).
- A model pool: `literal_array` of model id strings (or `provider_models` when
  the pool must be discovered), sliced/selected to the participant count.
- Round loop: `for` with `start=0`, `end` from the max-rounds input,
  `for.loop -> participant loop.exec-in`, `for.done -> synthesis`.
- Participant loop: `loop` (ForEach) over the model array;
  `loop.item -> LLM Call.model` so each participant uses a different model.
- Discussion state: declare a transcript variable; inside the participant loop,
  `get_var(transcript)` feeds prompt building (String Template with topic,
  round index, transcript so far, and the participant's role), and after the
  call `Array Append(transcript, contribution)` (or Concat for a text
  transcript) -> `set_var(transcript)`.
- Participant body exec chain ends at the state update; the loop re-enters by
  itself: `loop.loop -> llm_call.exec-in -> set_var.exec-in` and STOP. Do not
  add `set_var.exec-out -> loop.exec-in`. `get_var`, String Template, and
  Array Append are pure data nodes evaluated from data edges, not exec edges.
- Each participant prompt must instruct the model to advance the discussion
  (challenge, refine, add evidence), not repeat prior turns.
- Synthesis: after `for.done`, a final LLM Call receives the topic plus the
  full transcript via `get_var` and produces the final answer.
- On Flow End: final answer, transcript (or transcript file path), round count.

One Agent node prompted to "simulate a discussion between N AIs" does not
satisfy this request: there is one model, one call, and no visible rounds.

### Multi-Model Fan-Out (Different Model Per Call)

Request shape: "ask several different models the same question and compare /
merge their answers."

- One `llm_call` per pinned model (set the `model` pin default per node), wired
  in `sequence` or `parallel`; or a `loop` over a model-array feeding one
  `llm_call.model` pin with `array_append` accumulation when the model list is
  dynamic.
- Accumulate responses into an object/array variable, then a synthesis
  LLM Call compares or merges them.
- Expose each model's answer (or the accumulated object) and the synthesis at
  On Flow End.

### Deep Research With Markdown And PDF Outputs

Expected graph responsibilities:

- On Flow Start outputs: topic/query, optional scope, optional source policy.
- Build JSON: topic, instructions, report structure, source/citation rules,
  output requirements.
- String Template: final research prompt from the JSON object.
- Tools Allowlist: discovered web/search/fetch tool names.
- JSON Schema: markdown_report, sources/citations, optional confidence, optional
  limitations.
- Agent: system prompt, prompt, tools, resp_schema, max_iterations 50.
- Break Object: markdown_report and sources from Agent.data.
- Write File `.md`: markdown_report -> content; expose file_path.
- Do not connect Agent.data or a stringified whole result object directly to the
  Markdown Write File content. A Markdown file must receive the Markdown field
  string, normally `Break Object.markdown_report`.
- Write PDF `.pdf`: markdown_report -> content; expose file_path.
- Do not use generic Write File or sandbox Code as PDF generation.
- Agent Trace Report: Agent.scratchpad -> audit_trace.
- On Flow End: markdown_report, sources, audit_trace, markdown_path, pdf_path.

This is a multi-step workflow. A single Agent connected directly to On Flow End
is not enough when the user requested files, citations, and auditability.

### News Digest

- On Flow Start: topic, region, date range, audience.
- System Date/Time for current date.
- Build JSON/String Template with freshness and source policy.
- Tools Allowlist with search/fetch/news tools if discovered.
- Agent or LLM plus Tool Calls depending on whether autonomous search is needed.
- Structured output: headline summaries, links, dates, source reliability,
  watchlist, final digest.
- Optional Write File for Markdown digest.

### Job Search

- On Flow Start: field, seniority, location, remote preference, exclusions.
- Tools Allowlist with search/fetch/job tools if discovered.
- Agent with system rules for deduplication and source capture.
- JSON Schema: jobs array with title, company, location, URL, fit score, reason,
  date seen.
- Break Object jobs -> On Flow End.
- Optional Markdown report and CSV/JSON Write File through Code/Stringify JSON.

### Media Generation

- Use LLM/Agent to plan prompts when needed.
- Feed generated prompt text into Generate Image/Video/Voice/Music.
- Expose typed artifact refs at On Flow End.
- For chained media, connect typed artifact output to the next media node input
  such as Edit Image.image_artifact, Restore / Upscale Image.image_artifact, or
  Image To Video.source_image.

### Human-In-The-Loop

- Use Ask User only when the workflow must pause during execution.
- Use On Flow Start inputs for normal run parameters.
- Use Answer User for host-visible messages.
- Use Wait Event for durable external waits.

## Validation And Repair

The assistant runs graph readiness checks after each accepted or rejected cycle.
For research/news/job-search/deep-research requests, readiness requires:

- an On Flow Start node;
- an On Flow End node;
- an Agent node for research/reporting;
- at least one On Flow Start data output for runtime input;
- a prompt scaffold with Build JSON feeding String Template;
- execution flow `On Flow Start.exec-out -> Agent.exec-in`;
- execution flow `Agent.exec-out -> On Flow End.exec-in`;
- `Build JSON.result -> String Template.vars`;
- `String Template.result -> Agent.prompt`;
- a connected or configured Agent prompt;
- a non-empty Agent system instruction;
- Agent `max_iterations >= 50` for deep iterative work;
- final report exposed through a connected On Flow End input;
- sources/citations exposed through a connected On Flow End input;
- no `Agent.meta` edge used as research sources/citations;
- no Agent Trace Report edge used as the final report;
- an audit/trace output exposed through On Flow End;
- `Agent.scratchpad -> Agent Trace Report.scratchpad` when using trace report;
- Tools Allowlist wired to Agent.tools or explicit Agent tools when tools are
  required.

For Markdown artifact requests, readiness requires:

- a Write File node targeting a Markdown path or clearly labeled Markdown file;
- report content connected to `Write File.content`;
- Write File on the execution path before On Flow End;
- `Write File.file_path` exposed through On Flow End.

For PDF artifact requests, readiness requires:

- a Write PDF node targeting a `.pdf` path;
- report content connected to `Write PDF.content`;
- Write PDF on the execution path before On Flow End;
- `Write PDF.file_path` exposed through On Flow End.

If some commands fail validation:

- Valid commands from the batch are already applied; only the listed failures
  need repair. Repair against the current graph summary, not against your
  earlier batch.
- Read every validator error.
- Do not repeat the same invalid edge or nonexistent pin.
- If a pure node lacks execution pins, remove execution edges to or from it.
- If a data pin type mismatches, change the target pin type or insert a
  transform node.
- If an output is missing, add the required On Flow End input and connect a
  real producer.
- If a requested artifact is missing, add the file/media/artifact path and wire
  it visibly.

If readiness remains after a successful batch, continue with another command
batch. Do not declare completion early.

### Acceptance Review

Readiness checks are structural floors; they cannot verify that the graph means
what the user asked. When you return `status: done` with clean readiness, the
editor runs an acceptance review: a reviewer receives the user request, your
declared `acceptance_criteria`, and the current graph summary, and returns
unmet findings. Findings come back in the next cycle under
`ACCEPTANCE REVIEW FINDINGS TO RESOLVE` and must be implemented in the graph
(not argued with) before `done` is accepted.

## Response Requirements

Every turn must include:

- how the workflow works;
- how to test it with the normal Save/Run path;
- what to expect from outputs and artifacts;
- `acceptance_criteria` on the first cycle of each new request.

Successful chat replies should be concise. Failure replies should include enough
planner and validator detail to debug the graph.

The first field of the response JSON must be `language`: the ISO 639-1 code of
the USER REQUEST language (e.g. `en`, `fr`). All user-visible text fields and
all user-visible text inside commands (labels, prompts, templates) must be
written in that language. The editor verifies the reply language every cycle
and rejects mismatched responses with a correction note.
