# Completed: Gateway-Only Remote Editor Transport

## Metadata
- Created: 2026-05-09
- Status: Completed
- Completed: 2026-05-10

## Outcome

AbstractFlow’s default editor path is established as Gateway-first.

- Browser/editor runtime calls are expected to use `/api/gateway/*`.
- Local Python `Flow` runtime routes remain behind `ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME=1` as
  explicit local compatibility.
- Static UI and proxy entrypoints are aligned to treat Gateway as the execution authority.
- Remote run detail/history workflows now rely on Gateway-discovered capabilities for control.

## Follow-up and linkage

- Follow-up work for stricter helper endpoint gating moved to
  `docs/backlog/completed/060_gateway_contract_helper_endpoint_strictness.md`.
- Draft/publish isolation and other lifecycle refinements remain in
  `docs/backlog/planned/020_draft_run_and_publish_lifecycle.md`.

## Migration Note

After closing `060`, editor runs that require run input rehydration or run history replay must receive
`common.runs.input_data` and `common.runs.history_bundle` from Gateway discovery in default
Gateway-only mode.
