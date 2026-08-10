# `deep-research` Workflow Family

`deep-research` is the shipped production research WorkflowBundle family for
Gateway-hosted runs. Flow ids, display names, files, and the bundle id all use
the `deep-` vocabulary (`deep-research`, `deep-plan`, `deep-investigate`,
`deep-review`, `deep-render`) — the historical `dp-` prefix was fully retired
on 2026-07-16 (operator ruling); older `dp-research@0.1.x` bundles remain on
disk only for completed-run history. It is authored as editable VisualFlow
JSON in `examples/flows/deep-*.json` and packed as `deep-research@0.1.7.flow`
(version lineage continues from the dp era; bundle versions are immutable by
sha).

## User Inputs

The public entrypoint is `deep-research`. It exposes product-facing inputs:

- `request`: what should be researched.
- `viewpoint`: the angle, thesis, audience stance, or evaluation lens.
- `effort`: one of `quick`, `standard`, or `thorough`.
- `provider` / `model`: optional overrides. Leave both blank to use the current
  Gateway/AbstractCore defaults.

All other controls are derived from `effort`, including per-pass agent
iterations, review-round count, source budget guidance, deadline guidance,
source/citation policy, export title, export prefix, and reasoning intensity
when the selected model is known to support reasoning controls.

The same optional provider/model override is used by planner, researcher,
adversarial critics, and writer. There are intentionally no separate
critic/writer model fields in the public entrypoint.

Effort presets:

| Effort | Behavior |
| --- | --- |
| `quick` | One review round, small source budget, concise report. |
| `standard` | Balanced source budget, two review rounds, full report and audit files. |
| `thorough` | Larger source budget, three review rounds, stricter triangulation and disconfirmation search. |

## Workflow Stages

- `deep-plan`: turns the request, viewpoint, and derived effort settings into a
  research plan and quality gates.
- `deep-investigate`: uses a read-only evidence tool allowlist to gather and
  structure sources. Each pass receives the previous investigation and latest
  adversarial review, so review findings drive the next pass.
- `deep-review`: runs three adversarial lenses: evidence skeptic, user relevance
  critic, and gap hunter, then synthesizes which insights matter and what to
  investigate next.
- `deep-render`: writes the final Markdown report and machine-readable audit
  objects.
- `deep-research`: derives the effort settings, orchestrates the subflows with a
  review-gated loop, then exports files.

Research agents are limited to read-only evidence tools:
`web_search`, `fetch_url`, `skim_websearch`, `skim_url`, `read_file`, and
`skim_files`. Export is deterministic via `Write File`, `Write PDF`, and
`Write DOCX` nodes, not model tool calls.

Derived `deadline_minutes` and `max_sources` are passed into the research
prompts and audit outputs. They do not interrupt a running provider request
mid-call; the deterministic hard gate is the derived review-round count, plus
the per-agent iteration cap.

## Outputs

The root flow returns direct paths for:

- Markdown report: `<derived-output-prefix>-<timestamp>.md`
- PDF report: `<derived-output-prefix>-<timestamp>.pdf`
- DOCX report: `<derived-output-prefix>-<timestamp>.docx`
- Run manifest: `<derived-output-prefix>-<timestamp>.manifest.json`
- Source ledger: `<derived-output-prefix>-<timestamp>.sources.json`
- Claim-evidence matrix: `<derived-output-prefix>-<timestamp>.claims.json`
- Iteration log: `<derived-output-prefix>-<timestamp>.iterations.json`
- Warnings: `<derived-output-prefix>-<timestamp>.warnings.json`

The root outputs also include actual PDF/DOCX `sha256` values and an
`export_manifest` object built after file writes complete. The manifest combines
the model-rendered research manifest with real export paths, byte counts, hashes,
and content types.

The final report should include method, findings, evidence tables, contrary
evidence, limitations, open questions, and cited source ids. The JSON audit
files exist so operators can inspect provenance and completeness without
parsing the prose report.

The derived `include_images` setting currently asks the writer for visual briefs
such as tables, Mermaid-style diagrams, and illustration slots in Markdown. It
does not run a bitmap image generation node in `0.1.0`.

## Rebuild And Validate

Regenerate the editable flows and bundle:

```bash
python abstractflow/scripts/build_deep_research_workflows.py
```

Validate the shipped bundle contract from the workspace root:

```bash
PYTHONPATH=abstractgateway/src:abstractruntime/src:abstractcore \
  pytest -q abstractgateway/tests/test_deep_research_bundle_contract.py
```
