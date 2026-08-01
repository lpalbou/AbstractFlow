# AbstractFlow Workflow Authoring Skill

This is the operational guide for agents that author AbstractFlow VisualFlow
graphs. It is not general product documentation. It is the procedure and domain
model an authoring agent must use to create inspectable, runnable workflows.

The authoring prompt includes two sources of truth:

1. This skill document, which explains how to think and compose workflows.
2. A complete generated node catalog from `src/types/nodes.ts` — one line per
   palette template with exact node types, template variants, input/output pins
   and pin types, dynamic-pin allowance, document config fields, and Gateway
   capability availability. The catalog is authoritative for exact types and
   pins.

Use this guide for semantics and patterns. Use the generated catalog for exact
parameters. The committed companion catalog is `docs/workflow-node-catalog.md`;
in the web assistant the same information is generated at runtime with current
Gateway capability availability.

## THE AUTHORING LADDER — nodes and wires first, always

VisualFlow exists so people can think about a process VISUALLY. Whenever you
express something OFF the canvas — in a code body, in a pin expression, in a
function, inside one object blob — you have HIDDEN it, and hiding is the one
failure this system cannot tolerate. Code is not a shortcut past the node
vocabulary; it is the harness for DETERMINISTIC or tedious work (talk to a
database, run an ETL, convert format 1 to format 2) that would otherwise need a
combinatorial explosion of nodes.

Before you emit ANY code node, expression, or function, walk this ladder from
the top and stop at the first rung that works:

| rung | use it for |
|---|---|
| 1. **An existing node** | anything the catalog already ships. CHECK THE CATALOG FIRST. |
| 2. **A subflow, with one input pin per field** | a whole reusable process. Never a hand-built `input` object. |
| 3. **`get_var` / `set_var` / `set_vars`** | reading and writing run state. |
| 4. **A pin expression** | a DERIVATION: a comparison, a boolean combination, a short interpolation. Never a plain read. |
| 5. **A code node** | deterministic glue: external systems, ETL, format/shape transforms, checksums, validation. Expert territory. |
| 6. **A flow function** | the same derivation at 2+ call sites, ≤25 lines. |
| 7. **A runtime builtin** | useful in EVERY flow (envelope parsing, shell quoting) — a request, not something you author. |
| 8. **Propose a reusable NODE** | nothing above fits. Say so (see "Missing Abstractions"). |

What a code node is NEVER for:

- **Orchestration** — sequencing, branching, looping. Those are `sequence`,
  `parallel`, `if`, `switch`, `loop`, `for`, `while`.
- **Reading or writing state** — `get_var`, `set_var`, `set_vars`.
- **Prompt or system text.** Every sentence a model reads must be editable by a
  user or an agent without opening a Python body: put it in the consumer's pin
  default, or in a `string_template`. A code node may SELECT between texts that
  live on pins (`text = str(repair_text or "")`) — it may not CONTAIN them.
- **Anything an existing node expresses.** A code node that reimplements
  `break_object`, `concat`, `format`, `compare`, or `coalesce` is a node you
  did not look for.

`scripts/audit_flow_graph.py --policy` checks the ladder mechanically (P1–P7)
and the editor's preflight panel raises the same findings as warnings.

## Missing Abstractions — say so, don't work around it

If a step genuinely has no node, the answer is a NEW REUSABLE NODE, not a
private workaround buried in a body. Two moves, in this order:

1. Build the step as a **subflow** when it composes from existing nodes — that
   is a reusable unit today, findable in the shared library, with a visible
   contract.
2. When it cannot be composed (it needs a new primitive), write the code node
   AND flag the gap explicitly in your `reply`, in one line of this shape:

   > Node gap: this needed a code node because no node exists for
   > `<capability>` — e.g. "pick A or B on a boolean without leaving the pure
   > lane" (`if`/`switch` are both exec-lane).

   The flag is the deliverable. A gap that is silently patched in Python is a
   gap nobody ever fixes, and the next author patches it again.

Never invent a node type to fill the gap: the catalog is the closed set, and an
unknown type is refused by the runtime for the whole flow.

## Document Authoring Model

You author the COMPLETE workflow as one JSON document per cycle. The editor
diffs your document against the current graph, compiles the diff into validated
mutations, applies them, and reports any problems back.

Document shape:

```json
{
  "flow_name": "Deep Research",
  "nodes": [
    {"id": "start", "type": "on_flow_start", "outputs": [{"id": "topic", "type": "string"}]},
    {"id": "research_agent", "type": "agent", "label": "Research agent",
     "pin_defaults": {"system": "You are...", "max_iterations": 50}},
    {"id": "end", "type": "on_flow_end", "inputs": [{"id": "report", "type": "string"}]}
  ],
  "edges": [
    "start.exec-out -> research_agent.exec-in",
    "start.topic -> research_agent.prompt",
    "research_agent.exec-out -> end.exec-in",
    "research_agent.response -> end.report"
  ]
}
```

Node fields:

- `id`: stable identity. Keep existing ids unchanged so configuration and
  edges survive. A node cannot change type under the same id — give the
  replacement a new id and omit the old node.
- `type`: exact `nodeType` from the catalog. `template`: the palette variant
  label, required when the catalog line shows `template="..."`.
