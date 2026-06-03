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

## Sharing Workflows

For portable workflows, prefer exposing environment-specific values as start inputs or Gateway defaults:

- provider id
- model id
- optional base URL override when the workflow intentionally targets an OpenAI-compatible route
- non-secret parameters such as temperature, max tokens, dimensions, steps, and seed

API keys and user credentials should be configured by the receiving Gateway, not exported with the workflow.

## Examples

Sample JSON files live in `examples/flows/`.
