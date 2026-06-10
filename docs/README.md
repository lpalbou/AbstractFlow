# AbstractFlow Documentation

AbstractFlow is the AbstractFramework visual workflow editor. It is distributed as the npm package `@abstractframework/flow`.

Normal operation:

1. AbstractGateway runs on a server or local machine.
2. AbstractFlow serves the browser editor.
3. The browser signs in with a Gateway user token.
4. Flow proxies authoring, discovery, run, ledger, and artifact calls to Gateway.

AbstractFlow does not own runtime execution or provider secrets. Gateway and Runtime do.

Flow can author runtime-facing pin defaults, including inline JSON Schema
response schemas for LLM Call and Agent nodes. Those schemas are saved in
VisualFlow JSON and enforced later by Runtime/Core after Gateway publish/start.
When a schema is active, `data` is the structured object output and `response`
stays textual for compatibility.

## Pages

- [Getting started](getting-started.md)
- [Web editor](web-editor.md)
- [Workflow authoring skill](workflow-authoring-skill.md)
- [Workflow node catalog](workflow-node-catalog.md)
- [Architecture](architecture.md)
- [API and contracts](api.md)
- [VisualFlow JSON](visualflow.md)
- [CLI](cli.md)
- [FAQ](faq.md)

## Documentation Upkeep

- Keep docs written around the web package layout: `src/`, `bin/`, `examples/flows/`, `docs/`.
- Do not add Python package or local server launch instructions; those surfaces were removed from this repository.
- Regenerate the LLM context after doc changes:

```bash
npm run docs:llms
```
