# 0152 — Multi-agent coding workflow (scout→plan→gate→build→lint→test→doc→PR→gate→merge)

- Status: proposed (design, cycle 0 — pre-adversary)
- Work id: abstractflow-multiagent-coding-workflow
- Thread anchor: operator directive (Laurent, relayed agora c4710 after a
  delivery gap)
- Owner: flow
- Test target: "create a fully playable r-type game in black & white, gameboy
  style — mechanics, monsters, boss, weapons+effects, procedural VFX/SFX/music,
  arrow-key playable." Provider `airelay` / model `gpt-5.6-sol`.
- Deliverable: the workflow + a 3-way comparison vs `basic-agent` and `coder`.

## Operator spec (verbatim intent, 14 steps)

1. user provides a request.
2. SCOUT agent mines SEPARATELY (a) code+documentation and (b) the internet to
   select relevant context.
3. PLANNER agent receives request + scout's engineered context.
4. GATE 1: present plan to user; reject+comments → back to step 2 with the
   comments; accept → step 5.
5. planner stores the plan as a PLANNED BACKLOG item (backlog skill), title ≤ 3
   words.
6. DETERMINISTIC code creates a git branch off main named with the step-5 title
   (git init if no repo).
7. BUILD agent implements the code in that branch.
8. LINT agent: auto-fix what it can; the rest → back to build; clean → proceed.
9. TEST agent tests as a user would, against the original request (works AND
   does what was asked); fail → back to step 7 with the fix list; pass → step 10.
10. build agent formats + documents; adds/updates a per-file header (what the
    file is, its purpose, how it interacts with others).
11. DOCUMENTATION agent uses the coredoc skill: create/update project docs +
    version + changelog.
13. CICD agent creates a clean PR (short summary, features/bugs list,
    design-choices list). [operator numbering skips 12]
14. GATE 2: wait for user testing + approval; reject → back to step 7 with
    comments; approve → merge the PR to main.

Constraints:
- "code" = DETERMINISTIC (python/shell), NO AI inference.
- User gating is a PARAMETER: default waits for approval; auto-approve option.
- Evaluate with 3 fable5 adversaries over 3 refinement cycles, THEN create+test.

## Draft mapping to VisualFlow (cycle-0 — the thing the adversaries attack)

Precedent: coding-agent's ReAct-from-primitives shape (while + get_var/set_var
scratchpad + agent subruns + deterministic code gates). New elements: two
`ask_user` gates, skill-activated agents, git/PR deterministic code, and the
scout's dual mining.

**Run inputs (on_flow_start pins):** `request` (string), `workspace_root`,
`gating_mode` (string: "wait" default | "auto"), `max_plan_revisions` (num,
default 3), `max_build_cycles` (num, default 5), provider/model (airelay /
gpt-5.6-sol at test).

**Nodes / lanes:**
- SCOUT (step 2): TWO agent subruns — `scout_code` (allowlist:
  read_file/list_files/search_files/skim_files/skim_folders/analyze_code) and
  `scout_web` (web_search/fetch_url/skim_websearch/skim_url). Both take the
  request; each emits an "engineered context" summary. A deterministic `code`
  node merges the two into one context blob (dedupe, cap size). [Open Q1: run
  the two scouts in sequence or via a parallel/foreach lane? VisualFlow has no
  true parallelism inside one run — sequential subruns, or a map lane.]
- PLANNER (step 3): agent subrun; input = request + merged context; output = a
  structured plan (goal, steps, files, risks) + a ≤3-word title.
- GATE 1 (step 4): `ask_user` (prompt = the plan). Response parsed by a
  deterministic `code` node: accept vs reject+comments. `gating_mode="auto"`
  skips the wait (deterministic pass-through). Reject → `set_var` the comments
  and loop the exec edge back to the SCOUT entry (a `while`/`if` carrying a
  `plan_revisions` counter bounded by `max_plan_revisions`).
- BACKLOG (step 5): the planner (or a dedicated agent) uses the **backlog
  skill** to write a PLANNED item, title ≤3 words. [Open Q2: skill activation —
  skills reach agent subruns via `_runtime.skills_block`, set at RUN start, not
  by the flow. So the workflow REQUIRES backlog+coredoc skills to be activated
  at run start; it cannot silently self-activate them (trust boundary). The
  flow documents this as a run requirement; the agent nodes `read_skill`.]
- GIT BRANCH (step 6): DETERMINISTIC `call_tool execute_command` — `git rev-parse`
  to detect a repo (git init if absent), branch name = slugified ≤3-word title,
  `git checkout -b <title> main` (or the default branch). No AI.
- BUILD (step 7): agent subrun in the branch (full file-writing toolset).
- LINT (step 8): agent subrun; auto-fixes, reports the un-fixable set; a
  deterministic `code` node decides clean vs back-to-build (loop).
