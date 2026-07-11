# Proposed: Template gallery via the gateway catalog

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 competitive research: templates are the primary adoption/education
channel for workflow products (n8n community templates, ComfyUI template
library, Flowise/Langflow marketplaces). AbstractFlow ships bundled examples in
FlowLibraryModal only — no tags, no capability filters, no graph preview before
import.

## Current code reality
`src/utils/bundledFlows.ts` + FlowLibraryModal list bundled examples; publish/
versioning to the gateway catalog exists; node capability requirements exist
per template (gateway-aware palette work 0087).

## Problem or opportunity
Users learn node vocabulary through templates; the current library
under-delivers discovery and preview.

## Proposed direction
Grow FlowLibraryModal into a gallery: tag + capability filters ("needs image
route"), read-only graph preview (reuse canvas in preview mode), one-click
import-as-draft, sourced from bundled examples + the gateway catalog; later
accept curated community submissions via the catalog.

## Why it might matter
Ranked top-8 competitive adoption gap; builds on existing publish
infrastructure.

## Promotion criteria
Product priority; catalog metadata fields (tags/description) audit.

## Validation ideas
Filter by capability hides incompatible templates on a gateway without that
route; preview renders without mutating the current draft.

## Non-goals
No open marketplace/upload portal in v1; no ratings.

## Guidance for future agents
Preview must be strictly read-only (separate store instance) — no accidental
draft contamination.
