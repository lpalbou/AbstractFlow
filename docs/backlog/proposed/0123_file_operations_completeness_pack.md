# Proposed: File operations completeness pack (append/copy/move/delete/find; read caps; CSV)

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: ADR-0037 (Artifact / Local File / Server File contract)
- ADR impact: None (extends the existing workspace policy boundary)

## Context
2026-07-11 assistant/FS-lane review: the file node inventory is read/write/list
only (src/types/nodes.ts ~1608-1812) — no append (write is full overwrite,
runtime executor ~496-497), no move/copy/delete/rename, no glob/content
search, no diff, no zip, no CSV/XLSX/YAML awareness. `read_file` is unbounded
(`path.read_text`, executor ~437) and non-UTF-8 raises; `read_pdf` got
max_chars+truncated but the most-used node didn't.

## Current code reality
All file ops flow through the `_resolve_user_file_path` workspace policy
boundary, so additions inherit containment for free.

## Problem or opportunity
Real document/data workflows need append-log, reorganize, cleanup, find, and
tabular IO; today each becomes a Code node or an agent tool call.

## Proposed direction
Add nodes (runtime + templates): `append_file`, `copy_file`, `move_file`,
`delete_file` (behind an explicit destructive confirm/policy flag),
`find_files` (glob + optional content match, bounded results), `read_csv` /
`write_csv` (list-of-objects contract); add `max_chars` + `truncated` to
`read_file` mirroring read_pdf; encoding parameter with honest failure.

## Why it might matter
FS maturity was named by the product owner as "scarce/immature"; this is the
core-ops half (the UX half is the workspace browser + open-produced-files
items).

## Promotion criteria
Runtime seat bandwidth; delete-policy wording agreed (destructive ops must be
loud and policy-gated).

## Validation ideas
Runtime unit tests per op incl. containment escapes; a doc-pipeline example
flow using append + find + csv.

## Non-goals
No file watching/triggers (0119's lane); no zip in v1 unless trivial.

## Guidance for future agents
Mirror pin naming from the existing family (path/content/success/error
message); regen catalog + llms-full.
