# Proposed: Gateway Media Browser E2E Regression Suite

## Metadata
- Created: 2026-05-22
- Status: Proposed

## Problem

The current regression coverage verifies TypeScript contracts, static UI wiring,
native Runtime compilation guards, and frontend build health. It does not launch
the browser against a live Gateway/media backend and verify the user-visible
artifact path end to end.

## Proposed direction

Add a browser-level E2E suite that runs against a known local Gateway fixture or
mock Gateway server and validates:

- Generate Music happy path: node authoring, save/publish/run, artifact player.
- Edit Image happy path: source artifact selection/wiring, run, image preview.
- Catalog task scoping: generate image uses `text_to_image`; edit image uses `image_to_image`; music uses `text_to_music`.
- Readiness failures: available false, route unavailable, and configured false all disable the relevant UI path.
- Model residency status mapping for supported, skipped, unsupported, and failed outcomes.

## Acceptance criteria

- The suite can run locally without requiring paid remote providers.
- It records enough fixture data to catch regressions in artifact rendering and catalog routing.
- It remains separate from the unit/static contract suite so normal development stays fast.
