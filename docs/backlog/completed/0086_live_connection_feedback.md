# Planned: Live connection feedback

## Metadata
- Created: 2026-05-25
- Status: Completed
- Completed: 2026-05-25

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
The Flow canvas validates connections when users drop an edge, and media artifact pins are now modality-aware. However, the editor still waits until drop time to explain many invalid connections. That makes artifact wiring feel trial-and-error instead of guided.

## Current code reality
- `web/frontend/src/components/Canvas.tsx` centralizes `validateConnection`, `getConnectionError`, edge coloring, and ReactFlow connection setup.
- `web/frontend/src/components/nodes/BaseNode.tsx` renders input/output pin rows and can receive transient render-only data through ReactFlow node data.
- `web/frontend/src/utils/validation.ts` already returns modality-specific connection errors.
- `web/frontend/src/utils/mediaArtifacts.ts` identifies image/audio/text/video/generic artifact mismatches.
- `web/frontend/src/styles/nodes.css` already styles pins, handles, edge paths, and connection lines.
- Two read-only subagent critiques on 2026-05-25 were requested for implementation and UX guidance.

## Problem
Users should see compatible and incompatible targets while dragging a connection, especially for media artifact pins. Waiting for a failed drop makes the graph feel brittle and hides the type system until after a mistake.

## What we want to do
Add live canvas feedback during connection drag:
- color the connection line by the source pin type;
- mark compatible target pins as valid;
- mark incompatible target pins as invalid;
- show the current invalid reason in a small canvas hint while dragging over an invalid target.

## Why
This turns typed pins into active guidance instead of passive validation. The workflow editor should teach users what can connect before they make a mistake.

## Requirements
- Keep the feedback render-only; do not persist drag state into saved flow data.
- Reuse `validateConnection` and `getConnectionError` instead of duplicating compatibility logic.
- Highlight target pins only when a source connection is actively being dragged.
- Use concise wording for errors, including media artifact modality errors from `validation.ts`.
- Keep generic object escape hatches intact.
- Avoid brittle direct DOM mutation for compatibility state.

## Suggested implementation
- Track the active source `{ nodeId, handleId, pinType }` from ReactFlow connection events in `Canvas.tsx`.
- Decorate ReactFlow nodes with transient `connectionPreview` data derived from the active source and current graph.
- Let `BaseNode.tsx` add pin-row classes and `aria-invalid`/title state from `data.connectionPreview`.
- Add a canvas-level hint for the active invalid target if ReactFlow exposes the hovered connection object; otherwise keep the first slice to target highlighting and failed-drop toasts.
- Style valid/invalid pin rows and the active connection line in `nodes.css`.

## Scope
- Frontend canvas connection drag state.
- Base node render classes for pin feedback.
- CSS for connection feedback.
- Focused frontend source/behavior tests.
- Backlog overview/completion trace.

## Non-goals
- No runtime or Gateway changes.
- No full graph tutorial or onboarding overlay.
- No artifact metadata network lookup.
- No broad rewrite of ReactFlow node/edge architecture.

## Dependencies and related tasks
- `completed/0085_media_artifact_modality_validation.md`
- `web/frontend/src/utils/validation.ts`
- `web/frontend/src/utils/mediaArtifacts.ts`

## Expected outcomes
- When dragging an image artifact output, image artifact inputs visibly accept it and audio artifact inputs visibly reject it.
- When dragging an audio artifact output, transcription audio inputs visibly accept it and image inputs visibly reject it.
- The live connection line uses the source pin color.
- Drop-time errors remain the authoritative fallback.

## Validation
- Frontend contract/source tests proving the transient connection preview exists and reuses validation helpers.
- Frontend build.
- Diff check.

## Progress checklist
- [x] Add transient connection preview model.
- [x] Wire Canvas connection start/end state.
- [x] Decorate nodes with valid/invalid target pin feedback.
- [x] Add CSS for valid/invalid target states and colored connection line.
- [x] Add tests.
- [x] Record completion evidence.

## Guidance for the implementing agent
Prefer a small render-only data path from Canvas to BaseNode. Do not add a new validation subsystem or persist ephemeral drag state into the store.

## Completion report
- Completed: 2026-05-25
- Summary: Added live typed-connection feedback on the Flow canvas. Dragging from a source pin now colors the connection line by the source pin type, decorates compatible and incompatible candidate pins with render-only state, and shows a small themed hint derived from ReactFlow's active end-handle state. The hint reuses `validateConnection` and `getConnectionError`; it is derived from current ReactFlow store state rather than side effects, avoiding stale hover messages.
- Files touched: `web/frontend/src/components/Canvas.tsx`, `web/frontend/src/components/nodes/BaseNode.tsx`, `web/frontend/src/styles/nodes.css`, `web/frontend/src/types/flow.ts`, `web/frontend/src/utils/connectionPreview.ts`, `tests/test_frontend_gateway_contract.py`.
- Behavior changes: media artifact and other typed pins now expose valid/invalid drop guidance during drag; reverse target-to-source drags are also evaluated; selected-node editing strips the transient preview payload so drag state is not persisted into the flow store.
- ADR impact: None. This is an editor interaction implementation using existing validation policy.
- Validation: `pytest abstractflow/tests/test_frontend_gateway_contract.py::test_frontend_live_connection_feedback_uses_validation_contract -q`; `pytest abstractflow/tests/test_frontend_gateway_contract.py -q`; `npm --prefix abstractflow/web/frontend run build`; `npm --prefix abstractflow/web/frontend run build -- --mode production`; `git -C abstractflow diff --check`.
- Residual risks: No browser-plugin visual screenshot was available in this session, so the work is validated by contract tests and TypeScript/Vite build rather than pixel inspection.
- Follow-ups: none from this item.
