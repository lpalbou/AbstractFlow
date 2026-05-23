# AbstractFlow Backlog Overview

## Snapshot
- Updated: 2026-05-22
- Planned: 3
- Proposed: 8
- Completed: 7
- Deprecated: 0

## Current Priorities
- `planned/020_draft_run_and_publish_lifecycle.md`: continue Gateway-first draft/run lifecycle cleanup.
- `planned/030_local_execution_compatibility_boundary.md`: keep local Runtime/Core paths clearly compatibility-only.
- `planned/050_gateway_execution_regression_suite.md`: add regression coverage proving the default editor path stays Gateway-only.

## Completed Ledger
- `completed/0072_gateway_0_2_17_native_media_contract_alignment.md`: Flow now targets Gateway `0.2.17` native media contracts, uses canonical Gateway catalog helpers, consumes Gateway surface readiness as a conservative overlay, persists native Generate Music/Edit Image nodes, adds music residency, and removes browser-side music lowering except for legacy import normalization. Validation: focused Flow/Runtime/Gateway contract tests and frontend build.
- `completed/0071_flow_generate_music_runtime_compat_lowering.md`: Superseded by `0072`; historical temporary lowering item kept for audit trail.
- `completed/0070_flow_durable_bloc_prompt_cache_binding_ux.md` from `planned/0070_flow_durable_bloc_prompt_cache_binding_ux.md`: Flow now exposes Gateway durable bloc prompt-cache capability, a separate durable exact-reuse Run Flow UX, explicit `prompt_cache_binding` pins, opt-in local Runtime/Core imports, and pass-through into Runtime/Agent LLM params. Validation: targeted Flow pytest suite, AbstractAgent generation-param tests, frontend build, and py_compile for edited Flow/Runtime/Agent modules.
- `completed/060_gateway_contract_helper_endpoint_strictness.md`: Gateway helper endpoint strictness.
- `completed/040_gateway_capability_schema_and_connection_contract.md`: Gateway capability schema and Flow connection contract.
- `completed/010_gateway_only_remote_editor_transport.md`: Gateway-only remote editor transport.
- `completed/001_run-flow-advanced-layout.md`: Run Flow advanced layout.

## Notes
- The repo predates the stricter four-digit backlog filename rule. `proposed/` still contains date-prefixed and unnumbered legacy files. They were not renamed during item `0070` to avoid mixing unrelated backlog hygiene with implementation work.
- Gateway remains the primary product runtime/discovery/persistence boundary. Direct Runtime/Core usage in Flow should stay limited to local compatibility shims, compiler re-exports, and tests that explicitly exercise those shims.
