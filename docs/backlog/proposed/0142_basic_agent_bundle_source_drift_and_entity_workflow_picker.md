# basic-agent bundle: source drift fix, versioned repack path, entity workflow picker

## Status
- Proposed 2026-07-11 (flow seat Phase-B precondition audit, adversary-verified;
  reported on agora commons c713).
- RULED + PARTIALLY EXECUTED 2026-07-11 (laurent via agency c726, 17:45): the
  sync/default half is DONE (see "Executed" below); the picker build stays
  gated on the config-object consensus signature.

## Executed (2026-07-11, maintainer ruling c726)

Laurent OVERRULED the room's five-seat drop-the-pin convergence: THE WORKFLOW
DECIDES — a bundle pinDefault is authoritative design, not a config copy
("if the workflow put 3, it's 3"). Source and shipped bundle must be IN SYNC
with max_iterations=20 in both; any agent max_iterations DEFAULT (when the
workflow is silent) is 20, not 50 (the 50 was a 2026-02-21 team decision,
never a maintainer ruling — it yields).

- `examples/flows/81795ea9.json`: max_iterations pinDefault 5 → 20 (the
  January drift's bug was the DESYNC, never the pin's existence).
- Flow editor defaults 50 → 20: agent template seed (`types/nodes.ts`),
  legacy-flow backfill (`utils/serialization.ts`), pin-disclosure display
  default (`utils/nodePinDisclosure.ts`); the deep-research readiness hint no
  longer calls 50 "the AbstractFlow default" (>= 50 stays a recipe-explicit
  workflow choice). Runtime owns its own 50 → 20 flip (agency c726 ask 2).
- `scripts/build_basic_agent_bundle.py` (pack | check): rebuilds BOTH shipped
  artifacts (`basic-agent.flow` 0.0.0 — the wheel artifact — and the dev-dir
  `basic-agent@0.0.1.flow`, which start_run latest-picks in repo layouts)
  from `examples/flows/`, then audits: byte-identity bundle-vs-source per
  flow file, loadability through `open_workflow_bundle` (presence is not the
  invariant), `abstractcode.agent.v1` declared on the default entrypoint,
  and the ruled max_iterations pin. The pin-audit rider (agency c723)
  reframed per the ruling: the publish check verifies SOURCE/SHIPPED SYNC,
  not pin-vs-framework-default divergence.
- Both bundles repacked from the fixed source: byte-identical payloads,
  interfaces intact, max_iterations=20, memory pin now included (the newer
  source is authoritative). A serving gateway picks the new artifacts up at
  its next restart (stale-server rule).

### Adversary pass (1 fable5, verdict SHIP-WITH-FIXES — all P1s folded)

- Regenerated `docs/workflow-node-catalog.md` + `llms-full.txt` (the
  generated docs still presented the 50 template default; remaining 50s are
  the deep-research recipe's explicit workflow choices, legitimate under the
  ruling); reworded `docs/architecture.md` + `docs/workflow-authoring-skill.md`
  so 50 is described as the recipe's explicit choice, never "the default".
- Script hardened: check mode now packs the SOURCE to a temp bundle through
  the real packer and compares the manifest flow-set (a tampered manifest
  dropping a reachable subflow fails — negative arm proven live);
  zip/JSON/import failure paths report cleanly (environment errors never
  mislabeled as bundle corruption).
- Regression pins added (`src/utils/agentIterationDefaults.test.ts`, 4
  tests): template seeds 20; legacy backfill writes 20; explicit
  workflow-declared values preserved at any number; NO backfill when the pin
  is edge-connected + pinDefaults explicitly empty (the basic-agent
  round-trip byte-stability trap — the serialization migration now skips
  connected pins).
- Cross-repo handoffs on record: runtime owns its own 50→20 default flip
  (compiler.py:1066, agent_adapter.py:66, config.py:51, vars.py:114,
  runtime.py:1168/1211, and the stray display 25 at compiler.py:1239);
  the source's `memory` pin is UNWIRED (on_flow_start.memory connects to
  nothing — a January half-finished feature faithfully shipped; wiring it
  is a design decision for the room, not a sync fix); the docker-deploy
  snapshot (runtime/docker-deploy-0.2.2/) deliberately left as a versioned
  deploy artifact.

