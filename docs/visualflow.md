# VisualFlow JSON

VisualFlow is the portable workflow document produced by the AbstractFlow editor and persisted by AbstractGateway.

Execution semantics are owned by AbstractRuntime. Flow's job is to author and serialize the graph.

## Shape

```json
{
  "id": "workflow-id",
  "name": "Workflow Name",
  "nodes": [
    {
      "id": "node-1",
      "type": "llm_call",
      "position": { "x": 100, "y": 80 },
      "data": {
        "nodeType": "llm_call",
        "pinDefaults": {}
      }
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "node-1",
      "sourceHandle": "exec-out",
      "target": "node-2",
      "targetHandle": "exec-in"
    }
  ],
  "entryNode": "node-1"
}
```

## Authoring Rules

- Nodes contain editor data and runtime-facing pin defaults.
- Execution edges connect `exec-out` to `exec-in`.
- Data edges connect typed pins.
- Provider/model pins should use Gateway-discovered provider ids and models.
- Secrets must not be embedded in VisualFlow JSON.
- Reusable endpoint credentials belong in Gateway provider endpoint profiles.

## Pin Expressions

A data input pin may carry a small sandboxed Python expression instead of a
wire or a static default. Expressions are stored on the node as
`data.pinExpressions` — a field of its own, deliberately never encoded inside
`pinDefaults`:

```json
{
  "id": "loop",
  "type": "while",
  "data": {
    "nodeType": "while",
    "pinExpressions": { "condition": "vars.fix_cycles < 3" }
  }
}
```

AbstractRuntime evaluates the expression at input resolution on the consuming
node, after wires and pin defaults have resolved, and the result replaces the
pin's value. The expression environment is small:

- `vars` — the run variables, read-only (`vars.count`, `vars["count"]`,
  `vars.get("count", 0)`, `"count" in vars`). Writing state stays the
  Set Variable node's job.
- `value` — what the pin would have resolved to without the expression: the
  wire value if connected, else the pin default, else `None`.
- The Code-node sandbox builtins (`len`, `sorted`, `sum`, ...) plus
  `parse_json` / `to_json` / `shq` / `text_of`. The last two are for the two
  things flows kept hand-rolling: `shq(value)` escapes a value for a
  single-quoted shell context (`"cd '" + shq(path) + "'"`) — use it for every
  value you interpolate into a command, one unescaped quote is an injection —
  and `text_of(envelope)` pulls the text out of a tool result whatever
  envelope shape it arrives in. Both are available in Code node bodies too
  (one source, both sandboxes), which is what lets a shell-command composer be
  a Code node with a visible body rather than a flow-library function.

Expressions compile under the same RestrictedPython policy as Code node
bodies, in expression mode: statements and imports cannot appear, while
lambdas, comprehensions, and conditional expressions remain available.
Failures are loud and attributed — an unparseable expression fails the flow
build naming node and pin, and an expression that raises at run time fails
the consuming step with an error naming `<node>.<pin>` plus an expression
preview. Evaluation happens at every resolution, so a While condition
expression re-reads `vars.*` fresh each iteration.

### The authoring ladder

An expression is one rung of a ladder, and the ladder has one rule: **nodes and
wires first, always.** Visual authoring exists so a process can be understood by
looking at it. Anything expressed off the canvas — in a code body, an
expression, a function, or one object blob crossing a boundary — is hidden, and
the reader has to open something to learn what the flow depends on.

Code and pure functions are here to harness DETERMINISTIC or tedious work —
contact a database, run an ETL, convert format 1 to format 2 — so the node
vocabulary does not have to explode combinatorially. They are not a replacement
for the abstractions that already ship, which must always be favoured.

Walk from the top; stop at the first rung that works.

