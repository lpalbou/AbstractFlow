# Completed: Gateway Capability Schema and Connection Contract

## Metadata
- Created: 2026-05-09
- Status: Completed
- Completed: 2026-05-10

## Outcome

Flow now consumes Gateway capabilities through a contract-driven model for:

- VisualFlow CRUD and publish.
- Run start/summary/list/commands and run stream support.
- Run history and artifact discovery.
- Tool/provider/model/semantics/space discovery and workspace policy.
- Optional features (prompt cache, KG, generated media, attachments) via advertised capability flags.

The editor path is now expected to fail early against incomplete Gateway contracts rather than
silently inferring route support.

## Follow-up and linkage

- Gateway contract strictness for run helper endpoints (input_data/history_bundle) is finalized in
  `docs/backlog/completed/060_gateway_contract_helper_endpoint_strictness.md`.

## Migration Note

The strict Gateway-only editor contract assumes `common.runs.input_data` and `common.runs.history_bundle`
for the corresponding run detail features once `060` is completed.

