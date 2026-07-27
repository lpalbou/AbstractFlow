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
  `parse_json` / `to_json`.

Expressions compile under the same RestrictedPython policy as Code node
bodies, in expression mode: statements and imports cannot appear, while
lambdas, comprehensions, and conditional expressions remain available.
Failures are loud and attributed — an unparseable expression fails the flow
build naming node and pin, and an expression that raises at run time fails
the consuming step with an error naming `<node>.<pin>` plus an expression
preview. Evaluation happens at every resolution, so a While condition
expression re-reads `vars.*` fresh each iteration.

Use an expression for a small condition, field read, or one-line transform
that would otherwise need a Get Variable → Code chain (`vars.fix_cycles < 3`,
`value["field"]`, `to_json(value)`). Use a Code node when the logic needs
multiple statements or several outputs.

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
