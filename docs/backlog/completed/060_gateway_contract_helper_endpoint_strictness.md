# Completed: Gateway Contract Helper Endpoint Strictness

## Metadata
- Created: 2026-05-10
- Status: Completed
- Completed: 2026-05-10

## Outcome

Flow now enforces helper endpoint capability strictness for remote run detail UX:

- `common.runs.input_data` is required for run start rehydration.
- `common.runs.history_bundle` is required for run history replay.
- Readiness checks in `web/frontend/src/utils/gatewayClient.ts` now fail those operations when
  descriptors are missing.
- `RunFlowModal` and `Toolbar` no longer silently guess these endpoints under contractful gateways.
- Missing descriptors in legacy/non-versioned contracts use temporary `#FALLBACK` canonical route logging
  for compatibility while still keeping behavior explicit.
- Contract tests in `abstractflow/tests/test_frontend_gateway_contract.py` now assert failure when either
  descriptor is missing.

## Release / migration notes

- This closes the strict contract gap after Gateway already advertises helper descriptors in discovery.
- Running the default editor against older contract-less Gateways may still log temporary
  `#FALLBACK` compatibility behavior for these endpoints.
- After this item, unknown contract combinations should fail with clear reason states before
  opening run history / input rehydration flows.

