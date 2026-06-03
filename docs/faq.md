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

## Where Did The Python `abstractflow` Package Go?

Its responsibilities were moved to their owners:

- visual execution and bundle semantics: AbstractRuntime
- users, auth, runtime routing, workflow registry, runs, artifacts: AbstractGateway
- provider calls and capability plugins: AbstractCore
- visual authoring UI: `@abstractframework/flow`