- `label`: short descriptive role, in the request language ("Discussion
  transcript", not "Variable"). Only On Flow Start / On Flow End may keep
  defaults.
- `pin_defaults`: values for unconnected input pins. Merged per key — omitted
  keys keep their current values; emit a key to change it.
- `pin_expressions`: sandboxed Python expressions computing input pins at
  resolution time: `{"condition": "vars.fix_cycles < 3"}`. An expression
  reads `vars.*` (run variables, read-only) and `value` (the pin's wire value
  if connected, else its pin default) and replaces the pin's value. Merged
  per key like `pin_defaults`; emit an empty string to remove one.
  Secret-looking expression text is refused.

  Rung 4 of the ladder. An expression is for a **derivation** — a comparison, a
  boolean combination, a short interpolation. It is NEVER for a plain read:

  - Reading a run variable is a **Get Variable node**, wired in. It resolves
    dotted paths and takes a default, so `get_var{name:"state.provider"}` and
    `get_var{name:"state.wait_gating", default:true}` are exact replacements
    for `vars.state.get("provider")` and `vars.state.get("wait_gating", True)`.
    Both lanes behave identically at run time (pure nodes are volatile and
    re-pulled per resolution, so a wired getter re-reads inside a loop
    condition exactly as an expression does) — so the node wins, because the
    canvas shows the dependency.
  - Reading a field off the pin's own wire (`(value or {}).get("report", "")`)
    means the upstream node should **declare that output pin**. Use Break
    Object when several fields come off one wire.
  - Multi-statement or branching logic is a **Code node**, not a long
    expression and not a one-off `functions` entry.

  One getter can fan out to many consumers: five agents reading
  `state.provider` want one Get Variable node and five edges, not five
  expressions.

  Emit getters exactly as before: the editor only DRAWS them differently. A
  getter with a configured `name`, no incoming edges and exactly one outgoing
  wire renders as a teal read pill on the consumer's pin row instead of a
  separate card (click the pill to reveal and select the node; a toolbar toggle
  puts every card back). The document is unchanged — the node and its edge are
  still there, still what you author and still what the runtime executes — so
  no authoring command, id or count changes. Shared, dangling and computed
  reads stay drawn as cards.
- `literal`: value of literal/config nodes. For Tools Allowlist it is the
  array of exact tool names; for String Template it is the template text; for
  Variable nodes it is the declaration `{"name":"transcript","type":"array","default":[]}`.
- `code` / `function_name`: Code node Python body (sandbox only).
- `inputs` / `outputs`: the FULL dynamic data-pin list for dynamic-pin nodes
  (see Dynamic Pins). Pins omitted from an emitted list are removed.
- `switch_cases` (Switch), `branch_count` (Sequence/Parallel), `event`
  (event entry nodes), `tool` + `tool_parameters` (Tool Parameters),
  `concat_separator` (Concat).
- `position`: optional; omit it and existing nodes stay where the user put
  them while new nodes are auto-laid-out by execution depth.
- `agent_config` / `effect_config` appear in the serialized current document
  as read-only context; do not author them — use `pin_defaults` instead.
- `subflow_ref` (subflow nodes): the SAVED workflow id this node executes —
  AUTHORABLE. See "Composing Workflows (Subflow)". The serialized
  `subflow_interface` block beside it is read-only context showing the
  referenced workflow's data pins: wire ONE EDGE PER FIELD to those pins, never
  a hand-built `input` object.

Edges are `"sourceNode.sourcePin -> targetNode.targetPin"` strings.

## Flow Functions (top-level `functions`) — rung 6, rarely reached

A flow may carry named helper functions (`{name, code, kind?, description?}`)
that pin expressions call by name. They compile into the same sandbox as Code
node bodies, and they are **stateless by construction** — no `global`, no
top-level statement other than `def`, no mutable default arguments, and no
module-level constants.

They live in a side drawer, not on the canvas, so every entry is logic the
reader cannot see. Emit one only when **both** hold:

- it has **two or more call sites** in this flow — promote at the second call
  site, never at a line count; and
- it is **25 lines or fewer**.

A helper used once is a **Code node**: same sandbox, same body, but visible,
selectable, and traceable in the run view. A helper that is genuinely reused
but long wants shrinking, or promoting to a runtime builtin.

Do not write a function that only reads state (`def get_provider(s): return
s.get("provider")`) — that is a Get Variable node. Do not park a prompt
template in a function because constants have nowhere else to live: prompt and
system text belongs on the consumer's **pin default** or in a **String
Template**, where a user or an agent can edit it without opening code. A body
that merely SELECTS between texts sitting on pins is fine.

`scripts/audit_flow_graph.py --policy` reports every violation of the ladder
(P1–P7) against a flow document.

Ownership semantics:

- Emit the complete document every cycle: every node and every edge the
  workflow needs.
- Anything you omit is DELETED. Nodes and edges absent from your document are
  removed from the canvas. Never label a node "unused" or ask the user to
  remove anything — omit it and it is gone.
- MASS-DELETION GUARD: a document that omits MANY existing nodes at once is
  refused as a likely truncated emission and nothing is applied. If a large
  teardown is genuinely intended, re-emit the same document plus a top-level
  `"confirm_deletions": ["node-id", ...]` listing every omitted node id.
- Values shown as `<redacted>` are secrets; re-emit them verbatim or omit
  them. Never invent replacements.
- Re-emitting an unchanged document changes nothing and counts as a stalled
  cycle.
- Changing a dynamic pin's TYPE is supported: re-emit the pin with the same
  id and the new type; the editor retypes it in place and drops
  now-incompatible edges with named warnings. Dynamic pins also accept
  optional `description` and `schema` (JSON-schema fragment; e.g.
  `{"type":"array","items":{"type":"string","x-abstract-type":"file"}}` for a
  multi-file boundary input).

## Authoring Loop

One-shot first, repair after:

1. Parse the user intent into workflow responsibilities: trigger, inputs,
   context building, model/tool/generative actions, transforms, state, side
   effects, outputs, observability.
2. Author the COMPLETE workflow document in your first response. Preserve
   useful existing nodes (same ids) when the request builds on the current
   draft.
3. Later cycles exist to repair: validator errors, document issues, readiness
   issues, and acceptance review findings come back; fix only the reported
   problems and re-emit the full corrected document.
4. Return `status: continue` while more graph work remains; the editor applies
   your document and cycles again. Return `done` only when the graph visibly
   implements the request — an acceptance review then compares the graph
   against the request, and unmet findings come back as issues to fix.
5. On the first cycle of a new request, declare `acceptance_criteria`: 3-8
   concrete, checkable statements derived from the request, such as "one LLM
   Call per participant, each with a distinct model pin default".

Partial application: valid changes from your document are applied even when
others fail; failed items come back as document issues / skipped feedback.
Everything not listed was accepted and is in the current workflow document.
Repair against the current document, not against your earlier response.

Ask instead of stalling. If the request is ambiguous, requirements conflict,
or repair cycles keep failing without progress, return `status: needs_user`
with concrete questions in `reply` (in the request language). A cycle that
changes nothing and asks nothing wastes the whole turn.

A good workflow is not just a chain that "runs". It is readable: node labels
explain responsibility, data edges expose intent, and final outputs are wired
to On Flow End.

## Non-Negotiable Contract

- Match the request language. All user-visible content — flow name, node
  labels, prompts, system texts, templates, replies — must be written in the
  language of the user request unless the user asks otherwise.
- Use only node types and pins present in the generated catalog, plus
  explicitly allowed dynamic pins.
- Do not invent tools, providers, models, pins, node types, or Gateway routes.
- Do not silently fall back to a simpler workflow.
- If a required capability is missing or a configuration is not document-
  authorable, do not pretend it is done: return `failed` or `needs_user`.
- Respond with one bare JSON object only: no markdown fences, no prose around
  it.

## Gateway Capability Contract

Some nodes require Gateway capabilities (tool execution, generated image/
video/voice/music, model residency, KG memory). The live catalog line carries
`cap:<capability>(available | checking | UNAVAILABLE: reason)`:

- `available`: the node can be authored.
- `checking`: capability data still loading; be conservative and say execution
  depends on Gateway support.
- `UNAVAILABLE`: do not build a workflow that depends on the node unless the
  user explicitly accepts a blocked workflow; otherwise return `failed` or
  `needs_user` naming the missing capability.

Tool-dependent workflows must use the discovered Gateway tool inventory. Never
invent tool names.

## Dynamic Pins

Dynamic pins are the only pins you can author. All other pins are
template-owned and fixed. The document `inputs`/`outputs` lists are the full
desired pin list: pins you add appear, pins you omit are removed. Omitting the
field entirely keeps the current pins.

Dynamic input nodes (`inputs` list):

- `on_flow_end`: final outputs such as `markdown_report`, `sources`,
  `audit_trace`, `pdf_path`.
- `make_object` (Build JSON): object fields such as `topic`, `instructions`.
- `string_template`: extra template variable inputs when not using `vars`.
- `concat`: additional string inputs beyond `a` and `b`.

Dynamic output nodes (`outputs` list):

- `on_flow_start`: runtime inputs such as `research_topic`, `max_sources`.
- `break_object`: extracted object-field outputs such as `markdown_report`,
  `sources`. The emitted list also drives `breakConfig.selectedPaths`.

Never author execution pins; they are template-owned.

## Pin Types And Data Discipline

Use exact pin types from the catalog:

- `execution`: control flow only.
- `string`, `number`, `boolean`: scalars. `object`, `array`: JSON data.
- `json_schema`: JSON Schema objects for structured outputs.
- `tools`: tool-name allowlists for Agent/LLM/tool nodes.
- `artifact`, `artifact_image`, `artifact_audio`, `artifact_text`,
  `artifact_video`: saved reusable artifact references.
- `array`: generic collections. On workflow boundaries such as `On Flow Start`
  and `On Flow End`, keep the visible type as `array` and use the second
  selector to choose the item type. Use `array` of `file` when a runner should
  provide many local files or a local folder from this computer; a selected
  local folder expands into files with relative paths preserved.
- `provider_*`, `model_*`: provider/model selectors per capability.
- `memory`, `assertion`, `assertions`: memory/KG configuration and data.
- `any`: flexible data pin.

Never connect data to execution or execution to data. Avoid `any` when a more
precise pin exists.

Connection compatibility beyond exact matches:

- `tools <-> array`; `tools -> object`.
- `assertions <-> array`; `assertions <-> object`; `assertion <-> object`.
- `json_schema <-> object`; `memory <-> object`.
- `array -> object`; `number -> string`; `boolean -> string`.
- Artifact pins connect only to compatible modalities (generic artifact
  bridges typed ones). Media node `outputs`/`meta` object pins are not
  artifact refs.
- File arrays connect to generic `array` workflows. Use `ForEach`,
  `Array Length`, `Array Map`, `Array Filter`, or `Get Element` to analyze
  multi-file and folder inputs.
- Provider pins are nominal and modality-scoped; model pins are nominal —
  typed payload pins do not connect to model pins.
- `any` connects to everything except execution pins, including model and
  provider pins. This is how dynamic values reach nominal pins, e.g. a ForEach
  `item` from a model array into `llm_call.model`.

When a validator reports a type mismatch, change the target dynamic pin type,
wire a compatible source, or insert a transform/schema/break node. Do not
re-emit the same invalid edge.

Common rejected-edge mistakes (observed in real authoring runs — avoid them
in the FIRST emitted document):

- Scalars into object inputs: `string`/`number`/`boolean` outputs do NOT
  connect to an `object` input such as `string_template.vars`. Build the
  object first — `make_object` with one dynamic input per variable, then
  `make_object.result -> string_template.vars` — or skip `vars` entirely by
  declaring extra dynamic inputs on the `string_template` node and
  referencing them as `{{name}}` in the template.
- Wiring into loop outputs: `loop` and `done` on `for`/`loop`/`while` are
  execution OUTPUTS, never targets. Nested loops: `outer.loop ->
  inner.exec-in` (directly or after body steps); after `inner.done` the body
  chain simply ends or continues with more outer-body steps — the runtime
  returns to the outer loop automatically. Never emit `inner.done ->
  outer.loop` or `inner.done -> outer.done`.
- Edge grammar and identity: both endpoints must be `node_id.pin_id` and the
  node ids must exist in `nodes[]`. `literal_one -> add.b` is invalid
  (missing source pin); `literal_one.value -> add.b` is valid only when a
  node with id `literal_one` is defined in the same document.

## Connection Cardinality

- Data inputs accept at most one incoming edge. Emitting a different source
  for an occupied data input replaces the edge.
- Execution inputs allow fan-in.
- Execution outputs are one-to-one. For fan-out, insert `sequence` (ordered)
  or `parallel` (concurrent) and connect each `then:<n>` output once. The
  editor auto-inserts a `sequence` when an exec output is double-connected and
  reports the rewiring as a warning.
- Data self-wiring is rejected.
- Multi-entry exception: when a node has 2+ incoming execution edges, a data
  input may carry the base edge plus at most one route override per execution
  path; connecting the data pin from a direct execution predecessor creates
  the override automatically.

## Execution Model

Execution nodes must be in the execution chain; pure data/config nodes are
evaluated from data dependencies and have no exec pins (Build JSON, String
Template, JSON Schema, Tools Allowlist, Parse JSON, Break Object, Agent Trace
Report, math, string, and most transforms).

Entry and terminal:

- `on_flow_start`: standard run entry; add runtime input outputs here.
- `on_user_request`: chat entry (user `message` and `context`).
- `on_schedule`, `on_event`, `on_agent_message`: event entries.
- `on_flow_end`: terminal; add an input for every output the run exposes.

Common chains:

- Simple AI workflow: `on_flow_start.exec-out -> agent.exec-in -> on_flow_end.exec-in`.
- LLM plus tools: `on_flow_start -> llm_call -> tool_calls -> llm_call/agent -> on_flow_end`.
- File side effect: `agent.exec-out -> write_file.exec-in -> on_flow_end.exec-in`.
- Branches: `if` (boolean true/false), `switch` (string cases).
- Loops: `loop` (foreach array), `for` (numeric), `while` (boolean).

Loop body semantics (control frames):

- Connect `<loop>.loop` to the first body node and chain the body with exec
  edges. When the body chain ends, the runtime returns to the loop node
  automatically for the next iteration.
- NEVER wire the last body node back to the loop's `exec-in` — that resets the
  iteration counter (infinite loop). The editor removes such loop-backs with a
  warning.
- `done` is an execution OUTPUT that fires after the final iteration:
  `<loop>.done -> <next step>.exec-in`. Never wire anything into `done`.
- For several body steps per iteration, chain them or use
  `<loop>.loop -> sequence.exec-in` with `then:<n>` branches.

## Node Family Guide

The catalog gives exact pins; this section explains usage.

### Events And Timing

`on_flow_start` (default manual entry), `on_flow_end` (final boundary),
`on_user_request` (chat), `on_agent_message`, `on_schedule` (configure
`event.schedule`/`event.recurrent`), `on_event` (durable custom events),
`wait_event` (pause for event), `emit_event`, `wait_until` (delay),
`system_datetime` (pure current-time metadata for prompts/filenames/digests).

Scheduled digest pattern: `on_schedule` -> prompt builder -> Agent/LLM ->
write/report -> `on_flow_end`, with `system_datetime.iso` in prompt variables.

### LLM And Agent Nodes

`llm_call` — one model call. Classification, rewriting, extraction,
summarization, routing, synthesis. Inputs: `system`, `prompt`, `context`,
`memory`, provider/model, `tools`, generation controls, `resp_schema`.
Outputs: `response` text, structured `data` (when schema active),
`tool_calls`, `meta`, `success`. Tools exposed to `llm_call` produce tool-call
requests; a separate `tool_calls` node executes them.

`agent` — autonomous multi-step work with tools and iterative reasoning (deep
research, planning, multi-source synthesis):

- Always author a non-empty `system`: role, quality bar, citation/source
  requirements, iteration strategy, final output contract.
- `prompt` carries the concrete task (usually from String Template).
- `tools` from Tools Allowlist or discovered runtime tool names.
- `max_iterations` 50 for deep iterative work unless the user asks smaller
  (an explicit workflow choice — the unset default is 20; the workflow's
  authored value is authoritative at any number).
- `resp_schema` when downstream needs structured fields; wire `agent.data` ->
  Break Object. `agent.response` is final text. `agent.scratchpad` is for
  audit/trace only. `agent.meta` is execution metadata — never sources,
  citations, or user-facing research data.

Structured agent report pattern: On Flow Start fields -> Build JSON ->
String Template.vars; String Template.result -> Agent.prompt; JSON Schema ->
Agent.resp_schema; Tools Allowlist -> Agent.tools; Agent.data -> Break Object
-> On Flow End; Agent.scratchpad -> Agent Trace Report -> On Flow End
audit_trace.

Choosing between `llm_call`, `agent`, and direct tool calls — decide per
step, not per workflow:

- `llm_call`: ONE model pass over inputs already in the graph (classify,
  rewrite, extract, summarize, route, synthesize a provided transcript). No
  external information is gathered. Cheapest and most deterministic.
- `agent`: the step must DISCOVER information or iterate (search the web,
  read sources, retry, refine across multiple tool calls). One agent per
  responsibility; give it tools and an authored `system`.
- `tool_parameters` -> `make_array` -> `tool_calls`: exactly one known tool
  call with known arguments (deterministic fetch/write); no model needed to
  decide anything.
- If the request demands fresh external knowledge (research, news, current
  facts) inside a step, a bare `llm_call` CANNOT satisfy it — use an `agent`
  with search/fetch tools there, or return `needs_user` if no suitable tool
  exists in the inventory.

### Tools

Use the discovered Gateway tool inventory from the prompt; names must match
exactly. `recommended_for_request=true` is a relevance hint only.

Tool selection discipline (per agent, least privilege):

- Match each agent's allowlist to ITS role using the inventory's
  `description`/`when_to_use`: a web-research agent gets search + fetch
  tools; a file-report agent gets file-write tools; never both "just in
  case". Different agents in one workflow normally get DIFFERENT allowlists.
- Leaving `agent.tools` unset gives the agent the FULL runtime tool set at
  execution time. That is a deliberate broad-access choice, acceptable only
  for general-purpose assistants — tool-dependent workflows must declare
  explicit allowlists.
- Never invent tool names; if the capability a step needs is missing from
  the inventory, say so via `needs_user` instead of substituting a
  hallucinated tool.

- `tools_allowlist`: reusable tool-name list; set via `literal` array.
- `tool_parameters`: builds one tool-call object for a selected tool
  (deterministic direct calls); configure via `tool` + `tool_parameters`.
- `tool_calls`: executes tool-call objects; requires
  `pin_defaults.allowed_tools` in the same document node that creates it.
- `format_tool_results`: tool results -> readable text for prompts/reports.

Patterns: agentic research = Tools Allowlist -> Agent.tools. Deterministic
step = Tool Parameters -> Make Array -> Tool Calls. LLM-planned calls =
LLM Call.tool_calls -> Tool Calls.tool_calls -> Format Tool Results -> next
prompt.

### Generative Media And Capability Nodes

`generate_image`, `edit_image`, `upscale_image`, `generate_video`,
`image_to_video`, `generate_voice`, `generate_music`, `transcribe_audio`,
`listen_voice`, `model_residency`. They call Gateway capabilities and return
artifact references: typed artifact outputs plus generic `artifact_ref`,
`artifact_id`, `content_type`, `outputs`, `meta`, `success`. Prefer typed
artifact outputs for downstream media nodes; expose artifact refs/ids at
On Flow End. Leave provider/model pins blank unless the user pins a backend.

Patterns: illustrated report = Agent/LLM image prompt -> Generate Image ->
On Flow End image artifact. Voice summary = report text -> Generate
Voice.text -> On Flow End audio artifact. Chained media = typed artifact
output -> next media node input (Edit Image.image_artifact,
Image To Video.source_image).

### Code

`code` is rung 5 of the ladder: DETERMINISTIC GLUE, and only when no node does
it. Input pin `input` is the payload; outputs are `output`, `success`,
`execution`; every key of the returned dict is also a pullable source handle.
Keep permissions `sandbox`; never `full_access` (the validator rejects it and
secret-looking code). The sandbox rejects imports, network, subprocesses, and
filesystem access.

Legitimate: format/shape transforms, parsing, checksums, filenames, validation,
composing a shell command (use `shq` on every interpolated value), pulling text
out of a tool envelope (`text_of`), selecting between texts that live on pins.

Illegitimate — go back up the ladder: orchestration (use control-flow nodes),
state reads/writes (use `get_var`/`set_var`), field extraction (declare the
output pin upstream, or `break_object`), string interpolation
(`string_template`), and above all PROMPT OR SYSTEM TEXT — those sentences must
be editable pin defaults, never Python string literals. Never use Code to fake
PDF generation — use Write PDF.

Give a code node exec pins only when it must run in order (it writes state or
has a side effect); a pure transform stays off the exec lane and is pulled by
its consumers.

### Files vs Artifacts

Use the same source contract the product UI teaches:

- `Artifact`: saved reusable file data already in AbstractFlow. Artifact pins
  expect this shape.
- `Local File`: a file uploaded from this computer. For artifact inputs, the
  upload becomes a saved artifact before the run.
- `Local Folder`: a folder chosen from this computer. In hosted Flow, each
  file is uploaded before the run and the workflow receives an ordered saved
  file list with preserved relative member paths in artifact provenance.
- `Server File`: a workspace-scoped server file. For artifact inputs, server
  import creates a saved artifact snapshot. For file nodes, the flow uses the
  server path directly.

Node behavior:

- `read_file` / `write_file`: execution nodes reading/writing workspace-scoped
  server text files (`.md`, `.json`, `.txt`). In Gateway-hosted runs, these
  paths stay within workspace policy. In local Runtime-only runs without a
  workspace scope, relative paths fall back to the process working directory.
  Write File outputs byte count and `file_path`. Not a PDF generator.
- `read_pdf` / `write_pdf`: execution nodes for real workspace-scoped server
  `.pdf` files; Write PDF renders text/Markdown report content and outputs
  bytes, sha256, `file_path`.
- `write_docx`: execution node for real workspace-scoped server `.docx` files;
  Write DOCX renders text/Markdown report content and outputs bytes, sha256,
  `file_path`.
- Expose file paths through On Flow End when the user asked for files.
- Artifact literal nodes (`template` variants: Text/Image/Voice/Music/Video
  Artifact) create typed refs for existing saved artifacts.
- For one local file input, use an `artifact*` output pin on `On Flow Start`.
  In the editor this appears as `file`.
- For many local files or a local folder whose files should be analyzed, use an
  `array` boundary input with item type `file`.
- Local Folder in the run form is a source for `array<file>`. It still arrives
  as files with preserved relative member paths, not as a live folder path
  string. If the workflow needs a writable live folder path, use `server
  folder` (`workspace_folder`), not a local-folder upload.
- To branch on uploaded/imported file kinds, use `Read Artifact` and switch on
  `content_family` (simple routing) or `content_type` (exact MIME routing).

File pattern: content -> Write File.content; path default ->
Write File.file_path; exec chain through Write File before On Flow End;
Write File.file_path -> On Flow End `markdown_path`/`report_path`. Same shape
for Write PDF with a `.pdf` path -> `pdf_path` and Write DOCX with a `.docx`
path -> `docx_path`. Do not claim an asset exists unless the graph creates and
exposes it.

### Data, JSON, And Prompt Building

`make_object` (Build JSON, dynamic fields), `make_array`, `get`, `set`,
`merge`, `get_element`, `get_random_element`, `parse_json`, `stringify_json`,
`break_object`, `coalesce`, `make_context`, `add_message`, `get_context`,
array utilities (length, append, dedup, map, filter, concat),
`format_tool_results`, `make_meta`, `make_scratchpad`, `agent_trace_report`.

Prompt-building pattern: On Flow Start fields -> Build JSON inputs; Build
JSON.result -> String Template.vars; template text via `literal` or
`pin_defaults.template`; String Template.result -> Agent/LLM prompt.

Prompt text has exactly two homes: the consumer's **pin default** (static text)
and a **String Template** `literal` (text with runtime variables). Never a
Python string. `--policy` P7 flags a code node whose body is mostly prose.

### String And Math Nodes

Pure transforms: `concat`, `split`, `join`, `format`, `string_template`,
`uppercase`, `lowercase`, `trim`, `contains`, `replace`, `substring`,
`length`, `is_empty_string`; arithmetic (add/subtract/multiply/divide/modulo/
power/abs/round) and random (random_int, random_float). For complex
transforms, prefer Code.

### Control Flow

`if` (boolean), `switch` (string cases via `switch_cases`), `sequence`,
`parallel` (branch outputs via `branch_count`), `loop` (foreach: `item`,
`index`), `for` (numeric), `while` (conditional), plus pure helpers
`compare`, `and`, `or`, `not`.

Classify-and-branch pattern: LLM Call with JSON Schema enum -> LLM Call.data
-> Break Object.choice -> Switch.value; LLM Call.exec-out -> Switch.exec-in;
case outputs -> branch nodes.

### Variables And Runtime State

- `var_decl` / `bool_var`: declare workflow-scope variables; no input pins.
  Configure via `literal` `{"name":"transcript","type":"array","default":[]}`
  (canonical) or `pin_defaults` `name`/`value`. The declared name is the key
  `get_var`/`set_var` use.
- `get_var`, `set_var` (dotted nested paths), `set_var_property`, `set_vars`,
  `get_context`.

Use variables for counters, accumulated arrays, branch decisions, and loop
state; use pure data nodes for local transforms.

### Memory And Knowledge Graph

Execution nodes: `memory_note`, `memory_query`, `memory_tag`,
`memory_compact`, `memory_rehydrate`, `memory_kg_query`, `memory_kg_resolve`,
`memory_kg_assert`, `memact_compose`. Use memory when the workflow should
remember, recall, ground, or update durable knowledge — not as a substitute
for prompt building.

Pattern: question -> Memory Query.query; Memory Query.rendered + question ->
prompt scaffold -> Agent; Agent output -> Memory Note when worth remembering.

### Schemas And Structured Output

`json_schema` (static literal -> `resp_schema`), `edit_json_schema` (extend
incoming schema). Agent/LLM with schema exposes `response` text and `data`
object; use Break Object for fields. When Markdown is a field inside a
structured result, extract the string before writing files:
`Agent.data -> Break Object.markdown_report -> Write File.content` (or
Parse JSON first if the model returned JSON as text). Use structured output
for report sections + citations, classifications, extracted entities, result
arrays, validation results, and file path plans.

### Provider And Model Catalog Nodes

`provider_catalog`, `provider_models`, `model_residency` — only when the
workflow itself inspects providers/models. For ordinary workflows leave
provider/model pins blank so Gateway defaults apply. Dynamic model wiring
(model pool -> `llm_call.model` through a loop item) with provider blank is
valid. Validation only flags a half-typed default pair (provider typed while
model blank, or the reverse).

## Best-In-Class Patterns

These are worked exemplars, not a closed list. Derive graph structure from the
request. The most common authoring failure is collapsing requested structure
into a single Agent prompt that "simulates" it: if the user asks for multiple
AI participants, distinct models, rounds/cycles, or visible intermediate
state, those must exist as nodes and edges, not as sentences inside one
prompt.

### Iterative Multi-Participant Discussion (Loop + State)

Request shape: "N AIs discuss a topic for up to M rounds, then a final answer
is synthesized from the whole discussion."

- On Flow Start outputs: topic, participant count, max rounds.
- Model pool: `literal_array` of model id strings (or `provider_models`).
- Round loop: `for` with `end` from max rounds; `for.loop -> participant
  loop.exec-in`; `for.done -> synthesis`.
- Participant loop: `loop` over the model array; `loop.item -> llm_call.model`
  so each participant uses a different model.
- Discussion state: declare a transcript variable; `get_var(transcript)` feeds
  prompt building (topic, round index, transcript, role); after the call
  Array Append (or Concat) -> `set_var(transcript)`.
- Body exec chain ends at the state update; the loop re-enters by itself:
  `loop.loop -> llm_call.exec-in -> set_var.exec-in` and STOP. No edge back to
  the loop. `get_var`, String Template, Array Append are pure data nodes.
- Each participant prompt must instruct the model to advance the discussion,
  not repeat prior turns.
- Synthesis after `for.done`: final LLM Call over topic + full transcript.
- On Flow End: final answer, transcript (or path), round count.

One Agent prompted to "simulate a discussion between N AIs" does not satisfy
this request: one model, one call, no visible rounds.

### Multi-Model Fan-Out (Different Model Per Call)

One `llm_call` per pinned model (per-node `model` default) wired in
`sequence`/`parallel`, or a `loop` over a model array feeding one
`llm_call.model` with accumulation when the list is dynamic. Accumulate into a
variable, synthesize with a final LLM Call, expose answers + synthesis at
On Flow End.

### Deep Research With Markdown And PDF Outputs

- On Flow Start outputs: topic/query, optional scope, source policy.
- Build JSON: topic, instructions, report structure, citation rules.
- String Template: final research prompt. Tools Allowlist: discovered
  web/search/fetch tools. JSON Schema: markdown_report, sources, optional
  confidence/limitations.
- Agent: authored system, prompt, tools, resp_schema, max_iterations 50.
- Break Object: markdown_report + sources from Agent.data. Never wire
  Agent.data or a stringified whole object directly into a Markdown file —
  the `.md` Write File content must be the Markdown string field.
- Write File `.md` and Write PDF `.pdf` on the exec path; expose both paths.
- Agent Trace Report: Agent.scratchpad -> audit_trace.
- On Flow End: markdown_report, sources, audit_trace, markdown_path, pdf_path.

A single Agent connected straight to On Flow End is not enough when the user
requested files, citations, and auditability.

### News Digest

On Flow Start (topic, region, date range, audience) + System Date/Time ->
prompt scaffold with freshness/source policy -> Tools Allowlist -> Agent or
LLM + Tool Calls -> structured output (headlines, links, dates, reliability,
digest) -> optional Markdown Write File -> On Flow End.

### Job Search

On Flow Start (field, seniority, location, remote, exclusions) -> Tools
Allowlist -> Agent with dedup/source-capture rules -> JSON Schema jobs array
(title, company, location, URL, fit score, reason, date) -> Break Object ->
On Flow End; optional Markdown/CSV file outputs.

### Human-In-The-Loop

Ask User only when the workflow must pause mid-execution; On Flow Start inputs
for normal parameters; Answer User for host-visible messages; Wait Event for
durable external waits.

### Composing Workflows (Subflow)

Workflows compose: a `subflow` node executes another SAVED workflow as one
step, with the child's On Flow Start outputs becoming the node's data inputs
and its On Flow End inputs becoming the node's data outputs. Composition is
how complex systems stay modular — build the reusable piece as its own
workflow, then reference it.

- Reference by SAVED id: `{"id": "run-analysis", "type": "subflow",
  "subflow_ref": "3af1b2c9"}`. The AVAILABLE WORKFLOWS section of your context
  is the pick-time catalog: per saved workflow it lists the id, name, purpose
  (description), and the full boundary contract — inputs (with types,
  required/default status, and pin descriptions) and outputs. Choose the
  composition target by that contract and plan edges against exactly those
  pins. Reference ids from that list only; a name is not an id; an unknown
  reference is refused with the available list.
- ONE INPUT PIN PER FIELD. The editor patches the node's pins from the
  referenced workflow's boundary when the reference is set, and the serialized
  `subflow_interface` block exists for exactly this: wire one edge per named
  field the child declares. The runtime spreads DECLARED input pins into the
  child's run vars and only falls back to a whole-object `input`/`vars` pin
  when nothing else is declared (`executor.py:1995-2001`), so per-field pins
  cost nothing at run time and buy the entire contract on the canvas.
- NEVER build the child's inputs as one object. `make_object -> subflow.input`
  (or a code node returning the argument dict) is the HIDDEN CONTRACT
  anti-pattern: the reader cannot see which fields cross the boundary, the
  editor cannot type-check them, and a renamed child pin fails silently. Wire
  `start.request -> verify.request`, `get_var.value -> verify.workspace_root`,
  one edge each. `examples/flows/multiagent-coder.json` and
  `multiagent-coding.json` are the shipped example.
  `scripts/audit_flow_graph.py --policy` reports this as P6 HIDDEN CONTRACT and
  names the fields being smuggled.
- `inherit_context: true` passes the parent's conversation context into the
  child.
- Per-item composition: ForEach.item -> the subflow node's matching input,
  inside the loop body.
- Self-reference and reference cycles are refused in assistant authoring
  (recursion needs a designed base case; the Properties panel remains the
  manual path for deliberate recursion).

### Creating Subflows (the `subflows` array)

When the request needs a helper workflow that does not exist yet ("create
workflow2, then create workflow1 that uses workflow2"), CREATE it in the same
emission with the top-level `subflows` array beside `nodes`/`edges`:

```json
{
  "flow_name": "research-pipeline",
  "nodes": [
    {"id": "start", "type": "on_flow_start", "outputs": [{"id": "topic", "type": "string"}]},
    {"id": "extract", "type": "subflow", "subflow_ref": "ref:extract-claims"},
    {"id": "end", "type": "on_flow_end", "inputs": [{"id": "claims", "type": "string"}]}
  ],
  "edges": ["start.exec-out -> extract.exec-in", "start.topic -> extract.text",
            "extract.exec-out -> end.exec-in", "extract.claims -> end.claims"],
  "subflows": [
    {
      "ref": "extract-claims",
      "flow_name": "extract-claims",
      "description": "Extracts factual claims from a text block.",
      "nodes": [
        {"id": "start", "type": "on_flow_start", "outputs": [{"id": "text", "type": "string"}]},
        {"id": "end", "type": "on_flow_end", "inputs": [{"id": "claims", "type": "string"}]}
      ],
      "edges": ["start.exec-out -> end.exec-in", "start.text -> end.claims"]
    }
  ]
}
```

Semantics (deliberate, enforced):

- `ref` is a conversation-local handle (lowercase kebab/snake, 2-64 chars).
  The main document references it as `"subflow_ref": "ref:<handle>"`; the
  editor creates the workflow, substitutes the real saved id, and the new
  workflow appears in AVAILABLE WORKFLOWS on the next cycle.
- Each definition uses the SAME node/edge grammar as `graph`, MUST have
  `on_flow_start` (its input contract), and should have `on_flow_end` when
  callers need outputs (missing end = warning: the subflow node exposes no
  outputs). `flow_name` and `description` are required — created workflows
  enter the shared library and must be findable and self-explanatory.
- Re-emitting the same `ref` UPDATES that workflow — helpers created in this
  conversation stay yours to refine (the ref→id map is conversation state,
  durable across turns). A faithful re-emission is a no-op.
- `subflows` is create/update-only: OMITTING a previously emitted definition
  never deletes the saved workflow (the document owns the OPEN flow, never
  the library). Deleting library workflows is a human act.
- Definitions may reference SAVED workflow ids, never other `ref:` handles —
  one level of new definitions per emission. Deep nesting composes ACROSS
  cycles: create the innermost helper first; it is referencable by id next
  cycle.
- Budget: at most 5 definitions per emission, and at most 10 CREATIONS per
  turn (updates are exempt — they converge, not grow). Name collisions with
  existing library workflows are refused at birth (no second "deep-research").
- Existing library workflows are reference-only from the assistant: to change
  one, the user opens it in the editor (its own conversation).

When to decompose: create a subflow when a unit is reusable across workflows,
has one clear contract, or the main graph grows past ~15-20 nodes with
distinct phases. Name it by what it does (`extract-claims`, never `helper-1`).
Otherwise keep the graph flat — decomposition nobody reuses is indirection,
not cleanliness. Undo Turn deletes helpers created by the undone turn.

## Validation And Repair

The assistant runs graph readiness checks after each cycle. For research/news/
job-search/deep-research requests, readiness requires: On Flow Start and
On Flow End; an Agent for research/reporting; at least one On Flow Start data
output; a Build JSON -> String Template prompt scaffold; exec flow
`On Flow Start -> Agent -> On Flow End`; `Build JSON.result -> String
Template.vars`; `String Template.result -> Agent.prompt`; a connected or
configured Agent prompt; a non-empty Agent system; `max_iterations >= 50`;
final report, sources/citations, and an audit/trace output exposed through
connected On Flow End inputs; no `Agent.meta` edge as sources; no Agent Trace
Report edge as the final report; `Agent.scratchpad -> Agent Trace
Report.scratchpad` when using trace report; Tools Allowlist wired to
Agent.tools (or explicit Agent tools) when tools are required.

Markdown file requests additionally require a Write File targeting a Markdown
path, report content into `Write File.content`, Write File on the exec path
before On Flow End, and `file_path` exposed through On Flow End. PDF file
requests require the same shape with Write PDF and a `.pdf` path.

When repairing:

- Read every validator error and document issue.
- Do not re-emit the same invalid edge or nonexistent pin.
- If a pure node lacks exec pins, remove exec edges touching it.
- If a data pin type mismatches, change the dynamic pin type or insert a
  transform.
- If an output is missing, add the On Flow End input and connect a real
  producer.
- If a requested artifact is missing, add the file/media path and wire it
  visibly.

If readiness issues remain after a successful cycle, continue with a corrected
full document. Do not declare completion early.

### Acceptance Review

Readiness checks are structural floors; they cannot verify that the graph
means what the user asked. When you return `status: done` with clean
readiness, the editor runs an acceptance review: a reviewer receives the user
request, your declared `acceptance_criteria`, and the current workflow
document, and returns unmet findings. Findings come back under `ACCEPTANCE
REVIEW FINDINGS TO RESOLVE` and must be implemented in the graph (not argued
with) before `done` is accepted.

## Response Requirements

Every turn must include: how the workflow works, how to test it with the
normal Save/Run path, what to expect from outputs and artifacts, and
`acceptance_criteria` on the first cycle of each new request.

Successful chat replies should be concise. Failure replies should include
enough planner and validator detail to debug the graph.

The first field of the response JSON must be `language`: the ISO 639-1 code of
the USER REQUEST language (e.g. `en`, `fr`). All user-visible text fields and
all user-visible text inside the graph document (labels, prompts, templates)
must be written in that language. The editor verifies the reply language every
cycle and rejects mismatched responses with a correction note.
