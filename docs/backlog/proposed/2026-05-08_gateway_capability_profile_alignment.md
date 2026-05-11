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

- `abstractgateway[http]`: lightweight remote/server deployment.
- `abstractgateway[apple]`: full native Apple deployment.
- `abstractgateway[gpu]`: full native GPU deployment.
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
- keep `abstractflow[apple]` / `abstractflow[gpu]` as UI/proxy install profiles, not a local execution aggregate;
- document that local hardware setup belongs to `abstractgateway[apple]` or `abstractgateway[gpu]`,
  not to Flow.

## Detailed Plan

1. Centralize Gateway capability parsing.
   - Keep a single typed client/helper for `/api/gateway/discovery/capabilities`.
   - Normalize missing fields into explicit unavailable states with `#FALLBACK` diagnostics.
   - Include Gateway version/profile, contracts, generated-media support, voice catalogs, music
     readiness, memory/KG readiness, prompt-cache support, tools, workspace policy, and auth state.

2. Gate editor controls by capability.
   - Provider/model selectors should come from Gateway catalogs and run defaults.
   - Image-generation/edit controls should appear only when Gateway advertises direct or
     workflow-backed generated image support.
   - Voice/TTS/STT controls should use Gateway voice/profile/model catalogs.
   - Music nodes should remain hidden or marked unavailable until Gateway advertises music support.
   - KG/memory controls should show the selected store capability: volatile, structured-only, or
     vector-capable.

3. Align node serialization with Runtime/Core contracts.
   - LLM nodes should emit `output`/`outputs` selectors for generated images, voice/audio, and music
     instead of Flow-only fields.
   - Media/artifact inputs should serialize as Gateway artifact refs or upload payloads.
   - Workflow publish should preserve capability requirements in bundle metadata so Gateway can
     preflight before run start.

4. Improve run UX for generated capabilities.
   - Render generated artifacts from Gateway history and live SSE records.
   - Show subrun and background generated media without duplicating final answers.
   - Surface Gateway readiness failures as authoring/run validation messages, not as broken forms.

5. Test against capability fixtures.
   - Add fixtures for `server`, native `apple`, native `gpu`, and missing/unconfigured capabilities.
   - Cover same-origin proxy auth injection and EventSource stream behavior.

## Non-Goals

- Do not add Core/Vision/Voice/Music/Memory local engine dependencies to Flow.
- Do not add Flow-owned provider/model config.
- Do not bypass Gateway for workflow execution in the modern editor path.

## Promotion Criteria

Promote when Gateway 0.2.4+ is released and Flow starts exposing generated media, voice, music,
memory, or prompt-cache controls in the editor.

## Expected Outcomes

- Flow can author workflows that use Gateway-generated image, audio/voice, music, memory, tools, and
  prompt-cache capabilities without knowing whether Gateway is lightweight, Apple-native, or GPU.
- A Flow connected to lightweight Gateway never suggests local-only capabilities as runnable.
- A Flow connected to full Gateway profiles exposes the richer controls automatically from Gateway
  contracts.

## Validation Ideas

- UI contract tests with Gateway capability fixtures for lightweight, Apple, and GPU profiles.
- Regression test that missing Gateway capability fields hide or disable the relevant node controls.
- Manual smoke: connect Flow to `abstractgateway[http]` and verify no local-only controls are
  advertised as runnable.

## Guidance For Implementing Agents

Re-check the current Gateway capability schema before coding. Prefer adding typed client helpers over
scattering endpoint-specific feature checks through editor components.