| rung | reach for | for |
|---|---|---|
| 1 | **an existing node** | anything the catalog ships. Check `docs/workflow-node-catalog.md` before writing a line of Python. |
| 2 | **a subflow, one input pin per field** | a whole reusable process. `subflow_interface` names the child's pins; wire one edge each. Never a hand-built `input` object. |
| 3 | **`get_var` / `set_var` / `set_vars`** | reading and writing run state. |
| 4 | **a pin expression** | a derivation: `vars.fix_cycles < 3`, `not vars.accepted and vars.revisions < 3`, `to_json(value)`. Never a plain read. |
| 5 | **a code node** | deterministic glue: external systems, ETL, format/shape transforms, checksums, validation, shell composition. Exec pins when it acts; pure otherwise. Expert territory. |
| 6 | **a flow function** | the same derivation at 2+ call sites, ≤ 25 lines. |
| 7 | **a runtime builtin** | something useful in every flow (envelope parsing, shell quoting). |
| 8 | **propose a reusable node** | nothing above fits — say so, out loud, instead of working around it in a body. |

Within rung 4, what an expression is NOT for:

| what you are doing | use |
|---|---|
| reading a run variable, incl. a dotted path and a default | **Get Variable** node, wired in |
| reading one field off this pin's own wire | declare that **output pin upstream** |
| reading several fields off one wire | **Break Object** |
| interpolating values into a string | **String Template** |
| combining two reads with `and` / `or` / `not` / a comparison | those nodes, or an expression |
| multiple statements, branching, several outputs | **Code node** |
| the same derivation at two or more call sites | a **flow function** (≤ 25 lines) |

And what a **code node is never for**: orchestration (sequence/parallel/if/
switch/loop/for/while own that), state reads and writes, field extraction, or
**prompt and system text**. Every sentence a model reads must be editable by a
user or an agent without opening Python — it lives on the consumer's pin default
or in a String Template. A body may SELECT between texts that sit on pins; it
may not contain them.

It is never for a plain read. The runtime treats both lanes identically (every
pure node is volatile and re-pulled at each resolution, so a wired getter
re-reads inside a `While` condition exactly as an expression does), so the
choice is purely about what the canvas shows — and a node shows it.

`get_var` resolves dotted paths and honours a `default`, so
`get_var{name:"state.wait_gating", default:true}` is an exact replacement for
`vars.state.get("wait_gating", True)` — including the missing-key case. One
getter can fan out to many consumers; five agents reading `state.provider`
want getter nodes and edges, not five expressions.

How far to fan one getter out is a LAYOUT question, and the honest answer is
"per neighbourhood", not "once per flow". Auto-layout puts a pure helper in
the column of its EARLIEST consumer, so a getter shared by consumers ten
columns apart drags a wire the width of the canvas. Cluster consumers that sit
within a column or two of each other, give a distant cluster its own getter,
and measure: on the `multiagent-coding` bundle, one pair per agent cost 10
chips, one pair for all five produced a 7,872px wire, and three neighbourhood
pairs (6 chips) came out shortest on every wire metric at once.

The editor DRAWS a single-consumer read on the pin row it feeds instead of as
a separate card: a `get_var` with a configured `name`, no incoming edges and
exactly one outgoing wire renders as a teal read pill on its consumer, the card
and wire hidden until you click the pill (which reveals and selects the node).
This is a render fold and nothing else — the document keeps the getter node and
its edge, so nothing to author or migrate changes, and the audit reports both
counts as `[nodes=…, rendered_nodes=…]`. Shared, dangling and computed reads
(2+ consumers, no consumer, or a wired `name`/`default`) stay drawn, because
there the node is the subject rather than the argument. The toolbar toggle
beside the execution view turns the fold off and puts every chip back on the
canvas.

`scripts/audit_flow_graph.py --policy` checks a flow against the whole ladder,
and the editor's preflight panel raises the same findings as warnings while you
author (never as Run blockers — style must not stop a run):

| check | fires on |
|---|---|
| P1 TRIVIAL READ | an expression that is only a run-var read (either spelling: `vars.state.get("k")` or `(vars.get("s") or {}).get("k")`) |
| P2 FIELD EXTRACT | an expression that is only a field read off the pin's own wire |
| P3 THIN WRAPPER | an expression that is only a call to a function failing P4/P5 |
| P4 SINGLE USE | a flow function with fewer than 2 call sites |
| P5 OVERSIZED FN | a flow function longer than 25 lines |
| P6 HIDDEN CONTRACT | a subflow node whose only data input is one `input`/`vars` object while the child declares several start pins — the finding names the smuggled fields when the child resolves beside it |
| P7 CODE-FOR-ORCHESTRATION | a code node whose body is mostly prose — the "prompt composer in Python" smell; the text belongs on a pin default or in a String Template |

