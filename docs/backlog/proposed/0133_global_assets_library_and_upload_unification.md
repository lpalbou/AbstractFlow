# Proposed: Global assets library + one robust upload path

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: ADR-0037 (artifact contract)
- ADR impact: None

## Context
2026-07-11 rendering/assets review: asset reuse exists only inside per-pin
pickers (native <select> of text labels, no thumbnails/size/date, hardcoded
limits); no browse-all UI, no rename/tag editing, no favorites, no
"open producing run" provenance action; node-level uploads mint synthetic
sessions invisible to "This session" scope; sha256 captured but unused for
dedup. Upload logic is duplicated 6× with drift — the Toolbar follow-up path
omits `timeoutMs: 0` so large follow-up attachments abort at 30s
(Toolbar.tsx ~1066).

## Current code reality
Gateway artifact search endpoint exists (scope/modality/query filters);
ArtifactInputField/ArtifactListInputField/PropertiesPanel/BaseNode/
RunFlowModal/Toolbar each build their own upload form.

## Problem or opportunity
Assets are effectively write-only storage; reuse degrades as artifact count
grows; the duplicated upload path already shipped one real bug.

## Proposed direction
(1) Extract `uploadArtifact()` in gatewayClient (progress %, cancel, bounded
retry, size preflight, consistent timeoutMs) and adopt at all six call sites —
ship this half FIRST (fixes the 30s bug). (2) Toolbar-level Assets modal on
the existing search endpoint: thumbnail grid, preview pane (reuse 0116
previewer), tag editing, provenance link to producing run, "use as input"
handoff; unify picker rows on the same card component.

## Why it might matter
Directly answers the product owner's "is our way to find and reuse an asset
good enough?" — today the honest answer is no.

## Promotion criteria
0116 previewer landed (reused by the preview pane); gateway tag-update
endpoint audit.

## Validation ideas
Upload of a 100MB file with progress + cancel; follow-up attachment >30s
succeeds; library search round-trip; provenance link opens the right run.

## Non-goals
No dedup-by-sha rewriting of history; no cross-gateway asset federation.

## Guidance for future agents
Ship the upload unification independently and early — it is a bug-fix-sized
change hiding inside a feature item.
