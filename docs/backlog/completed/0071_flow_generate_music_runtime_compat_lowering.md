# Completed: Flow Generate Music Temporary Runtime Compatibility

## Metadata
- Created: 2026-05-21
- Status: Completed
- Completed: 2026-05-21
- Superseded: 2026-05-22 by `0072_gateway_0_2_17_native_media_contract_alignment.md`

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context

This is a historical audit item. On 2026-05-21, Flow temporarily made
editor-authored Generate Music executable on a Runtime version that did not yet
dispatch a native `generate_music` VisualFlow node.

## Superseded current reality

Runtime `0.4.21` now supports native `generate_music`. AbstractFlow `0.3.13`
therefore removed the temporary browser-side compatibility transform and keeps
only a legacy importer that normalizes old saved flows back to native
`generate_music` on load/save.

Current implementation is tracked in:

- `0072_gateway_0_2_17_native_media_contract_alignment.md`
- `web/frontend/src/utils/visualFlowCompat.ts`
- `web/frontend/src/utils/serialization.ts`
- `web/frontend/src/hooks/useFlow.ts`

## Validation status

The current replacement path is validated by:

- `tests/test_frontend_gateway_contract.py`
- `tests/test_visual_generate_music_native_runtime.py`
- `npm run build` from `web/frontend`