- TEST (step 9): agent subrun; a run-as-a-user test against the request; a
  deterministic `code` node (or the agent's structured verdict + a gate) decides
  pass vs back-to-build-with-fixlist. [Open Q3: how is "tests as a user would"
  made deterministic-enough to loop on — a structured verdict like coding-agent's
  feature_checks? reuse coding-agent's G-gates?]
- FORMAT+HEADERS (step 10): build agent again — format + per-file headers.
- DOC (step 11): agent subrun using the **coredoc skill** — docs + version +
  changelog.
- CICD/PR (step 13): agent subrun (or deterministic `gh`/`git`) — create a PR
  with summary + features/bugs + design-choices. [Open Q4: PR creation is
  arguably deterministic (gh pr create) but the SUMMARY content is agent-authored;
  split — agent drafts the body, deterministic code runs gh.]
- GATE 2 (step 14): `ask_user` (prompt = PR link + summary). Accept → deterministic
  `git merge`/`gh pr merge` to main. Reject+comments → loop back to BUILD (step 7)
  with the comments. `gating_mode="auto"` auto-approves.

**Loops (all bounded, state in run vars — coding-agent precedent):**
- plan-revision loop (gate1 reject → scout), bound `max_plan_revisions`.
- build↔lint loop, build↔test loop, gate2 reject → build, bound
  `max_build_cycles` (shared counter so the three feedback edges can't spin
  forever).

## Open design questions for the adversaries (cycle 1)

- Q1: scout parallelism — sequential subruns vs a map lane; does sequential lose
  the "mines separately" intent?
- Q2: skill activation trust — the flow needs backlog+coredoc but can't
  self-activate skills (run-level trust). Is "run must activate these skills" an
  acceptable requirement, or does the workflow need a deterministic non-skill
  path (write the backlog file / docs directly via code+templates)?
- Q3: deterministic-enough test/lint verdicts — how to loop on agent judgments
  without the model self-reporting pass (coding-agent's lesson: outer-loop
  progress must be a deterministic gate or a structured verdict, never
  self-report).
- Q4: the deterministic/agent boundary on PR + git — which sub-steps are pure
  code vs agent-authored-content-then-code.
- Q5: gate semantics — reject-to-earlier-step must carry comments into the
  target agent's prompt; auto mode must be a clean deterministic pass with no
  hidden wait; what happens on gate timeout / abandoned run.
- Q6: git safety — branch off main when the workspace has uncommitted changes;
  git init in a non-empty dir; merge conflicts at gate-2 merge; never force.
- Q7: the whole thing is LONG (7+ agent subruns + 2 human gates); does it fit
  the run/ledger model, and how does a reject-loop not re-run the expensive
  scout every time.

## Cycle-2 design (cycle-1 adversaries folded — supersedes the draft mapping)

Three fable5 adversaries (control-flow, agent/skill boundary, git/comparison)
converged: the 14-step LIST is sound; the draft's CONTROL FLOW and several step
CLASSIFICATIONS must be restructured to the coding-agent precedent before build.
The restructure is mostly a COPY of shipped machinery, not new platform work.

### Structural invariants (must hold; bounded-termination sketch)
1. **No backward exec edges.** Two `while` loops, coding-agent style: (L1) plan
   loop, (L2) build loop enclosing a fix-subflow + the format/doc/PR/gate-2 tail.
   Re-entry state is DATA in a single per-loop `loop_state` fold, never wiring
   (kills the 4-incoming-route multi-entry complexity).
2. **Single fold, single decision per loop.** One state-fold code node runs every
   cycle (all re-entry causes pass through it); one condition node alone decides
   continuation; counters bump ONLY in the fold.
3. **Split counters (human attention is the scarce resource).** `max_fix_cycles`
   (lint+test, reset on each gate-2 arrival) × `max_review_rounds` (gate-2
   rejects, never reset). Total builds ≤ (1+R)(1+F); pick R=2,F=3 (≤12), stated.
   Lint churn can never starve the human's review budget.
4. **Merge requires green, in BOTH gating modes.** The loop `done` edge feeds
   `if(all_passed)` before the tail; auto-mode gate-2 approve == the deterministic
   test verdict, never an unconditional pass-through (closes the auto-merge-of-
   failing-code FATAL, A-F1).
5. **Auto mode has zero wait-capable nodes on its path.** Both gates branched
   around deterministically; EVERY agent node carries an explicit allowlist
   EXCLUDING ask-user/comms tools; the run tool-policy auto-approves the named
   deterministic tools (`execute_command`, `gh`). Otherwise "auto" parks (A-F2).
6. **Stall guard + attempt memory** (port `NEXT_STATE_CODE`/`LOOP_CONDITION_CODE`):
   normalized failure signature; `same_signature_count >= 2` → terminal; the
   builder's own report carried cross-cycle so N+2 knows what N+1 tried.
7. **Feedback is data or it doesn't exist.** Reject comments / lint residuals /
   test fixlists are `loop_state` fields written by the fold and RENDERED by a
   per-agent prompt-composer code node (scout/planner/build each get one). The
   draft dropped the comments entirely (A-R1).
8. **Four exhaustion terminals defined**: plan-exhausted → `failed` (last plan +
   comments); fix-exhausted → coding-agent's delivered≠passed distinction; every
   terminal NAMES the branch + PR disposition (no invisible git litter).

### Step re-classification (deterministic vs agent — the operator's hard line)
- **Step 5 backlog: DETERMINISTIC, drop the skill** (B-R1). The backlog skill is a
  governance procedure (repo-shape discovery, NNNN audit, overview sync); step 5
  needs ONE templated file in a layout the flow itself defines. Planner emits
  structured fields via `resp_schema` (title ≤3 words, goal, steps[], files[],
  risks[]); a code node computes next-NNNN (`list_files` + max+1) + slug + path
  and renders the template; `write_file` places it + bumps overview counts.
- **Step 8 lint: DETERMINISTIC verdict, agent only fixes** (B-R5). `ruff/eslint/
  prettier --fix` via execute_command; a code node parses exit code + residual
  diagnostics; only residuals go back to build. An agent appears only to attempt
  fixes beyond `--fix`, and the linter re-run is still the verdict.
- **Step 9 test: MOUNT the coding-agent verifier subflow wholesale** (B-R3, C-G4):
  deterministic gates first + fail-fast, strict `feature_checks[]` schema with
  per-feature `depends_on_input` evidence, merge belt OUTSIDE the LLM, verifier-
  death fold (delivered≠failed). Its `failures[]` IS the fix-list hand-off (9→7).
- **Step 10 format: DETERMINISTIC formatter** (`black/prettier`); only the per-file
  HEADERS are agent inference. Split the node. And re-verify after step 10 (it
  mutates post-test — A-R4): re-run the test COMMAND (not the full agent) before
  the PR; a format-introduced break loops back into the fix budget.
- **Step 11 coredoc: KEEP the skill agent + a deterministic doc-completeness GATE**
  (B-R2): file set present, every `docs/*.md` linked from `docs/README.md`, every
  `llms.txt` path exists, `CHANGELOG.md` has today's version. Fail → doc agent
  with the missing-file list, bounded. (Coredoc's faithfulness judgment is real
  agent value; its mechanical tail is checkable.)
- **Step 13 PR body: agent-authored via `resp_schema` {title, summary, features[],
  bugs[], design_choices[]}`; a code node renders markdown; deterministic tool
  runs the PR.** Create-or-update by branch (a gate-2 re-run must not `gh pr
  create` twice — A-R6).

### The PR/merge DEGRADE (FATAL for the local R-Type test — C-F1, B-F1)
The test target is a from-scratch LOCAL workspace: no remote, `gh pr create/merge`
fail unconditionally. Deterministic `has_remote` branch (`git remote get-url
origin`, exit-code, no parse):
- **no remote:** "PR" = a `PR.md` artifact (agent-authored body) + gate-2 presents
  it + approve = local `git merge --no-ff <branch>` into the default branch. No
  `gh` on this path (the R-Type test rides this branch).
- **remote:** gate `gh auth status` first; success → `gh pr create/merge`;
  failure → degrade to the local path with a `#FALLBACK` warning, never a dead run.

### Mandatory git safety (C-F1/F2/F3, R7) — before any repo is touched
- **Parent-repo guard (most dangerous line):** require `git -C '<ws>' rev-parse
  --show-toplevel` == `workspace_root` EXACTLY, else "no repo here" → init. Belt:
  export `GIT_CEILING_DIRECTORIES=<parent-of-ws>` so discovery can't climb into
  the operator's framework repo and branch/merge IT.
- **Base commit:** `git init -b main` (fallback `git init`) + `git add -A && git
  -c user.name=.. -c user.email=.. commit -m baseline` (fresh env has no git
  identity — bare commit dies "who are you"). Branch off HEAD, never a named ref.
- **Explicit deterministic COMMIT nodes at cycle boundaries** (the draft had NONE
  — a zero-commit branch merges the baseline, not the game, C-F3).
- **Slug:** lowercase `[a-z0-9-]` only, collapse/trim dashes, ≤40 chars, empty →
  run-id fallback; `git check-ref-format --branch`; collision → `<slug>-<runid8>`.
  All shell composed through ONE quoting helper (coding-agent's `ws_q` single-
  quote + bad-char refusal — an agent-authored title is untrusted input).
- **Merge:** `--no-ff`; conflict → `git merge --abort` + loud file list → gate-2;
  never `--force`, never auto-resolve; refuse on a dirty tree.

### Skills resolution gate (FATAL silent-hallucination — B-F2)
`skills` becomes an `on_flow_start` input pin defaulting to `["coredoc"]` (backlog
dropped per B-R1). A deterministic precondition node reads
`_runtime.skills_resolution` (`get_var`) and asserts the required set is active;
absent → hard-fail with the labeled verdict OR set `skills_degraded` and reroute
step 11 to a deterministic skeleton. NEVER let the doc agent discover the absence
and hallucinate coredoc-shaped output.

### Scout (Q1 + bounding)
Sequential subruns (runtime has one cursor — parallelism confirmed impossible in
one run; "separately" = uncontaminated contexts, not concurrency). Both scouts
emit `resp_schema` findings[] `{source, claim, why_relevant}` (capped count) so
the deterministic merge does REAL work (source-key dedupe, per-scout quota, stable
order) instead of concat+cap. Cache the merged blob in a run var; gate-1 offers
`choices: accept / revise-plan / re-research` so re-scout is the human's explicit
choice, not a tax on every revision (A-R5, S3).

### Honest playability ceiling (B-R4, C-G5) — stated, not hidden
Step 9 certifies "runs + task-named features present AND input-dependent" (the
coding-agent ceiling, incl. its class-6 residue: liveness probes cannot certify
play quality). GATE 2 (human) is the ONLY playability oracle. The final report
says "verified: runs + features alive; playability: pending human gate" — never
"tested as a user would." Tiered success bar: T0 runs → T1 core loop alive (ship
moves/shoots/something dies) → T2 named features present+alive → T3 human-playable.

## Cycle-3 design (cycle-2 integration adversary folded — BUILD-READY)

Cycle-2 (one deep integration adversary, all static-verified against the repo)
found 2 FATALs + 7 integration gaps that appear only once the cycle-1 fixes
COMBINE. Folded here; the design is now build-ready modulo one host precondition.

### Two FATALs (fold before writing the builder)
- **F1 — `browser_probe` mount is a HOST PRECONDITION, made honest by a preflight
  node.** `browser_probe` is registered ONLY in abstractcode (`react_shell.py`),
  NOT in runtime/gateway. On the gateway host this bundle runs on, the mounted
  verifier's execute gate returns an ENVIRONMENT failure every round →
  `environment_blocked` early-stop → invariant-4 (merge-requires-green) means the
  R-Type test can NEVER merge. Honest nuance: this is a hard-block, not a fake
  pass (the merge belt overrides `executes` with the probe result). FIX: a
  deterministic PREFLIGHT node (sibling of the skills gate) probes browser_probe
  availability BEFORE L2 and fails/labels the run immediately — never after 12
  builds. The live R-Type test + the comparison verifier therefore REQUIRE a host
  that mounts browser_probe (coding-agent's own standing cross-seat limit); on a
  bare gateway, step 9 certifies only the STATIC gates (G0/G1/G4/G6) and gate-2
  (human) is the sole runtime/playability oracle — stated, not hidden.
- **F2 — the deterministic formatter (step 10) breaks the mounted G5 hash gate.**
  G5 fails on "bytes mutated after the last SELFCHECK ARTIFACT-SHA256"; a
  post-test `prettier/black` pass IS that mutation → G5 fails every format cycle,
  a constant signature → stall-terminate. FIX: after the formatter, deterministically
  REFRESH the SELFCHECK hash lines (`shasum -a 256` + a code-node rewrite of the
  `ARTIFACT-SHA256:` lines), OR define the step-10 re-verify as gates-MINUS-G5
  with the format pass attested in loop_state. (The spec's earlier "re-run the
  test command" is void for a web target — there is no test command; the
  subflow/probe IS the verification.)

### The load-bearing STRUCTURAL correction (G2/G3)
`loop_state` (a public run var) does NOT cross a subflow hop — the runtime
setdefault-inherits only workspace keys, `_runtime.skills_block`,
`_runtime.tool_policy`, `operator_email`. So a "fix-subflow" wrapping builder+verify
would read a DEFAULT loop_state → `mode` always "build" → every repair a full
rewrite (the exact R1 defect), silently. FIX: keep builder+verify **INLINE in
L2's body** and mount ONLY `coding-verify-gates` as the one subflow — which is
exactly what coding-agent does (the `coder→coding-agent→coding-verify-gates`
depth-3 tree compiles today). This also fixes G3 (the verifier-death fold reads
the IMMEDIATE child's `child_output`; an extra layer hides the death). Mounting =
fork-by-copy: 0152 embeds its OWN copy of coding-verify-gates.json, version-pinned
to coding-agent 0.2.4's gates (drift from future bumps is then deliberate). The
0152 build agent's prompt must carry the ARTIFACT-SHA256 demand (the mounted G5
requires it) or deliberately skip SELFCHECK.

### Seven integration fixes
- **G1 — doc-completeness is a THIRD loop; give it `max_doc_cycles` (1–2)** bumped
  in the fold + a fifth terminal (docs-incomplete ≠ code-failed). Unbounded today
  = infinite loop in auto mode.
- **G4 — gate-2 arrival ZEROES `same_signature_count`** (else the revived fix
  budget dies on the stale stall latch); and in GATED mode, fix-exhaustion/stall
  routes TO gate-2 (reject-with-comments = the human rebuild), not straight to
  terminal — human comments are an escalation event (coding-agent's rebuild-escape
  precedent). Human attention must be spendable exactly when the build is stuck.
- **G5 — "CHANGELOG has today's version" needs a date the sandbox forbids** (no
  imports/datetime in RestrictedPython) → one `execute_command date +%F` feeds the
  gate.
- **G6 — scout `resp_schema` non-conformance** → the merge degrades to raw
  `response` text as one finding + a `#FALLBACK` warning (never a silent empty
  context blob).
- **G7 — the slug run-id fallback has no run-id in code nodes** → derive
  uniqueness from `date +%s` via the auto-approved execute_command lane.
- **next-NNNN must recurse ALL backlog subfolders** (proposed/planned/completed/
  deprecated) or it re-mints completed numbers; "bump overview counts" APPENDS,
  never parses (fragile).
- **commit at the post-test/pre-format boundary** so an F=0 format break can
  `git checkout` back to the green bytes (no `.cg_rounds` needed here).

### Confirmed sound (cycle-2 verified, no change)
Two-while restructure; split counters (1+R)(1+F)=12; auto-mode is genuinely
park-free (`ask_user` behind an `if` never runs); `_runtime.tool_policy` HAS a
consumer (the 2026-07-06 regression is fixed) and crosses child runs; the skills
resolution gate is grounded (`_runtime.skills_resolution` written by bundle_host);
git-safety ordering (guard before remote-detect) is safe as sequenced (add
`GIT_CEILING_DIRECTORIES` to EVERY git/gh call + a checkout-existing route for
review-round re-entry). tool_policy must ride run `input_data` (set_var can't
write `_runtime.*`).

### Cycle-3 = verify the BUILT artifact (not more paper)
The cycle-2 adversary produced the 11-point verification checklist the built
workflow must pass (preflight honesty on a probe-less host; format cycle closes
green with refreshed hashes; doc loop bounded; loop_state plumb-through on
resume; verifier-death forwarded; gate-2 revival resets both counters + carries
comments; auto-mode zero parks in the ledger; git-safety in a nested workspace;
merge-requires-green under env-only failures; scout schema degradation; the
comparison rig distinguishes tiers mechanically). Cycle-3 runs these against the
real built flow (audit + gate smoke + a live drive), which IS the adversarial
third cycle — the design is now stable enough that attacking the artifact beats
attacking the paper.

## Comparison plan (after build + test — fairness fixes folded, C-G4)

Run the R-Type request through all three (this workflow, basic-agent, coder),
same provider/model (airelay/gpt-5.6-sol), each from scratch in its own
workspace. FAIRNESS (the adversary's central methodology point):
- **Head-to-head runs this workflow in `gating_mode=auto`.** A gated run gives
  this workflow human course-correction at gates 1+2 that basic-agent/coder never
  get — comments injected at a reject are literally extra intelligence in the
  loop. The auto arm is the fair comparison; a gated arm is reported SEPARATELY
  and labeled "what human-in-the-loop buys," never mixed into the head-to-head.
- **Scoring by an EXTERNAL shared verifier, not self-grade.** The feature
  checklist (mechanics/monsters/boss/weapons/effects/procedural VFX-SFX-music/
  arrow controls) is scored by ONE verifier flow applied IDENTICALLY to all three
  artifacts, using the coding-agent `feature_checks[]` evidence-chain
  (`depends_on_input`) — a feature is scored ALIVE, not merely PRESENT (a dead
  code path satisfies "a boss exists"; the evidence chain doesn't). Never let any
  workflow grade its own output. Human spot-check on verifier disagreements.
- **Tiered success bar** (T0 runs → T1 core loop → T2 features alive → T3
  human-playable); report each arm's tier. "Fully playable" as a single pass bar
  would just report "all three failed" (the base rate for this class) — measure
  the tier, not a binary. Procedural MUSIC especially needs an explicit evidence
  definition or it gets silently faked (a WebAudio blip labeled "music").
- **Cost = active compute time (ledger, wait-states subtracted) + TOKENS.** Raw
  wall-time on a shared endpoint is noise; tokens are the comparable cost.
- **N ≥ 2–3 per arm** (provider nondeterminism) or the result is labeled
  illustrative, not statistical.
- Playability (T3) requires ONE human playing all three, same person, blind
  order, fixed protocol + rubric — or the criterion is renamed to what the rig
  can measure (T2). No agent certifies play quality.

## Host fact CONFIRMED (2026-07-23, F1 live) + R-Type scoring rubric

Live probe of the running gateway (`/discovery/tools`): 50 tools —
`camera_*` (11) + `analyze_media` + `execute_command` present, **`browser_probe`
ABSENT**. So F1 holds on this host: neither the in-workflow verifier NOR the
comparison verifier can drive a real browser here. Consequences, decided:
- The workflow's step-9 preflight labels the run "runtime unverified (no
  browser_probe)"; static gates (G0/G1/G4/G6) + gate-2 human stand.
- The COMPARISON's T0/T1 (runs / core-loop-alive) is measured by a DETERMINISTIC
  headless smoke I own in the comparison harness (Node + a headless Chromium
  drive of the artifact's index.html: page loads with zero console errors,
  canvas present + paints under scripted ArrowLeft/Right/Space, non-blank
  sample) — NOT by the absent gateway probe. T2 (features present+alive) via
  static structure + the input-dependence evidence chain. T3 (playable) = one
  human, blind order. If a browser_probe-mounted host becomes available before
  the test, the in-workflow leg lights up too; the comparison harness is the
  portable fallback either way.

### R-Type objective feature checklist (the comparison's scored rubric)
Each item is scored PRESENT (in source) AND ALIVE (input→state→render evidence),
not just present — a dead code path scores 0. Applied identically to all three
arms by the external harness:
1. Arrow-key movement — ArrowLeft/Right/Up/Down move the player ship; input
   handler → position state → render read (evidence chain).
2. Fire — Space (or arrow-era fire key) spawns a projectile that travels + can
   despawn.
3. Enemies/monsters — ≥1 enemy type spawns, moves, and is destroyable.
4. Boss — a distinct higher-HP entity with a defeat condition.
5. Weapons/effects variety — ≥2 distinct weapon or power-up behaviors.
6. Procedural VFX — visual effects generated in-code (not static assets):
   explosions/particles driven by code.
7. Procedural SFX — sound synthesized in-code (WebAudio oscillator/buffer), NOT
   a bundled audio file labeled "sound".
8. Procedural music — a generated musical loop (sequenced notes / algorithmic),
   NOT a WebAudio blip; explicit evidence required (this is the item most likely
   silently faked — weight as stretch).
9. Black-and-white / gameboy-style rendering — a constrained palette (≤4 shades)
   is actually applied to the canvas.
10. Runs at all (T0) — index.html loads headless with zero console errors.
Score per arm: count of PRESENT+ALIVE / 10, plus the tier (T0/T1/T2/T3), plus
code quality/organization (files, module boundaries, header comments), docs
(coredoc completeness), and cost (active compute time + tokens). N≥2 per arm or
labeled illustrative.

## BUILT (2026-07-23) — artifact facts

`scripts/build_multiagent_coding_workflow.py` emits `multiagent-coding.json`
(74 nodes / 159 edges) + `multiagent-verify-gates.json` (32-node drift-pinned
copy of coding-verify-gates); packed as `multiagent-coding@0.0.0.flow` and
registered on the local gateway (bundles/reload confirmed the id).

Verification at build time:
- Runtime compiler: `compile_visualflow_tree` green on the 2-flow tree.
- Graph audit (`audit_flow_graph.py`): clean on both flows (no dead nodes,
  no orphan pins, no overlaps).
- `scripts/multiagent_coding_smoke.py`: 39 checks green — all 31 code bodies
  compile through the REAL RestrictedPython wrap (`_generate_code_from_body`
  + `create_code_handler`, the exact live lane), plus logic scenarios: state
  folds (split counters, stall signature with fused-digit preservation),
  gate-1/gate-2 parsing (approve/revise/reject resets), auto-mode approval
  (green ⇒ approved without gates), lint-residuals-block-green, git command
  composition (quote-hostile workspace path, GIT_CEILING_DIRECTORIES,
  toplevel guard), merge conflict-abort honesty, preflight refusals + degrade
  advisories, PR no-remote degrade, verify round_index threading.

Build-time deviations from the cycle-3 paper design (deliberate, bounded v0):
- Per-file headers (step 11) folded into the doc agent's instructions rather
  than a separate agent pass.
- Format step (10) folded into the lint node (ruff --fix + prettier -w),
  followed by a deterministic SELFCHECK hash refresh (the formatter-breaks-G5
  fold) BEFORE commit+verify.
- One doc pass per green cycle (no separate doc loop / max_doc_cycles); doc
  residuals ride PR.md advisories instead of blocking.
- gate-2 sits INSIDE the build loop behind if(green)+if(wait-mode) so
  rejection re-enters repair with zero backward exec edges; merge stays
  outside the loop (single final act after `done`).

Live driver: `scripts/multiagent_coding_run.mjs` (auto + wait modes; scripted
gate answers; evidence sweep: agents/verify-subflow/git-branch/lint/merge +
workspace git log). Cycle-3 = 3 fable5 adversaries on the BUILT artifact +
live auto-mode smoke (factorial task) are running as of this note.

## Cycle-3 executed (2026-07-23): 3 fable5 adversaries on the BUILT artifact + live proof -> 0.0.1

Live auto-mode smoke on 0.0.0 (gpt-oss-120b, factorial task): COMPLETED
end-to-end with ZERO ask_user prompts — real git history (baseline -> build
cycle -> branch merge --no-ff -> docs commit), working artifact
(`python3 solution.py` -> 120), SELFCHECK/PR.md/backlog item all written,
honest report. Live findings: the gateway REWRITES `workspace_root` to its
managed per-run workspace (drivers must read the effective workspace from the
ledger); the doc agent modified `solution.py` post-verify (confirming
integration F3); the skills advisory false-fired (confirming F2).

Three adversaries (control-flow/termination; deterministic+git safety;
integration/11-point checklist) returned FIX-FIRST with converging blockers,
ALL folded into 0.0.1 (79-check smoke green, audit clean, compile OK):

- Interface honesty: root now declares `abstractcode.coding.v1` (agent.v1 was
  the false-contract class coding-agent was already burned for); bundle
  metadata documents the auto-mode `_runtime.tool_policy` requirement.
- Skills truth source: preflight reads `get_var("_runtime.skills_resolution")`
  (the gateway-written fact) instead of a caller-attested input pin.
- Lint honesty: residuals = diagnostic-grammar lines only (path:line:col,
  `[error]`, SyntaxError class); ruff's own success summary ("Found N errors
  (N fixed, 0 remaining).") and touched-file echoes no longer red the build.
- Merge honesty: POSITIVE `MERGED_OK` sentinel required (absence-of-token
  folds reported merged over an unmerged trunk-default repo); loud
  NO_MAINLINE_BRANCH degrade; conflict abort unchanged.
- Recursive result extractor (ported from coding-agent GATE5): direct-lane
  dicts, nested approval-resume envelopes, plain strings, stderr, *_preview.
- Verifier death: `verify.child_output -> next_state.verify_meta` + a named
  synthetic failure that LATCHES the stall signature (a dead verifier burned
  the whole builder budget invisibly); builder attempt memory
  (`last_attempt_summary`) rides into repair prompts.
- G4 second half: in wait mode a stuck build (fix budget exhausted/stalled)
  ESCALATES to gate-2 (comments reset the fix budget; 'stop' ends the run;
  'approve' on red is guidance, never a merge — merge stays green-only).
- Doc containment: headers moved to the builder (verified path); documenter
  restricted to README/docs; deterministic post-doc HASH GUARD reds the
  iteration if verified source bytes drifted (F3, live-confirmed class).
- Auto-mode dead-plan guard: planner death re-plans within budget instead of
  blind-accepting `{}`.
- Scout economics: scouts run on the first pass + explicit "research" choice
  only (cached context feeds plain plan revisions).
- Honest terminals: review-rounds-exhausted (renders unaddressed change
  requests), stopped-by-reviewer, plan-not-accepted (renders last plan +
  reviewer comments), short preflight reason token, final-review warning.
- Shell hardening: space-safe SELFCHECK refresh (line loop, never awk $2
  word-split), branch-first baseline commit (user's branch never mutated),
  GIT_TERMINAL_PROMPT=0 + GIT_ASKPASS=true + timeout=120 on push/gh,
  POSIX-only constructs (no process substitution).

Deliberate deferrals (recorded, not silent): doc-completeness gate +
max_doc_cycles (doc residuals stay advisory; the hash guard covers the
breakage class), CHANGELOG date gate, backlog NNNN numbering (slug-only),
slug-collision timestamp suffix (same-name branch reuse is idempotent),
real browser_probe preflight probe (caller boolean kept — unknown-tool
call_tool park behavior unverified on this host), gh auth pre-check
(fail-fast env covers the hang class), T0-T3 tier bar in the final report
(comparison-lane concern).

A parallel implementer subagent (stalled, superseded by the direct build)
independently completed its own version and preserved it under
/tmp/ma0152-fable5/ — reviewed for ideas (its doc gate, hard-fail preflight
posture and NNNN numbering are the main deltas); the canonical artifact
remains this generator (adversary-reviewed + live-proven).

## Gateway blocker found during live testing (2026-07-23) — hung browser starves the effect executor

During the 0.0.1 live runs the gateway froze THREE times (every run stuck,
heartbeat frozen). Full diagnosis from the flow seat:

- NOT the workflow: a fresh trivial `basic-agent` "reply pong" run hung
  identically at its LLM node.
- NOT the LLM endpoint: a DIRECT `create_llm("endpoint:ovh-provider",
  "gpt-oss-120b").generate(...)` returned in 2.0s.
- NOT lock contention: single clean gateway process, no takeover/yield.
- NOT a replay-poison run: the freeze persisted with all 13 non-terminal runs
  paused at rest.
- ROOT CAUSE: gateway process had a 5-minute-old hung child
  `/bin/sh -c python3 - <<'PY' ... Path('index.html').read_text() ...` whose
  OWN child was a headless **Google Chrome** — a coding-agent R-Type run's
  browser check (`execute_command` heredoc). `python3 -` reads its script from
  stdin; the spawned Chrome never exited; the gateway's SERIALIZED effect
  executor blocked behind that one tool subprocess, starving every other run's
  effects (including plain LLM calls). Killing the hung Chrome subprocess
  immediately unblocked the executor and all runs resumed to terminal.
- The `lock_heartbeat_age_s` health metric was a RED HERRING here — it climbed
  1:1 with wall-clock while runs actually advanced once the child was killed.

Handoff to the gateway/runtime seat (NOT a flow defect): `execute_command`
must reap its whole child process TREE on timeout (a `python3 -`/heredoc that
spawns a browser leaves an orphan the 300s tool timeout doesn't kill), and/or
the effect executor must not serialize all effects behind one hung tool
subprocess. Until fixed, ANY browser-spawning tool call (browser_probe, a
build step that launches a headless browser) can wedge the whole gateway.

CONSEQUENCE FOR THIS TASK: the R-Type live *playability* test spawns exactly
this browser check (F1 host constraint, already flagged). On the current
gateway it will re-trigger the hang. So the R-Type live run + the 3-way
comparison's runtime-playability arm are BLOCKED on the gateway child-reaping
fix; the workflow's own build/verify/gate/merge logic is proven on non-browser
tasks (0.0.0 end-to-end merge; 0.0.1 factorial re-verification).

## R-Type comparison attempt (2026-07-23) — BLOCKED by gateway instability, not a workflow defect

Ran the operator's full R-Type prompt on all three arms (multiagent-coding
0.0.1 / coder / basic-agent), gpt-oss-120b, auto mode, Chrome reaper guarding.
Two passes (parallel, then clean sequential). Outcome: no clean/meaningful
comparison possible on the current gateway. Two gateway-side causes, both
already documented above:

1. HUNG-CHROME EFFECT-EXECUTOR WEDGE (recurring): browser probes (verify's
   browser_probe / builder execute_command browser checks) leave headless
   Chrome hanging; the gateway's SERIALIZED effect executor starves behind
   them. In the sequential clean run, multiagent ran genuinely (76s, 24.7k
   in-tok, 84 tool batches, real artifacts) but the NEXT two arms (coder,
   basic) started while multiagent's hung Chrome still starved the executor
   and returned EMPTY (0 tokens, empty response) before the reaper's window
   (40s) cleared it. The reaper killed 15 hung Chromes during the run.
2. browser_probe ABSENT on the gateway: the mounted verify's browser gate
   fails-closed for web-class artifacts; the verify CHILD RUN dies rather than
   returning a fail verdict, so the gated arms (multiagent, coder) burn their
   3 fix cycles in ~76s and STALL before the builder finishes the game
   (multiagent wrote index.html referencing main.js but never got to write
   main.js). The 0.0.1 verifier-death fix worked exactly as designed here:
   it NAMED the death ("verify child run died"), latched the stall guard, and
   reported an honest "stalled" terminal — no loop, no lie.

Consequence: a clean, fair 3-way R-Type comparison needs the gateway seat to
(a) reap execute_command/browser_probe child process trees on timeout (or not
serialize all effects behind one hung tool subprocess), and (b) mount
browser_probe so the gated arms' verify can actually run and complete instead
of dying. Until then the gated arms are cut short by a missing capability
(apples-to-oranges vs the ungated basic-agent).

Qualitative signal (consistent across both passes, degraded): multiagent-coding
runs the full multi-agent pipeline and produces artifacts + honest failure
reporting; coder produces a single-file coding attempt (a coherent 6KB mini
R-Type index.html in the first pass); basic-agent tends to DUMP THE GAME AS A
CHAT RESPONSE (0 tool calls, 0 files) rather than writing to the folder — the
starkest arm difference, and a real argument for the scaffolded coding
workflows over a bare agent for "build in a folder" tasks.

## Publication + agent.v1 interface fix (2026-07-23, operator: "not published, must be executable by other apps")

Root cause of invisibility: cycle-3 correctly switched the root to the honest
`abstractcode.coding.v1` interface, but that removed it from the app
agent-workflow picker (which lists agent.v1 entrypoints) and I never shipped
the companion agent.v1 wrapper the way coding-agent ships `coder`. (The picker
also omits coding-agent's own strict root for the same reason — only `coder`
shows.)

Fix -> `multiagent-coding@0.0.2` (dual-interface, coding-agent precedent):
- New `multiagent-coder` flow (agent.v1): {prompt} -> make request object
  (threads the ambient `workspace_root` the client sends via get_var; gating
  defaults to AUTO so a generic agent client never parks on a gate) -> subflow
  into the multiagent-coding root -> returns {response=report, success, meta}.
- Packed with TWO entrypoints, WALK-ROOTED FROM THE WRAPPER (the packer
  collects flows reachable from the walk root, and the wrapper references the
  coding root which references the verify copy — rooting from the coding root
  would miss the wrapper; this is exactly coding-agent's `root_flow_json=coder`
  trick). default_entrypoint stays the strict coding root.
- Manifest verified: flows=[multiagent-coder, multiagent-coding,
  multiagent-verify-gates]; entrypoints = multiagent-coding (coding.v1) +
  multiagent-coder (agent.v1). Gateway /bundles confirms both entrypoints with
  correct interfaces, published channel. UI bundledFlows.ts bumped to 0.0.2 +
  multiagent-coder added. 79-check smoke + audit + compile all green; tsc +
  bundledFlows test green.

Executability PROVEN structurally: driving `multiagent-coder` with a {prompt}
payload (like basic-agent/coder) starts the run, maps prompt->request, threads
the workspace, and launches the full multiagent-coding subflow pipeline (react
agents run + request tools; the agent.v1 response/success/meta contract is
wired end-to-end). A full clean TERMINAL smoke was blocked by the recurring
gateway run-scheduling flakiness (resume commands accepted but not processed —
manual and driver resumes both no-op'd on a ~40-min-old subrun while the runner
reported healthy; likely the run_scan_limit window with the day's large run
backlog). Environment/gateway-side, not a workflow defect.

Two DRIVER bugs found + fixed during this (harness, not workflow):
- Subworkflow-wait force-resume: the run drivers treated a `subworkflow` wait
  as an approval and resumed it, completing the parent past the subflow with
  EMPTY output (and faking "verify child died" in the build loop). Fixed:
  never resume subworkflow waits — they auto-resolve when the child completes;
  approve only the child's tool waits, which propagate up. This retroactively
  explains part of the R-Type "verify death" — partly self-inflicted by the
  driver, not only browser_probe absence.
- Tool-approve key shape: the live wait key is `tool_calls:<runid>:act` with
  details.mode=approval_required (the drivers already matched `:act`/mode).

## Terminal proof of the agent.v1 wrapper (2026-07-23 ~22:15) + one 0.0.3 refinement

`multiagent-coder` driven with a plain {prompt} payload ran END TO END
unattended (full auto-approve tool policy; one gateway bounce mid-run to clear
a stuck 40-min LLM tick - the gateway's no-effect-timeout bug, third face) and
returned the complete agent.v1 contract: response = the workflow report,
success=false (honest), meta={branch: add-factorial-script, stopped_reason}.
Pipeline evidence: scouts completed, plan auto-accepted, backlog written, git
branch created, 3 build/verify cycles, honest "stopped-open-failures" terminal.
Publication question CLOSED: picker-visible + drivable like basic-agent/coder.

0.0.3 refinement found by this run: the verify verdict separates fixable
`failures` from `environment_failures` ("missing Python executor" = the host
cannot execute build/run commands), but NEXT_STATE folds only `failures` and
the verify's environment lines landed there, burning 3 fix cycles on an
unfixable environment gap. Adopt coding-agent 0.2.2's fail-soft: fold
environment_failures as "delivered, not verifiable" (advisory + stop, no fix
cycles burned, success stays honest). Also thread build_command/run_command
defaults smarter in the wrapper (agent.v1 has no such pins; empty commands
should skip the build/execute gates rather than probe for executors).

## Publication-adversary fold -> 0.0.3 (2026-07-23)

The fable5 publication audit confirmed the 0.0.2 mechanism end-to-end with
file:line evidence (picker filter `abstractcode.agent.v1` per-entrypoint at
react_shell.py:4296-4307 + client resolution gate workflow_agent.py:863-864;
gateway echoes the packed manifest verbatim; bundledFlows.ts is editor-only)
and contributed two deltas, both adopted:
- workspace_root + gating_mode as DECLARED wrapper start pins (subset
  validation is legal; input-first pin resolution picks up abstractcode's
  session-workspace var sync at react_shell.py:12146 — better than the
  get_var approach: visible in discovery, no ambient-timing reliance).
- gating default WAIT (reversing my auto): the primary picker client answers
  WaitReason.USER interactively (react_shell.py:12644), so the two-gate
  experience is the honest default; unattended clients degrade bounded
  (capped refusals then cancel) and opt into auto via the declared pin.
Plus the 0.0.3 environment fail-soft shipped (env failures never burn fix
cycles; immediate honest exit "delivered-not-verifiable"; escalation and the
report handle the class explicitly). 85-check smoke; manifest + gateway
serving verified for 0.0.3.
