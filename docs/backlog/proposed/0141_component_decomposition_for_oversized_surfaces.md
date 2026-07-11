# Proposed: Component decomposition for oversized surfaces (RunFlowModal, PropertiesPanel, index.css, AuthoringAssistantDrawer)

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
Repo rule: 1 file = 1 task, ideally <600 lines, with smart refactoring
proposals when files grow too big. Current reality (2026-07-11):
RunFlowModal.tsx 8,109 lines; PropertiesPanel.tsx 6,806; index.css 6,024;
AuthoringAssistantDrawer.tsx 3,570. The 2026-07-11 adversarial reviews
repeatedly hit the cost: selection/follow logic, failure panel, follow-up
dialog, artifact extraction heuristics, and wait rendering all interleave in
one component; palette.css contains toolbar/properties/pin-legend styles
despite its name; a likely-dead legacy `.flow-list` block coexists with the
flow library.

## Current code reality
Every planned run-modal item (0111, 0115, 0116) pays a comprehension tax in
these files; tests exist for extracted utils but not for the interleaved UI
logic.

## Problem or opportunity
Change velocity and review quality degrade with each addition; extraction of
pure logic into tested utils (the repo's own proven pattern) is applied
inconsistently.

## Proposed direction
Incremental extraction, behavior-preserving, one surface per pass:
RunFlowModal → {PreflightForm, StepTimeline, StepDetails, WaitPanels,
FollowUpDialog, artifact extraction utils}; PropertiesPanel → per-pin-family
editors; index.css → per-surface modules (tokens, chrome, canvas, run-modal,
library); delete dead `.flow-list` and JsonCodeBlock after confirmation.
Each extraction lands with the existing tests green and no visual diff
(screenshot scripts).

## Why it might matter
Every future item in this backlog gets cheaper and safer.

## Promotion criteria
Opportunistic: bundle each extraction with the planned item that touches the
same region (0115/0116 first candidates), never as a big-bang rewrite.

## Validation ideas
vitest + tsc + build + screenshot-script parity per extraction.

## Non-goals
No behavior changes disguised as refactors; no CSS framework migration.

## Guidance for future agents
Extract pure logic to tested utils FIRST (cheap, safe), JSX regions second;
never both in one commit-sized change.
