# Completed: Permissive PDF document nodes

## Metadata
- Created: 2026-06-05
- Status: Completed
- Completed: 2026-06-05

## ADR status
- Governing ADRs: root `docs/adr/0029-permissive-dependency-and-licensing-policy.md`
- ADR impact: No new ADR. This item applies the permissive dependency policy to Flow-authored PDF workflows.

## Context
The authoring assistant needed a truthful way to create workflows that read and write PDF reports. The existing catalog only exposed generic `Read File` / `Write File` text nodes, so PDF requests were either blocked or risked being represented by fake Markdown-to-`.pdf` file writes. A license review also showed the existing PyMuPDF-family packages are not suitable for a permissive default path.

## Current code reality
- `abstractruntime` VisualFlow file nodes were text/JSON-only.
- `abstractflow` readiness checks intentionally blocked PDF output because no first-class Runtime PDF node existed.
- Runtime base dependencies directly selected `pymupdf4llm` and `pymupdf-layout`, and also selected AbstractCore's `media` extra, which can bring the PyMuPDF stack transitively.
- PyPI package metadata reports PyMuPDF/PyMuPDF4LLM as AGPL/commercial and `pymupdf-layout` as Polyform Noncommercial/commercial. `pypdf` reports BSD-3-Clause and ReportLab reports BSD.

## What changed
- Added Runtime-owned permissive PDF helpers using `pypdf` for extraction and `reportlab` for rendering.
- Added explicit VisualFlow `read_pdf` and `write_pdf` handlers in AbstractRuntime.
- Added Flow palette/catalog nodes `Read PDF` and `Write PDF` with typed pins for content, metadata, page counts, warnings, bytes, sha256, content_type, and file_path.
- Updated authoring assistant readiness so PDF requests require a real `Write PDF` node on the execution path before `On Flow End`, with its output path exposed.
- Tightened Markdown artifact readiness so `Write File` must also be on the execution path before `On Flow End`.
- Removed PyMuPDF-family packages and `abstractcore[media]` from Runtime's base dependency path for VisualFlow PDF support.
- Updated Runtime and Flow docs, changelogs, authoring skill, and LLM-readable docs.

## Scope
- AbstractRuntime PDF document node execution.
- AbstractFlow node catalog, authoring readiness, authoring skill, and user-facing docs.
- Runtime dependency profile for the VisualFlow PDF path.

## Non-goals
- This item does not complete the broader AbstractCore media PDF migration. AbstractCore's optional media stack still needs a separate package-owned pass if the project wants every Core media/profile path to remove PyMuPDF-family packages.
- This item does not add OCR, pixel-perfect HTML/CSS PDF rendering, or artifact-native PDF export nodes.

## Expected outcomes
- Agents can author workflows that visibly create and read PDF files with dedicated nodes.
- PDF output is not represented by sandbox Code or generic text file writes.
- Runtime stores only JSON-safe PDF metadata/path outputs in run state.
- Runtime's default Flow PDF path uses permissive dependencies.

## Validation
- `python -m pytest abstractruntime/tests/test_visualflow_file_nodes_workspace.py -q`
- `npm test -- AuthoringAssistantDrawer flowAuthoringCommands`
- Pending final gate in this pass: Flow lint/build/docs generation.

## Progress checklist
- [x] Run architecture subagent review.
- [x] Run independent review subagent.
- [x] Check package license metadata.
- [x] Implement Runtime PDF helper and VisualFlow handlers.
- [x] Add Flow node catalog entries.
- [x] Update assistant readiness and authoring skill.
- [x] Add Runtime PDF round-trip test.
- [x] Update user-facing docs and LLM context.

## Guidance for future work
The next licensing cleanup should target AbstractCore's optional media PDF stack. A dedicated document capability package or Core document capability can preserve higher-level document APIs while moving PyMuPDF-family packages behind an explicit commercial/operator-approved extra.
