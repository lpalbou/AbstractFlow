# Completed: diagram-render workflow + co-scientist professional figures

## Metadata
- Created: 2026-07-20
- Status: Completed
- Completed: 2026-07-20
- Work id: abstractflow-0148
- Thread anchor: operator directive 2026-07-20 00:28 ("didn't i asked you to
  create a workflow dedicated to create professional diagram? work with one
  adversarial sub agent and make it so. then generate a new version of
  [the R1 report]") — closing the figure half of the 0147 directive
  ("improve the visual of the reports... you could create a dedicated
  workflow to create and render professional figures")

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
The co-scientist reports carried ASCII-art architecture sketches (the
operator screenshotted one). The runtime PDF/DOCX writers have no
inline-image branch (runtime backlog 0069), so "professional figures"
needed: a rendering path that produces real image files, a way to get them
INTO the delivered PDF, and honest degradation everywhere the chain can
fail.

## What was built

### `diagram-render@0.1.0` (new dedicated workflow)
- Input: a structured diagram SPEC (JSON data). Two kinds: `layered`
  (architecture columns of rounded boxes, per-layer colors, labeled
  solid/dashed arrows) and `line` (trajectories, integer x-ticks, optional
  honest `y_min` anchor).
- A FIXED matplotlib renderer script (constant shipped by the workflow) is
  written to the workspace and executed via `call_tool execute_command`;
  the LLM's authoring surface is data, never code.
- Deterministic render gate: stdout ok-marker AND a filtered `list_files`
  existence check must both pass; otherwise `rendered:false` + `#FALLBACK`
  warning (matplotlib missing / bad spec / crash all degrade honestly —
  never a flow failure). Figures register as durable run artifacts
  (PNG dpi-200 + vector PDF).
- Injection-proofing (adversary P0): `basename`, `out_dir`, `python_bin`
  are all reduced to safe character sets before shell quoting; traversal
  segments stripped; shell-active characters in the interpreter rejected
  wholesale (fallback `python3`).

### co-scientist@0.1.12 integration
- `fig_spec` LLM node designs the architecture spec from the run's top
  hypotheses (strict schema; fold clamps to ≤4 layers / ≤4 nodes each,
  drops dangling edges, refuses <2 layers or <3 nodes).
- The Elo trajectory spec is fully deterministic from tournament history
  (y-axis anchored at the 1200 start — same honesty rule as the ASCII bar).
- Markdown embeds the PNGs; the PDF export appends the figure PDFs as
  appendix pages via a pypdf merge script (`execute_command`); md wording
  never promises pages the merge has not made.
- `pdf_sha256` reports the DELIVERED bytes: the merge script prints the
  post-merge hash and `final_sha` prefers it (adversary P1-1 — the
  pre-merge hash shipped wrong on every figure run).
- Figure basenames carry the run timestamp (adversary P1-3 — fixed names
  collided across runs sharing a workspace_root).
- Meta prompt no longer requests ASCII-art diagrams.

## Adversarial review (mandated, one fable5 reviewer)
Verdict: "sound design... shippable after the P0/P1 fixes." Verified clean:
the `if_valid=false` pure-pull path, merge-failure atomicity (report intact),
subflow input mapping, colorblind safety. Findings folded: P0 out_dir/
python_bin injection lane; P1 pre-merge sha, silent-merge-failure wording,
basename collision; P2 y-axis auto-scale overstating gain, stranded layer
headers, unfiltered listing gate, dropped spec-error reason, NaN in the
JSON emitter. Deliberately not taken: parsing stdout's last line as JSON
(P2-3 — the substring marker is triple-gated already).

## Validation
- All code nodes compile AND execute through the real RestrictedPython
  sandbox (`create_code_handler` + `_generate_code_from_body`) — including
  injection-attempt cases, NaN specs, merge-sha extraction, ts basenames.
- Renderer script tested standalone on both spec kinds (including the
  fixed header placement and 1200-anchored chart).
- Live end-to-end run (OVH gpt-oss-120b): LLM-designed 4-layer architecture
  figure + Elo chart rendered, markdown embeds both, delivered PDF is 15
  pages with both figures as appendix pages, three execute_command
  approvals auto-resolved.
- Honest-degradation path live-proven by the first (broken) attempt: report
  shipped with ASCII fallback + `#FALLBACK` caveat instead of failing.

## Incidents folded back as guards
- **Probe approval route**: the gateway resume route is
  `POST /api/gateway/commands` (run_id in body); `/runs/{id}/command` does
  not exist. Never noticed before because web tools are safe-auto-approve —
  `execute_command` is this flow's first ask-approval tool. The probe now
  marks approvals only after the POST succeeds.
- **Unwired code input**: `exec_args.prep` had no edge, so the render
  command was empty and execute_command "succeeded" doing nothing.
  `wf_common.validate_edges` now fails the build for any code-node data
  input with no edge and no pin default (all generators re-validated green).
- **Sandbox `chr`**: code nodes have no `chr` builtin (earlier same-night
  lesson, re-confirmed) — self-checks must run through the real sandbox.

## 2026-07-20 follow-up: INLINE image embedding (operator: "you did not render the figures in the pdf")
The first delivery appended figures as pypdf appendix PAGES while the report
BODY still showed the raw `![...](path)` markdown as literal text (the PDF
writer had no inline-image branch — operator screenshotted it). Fixed at the
renderer: `abstractruntime/documents/pdf.py` + `docx.py` now embed a
standalone markdown image line inline (scaled to the text column, alt as an
italic caption; PDF via reportlab `Image`, DOCX via a real `word/media/*`
part + drawing XML). The `write_pdf`/`write_docx` handlers pass the resolved
workspace root as `base_dir`; the resolver refuses remote/`data:` URLs and
any path escaping base_dir (resolve + `relative_to` containment) and degrades
to `[figure: alt]` — never raw markdown, never an exception. The co-scientist
pypdf appendix-merge was DELETED (redundant); `pdf_sha256` is write_pdf's own
hash again. The run timestamp is frozen once into `co.ts` before figures
render — `system_datetime` is a volatile pure source, so the figure basename
chain and the report-filename chain would otherwise pull different times and
break the embedded path (caught by the mandated adversary). Two adversarial
reviews (renderer correctness/security + end-to-end pipeline). Live-verified:
co-scientist@0.1.12 run produces a 12-page PDF with both figures embedded on
the page where referenced (pages 5-6), zero raw `![` in the text.

## 2026-07-20 second operator report ("none of the figures are part of the pdf") + adversary hardening
The first inline-embed delivery was correct in re-rendered files but the
RUNNING GATEWAY was stale (booted 22:46, before the 08:17 renderer edit) — a
bundle reload does not reload Python modules, so every report it produced
(the exact file the operator cited) still used the old renderer. Requested a
stack bounce (framework owns relaunch); after the 09:32 restart the fix is
live. Two mandated fable5 adversaries (renderer correctness/security +
end-to-end pipeline) found and I folded: P0 workspace-root collapse to `/`
(tail-match guard); P1 DOCX quote/control-char corruption (attribute
escaper); P1 raw-markdown leak for non-standalone image refs and `]`/newline
alts (inline pipelines emit `[figure: alt]`, non-greedy match); P1 DOCX
height clamp + IHDR validation; plus size caps, unique ids, underscore
emphasis, UNC refusal, caption sanitization, and dropping the duplicate baked
caption. Bundle bumped to `co-scientist@0.1.13` (same-version re-publish is
refused by the gateway — the bump forces pickup). Proven in an adversary
attack harness AND on the delivered reports: figures embed in PDF + DOCX,
python-docx opens both, zero raw markdown, secrets/traversal refused.

## Honest limits / follow-ups
- Inline embedding is now the delivery shape in all three formats (md/PDF via
  reportlab / DOCX via OOXML drawing); coordinated with runtime as a
  consumer-driven change to their `documents/` package (offered for
  ratification).
- Non-PNG images in DOCX use a fallback aspect ratio (only PNG dimensions are
  parsed from bytes); the co-scientist figures are always PNG.
- The `.md` deliverable references figures workspace-root-relative
  (`reports/figures/x.png`) — correct for the PDF/DOCX base_dir resolution
  but a file-relative markdown viewer (GitHub/VS Code) resolves from the md's
  own dir and misses; the operator's deliverables are the PDF/DOCX. A
  renderer-side second resolution base is the follow-up if md-viewer parity
  is wanted.
- `python_bin` defaults to `python3` on the gateway PATH; a host without
  matplotlib degrades to the ASCII fallback with an actionable warning.
- The LLM occasionally truncates captions at the 300-char clamp mid-word;
  cosmetic.
