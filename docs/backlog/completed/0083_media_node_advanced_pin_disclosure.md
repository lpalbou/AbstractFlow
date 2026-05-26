# Media Node Advanced Pin Disclosure

## Date

- Completed: 2026-05-25

## Status

Completed

## Priority

P1

## Context / Problem Statement

Backlog item `0073` calls for media authoring to become preview-first and progressively disclosed. Media nodes already expose the right Gateway-backed capabilities, but the canvas showed too many tuning, provider, artifact, and diagnostic pins at once. `generate_music` had a one-off advanced-pin filter, while other media nodes exposed every optional pin by default.

This made simple workflows look harder than they are and kept the advanced-pin policy embedded in `BaseNode` instead of a reusable presentation abstraction.

## Decision

Create a shared, UI-only media pin disclosure helper. The helper defines which media pins are advanced and filters canvas presentation without changing serialized VisualFlow data, node templates, Runtime execution, or Gateway contracts.

Connected advanced pins always remain visible so existing flows and wired handles stay explainable. Selected media nodes expose a compact `Advanced` disclosure button to reveal optional tuning and diagnostic pins.

## Scope

- Add `mediaPinDisclosure.ts` with media node coverage, advanced input/output pin maps, and pure visibility/count helpers.
- Replace one-off `generate_music` and `generate_voice.profile` filtering in `BaseNode` with the shared helper.
- Hide unconnected advanced media inputs and outputs by default.
- Keep connected advanced media pins visible even when the node is collapsed.
- Add a selected-node `Advanced` / `Hide advanced` disclosure row.
- Re-measure ReactFlow handles when the rendered pin set changes.
- Add source and helper-contract tests for media pin disclosure behavior.

## Non-goals

- Do not add `advanced` metadata to serialized pins.
- Do not change Runtime, Gateway, node templates, or execution semantics.
- Do not redesign run-result galleries or artifact pickers in this slice.
- Do not expose `runtime_provider` or `runtime_model` routing pins here.
- Do not rewrite PropertiesPanel media controls in this slice.

## Validation

- `pytest abstractflow/tests/test_frontend_gateway_contract.py::test_frontend_media_nodes_use_shared_advanced_pin_presentation abstractflow/tests/test_frontend_gateway_contract.py::test_frontend_exposes_gateway_media_node_templates -q`
- `npm --prefix abstractflow/web/frontend run build`

## Report

Media nodes now default to the happy-path canvas surface: prompts/source artifacts/provider/model/format stay visible, while tuning and diagnostic pins are hidden until requested. Advanced users can reveal the full pin set on selected media nodes, and any already-wired advanced handle remains visible to avoid breaking or obscuring existing flows. The disclosure policy is now a pure helper that can be tested independently and reused as media UX evolves.
