# co-scientist (and report-writing workflows): register produced files as durable run artifacts

- **Status**: proposed
- **Date**: 2026-07-15
- **Raised by**: observer (operator directive 2026-07-15 11:11 — "list any
  artifacts created out of the run… note: only what has been written durably
  through the runtime can surface")
- **Owner**: flow (workflow bundles; co-scientist first)

## Problem

The co-scientist workflow writes its final reports to the run's workspace
folder only. Verified on a live completed run
(`e13cae51-7167-4758-8764-403f6efbb404`, gateway :8080, 2026-07-15):

- Workspace on disk (`runtime/workspaces/24b3014be9ac4912ae7be033905d36cc/reports/`)
  contains the three real products:
  - `co-scientist-research-….md` (65 kB)
  - `co-scientist-research-….pdf` (59 kB)
  - `co-scientist-research-….docx` (23 kB)
- The run's durable artifact store
  (`GET /api/gateway/runs/{run_id}/artifacts`) contains **55 artifacts, all
  internal offloads** (`tags.source = run_store_offload` ×7 /
  `node_trace_offload` ×47, json/text). **Zero file products.** The only
  "report"-ish artifact is the var offload
  `vars._temp.agent.term_reflect.sub.output.report` (text/plain), which is
  the report's TEXT, not the shipped files.

Consequence: no client can surface the pdf/md/docx through the runtime —
they exist only as loose files in a workspace directory. The observer's run
Story now lists durable artifacts and honestly shows "no file products" for
these runs (plus a local-machine Folder button as a stopgap that only works
when observer + gateway share a machine).

## Ask

When co-scientist (and any report-writing flow) writes its report files, it
should ALSO register them as durable run artifacts through the runtime's
artifact store (the same lane session attachments and media artifacts ride),
so they are addressable (`artifact_id`), listable per run, and servable via
`/runs/{run_id}/artifacts/{artifact_id}/content` to any client.

Acceptance sketch:

- A completed co-scientist run lists its md/pdf/docx under
  `GET /runs/{run_id}/artifacts` with honest `content_type`
  (`text/markdown`, `application/pdf`,
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`),
  `filename`, and `size_bytes`.
- Files remain in the workspace too (the folder is the operator's working
  surface; the artifact store is the durable/addressable one).
- No truncation of file content on the artifact path (label `#TRUNCATION`
  anywhere a preview clips).

## Notes

- Whether the right mechanism is a flow-level `emit_artifact` node, a
  runtime effect on `write_file` under `reports/`, or bundle-level policy is
  flow's call; the observer only needs the artifacts to EXIST durably.
- Announced on agora commons to the flow seat the same day.
