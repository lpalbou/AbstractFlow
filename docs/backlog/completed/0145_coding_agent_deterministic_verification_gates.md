# Completed: coding-agent deterministic verification gates (v2 redesign)

## Metadata
- Created: 2026-07-17
- Status: Completed
- Completed: 2026-07-18
- Work id: abstractflow-0145 (S0 ruling `<package>-<NNNN>`, agora c3021)
- Thread anchor: agora commons c2725 / c2735 / c2736 / c2772 (operator) /
  c2845 (receipt) / c2945+c3026 (external validation)

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
The R-Type 3-arm experiment (code seat, agora c2725) showed `coding-agent`
v1 shipping games that crash on every frame while its verifier passed them.
The operator's verdict (relayed c2735): "badly designed — you have to do
more research and improve it." Root cause, owned on the record (c2753): the
v1 verifier PROMPT contained an authored escape hatch — "executes=true if
the entrypoint loads" — and delegated gate discretion to the verifier LLM.
Both observed failures (index.html+game.js split-brain ReferenceError;
160x144 draw into a 3x canvas) were runtime facts invisible to an
unexecuting reader. The ralph experiment (c2736) supplied the design
principle: world-side execution signals beat LLM review, and gate cost
should be pay-per-failure.

## What was done
`coding-verify-gates` v2 (bundle `coding-agent@0.2.0`, generator
`scripts/build_coding_agent_workflow.py`), gates in cost order — execute
where an executor exists, LLM-judge only where none does:

- G0 DELIVERY (deterministic): `call_tool list_files` ground truth —
  non-empty workspace, entrypoint exists.
- G1 INTEGRATION (deterministic): entrypoint reference check — dangling
  `src`/`href`, split-brain orphan `.js` siblings, case-mismatch named
  honestly. Red-team hardened: markup-only scan (script/style bodies
  stripped), token-boundary attribute matching (`data-src=` ≠ `src=`),
  relative-with-extension-only refs (SPA routes/anchors quiet), orphan
  flagging skips inline-import mentions and non-browser siblings.
- G3 EXECUTES-web (deterministic): `call_tool browser_probe` (code's
  registered tool, c2769) — page/console errors and failed local resource
  loads fail the round with exact error text; blank canvas blocks a pass on
  every round; non-blank FRACTION floor (≥2% of a real sampling pass —
  cav2/run1's 1-of-369 corner-ninth escape, c2945); draw-extent check on
  code's additive `painted_bbox` diag (confined-to-under-half in BOTH
  dimensions fails — the scale-bug class; letterboxed passes; older probes
  degrade gracefully). Missing executor = `environment_failures`
  (fail-closed), and the round loop stops early on environment-only
  failures instead of burning repair rounds.
- G4 ORPHAN FUNCTIONS (deterministic): a declared function whose identifier
  appears exactly once across entrypoint + main referenced script is dead
  code or a missing call — the `spawnBoss` progression-deadlock class
  (defined-never-invoked, zero errors thrown). Conservative: any second
  reference passes; declarations only.
- LLM verifier (agent node) retained for builds/matches only; its
  `executes` opinion is OVERRIDDEN by the probe world-side in a
  deterministic merge; strict-expressible schema (all properties required);
  `max_output_tokens=2000`; prompt carries gate ground truth + the
  discipline line (agent seat's paid-for precisions, c2847).
- Builder: delivery rules + single-file-first guidance; `browser_probe` in
  the builder allowlist for organic mid-build self-verification (memact
  datum c2790); deterministic gates stay authoritative.
- Branch verdicts converge through a `vg.verdict` run var (single writer
  per path; no multi-entry pin overrides); `round_index` rides from the
  root loop for round-aware gate policy.

## Validation (receipts)
- Scripted proof: `scripts/coding_agent_v2_gates_smoke.py` — 43 checks
  driving the REAL compiled flow through abstractruntime with stubbed
  tools; fail-fast paths never invoke the verifier agent; fail-closed
  no-executor semantics; probe-overrides-LLM merge; early-stop loop;
  all gate false-positive/negative pins.
- Red team: fable5 adversarial subagent; finding classes folded same-day
  (G1 false positives, blank-canvas pass-through, RestrictedPython sandbox
  regression surfaced cross-seat — runtime restored the underscore policy,
  consumer-validated 32/32 under the restricted path, c2892/c2893/c2898).
- Suite: 346 frontend tests green; typecheck + build clean; bundle packed
  and served by the live gateway (registry reloads verified).
- EXTERNAL validation (code's harness, probe mounted, ornith-35b):
  cav2 (c2945) 2/2 completed+integrated vs v1's 0.5/2 — strictly better;
  cav2r2 (c3026) after the iteration folds: 2/2 completed ~2x FASTER
  (19.5/16.4 min vs 34.2/36.5), taxonomy classes 4 and 5 flipped to
  FIXED-with-gate with no recurrence. The 2x speedup is the pay-per-failure
  hypothesis measured (deterministic failure text spares LLM verify
  rounds).

## Honest limits (named, not silently implied)
- Non-web `executes` still rides the LLM verifier's self-report (v1 class);
  staged fix = per-class executor registry (pytest/run for python).
- Gateway-hosted deployments hit the fail-closed path until `browser_probe`
  gets a mount decision (abstractcode tool; runtime's default toolset
  imports only from abstractcore — code+core+gateway's call).
- Class 6 (playability/progression) sits above the probe's ceiling: a
  playthrough gate (G5) with state assertions is buildable the way G3
  consumed the probe, but assertions are task-specific — flow's stated lean
  (c3031): optional author-declared acceptance checks on the coding.v1
  request, honest absence otherwise; operator hands remain the full-truth
  gate. Awaits the operator design round.
- Verifier-infra failure terminates the run (no error-continuation surface
  on effect nodes); runtime ruled `continueOnError` → `_absorb_failure`
  compiler mapping (c2896, adopted c2919) — lands in runtime's queue; the
  agent-subrun absorption extension is a separate design.

## Follow-ups
- Wire `continueOnError` on the deterministic gate nodes when runtime's
  mapping ships (receipt expected on thread c2851).
- G5 playthrough gate design round with the operator (class 6).
- browser_probe mount decision for gateway-hosted runs (cross-seat).
