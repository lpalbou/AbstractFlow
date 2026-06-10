# Web Editor

AbstractFlow is the browser-based VisualFlow editor.

It talks to AbstractGateway for:

- user sessions and runtime routing
- workflow CRUD and publishing
- provider/model/capability discovery
- run start, commands, ledger replay, and ledger streaming
- artifacts, media previews, and generated output downloads

## Run With A Gateway

```bash
export ABSTRACTGATEWAY_USER_AUTH=1
export ABSTRACTGATEWAY_DATA_DIR="$PWD/runtime/gateway"
abstractgateway serve --host 127.0.0.1 --port 8080
```

```bash
npx @abstractframework/flow --gateway-url http://127.0.0.1:8080
```

Open http://localhost:3003.

## Browser Auth

Each browser signs in with a Gateway user id and that user's token. Flow exchanges the token with Gateway for an opaque browser session and keeps that session in HTTP-only cookies. Raw user tokens are not retained after sign-in.

Server/operator bearer tokens such as `ABSTRACTGATEWAY_AUTH_TOKEN` are not browser sign-in tokens. Use the Gateway user token, normally the bootstrap admin token for a first local install.

Remote browser-supplied Gateway URL changes are blocked by default. A hosted Flow instance should proxy only to its configured Gateway unless the operator explicitly enables `ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG=1` behind their own access control.

## Provider And Model Discovery

Flow does not store API keys or endpoint secrets. It asks Gateway for provider catalogs, endpoint profiles, model lists, capability defaults, and media route descriptors.

Configure these in the Gateway console:

- OpenAI, Anthropic, OpenRouter, Portkey, Ollama, LM Studio
- custom OpenAI-compatible endpoint profiles
- Gateway-level and user-level capability defaults

Flow nodes then select providers and models from Gateway discovery.
Leave provider/model as **Auto (Gateway default)** when a workflow should use
the Gateway/Core capability route configured for the current runtime. This is
the portable default for LLM Call, Agent, and generated media nodes. If you pin
a provider and later want to return to runtime defaults, choose **Auto (Gateway
default)** again from the provider dropdown.

The Model Residency modal shows only provider-reported resident/loaded models.
Configure capability defaults in Gateway Console or with the Gateway/Core
config CLIs; changing a default does not load or unload a model.

## Workflow Authoring Assistant

The star button on the right side of the toolbar opens a conversational
assistant in the right drawer. The drawer shares space with Properties, so users
can switch between assistant guidance and node editing while keeping the canvas
visible.

The assistant uses `docs/workflow-authoring-skill.md` plus a complete generated
node catalog from `src/types/nodes.ts` as its graph-authoring context. This
replaces generic `llms-full.txt` context for workflow construction. By default
it resolves Gateway's configured `output.text` capability route and starts a
short-lived Gateway `basic-agent` planner run through the normal
`/api/gateway/runs/start` path. Users can pin a specific assistant
provider/model from the drawer. The assistant runs an autonomous authoring loop:
each cycle reads the planner response from the run ledger, applies validated
command batches, checks the updated graph, and continues until the draft is
ready or explicitly blocked.

The planner run receives a single prompt plus a system prompt with strict JSON
instructions. Its runtime tool list is explicitly empty: authoring edits must
come back as validated command JSON, not as Gateway tool calls. Prior user turns
are included inside the current prompt, while assistant prose is represented by
the current graph summary rather than replayed as separate chat-history
messages. The visible graph remains the source of applied draft state.

The drawer shows the prompt size that will be sent to Gateway and, when Gateway
model-capability discovery is available, the selected model's context and output
limits. It also includes a Clear Chat button and a loop status strip showing
phase, cycle count, applied command count, and readiness issue count.
AbstractFlow does not truncate the assistant conversation, selected docs
sections, or graph summary to fit a local limit, and it does not hardcode model
context windows. The drawer conversation and draft text are persisted locally so
closing and reopening the Assistant rail does not erase the ongoing authoring
discussion. Clear Chat resets the local assistant conversation and planner
session without changing the current graph. If the Gateway run, model call,
structured response, or ledger read fails, the drawer reports that failure
directly.

Assistant output is treated as an untrusted edit proposal. The editor accepts
only a small command set for flow names, node creation, safe dynamic pins,
pin defaults, literals, Code node bodies, labels, concat separators, and
validated connections. The command reducer rejects unknown node types, invalid
edges, secret-looking values, Code `full_access`, destructive edits, and Tool
Calls nodes without an explicit `allowed_tools` allowlist.