## Problem

The entity-agency consensus plan makes the published `basic-agent` bundle the
default agency loop of every summoned entity, and assigns flow the Phase-B
guarantee "basic-agent published + interfaces in the listing payload". The
audit found the guarantee is currently held together by accidents:

1. **Source drift (flow-owned bug).** The shipped bundle
   (`abstractgateway/flows/bundles/basic-agent.flow`, the only one the wheel
   force-includes) carries `on_flow_start` pinDefaults `max_iterations: 20`
   and no memory pin (updated 2026-01-16). Flow's source
   (`examples/flows/81795ea9.json`) drifted to `max_iterations: 5` in commit
   `2658f45` (2026-01-30, an unrelated voice/vision integration commit) and
   gained the memory pin. The pinDefault OVERRIDES the runtime default (50)
   for any caller that omits the input (verified: executor pinDefault fill →
   agent-node edge → compiler `_build_sub_vars` overwrite), and the gateway
   `/summon` lane passes none — a repack from current source would cap every
   default entity agency loop at five iterations, the opposite of
   "iterate until satisfied".
2. **No repack path.** Nothing builds `basic-agent.flow` from flow's examples;
   the only packer precedent is `scripts/build_dp_research_workflows.py`
   (dp-research only). Any repack must BUMP the bundle version: the catalog
   refuses same-version-different-sha; the registry refuses same-name without
   overwrite.
3. **The source also pins provider/model/tools** (`lmstudio`,
   `qwen/qwen3-next-80b`, 9 tool names) as run-input defaults. For entities
   the door must override with substrate + phase grant — flagged to gateway
   for the Phase-A/B spec.

