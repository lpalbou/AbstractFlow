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

Flow uses one explicit file-like vocabulary across the editor, run modal,
and authoring docs:

- `Artifact`: a saved Runtime-owned durable payload.
- `Local File` / `Local Folder`: client-device intake sources. In hosted/browser
  mode, uploads become artifacts before durable execution.
- `Server File` / `Server Folder`: user-facing wording for workspace-scoped
  server paths under Gateway policy. The engineering/model term remains
  `Workspace File` / `Workspace Folder`.

The canvas reflects that split:

- path-based nodes such as `Read File`, `Write File`, `Read PDF`, `Write PDF`,
  `Write DOCX`, and `List Folder Files` consume workspace-scoped server paths;
- artifact-first nodes such as `Artifact`, `Import Server File`, `Read
  Artifact`, and `Export Artifact` work with durable runtime-owned payloads.

## Pages

Start here:

- [Getting started](getting-started.md): start a Gateway, run the editor, sign in, and author a first workflow.
- [Web editor](web-editor.md): the editor's features: sign-in, About, the responsive layout on phones and tablets, discovery, Resources, flow interfaces, automation defaults and trigger-source discovery, hidden connections, the authoring assistant, media and file nodes.
- [Troubleshooting](troubleshooting.md): symptoms, causes, and fixes for sign-in, proxy, editor, and local development problems.
- [FAQ](faq.md): short answers about what Flow owns and what it delegates.

Reference:

- [Architecture](architecture.md): components, boundaries, and diagrams of the editor, the Flow server, and Gateway, including the automation-defaults path from document to automation.
- [API and contracts](api.md): CLI options, environment variables, proxy contract, and the main frontend modules.
- [CLI](cli.md): the `abstractflow-editor` command.
- [VisualFlow JSON](visualflow.md): the workflow document format, interfaces and their boundary pins, the `automation_defaults` field, pin expressions, and sharing.

Workflow authoring:

- [Workflow authoring skill](workflow-authoring-skill.md): the command contract and patterns the Workflow Authoring Assistant follows; also useful to human authors.
- [Workflow node catalog](workflow-node-catalog.md): every node template with its pins and configuration fields (generated from `src/types/nodes.ts`).

Shipped workflows:

- [Shipped workflow sources](shipped-workflow-sources.md): the editable flows and generators behind the coder, deep-research, and co-scientist bundles that AbstractGateway serves.
- [Production research workflow](deep-research.md): the `deep-research` family in depth.
- [The entity brain](entity-brain.md): the `entity-life` workflow family that animates persistent entities.

Project policies live at the repository root: [CHANGELOG.md](../CHANGELOG.md),
[CONTRIBUTING.md](../CONTRIBUTING.md), [SECURITY.md](../SECURITY.md), and
[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).
