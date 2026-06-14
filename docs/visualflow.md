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

## File And Document Nodes

File/document side effects are execution nodes and must be on the execution path
before `on_flow_end` if their outputs are part of the requested result.

- `read_file` reads UTF-8 text or JSON from a workspace path.
- `write_file` writes UTF-8 text or JSON to a workspace path.
- `read_pdf` extracts text and metadata from a `.pdf` path using Runtime's
  permissive PDF reader.
- `write_pdf` renders text or Markdown-style report content to real PDF bytes
  using Runtime's permissive PDF writer.

In Gateway-hosted runs, these are workspace-scoped server paths, not browser
local files. Artifact inputs use the separate `Artifact` / `Local File` /
`Server File` source model. Use `write_file` for Markdown, JSON, and text
files. Use `write_pdf` for PDF files; do not represent PDF generation by
writing Markdown to a `.pdf` path.

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
