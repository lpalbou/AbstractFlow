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

## File-like sources

Flow now teaches one explicit file-like vocabulary across the editor, run modal,
and authoring docs:

- `Artifact`: a saved Runtime-owned durable payload.
- `Local File` / `Local Folder`: client-device intake sources. In hosted/browser
  mode, uploads become artifacts before durable execution.
- `Server File` / `Server Folder`: user-facing wording for workspace-scoped
  server paths under Gateway policy. The engineering/model term remains
  `Workspace File` / `Workspace Folder`.

The canvas reflects that split:

- path-based nodes such as `Read File`, `Write File`, `Read PDF`, `Write PDF`,
  and `List Folder Files` consume workspace-scoped server paths;
- artifact-first nodes such as `Artifact`, `Import Server File`, `Read
  Artifact`, and `Export Artifact` work with durable runtime-owned payloads.

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
