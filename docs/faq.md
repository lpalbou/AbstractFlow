# FAQ

## Does AbstractFlow Need Python?

No. AbstractFlow is the web editor package `@abstractframework/flow`.

Python services are used by other framework packages such as AbstractGateway, AbstractRuntime, AbstractCore, and capability plugins. Flow itself does not ship a Python package or local execution host.

## Why Do I Need A Gateway Token?

Flow is only the editor. Gateway owns user authentication and runtime isolation. Each browser must sign in with a Gateway user token so Gateway can route requests to the right user/runtime.

## Can Flow Store Provider API Keys?

No. Configure provider credentials, OpenAI-compatible endpoint profiles, and model defaults in the Gateway console. Flow discovers those providers and models from Gateway.

## Where Are Workflows Stored?

Gateway stores VisualFlow drafts, published workflow bundles, run ledgers, and artifacts. Flow may import/export JSON in the browser, but persistent state belongs to Gateway.

## How Do I Use A Custom OpenAI-Compatible Endpoint?

Create a provider endpoint profile in Gateway with its base URL, API key, description, and discovered models. It will surface in Flow as a virtual provider.

## What Happens If Gateway Is Down?

The editor can load its static UI, but discovery, save, publish, run, artifact, and history features require Gateway.

## Is There A Python `abstractflow` Package?

No. AbstractFlow is the web editor only. The responsibilities of a workflow
backend belong to these packages:

- visual execution and bundle semantics: AbstractRuntime
- users, auth, runtime routing, workflow registry, runs, artifacts: AbstractGateway
- provider calls and capability plugins: AbstractCore
- visual authoring UI: `@abstractframework/flow`

## What Does Declaring An Interface Do?

An interface such as `abstractcode.agent.v1` tells hosts (AbstractCode,
AbstractAssistant, entity phases) that they can start the workflow and which
pins they send and read. Declaring one in the Flow Library adds the pins it
requires to `On Flow Start` and `On Flow End`; you then wire them. See
[VisualFlow JSON > Interfaces](visualflow.md#interfaces) for every interface
and its pins.

## Why Does A Node Show "N hidden"?

The stored workflow wires pins the canvas cannot draw, such as a code node's
returned keys. Those connections run and are saved as stored. See
[Web editor > Hidden Connections](web-editor.md#hidden-connections).

## Where Do I Find The AbstractFlow And Gateway Versions?

Open the About dialog (the `i` button in the top bar). See
[Web editor > About](web-editor.md#about).

## Something Does Not Work

See [Troubleshooting](troubleshooting.md) for symptoms, causes, and fixes.
