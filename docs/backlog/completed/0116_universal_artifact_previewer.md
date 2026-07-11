# Planned: Universal artifact previewer (PDF/text inline, image lightbox + gallery)

## Metadata
- Created: 2026-07-11
- Status: Planned
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 adversarial rendering review: `ArtifactPlayer` branches
image/audio/video and everything else falls to an "Open artifact content"
anchor with a forced `download` attribute — so a PDF "preview" is a download,
text artifacts (including the declared `text` kind) have no inline view, images
have no zoom, and multi-image outputs show only the first image. Markdown links
in rendered answers open in the same tab and eject the user from the SPA,
destroying run-modal state.

## Current code reality
- `src/components/ArtifactPlayer.tsx` ~8, 91, 122-134: `text` kind declared but
  un-rendered; generic fallback anchor; `useArtifactObjectUrl` fetches whole
  blobs (~55-80).
- Callers always set `download` (`src/components/ArtifactInputField.tsx` ~503).
- First-image-only: `RunFlowModal.tsx` ~694 (`imageItems.find(...)`); plain
  `<img>` card ~1043-1047, no lightbox.
- `src/components/MarkdownRenderer.tsx` ~55: marked with gfm/breaks; no
  `renderer.link` override (same-tab navigation).

## Problem
The most common outputs of real flows — documents, reports, image sets — cannot
be viewed where they are produced.

## What we want to do
1. Inline previews in `ArtifactPlayer` by content kind: text (pre, with
   MarkdownRenderer for markdown types), PDF via `<iframe>` on the blob URL;
   keep a Download action separate from Preview (drop the unconditional
   `download` attr for previewable kinds).
2. Image lightbox: click any generated/preview image to zoom in an overlay
   (Escape/click-out closes).
3. Multi-image gallery: render ALL image items of a step's output as
   thumbnails + lightbox navigation, not just the first.
4. Markdown links open in a new tab (`target="_blank"
   rel="noopener noreferrer"`).

## Requirements
- Previews must be size-aware: text preview caps rendered chars with a labeled
  truncation notice + full download; PDF iframe only for blobs under a sane
  cap (browser handles paging, so cap generously).
- No regression for audio/video/image playback paths.
- Kind detection extracted into a tested pure helper
  (content_type → preview kind).

## Suggested implementation
- `src/utils/artifactPreview.ts` (new): `previewKindFor(contentType, name)` →
  `'image'|'audio'|'video'|'pdf'|'markdown'|'text'|'binary'`; unit-tested.
- ArtifactPlayer: branch on the helper; lightbox as a small local overlay
  component (no new deps).
- RunFlowModal: gallery for image lists via existing extraction (extend to map
  all items); wire cards into the lightbox.
- MarkdownRenderer: link renderer override.

## Scope
Rendering components + one util + tests. No gateway changes (artifact content
endpoints already exist).

## Non-goals
- No CSV/table renderer, no streaming text, no diff view (proposed items).
- No global assets library (proposed).
- No HTTP range streaming for media (proposed).

## Dependencies and related tasks
- Reviewer 2C findings 1-3, 7 (2026-07-11).

## Expected outcomes
PDF and text artifacts preview inline; any image zooms; multi-image outputs
show every image; markdown links never eject the user from the run modal.

## Validation
- Unit tests: previewKindFor mapping; markdown link attrs.
- vitest + tsc + build green; manual check on a PDF-writing flow and a
  multi-image generation flow.

## Progress checklist
- [ ] artifactPreview helper + tests
- [ ] ArtifactPlayer inline text/PDF + download split
- [ ] lightbox + multi-image gallery
- [ ] MarkdownRenderer link target
- [ ] CHANGELOG

## Guidance for the implementing agent
Prefer adding branches to ArtifactPlayer over new components where possible;
keep the lightbox dependency-free and keyboard-dismissable.

## Completion report
- Completed: 2026-07-11
- Shipped: preview-kind helper (`src/utils/artifactPreview.ts`, tested;
  concrete content types win over extensions, extensions speak only for
  information-free types); ArtifactPlayer inline text/markdown (200k-char
  labeled #TRUNCATION clamp) and PDF iframe with Open/Download split;
  post-review hardening: PDF blobs force `application/pdf` (filename-
  detected PDFs arrived typeless and browsers downloaded instead of
  rendering), a 25MB honest-refusal guard before downloading text bodies,
  fragment links stay same-document while other markdown links open in a
  new tab. Image lightbox (Escape/click-out) + multi-image gallery: card
  keyed per step (state leak fix), primary artifact always leads the
  gallery (review P2-5), one clamped index for image + thumb highlight.
- Validation: artifactPreview tests + full vitest 275, tsc, build green.
- Residuals (acknowledged): no HTTP range streaming for media (proposed
  0136's lane); lightbox has no focus trap (a11y polish, 0141/0138 track);
  CSV/YAML table rendering is proposed 0136.
