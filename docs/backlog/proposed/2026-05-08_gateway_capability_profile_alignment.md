# Proposed: Gateway Capability Profile Alignment

## Metadata
- Created: 2026-05-08
- Status: Proposed
- Completed: N/A

## Context

AbstractFlow is the workflow authoring UI. The modern editor is Gateway-first: it saves VisualFlow
JSON through Gateway, publishes WorkflowBundles there, starts Gateway runs, and renders Gateway
ledger/history/artifact streams.

Gateway now has clear Python install profiles:

- `abstractgateway[server]`: lightweight remote/server deployment.
- `abstractgateway[apple]` / `abstractgateway[all-apple]`: full native Apple deployment.
- `abstractgateway[gpu]` / `abstractgateway[all-gpu]`: full native GPU deployment.
- Docker remains limited to the lightweight server image and the explicit NVIDIA server image.

## Problem

Flow should not maintain its own provider/model/capability truth. If the editor guesses local
Vision, Voice, Music, Memory, prompt-cache, or tool availability, it can drift from the Gateway that
will actually execute the workflow.

## Proposed Direction

Make Gateway discovery the source of truth for Flow authoring UX:

- load provider/model catalogs, generated media availability, voice profiles, music readiness,
  memory/KG readiness, prompt-cache support, tool inventory, and workspace policy from
  `/api/gateway/discovery/capabilities` and related Gateway catalog routes;
- show node controls only when the connected Gateway advertises the corresponding contract;
- keep `abstractflow[editor]` as a UI/proxy install profile, not a local execution aggregate;
- document that local hardware setup belongs to `abstractgateway[apple]` or `abstractgateway[gpu]`,
  not to Flow.

## Non-Goals

- Do not add Core/Vision/Voice/Music/Memory local engine dependencies to Flow.
- Do not add Flow-owned provider/model config.
- Do not bypass Gateway for workflow execution in the modern editor path.

## Promotion Criteria

Promote when Gateway 0.2.4+ is released and Flow starts exposing generated media, voice, music,
memory, or prompt-cache controls in the editor.

## Validation Ideas

- UI contract tests with Gateway capability fixtures for lightweight, Apple, and GPU profiles.
- Regression test that missing Gateway capability fields hide or disable the relevant node controls.
- Manual smoke: connect Flow to `abstractgateway[server]` and verify no local-only controls are
  advertised as runnable.

## Guidance For Implementing Agents

Re-check the current Gateway capability schema before coding. Prefer adding typed client helpers over
scattering endpoint-specific feature checks through editor components.
