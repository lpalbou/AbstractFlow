# Proposed: Media Progressive Disclosure and Preview-First UX

## Metadata
- Created: 2026-05-22
- Status: Proposed

## Problem

Gateway-backed media nodes are now first-class, but the editor still exposes some low-level concepts too early:

- provider/model/backend details are visible before the user understands the happy path
- artifact IDs and raw ledger payloads can dominate run results
- Edit Image requires artifact vocabulary before a normal user can try it

## Proposed direction

- Add simple media cards or presets for Generate Image, Generate Voice, and Generate Music.
- Keep node defaults to prompt/text, duration/size/voice, provider/model `Auto (Gateway default)`, and format.
- Keep seed and guidance visible on image/video generation and edit nodes because they are core reproducibility and quality controls; move steps, negative prompt, backend planner details, extra options, and raw output specs behind an explicit advanced section.
- Make run results open as a gallery/player first, with artifact IDs and raw JSON collapsed.
- Add an image artifact picker/upload affordance for Edit Image when the source pin is unconnected.

## Acceptance criteria

- A new user can create and run Generate Music from docs in under one minute without choosing a backend.
- Edit Image explains and supports the source image path without requiring manual artifact ID copy/paste.
- Advanced users can still wire every advanced pin and inspect raw artifacts/ledger records.
- Tests cover simple media node rendering and advanced pin visibility behavior.
