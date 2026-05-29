# Proposed: GitHub-Hosted Gateway + Flow Showcase

## Metadata

- Created: 2026-05-29
- Status: Proposed
- Completed: N/A

## ADR status

- Governing ADRs: None identified after review.
- ADR impact: This may need an ADR if we introduce a public-demo credential broker or a new browser-to-gateway authentication mode.

## Context

We need a travel-friendly AbstractFlow demonstration that can be shown without a local laptop running the full stack. The desired experience is a light Gateway + Flow deployment that can execute remote-provider workflows after the user supplies OpenAI credentials.

The current architecture already supports the remote-light path:

- `abstractflow` without Apple/GPU extras is a thin client package.
- The Flow Node CLI serves the static editor and proxies `/api/*` to Gateway while injecting `ABSTRACTGATEWAY_AUTH_TOKEN` server-side.
- The Python Flow backend does the same proxying for `/api/gateway/*`.
- Base `abstractgateway` includes HTTP/SSE dependencies and the remote-light runtime path; `abstractgateway[http]` is not required.
- Gateway already separates Gateway API auth from provider credentials such as `OPENAI_API_KEY`.
- Gateway refuses unsafe public binds without a stronger auth token and origin policy.

GitHub Pages alone cannot run Gateway because Gateway is a Python/FastAPI runtime service with durable run state, SSE, workflow execution, and provider calls. GitHub Actions are also not appropriate for an interactive long-running demo server. A GitHub-only temporary demo is possible through Codespaces, while a stable public showcase needs a small backend host for Gateway.

## Problem

We need a simple, secure showcase path that:

- hosts the Flow UI in a way that is easy to share,
- runs a light remote-inference Gateway,
- lets a viewer provide OpenAI credentials for execution,
- does not leak Gateway bearer tokens or provider API keys into a public static bundle,
- can load curated demo flows such as deep-research examples,
- stays clear that GPU/local inference is out of scope for the hosted demo.

## Proposed Direction

Evaluate and implement one or both deployment tracks.

Track A: GitHub Codespaces Demo

- Add a devcontainer or one-command script that installs `abstractgateway` and `abstractflow`.
- Start Gateway on one forwarded port and Flow on another forwarded port.
- Use remote OpenAI-compatible inference only.
- Keep the Gateway token in the Codespace environment, not in the client bundle.
- Allow the operator to paste a temporary OpenAI key into the Codespace secret/env flow for demos.
- Treat this as the simplest GitHub-native option, but document that it is operator-started and not a permanent public site.

Track B: Public Static UI + Remote-Light Gateway

- Publish the Flow static UI through GitHub Pages or the existing npm package.
- Deploy a light Gateway to a small free or low-cost backend host that supports long-running HTTP/SSE.
- Configure Gateway with a strict `ABSTRACTGATEWAY_AUTH_TOKEN`, allowed origins, and demo workspace retention rules.
- Add a first-run credential prompt for OpenAI credentials, scoped to the session or run.
- Avoid persisting provider keys unless the user explicitly opts in.
- Never bake `OPENAI_API_KEY` or a reusable Gateway bearer token into the frontend build.

The hard part is authentication when a fully static public UI talks directly to Gateway. A public static page cannot hide a Gateway bearer token. Clean options are:

- keep a server-side Flow proxy/BFF next to Gateway and inject Gateway auth there,
- issue short-lived per-session demo tokens from a small backend endpoint,
- require the operator to provide the Gateway URL/token for private demonstrations,
- run through Codespaces where the operator controls the forwarded ports.

## Proposed UX

For the public demo:

1. User opens the showcase URL.
2. Flow loads with curated demo workflows, for example a small deep-research flow.
3. User clicks Run.
4. If no provider credential is available, the modal asks for an OpenAI API key for this session/run.
5. Gateway executes with remote inference only.
6. Generated artifacts remain in the demo workspace for the run and follow the configured cleanup policy.

For Codespaces:

1. Operator opens the repository in Codespaces.
2. The setup command starts Gateway + Flow.
3. The forwarded Flow URL is shared for the live demonstration.
4. Provider credentials are supplied as Codespaces secrets or environment variables.

## Non-Goals

- Do not run local Apple/GPU inference in the hosted showcase.
- Do not use GitHub Actions as an interactive execution server.
- Do not ship a public Flow bundle containing provider keys or reusable Gateway bearer tokens.
- Do not make the public Gateway unauthenticated.

## Acceptance Criteria

- Documentation explains the GitHub Pages limitation and the Codespaces/backend-host alternatives.
- A demo deployment path can run at least one text-only remote-provider workflow end-to-end.
- Demo flows can be preloaded or imported without manual JSON editing.
- Provider credentials are request-scoped, session-scoped, or server-env scoped with explicit documentation.
- Gateway auth and provider auth remain separate.
- The smoke test covers Flow UI startup, Gateway connection, provider credential handoff, run streaming, and final artifact display.

## Validation Plan

- Start the light stack with only base Gateway + Flow dependencies.
- Run a small OpenAI-backed workflow using a temporary key.
- Confirm the frontend bundle does not contain `OPENAI_API_KEY` or the Gateway bearer token.
- Confirm CORS/origin restrictions reject an unapproved origin.
- Confirm the same demo can be launched from Codespaces or documented backend-host deployment steps.