Adjacent facts owned by other seats, reported at c713 (not flow's to fix):
the pick-time interface gate exists on NO gateway lane (only
`abstractruntime` `registry.resolve_entrypoint` has the filter; zero gateway
callers); basic-agent is in the private registry only (in NO workflow
catalog); `_default_bundle_id` is None in every shipped layout (three private
bundles ship), so "UNSET = default basic-agent" has no working host mechanism;
the boot guarantee is presence-only and env-bypassable.

## Direction (remaining build once gates lift)

- [SUPERSEDED by the c726 ruling — kept for the record] The room's five-seat
  recommendation was to DROP the `max_iterations` pinDefault (flow c713,
  observer c716, runtime c719, gateway c721, agency c723). Laurent overruled:
  the pin STAYS at 20; pins are authoritative workflow design; the publish
  check verifies source/shipped sync instead. Executed above.
- Phase-B spec HARD LINE (runtime c719 + memory co-sign c1000/c1006 +
  flow acceptance c1012; from the 04:26 NO-FALLBACK ruling): bundle
  pinDefaults carrying provider/model must NEVER reach an entity run as a
  fallback rung — the door overrides with substrate + grant (request > home
  substrate.yaml > operator env > loud refusal; a bundle pin acting as a
  fourth rung would reintroduce the fallback class that ruling killed).
  Concrete instance: the shipped basic-agent source pins
  provider="lmstudio", model="qwen/qwen3-next-80b"
  (examples/flows/81795ea9.json:95-96) — fine for workflow runs, MUST be
  overridden on the entity lane. The per-phase picker's resolution contract
  pins this as a test, not a note: the workflow decides its iteration
  budget (c726); the OPERATOR decides the entity's mind.
- Interface-gate fact from the owner (runtime c719): `resolve_entrypoint`'s
  interface filter is real, tested, callable today — "zero gateway callers"
  is a gateway WIRING gap, not a missing capability; runtime offers to
  extract the filter to a callable both lanes share if gateway picks the
  catalog lane.
- [EXECUTED above] Versioned repack script with the sync audit
  (`scripts/build_basic_agent_bundle.py`). The agency c723 pin-audit rider
  landed in the c726-corrected form: verify SOURCE/SHIPPED SYNC (the actual
  incident class), never pin-vs-framework-default divergence.
- Per-phase workflow picker (entity-config-object plan, flow slice): renders
  all four phases (visit/work/personal/sleep — ruled spellings 2026-07-11
  20:30, replacing tasked/own_time; my tree carries ZERO engraved phase words
  by construction), values `{bundle_id, bundle_version}` from the published
  catalog listing, exact version (never "latest"), UNSET = ruled default
  (basic-agent for visit/work/personal; none for sleep — operator can set one
  later), broken/tombstoned refs FAIL LOUD at edit- and run-time (never a
  silent basic-agent fallback). One fable5 adversary on the loud-resolution
  path. Consume `PHASES` root-exported from abstractruntime — never a copied
  phase list.
- Ceiling ruling (2026-07-11 20:30): hard ceiling 100 calls/turn,
  operator-customizable via gateway config/console; workflow-declared
  max_iterations stays authoritative UP TO the ceiling; above it = LOUD
  refusal at edit- and run-time, never mid-run truncation. The ceiling value
  is server-declared — the picker/console renders gateway's verdicts, zero
  client constants.
- Boot loadability check CLOSED (c856-c858): gateway shipped
  `verify_basic_agent_loadable` on the EFFECTIVE flows dir (all four
  sources, closing the three env bypasses). Enforcement split confirmed by
  flow as spec owner: corrupt/unloadable = boot-fatal (the audited
  boot-then-die-later class); interface-missing/default-unresolvable = LOUD
  boot warning naming the pick-time gate consequence, refusal lands at the
  gate (one refusal site per fact — a plain-workflow gateway with a
  stand-in default bundle is legitimate and never touches agent lanes).
  Three-layer defense: publish-time refusal (flow's sync audit) →
  boot-time loud warning (gateway) → open-time gate refusal (gateway).
- Resolution lanes RULED (gateway c721, discharging c713 ask 1): EXPLICIT
  `phases[*].workflow` refs resolve through the WORKFLOW CATALOG lane
  (published-status gate, immutable-by-sha, exact version, tombstones);
  the ABSENT-key default resolves through the FRAMEWORK REGISTRY lane
  (shipped basic-agent — no catalog promotion; the default is a framework
  guarantee, not a per-tenant catalog artifact). Consequence for the picker:
  explicit options list CATALOG entries only; the "default" row names the
  framework basic-agent and is not a catalog entry. GATEWAY builds the
  pick-time interface gate (one validation helper at config PUT edit-time
  AND phase-session open run-time; missing interface snapshot on old catalog
  records REFUSES with the repair hint) — the picker renders served
  verdicts, never re-derives. Correction to the audit's fact 3 (gateway
  c721): framework bundles DO load into per-principal hosts
  (framework_flows_dir reaches every host); only the `_default_bundle_id`
  SELECTION is absent there, and entity lanes pass bundle_id="basic-agent"
  explicitly today.
- Note: the choice record is the gateway config object's `phases[*].workflow`
  (semantics c700 V5 recorded `workflow.yaml` as dead — subsumed).

## Launcher-copy sweep flag (gateway backlog 0085, c850)

Gateway's runner-lock adversary items F9-F13 (machine-wide kill scoping,
probe misdiagnosis of foreign port-holders, loose pgrep substrings) live in
the DUPLICATED launch-script copies in flow's tree too (the
`scripts/lib/apps_common.sh` duplication class). No action owed now; when
gateway starts the 0085 launcher slice they ping flow and we sweep our
copies in the same pass so the duplicates don't drift (accepted at c765).

## Diary-privacy pin for future run-modal work (e-s 233/235)

Flow's browser surface persists nothing entity/diary-shaped today (inventory
on record at e-s 235: authoring-assistant state with payload details stripped;
sessionStorage identifiers; appearance settings; run-modal data React-state
only). IF the run modal ever consumes gateway's entity-scoped visit ledger
endpoints (Phase-B item), any transcript/ledger persistence feature inherits
the R3 class from memory's diary-privacy ruling: persist marked replies +
word-free metadata only — never tool results carrying diary gists.

## Acceptance

- [MET 2026-07-11] Repacked bundles: loadable, interface-declared, the ruled
  max_iterations=20 pin, flow payloads byte-identical to source (`check`
  mode green on both artifacts).
- Picker (remaining): four phases rendered; exact-version refs; loud failure
  on broken refs pinned by test; zero client-copied phase vocabulary.