Research-oriented readiness checks require an authored Agent system prompt,
explicit tool configuration when web tools are needed, prompt-building nodes,
sources/citations that are not `Agent.meta`, an audit trace, and final outputs.
`Agent Trace Report` is accepted only for audit output, not as a report source.
When a request asks for Markdown/PDF artifacts, the assistant must create
an executable `Write File` node for Markdown and an executable `Write PDF` node
for PDF. `Write PDF` renders report text or Markdown-style content to real PDF
bytes in Runtime and exposes the resulting path through `On Flow End`. Generic
`Write File` and sandbox Code are not treated as PDF generation.

Tool-dependent requests use Gateway's advertised tool inventory and exact tool
names. If Gateway defaults, advertised discovery endpoints, the planner run,
strict JSON parsing, or command validation fail, the assistant reports the error
instead of synthesizing a substitute plan. Completed cycle edits remain visible in
the draft; the failed cycle is not applied, and Undo Turn restores the pre-turn
snapshot.

Each assistant turn ends with how the draft works, how to test it, and what to
expect. The assistant changes the in-memory draft only. Users still review the
graph, Save, Publish, and Run through the normal Gateway-backed controls.

## Execution View

The toolbar's execution-view toggle (three linked dots) condenses the canvas to
the control-flow skeleton. Only nodes linked by execution edges remain visible,
along with those edges; data-only nodes (literals, concat, parsers) and data
edges are hidden. Node positions are unchanged, so the layout matches the full
view when switching back and forth.

Condensed nodes are compact cards with a per-family color, shape, and icon so
the flow reads at a glance: events (red pill), control flow such as Sequence or
If/Else (orange, with named branch pins), user interaction (green), generative
AI (violet), generated media (pink), tools & files (teal), memory (gold),
subflow (cyan double border), and logic/state (grey). Runtime highlights
(executing/recent) still apply in this view.

The execution view is a reading mode: dropping new palette nodes is blocked
with a hint, while moving nodes and rewiring execution pins remain available.

## Structured Output Schemas

LLM Call and Agent nodes expose `resp_schema` as an optional JSON Schema input.
When that input is not connected, the node shows an inline schema editor. The
Builder tab is for object fields, required/optional fields, descriptions, and
Choice fields. Choice fields are saved as standard JSON Schema string enums.

The JSON Schema tab accepts advanced object schemas directly, including `$ref`
schemas that Runtime can resolve. Switching back to Builder preserves supported
top-level fields and Choice values.

Connected schema inputs always override the inline default. When a workflow is
published, Gateway stores and packs the VisualFlow JSON unchanged; Runtime then
applies unconnected `pinDefaults.resp_schema` values and Core enforces the
structured output schema.

For branch routing, define a Choice field such as `choice`, wire the
LLM/Agent `data` output into Break Object, expose `choice`, and connect it to a
Switch node. `response` remains available as text for display and compatibility.
The Switch panel can sync explicit cases from the discovered enum values, so the
published workflow contains stable `switchConfig.cases`.

## Media Nodes

Flow exposes media nodes only when Gateway advertises the corresponding capability:

- Generate Image
- Edit Image / Image-to-Image
- Restore / Upscale Image
- Generate Video
- Image-to-Video
- Generate Voice
- Generate Music
- Transcribe Audio
- Listen Voice

Generated outputs are Gateway artifacts. The run modal renders image/video/audio previews and keeps the artifact content link available for open/download. When Gateway returns a media child run, Flow streams the child-run ledger and renders `abstract.progress` records for image, image-edit, image-upscale, video, and image-to-video runs when available.

Unconnected artifact input pins expose a browser upload affordance directly on the node. Uploads go to Gateway and are stored as session-visible artifacts, then the node stores the canonical artifact ref as its pin default. Flow does not use server workspace paths for browser-local uploads.

`Listen Voice` waits are handled as Gateway/Runtime waits. Flow only captures audio in the browser, uploads it to Gateway as an audio artifact, and resumes the waiting run with that artifact ref; transcription and downstream execution remain Gateway/Runtime work.

## Development

```bash
npm install
npm run dev
```

Useful environment variables:

- `ABSTRACTGATEWAY_URL` or `ABSTRACTFLOW_GATEWAY_URL`: default Gateway target for the proxy.
- `ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG=1`: allow non-local browsers to change the Gateway URL.
- `ABSTRACTFLOW_TRUST_PROXY_HEADERS=1`: honor forwarded host/proto headers behind a trusted reverse proxy.

## Build And Serve

```bash
npm run build
npm start -- --host 0.0.0.0 --port 3003 --gateway-url http://127.0.0.1:8080
```