`--policy` is advisory; `--policy-strict` makes it affect the exit code.
`--selftest` runs the predicates against their own fixtures.

Version skew is safe by construction: a runtime that predates pin expressions
never reads the field, so the pin falls back to its wire or default value —
a stale value, never a spinning loop. The no-secrets rule above applies to
expressions too; the editor and the authoring commands refuse
credential-looking expression text.

In the editor, hover a pin row and click the `ƒx` control to add or edit an
expression; computed pins show an amber chip. In the authoring document the
field is `pin_expressions`, merged per key (an empty string removes one).

## File And Document Nodes

File/document side effects are execution nodes and must be on the execution path
before `on_flow_end` if their outputs are part of the requested result.

- `read_file` reads UTF-8 text or JSON from a workspace path.
- `write_file` writes UTF-8 text or JSON to a workspace path.
- `read_pdf` extracts text and metadata from a `.pdf` path using Runtime's
  permissive PDF reader.
- `write_pdf` renders text or Markdown-style report content to real PDF bytes
  using Runtime's permissive PDF writer.
- `write_docx` renders text or Markdown-style report content to a real `.docx`
  document using Runtime's standard-library DOCX writer.

In Gateway-hosted runs, these are workspace-scoped server paths, not browser
local files. Artifact inputs use the separate `Artifact` / `Local File` /
`Server File` source model. Use `write_file` for Markdown, JSON, and text
files. Use `write_pdf` for PDF files and `write_docx` for Word-compatible
documents; do not represent PDF/DOCX generation by writing Markdown to a
`.pdf` or `.docx` path.

## Structured Output And Switch Cases

Inline response schemas for LLM Call and Agent nodes are stored as pin defaults.
Connected schema edges override these defaults at runtime.

When a schema is active, LLM Call and Agent nodes keep `response` as a text
output for compatibility and expose `data` as the structured object output. Wire
`data` directly into Break Object or other object-aware nodes; use `response`
when you explicitly want the textual assistant content.

```json
{
  "id": "classify",
  "type": "llm_call",
  "position": { "x": 240, "y": 80 },
  "data": {
    "nodeType": "llm_call",
    "pinDefaults": {
      "prompt": "Classify the request.",
      "resp_schema": {
        "type": "object",
        "properties": {
          "choice": {
            "type": "string",
            "enum": ["approve", "reject", "escalate"]
          }
        },
        "required": ["choice"]
      }
    }
  }
}
```

For enum-driven control flow, wire the structured `data` output into Break
Object, expose the enum field, and connect that field to Switch. Flow stores
explicit Switch cases. Gateway publishes these fields unchanged, and Runtime
routes by the saved case handles.

```json
{
  "id": "route_choice",
  "type": "switch",
  "position": { "x": 640, "y": 80 },
  "data": {
    "nodeType": "switch",
    "switchConfig": {
      "cases": [
        { "id": "approve", "value": "approve" },
        { "id": "reject", "value": "reject" },
        { "id": "escalate", "value": "escalate" }
      ]
    },
    "outputs": [
      { "id": "case:approve", "label": "approve", "type": "execution" },
      { "id": "case:reject", "label": "reject", "type": "execution" },
      { "id": "case:escalate", "label": "escalate", "type": "execution" },
      { "id": "default", "label": "default", "type": "execution" }
    ]
  }
}
```

## Sharing Workflows

For portable workflows, prefer exposing environment-specific values as start inputs or Gateway defaults:

- provider id
- model id
- optional base URL override when the workflow intentionally targets an OpenAI-compatible route
- non-secret parameters such as temperature, max tokens, dimensions, steps, and seed

API keys and user credentials should be configured by the receiving Gateway, not exported with the workflow.

## Examples

Sample JSON files live in `examples/flows/`.
