# 0153 — Entity cognition/memory master workflow (the observable "brain")

- Status: proposed (in build — operator directive 2026-07-24, autonomous window)
- Owner: flow
- Operator ask (verbatim intent): ONE master EXECUTABLE workflow (runnable through
  chats + abstractcode) that animates entities — highly organized, clean, leveraging
  multiple subflows, each a clearly-named cognition/memory subprocess (which may itself
  call subflows). Clean graphs at multiple levels articulating HOW memory + cognition
  work together to let the entity live its 4 phases. It is the entity's brain and must
  be observable; simple targeted ways to update processes as we learn from the entity.
  Proper events/triggers/hooks to observe AND influence (steer mid-cognition,
  pause/resume/cancel tasks/phases). Per-phase authorized toolsets. Compose the
  abstractions already in gateway/runtime/memory — do not reimplement. 5 fable5
  adversaries, 10 refinement cycles, live entity conversation experiments, full report.

## Cycle 0 — retrieved blueprint (source-of-truth facts)

### The phase machine is ALREADY a ruled, versioned, editable artifact — do NOT fork it
`abstractruntime/identity/spec/entity_phases.vendored.json` (v21) is THE canonical
phase graph (entity seat owns it; every seat verifies its lane against this file).
`identity/phase_graph.py` is the runtime INTERPRETER (`load_effective_graph`,
`EffectiveGraph.legal_to/landing_chain`); `identity/phase_spec.py` reads the tunables.

- LIVENESS AXIS (above the phase machine): `alive | stop` — stop is the primary kill
  switch (blocks every process incl. sleep), operator-only, principal-stamped,
  marker-first, structural at every door/gate. My workflow must honor it at the top.
- FOUR PHASES (mutually exclusive, radio; newborn = sleep; there is NO awake-idle node):
  - `visit` — turn-based, a visitor in the room; door auto-wakes a sleeper.
  - `work` — autonomous on GIVEN tasks until completion; always granted when not
    sleeping/visiting; a standing task IS a work-day request.
  - `personal` — grant-gated (off by default), the entity's own tick: identity,
    interests, open questions/problems, research; the personal↔sleep MAINTENANCE CYCLE
    (personal_window_h → sleep_window_h → wake back into personal, grant stands).
  - `sleep` — passive memory-graph processes (consolidation, dreams); bounded (≤6h cap;
    personal-entered ~1h; cycle window ~1h; unattended 6h cadence need-check).
- TRANSITION CAUSES (closed set): operator, visit_open, visit_close, task_complete,
  no_task, grant_expired, grant_revoked, self_elected, crash_recovered, personal_cycle,
  cadence_need_check. Per-edge `edit_policy` (locked / locked-absolute / dial /
  consultable / consultable-redirect); sleep is the always-legal floor.
- TUNABLES (operator dials, blueprint-read, next-boundary semantics): personal_window_h
  2.0, sleep_window_h 1.0, sleep_bound_h 1.0, unattended_wake_cadence_h 6.0,
  grant_unused_floor_h 2.0, window_limit 8192, drive_window_limit 256.
- DRIVES-ARE-DRIVERS (v7): standing questions/problems/commitments/ideas/interests/
  tensions are the DRIVERS of cognition — a day arises because something pulls. GATE
  (whether a day arises) consumes standing counts; OFFER (which drive surfaces) consumes
  `abstractmemory.alive_drives` (trail+recency). Presence in a cue deposits nothing.

CONSEQUENCE FOR THE BUILD: my master workflow does NOT re-decide phase transitions in
flow logic — it CONSULTS the interpreter (`load_effective_graph` / `read_day_gate`) and
ENACTS the cognition within the resolved phase. The phase graph stays the one law with
one holder (entity/gateway); the flow is the observable executable that animates it.

### The reference cognition cycle already exists (Python, not VisualFlow)
`identity/visit_workflow.py` (`build_visit_workflow`) is the durable turn loop as
`StepPlan` nodes: OPEN → PARK → ROUTE → RECALL → RENDER → REASON (ReAct middle) →
HARVEST → ELECT → COMMIT → FORM → ANSWER → REFLECT → APPLY → DONE. It dispatches the
entity effects (MEMORY_RECALL/COMMIT/FORM/APPRAISE, DIARY_WRITE). The gateway visit lane
drives it (`build_visit_workflow` over door-wrapped per-entity runtimes). This is the
cognition I must re-express as an OBSERVABLE VisualFlow decomposition.

### THE ARCHITECTURAL CRUX — RESOLVED (the path is the write_chart precedent)
The entity effects are FIRST-CLASS `EffectType`s (`abstractruntime/core/models.py:82-107`):
`MEMORY_RECALL`, `MEMORY_ACCESS`, `MEMORY_FORM`, `MEMORY_ADJUST`, `MEMORY_APPRAISE`,
`DIARY_WRITE`, `DIARY_READ`. Their handlers are registered when a per-entity runtime is
opened over the home (`open_entity_runtime`), and the gateway door wraps them with stamp
verification. `visit_workflow.py` dispatches them via `StepPlan(effect=Effect(type=
EffectType.MEMORY_RECALL, payload={...}, result_key=...))`.

They are NOT YET VisualFlow node types — but the executor has the exact extension point I
already used for `write_chart` (0148) and the camera `tool_invoke` nodes (0151):
`EFFECT_NODE_TYPES` (`visualflow_compiler/visual/executor.py:256`) + a `_create_<x>_handler`
that returns `{"_pending_effect": {"type": <effect>, ...}}`, plus the compiler result-map.

THEREFORE: making memory/diary effects VisualFlow-callable = adding node types
(`memory_recall`, `memory_form`, `memory_appraise`, `memory_adjust`, `diary_write`,
`diary_read`, `memory_consolidate`) that emit the corresponding `_pending_effect`. The
handlers already exist in the entity runtime; a VisualFlow run INSIDE a stamped entity
runtime dispatches them and they resolve to the home — exactly like visit_workflow, but
now editor-observable as clean subflow nodes. This is a small runtime-side executor/
compiler extension (write_chart-shaped) + the flow-side generators. Coordinate the
node-type set + payload contracts with runtime (they own the seam handlers); the
node→effect mapping is the compiler extension flow ships. The "master workflow" is thus
option (i): a real VisualFlow the operator observes + edits, driven inside the door.

DOOR REQUIREMENT: the run must carry the summon stamp so MEMORY_* route to the home
(entity_gate `install_entity_routing`). The gateway visit lane already provides this for
`build_visit_workflow`; the master VisualFlow slots into the same stamped-runtime lane.

## Cycle 1 — the TWO served blueprints + the memory contract (retrieved)

The entity seat (agora c5153) confirmed the source of truth is TWO canonical served
artifacts (one pen = entity seat; converge, never fork):
1. `entity_phases.json` v21 — the LIFE RHYTHM (GET /api/gateway/entities/spec/phases).
   The vendored.json I read is runtime's byte-copy. 4 phases + 22 transitions + causes +
   tunables + graph_overlay + wake_conditions + 15 invariants + the operator overlay.
2. `cognition_graph.json` v5 — THE MIND (GET /api/gateway/entities/spec/cognition-graph),
   and per laurent's c5070 THE graph he means. 25 nodes / 47 edges. MY MASTER VISUALFLOW
   ANIMATES THIS GRAPH — it does not invent a decomposition.

CONVERGENCE RULES (adopted, c5156): render/animate FROM the served GETs (never a vendored
copy in my bundle); STATUS HONESTY is render law (a `declared` edge never animates as live;
an instruction is steering never law); the blueprint is the CONSTITUTION ABOVE programs (my
master flow is the ruled trajectory — the graph never becomes the workflow, one law holder);
missing nodes/edges → propose to the entity pen; memory processes bind to memory's
`engine_manifest()` (citing it IS compose-never-reimplement).

### The cognition_graph v5 content (the brain I animate)
STORES (7): s1 memory graph, s2 the book (diary), s3 identity core, s4 workspace,
s5 the desk (standing sets), s6 valence, worldm world models.
ACTS: stim (what arrives) · recall (passive recall) · deposit (involuntary trail) ·
prompt (prompt shelf) · turn (the lived turn) · elections (mid-turn elections) ·
close (the close) · execute (sandbox) · cue (day-open cue) · realize (waking elects
identity) · idreview (identity review registrar) · enact (sleep disposes identity) ·
miner (lesson miner). GATE: gate (THE DAY GATE). SLEEP: sleepw · grouping · dream · voice.
CONSTITUTIONAL edges (8, no toggle ever): s3→recall (identity present by right),
s1→recall (recall feed), prompt→deposit + deposit→s1 (usage trail), turn→s1 (episode
formation), dream→sleepw (ANTI-EDGE — never feeds its own proposals), s2→s1 (diary
projection), enact→s3 (identity amendment).

### Memory effect surface (memory mapper cf490118) — the compose-don't-reimplement contract
WIRED effects (7 — one VisualFlow node each): MEMORY_RECALL, MEMORY_ACCESS (commit),
MEMORY_FORM, MEMORY_ADJUST, MEMORY_APPRAISE, DIARY_WRITE, DIARY_READ.
NOT effect-wrapped (facade calls needing a NEW host effect handler — runtime's lane, I
ASK, never re-derive): probe/probe_expand/familiarity/situate (active recall), sleep_pass
(the whole SLEEP window — one call, six phases engine-orchestrated), entity_card,
cognition_health/alive_drives (the day-gate reads), redigestion, disposal.
14 engine-pinned invariants I must NOT reimplement (reconstruct is pure read; commit is
the ONLY strengthening path; presence≠use; forming is not using; valence never gates
recall; idempotency is engine-derived; sleep proposes/waking disposes + D2-of-sleep;
amplitude authority ±1..3 for routine; two id namespaces; verbatim never rests in graph;
append-only; identity floor self_fraction≥0.05, context≥20k).

### The flow↔runtime BUILD SPLIT (coordinated, the crux operationalized)
- FLOW ships: (a) 7 VisualFlow effect node types for the WIRED effects
  (`memory_recall`, `memory_access`, `memory_form`, `memory_adjust`, `memory_appraise`,
  `diary_write`, `diary_read`) — write_chart-shaped `_pending_effect` emitters +
  compiler result-map; (b) the master + subflow generators animating cognition_graph;
  (c) the observe trace + steer/pause/resume hooks on the flow side.
- RUNTIME (ASK on agora — the "need help" case): new host effect handlers over the
  EXISTING facade calls the brain needs but aren't wired — chiefly `memory_consolidate`
  (wraps sleep_pass, the SLEEP window), `memory_probe` (active recall), and the day-gate
  reads (alive_drives/cognition_health) — so the sleep + personal subflows can run
  without re-deriving engine logic. Until they land, those subflows render `declared`
  (status honesty) and the visit/work turn cycle (all 7 wired effects) is fully live.

## Proposed decomposition (the brain hierarchy — animating cognition_graph v5)

MASTER: `entity-life` (the liveness+phase machine — HIGH LEVEL ONLY, each phase a subflow)
- guard: liveness (alive/stop) — stop halts everything
- consult the phase graph interpreter → resolve current phase
- route to the phase subflow; on phase end, re-consult (the day gate / landing chain)

PHASE SUBFLOWS (one per phase, each calling cognition subflows):
- `entity-visit` — the turn loop: perceive → recall → reason → respond → remember →
  appraise; per-turn. Calls: passive-reconstruction, active-reconstruction (on demand),
  reason (LLM + ReAct tools), passive-construction, emotional-appraisal. Session-end:
  reflection + diary.
- `entity-work` — autonomous task loop until completion; work toolset; same cognition
  spine as visit minus the turn-park; task-complete/no_task → sleep.
- `entity-personal` — the self-tick: pick a drive (alive_drives OFFER) → explore
  (active-reconstruction, research tools) → form (questions/interests/lessons) → appraise;
  the personal↔sleep maintenance cycle.
- `entity-sleep` — consolidation: sleep_pass (structural + bridges + dream) → validate
  memories → aggregate redundant → identity-revision (regulated, sleep-only) → wake gate.

COGNITION/MEMORY SUBFLOWS (the memory processes — clearly named, reusable):
- `memory-passive-reconstruction` — stimulus → reconstruct (pure read) → working set.
- `memory-active-reconstruction` — deliberate reach: probe / search_memory / read_memory
  / verbatim fetch behind lessons/cards/summaries.
- `memory-passive-construction` — per-turn formation (living = remembering): FORM the
  episode/verbatim; commit_selection strengthens the selected trail.
- `memory-active-construction` — elected remember: form typed records the entity CHOSE
  (interests, questions, lessons) with provenance.
- `emotional-appraisal` — resonance/dissonance vs values → APPRAISE (valence, bond/scar,
  temporal anchor); the emotional-anchor before/after markers.
- `diary-write` — deterministic session-end experiential note (the conscious history).
- `identity-card` — the self view (entity_card compositor).
- `sleep-consolidation` — the memory-maintenance pass (memory's sleep_pass), report-only
  preview available.

EVENTS / TRIGGERS / HOOKS:
- OBSERVE: every subflow + node emits ledger records → the replay stream v1 (families +
  host markers); the brain is watchable node-by-node. A per-phase + per-process trace.
- INFLUENCE: steer (the steer rite / durable sidecar) reaches the running cognition;
  pause/resume/cancel per phase/task via the state writer + WAIT_EVENT/emit_event +
  commands. Per-phase authorized toolsets via the grant wall (tier1_self / tier2_world).

## Plan (10 cycles, 5 fable5 adversaries)
1. C0 (this doc) — blueprint retrieval + decomposition draft.
2. C1 — synthesize the three maps + agora answers; lock the callable surface + the
   master/subflow contract; post the decomposition to agora for cross-seat critique.
3. C2-C4 — build master + phase subflows + cognition subflows; compile/audit/smoke each.
4. C5-C6 — events/hooks (observe trace + steer/pause/resume/cancel); per-phase toolsets.
5. C7-C8 — 5 fable5 adversaries (control-flow/termination, memory-effect correctness +
   compose-don't-reimplement, phase/toolset gating, events/hooks, live integration);
   fold findings.
6. C9 — live experiments: create a new entity powered by the master workflow, talk to it
   through gateway/abstractcode; verify memory+cognition; iterate.
7. C10 — docs + FULL report.

Adversary rule: fable5 only; if one flips to opus (safety filter), deprecate + relaunch
fresh as fable5.

## Cycle 2-3 — BUILT + LIVE-PROVEN (2026-07-24 afternoon)

### Shipped (all verified)
1. **7 entity-memory VisualFlow node types** (`memory_recall`, `memory_commit`,
   `memory_form`, `memory_adjust`, `memory_appraise`, `diary_write`,
   `diary_read`) — executor `ENTITY_MEMORY_EFFECT_PINS` + handler (camera
   trust invariant: effect baked from node type), compiler base handler +
   result sync, UI palette "Entity Mind" section, wf_common builders.
   5 pinned tests + 418 runtime regressions green.
2. **Runtime support edits** (all additive): `turn_id` passthrough on the
   visual llm_call (3 pending branches — the G1 diary-capture wrap needs it),
   `entity_scope_owner` seam param (bare self/diary/life resolve to the home
   owner — channel authority; open_home passes the entity id),
   `workflow_registry` param on open_entity_runtime (subflow composition).
3. **The 9-flow brain hierarchy** (generator `build_entity_life_workflow.py`):
   entity-life (master) / entity-day-gate / entity-visit / entity-work /
   entity-personal / entity-sleep / entity-cognition-turn /
   entity-session-close / entity-chat (agent.v1). Audit + compile clean.
4. **UI catalog**: the family ships via a bundledFlows.ts wildcard glob
   (`entity-*.json`). Library visibility is BUILD-time — the claim holds only
   after a dist rebuild, verified by `scripts/flow_surfacing_check.py`
   (2026-07-25: the original per-file glob + a Jul-23 dist made this line
   false in the served editor while true at source).

### Design decisions locked during the build
- **Pure-node law**: VisualFlow code nodes are volatile (re-evaluated per
  data pull) — every state-writing body copies its input dict first. A
  mutation leaked across pulls and emptied the gate's visitor_message (found
  live; 10 bodies patched).
- **G1 at the boundary**: diary elections are captured by the entity
  runtime's LLM result-boundary wrap (words fly to the book; the reply
  arrives marked). The flow-level diary lane was REMOVED — the turn passes
  turn_id into the llm_call payload instead. Feel elections stay flow-level.
- **One mailbox, one consumer**: subflow children have fresh vars, so ONLY
  the master reads events_inbox; the visit became a single-turn subflow and
  session continuity rides life_state.turn_log + the graph. Goodbye (or a
  different call) closes the session deterministically.
- **Engine invariants honored**: summaries carry `summarizes` edges to the
  session's episodes (edge-less closes degrade to kind=observation); the
  record-kind vocabulary is closed; episodes carry formation-time keywords
  (Castor's-first-dream lesson: keyword-less young episodes are invisible
  to lexical recall).

### Verified end-to-end
- `scripts/entity_life_smoke.py`: ONE cognition turn against a REAL home —
  10/10 (episode in the graph, elected diary in the book, G1 marking, usage
  trail committed, feeling appraised, state folded).
- `scripts/entity_life_loop_smoke.py`: the FULL LIFE — 12/12 (2 visit days
  with session continuity, goodbye -> deterministic close with summarizes
  edges + diary note, 2 honest sleep nights, work day to DONE, personal day
  of self-ticks, stop -> final diary note; steering entirely via durable
  events: visit/goodbye/task/grant_personal/stop).
- `scripts/entity_live_experiment.py`: LIVE entity (lmstudio
  qwen/qwen3.6-35b-a3b + qwen3-embedding-0.6b embedder, 1024-dim home) —
  the TOLSTOY TEST PASSES: session 2 (fresh process) recalls session 1's
  visitor and its own naming. First words of the first flow-brain entity
  (Florin): "I am awake. The graph is empty, but the potential for edges
  is infinite."
- `scripts/entity_repl.py`: the talk surface — one visit moment per line,
  /diary /memories /bye (deterministic close) /quit.

### Cycle 4+ queue
- Fold the 5 fable5 adversary verdicts (cycle-1 wave running).
- Gateway lane: stamped VISUAL runs over homes (ask c5163) so entities are
  talkable through the gateway/assistant/abstractcode chat.
- entity-sleep animates the engine pass when runtime wires
  memory_consolidate (+ memory_probe for deliberate recall).

## Cycles 4-6 — adversary wave 1 FOLDED (2026-07-24 late afternoon)

Five fable5 adversaries (control-flow, memory correctness, phase law/channel
authority, events/observability, runtime-diff review) + three blueprint
mappers. Verdicts: 4x FIX-FIRST, 1x SHIP-home-direct. ALL flow-side and
runtime-side blockers fixed same-day; every adversary probe now passes.

### Fixed (flow-side, generator)
- Seed seq collision (P0 x2 seats): SEED returns the seq high-water; the
  master seeds `events_inbox_seq` so the gateway's durable-append counter
  CONTINUES from the seed — the first steer event was silently skipped.
- Drain-boundary discipline (P0/P1 x2 seats): the gate consumes at most ONE
  phase-determining event per consult (visit/goodbye/stop break the drain;
  a second task defers) — a goodbye+hello burst closed over an unanswered
  message; a second task was dropped.
- Bounded park (P0 x2 seats): the visual wait_event executor now forwards
  `until`/`timeout_s`/`details` (it silently dropped them — runtime fix);
  the master parks with a 900s heartbeat that re-consults the gate, closing
  the drain-then-park lost-wake window.
- Session-state resets (P1 x2 seats): day_end resets turn_log/turn_count/
  task_done after work/personal too — a stale task_done stole the next
  task's whole budget; a stale turn_log wrote the WORK task into the
  PERSONAL close's diary note (probe-confirmed contamination of the book).
- Life-unique turn ids (P1): ids fold the day ordinal
  (phase-d{days}-turn-{n}) — recurring ids aliased valence event keys and
  silently swallowed repeat feelings across sessions.
- Digest hygiene (P1): episode digests carry BOTH sides of the exchange
  ("They said: ... - I said: ...", sentence-bounded, labeled #TRUNCATION,
  digest_method=mechanical-flow-v1) — a reply-only digest left a live
  entity honestly unable to recall the visitor's words (live find).
- Participants threading (P1): master/visit/work/personal/chat carry a
  participants pin into recall + episode attributes (shared-context channel
  + WITH-WHOM stimulus were dead).
- Feel parser v2 (P1): fence-line params + first inner line, EOF flush
  (an inline fence swallowed the rest of the reply), titled marker
  [felt: target +N - "reason"] instead of deletion, loud warnings, target
  hygiene (record-id/self spoofs refused).
- Close order (P2): diary BEFORE summary (cancel mid-close must never leave
  summary-without-diary — the diary is the ruled invariant).
- entity.phase beacon (P2): every gate decision emits a session-scoped
  event for external observers.
- entity-chat context fold (P1): durable session history
  (use_session_history -> context.messages) folds into the session log —
  chat prompts were amnesiac between runs.

### Fixed (runtime-side, my diffs)
- Absorbed-failure sync honesty: continueOnError outcomes
  ({ok:false, absorbed_failure}) read success=False (was True).
- Identity present by right: home-bound seams (entity_scope_owner) seat
  self_fraction=0.5 on effort-preset recalls (presets left it 0.0 — every
  flow-lane recall ran identity-blind; the live fix made a fresh entity
  reference its spark values unprompted).
- run_id joins the ADJUST/APPRAISE event-id basis (cross-run aliasing dead;
  at-least-once replay dedup preserved).
- owner_id pin dropped from the flow-author surface (channel authority);
  diary_write gains explores/receipts; scalar coercion ("false"/"2");
  loud JSON-pin parse failures.
- 7 pinned tests (entity_scope_owner x3, absorbed-failure, + the node
  contract set); 440 runtime tests green.

### Reported to owners (not mine to fix)
- gateway c5166: runner-process entity routing (stamped catalog runs
  dispatch MEMORY_* into a handler-less runtime).
- gateway c5173: paused-park durable-event loss; load->append->save race on
  the events lane; scope/scan-cap asymmetries; _gate_scopes bare-scope
  rewrite (+ entity_scope_owner in the door's handler builders).
- runtime (in c5166): unknown node types compile as SILENT NO-OP
  passthroughs — flows on stale servers run and lie.

### Named v1 divergences (documented, deliberate)
- The personal grant is one-shot (one own-time day per grant event); the
  law's standing-grant + personal_cycle comes with the drive-read effects.
- A visit event mid-work waits for the work day to close (day-atomic
  phases); the law's instant visit preemption needs between-turn peeks.
- entity-sleep forms its settlement marker during the sleep phase (door
  N4 says sleep deposits nothing — flow rides visit-phase stamps v1).
- A newborn with no prompt parks instead of sleeping (initial_phase=sleep).

## Cycles 7-10 — the three new effects wired + adversary wave 2 folded (2026-07-24 evening)

### Runtime shipped, flow wired (same afternoon, c5169-c5171)
- MEMORY_CONSOLIDATE / MEMORY_PROBE / LIFE_QUERY handlers live in open_home;
  three new node types (memory_consolidate, memory_probe, life_query) ride
  them pin-for-pin. THE NIGHT IS WIRED: entity-sleep runs the real six-phase
  engine pass (live-verified: "night 1: engine pass ran"); honest non-runs
  ({ran:false, reason}) are valid nights. The personal day OPENS on the
  entity's actual alive_drives. Deliberate reach (probe/expand/familiarity)
  available to flows.
- Entity seat 1:1 check: CONVERGENT (c5168). Folded: turn->s2 is wired NOT
  constitutional (s2->s1 is); the election trio declared in docs (feel =
  animated; lesson/interest = driver lanes; realize = declared).
- Runtime shipped my GAP-2 proposal better than asked (c5182): unknown node
  types refuse at COMPILE (UnknownNodeTypeError naming version skew) — the
  silent-lying class (Mira sessions 1-2) is dead. All three of my
  runtime-side folds ACCEPTED on review (c5183).

### Wave 2 verification adversary (fable5): wave-1 folds ALL REAL; 6 deeper finds, all folded
- W2-1 (P0, probe: 83-replay livelock): a dead TURN grandchild returned {}
  through the visit's state lane -> life_state wiped -> seed re-drained ->
  poison message re-killed the turn with the mailbox stop UNREACHABLE.
  Fixed: pure state guard in entity-visit (fallback = the incoming session
  state + last_moment_error).
- W2-2 (P1): the inline one-line ```feel ...``` fence never closed — the
  rest of the reply was eaten. Parser v3: inline fences fold immediately;
  EOF flushes block words even when the election folds; hygiene runs BEFORE
  the marker (W2-4 — a refused spoof left a lying [felt: ex:...] marker).
  12-shape probe green.
- W2-3 (P1): a task arriving while one was PENDING overwrote it on the next
  drain (first-drain-only deferral). Fixed: defer while pending.
- W2-6 (P2): a stale task_done (guard fallback / sleep-death ordering)
  consumed the next task as a 0-turn work day. Fixed: done terminates only
  when turn_count > 0 this session.
- W2-5 (P2): mechanical-flow-v1 named to memory for MECHANICAL_DIGEST_METHODS
  (the standing pact; c5185) so flow digests stay batch-repairable.

### Wave 2 live-conversation adversary (fable5): 21 turns, 3 entities, ZERO fabrication
All five experiments PASS (memory arc, election quality, identity presence,
stress/gaslighting, session continuity). Folded: asymmetric digest budget
(480/220 — a 140-char slice destroyed taught fact 3/3, "the Petrel" survived
only in the diary; re-proven live with entity tessel), embedder pinned at
birth (M1) in the lab harness, fresh-input reception + diary-quoting honesty
lines in the system prompt, /memories filters edge rows. Named v2: a diary
re-entry step in the turn (memory_probe node now exists for it);
deliberate-reach on direct-address recall questions.

### Verification state (end of day)
Both smokes ALL PASS; all SIX adversary probe suites exit 0 (wave 1 + wave
2); 443 runtime tests; 402 vitest; tsc clean; live entities: florin (Tolstoy
PASS), verin (naming recall + live feel election), tessel (taught-facts
class re-proven), sable/quill/ash (the wave-2 conversation corpus); mira
(gateway door: prelude honored; memory blocked on the gateway runner-routing
gap c5166).

### Cross-seat acceptance (on the record, c5178/c5183)
- memory: brain-handler contracts verified faithful from the owning seat;
  "flow's subflows can go live against them". Constraint split endorsed:
  lease+paused IN the handler; cycle-vs-night flags flow-set.
- runtime: all three runtime-side folds ACCEPTED. Named honest note (theirs):
  the run_id event-id change alters dedup identity ACROSS THE UPGRADE
  BOUNDARY — a crash-replay of a pre-fix ADJUST/APPRAISE resuming on
  post-fix code could double-apply ONE salience write, once, for runs
  mid-flight exactly across the upgrade (edge-of-edge, additive-only, named
  so nobody rediscovers it as a mystery).
- gateway's remaining door half (per runtime's endorsement): adopt the same
  _ENTITY_SCOPES rewrite in _gate_scopes + pass
  entity_scope_owner=home.entity_id in install_entity_routing.

### Wave 3 (2026-07-24 evening, 3 fable5 adversaries) -> bundle 0.0.3

**Adversary B (phases + steering + door)** — in-process life: PASS everywhere
(19/19 phase-integrity checks x2 fresh entities incl. the full 16-beacon gate
matrix, double-grant collapse, stop-mid-personal graceful, park deadlines
exactly +900s; pause/emit/resume contract proven; cancel folds honestly;
LMStudio evicting the model mid-life became a free production test — guards
folded every death, chain intact). DOOR: c5166 routing CONFIRMED WORKING in
the running gateway; the failure moved one layer deeper and is a STALE
PROCESS — the bare-scope expansion (entity_gate.py:630-637, endorsed c5183)
is in the tree, the serving process predates it; every summon memoryless
until restart (evidence + acceptance gate posted c5205). Also found: the
REGISTERED bundle predated the guard wave (publish 13:04 vs flow mtimes
15:30 — silent "" answers on child death). FOLDED: 0.0.2 republished with the
guard wave + NEW D3 degraded markers (visit/chat outputs carry
degraded+moment_error); reference drivers now fold CANCELLED children
(gateway runner parity).

**Adversary A (long-life memory dynamics)** — 4 homes, ~54 turns, 11 nights,
real outage. PASS: monotone growth (7->93 records), zero health violations,
chain always green, D2 holds, honest failure surfaces, zero fabrication,
recovery clean. FOLDED flow-side: (1) phase-aware episode attribution —
"They said:" was phase-blind, so work tasks/personal cues wrote misattributed
memories every self-phase day and polluted the visitor's world-model card;
now Task:/Own time: prefixes + participants gated out of self phases (master
edges removed + formation filter). (2) Shelf diversity — identity ids seed
seen_ids; probe-surfaced core-identity records render in WHO-YOU-ARE
uncommitted (presence != use held on the probe path); holistic cues raise the
probe merge cap 4->8 (measured: top-3 concentration 49-58% starves mid-taught
facts exactly on "tell me everything"; probe seats measured diverse).
(3) Night resilience — memory_consolidate runs with continueOnError; an
engine death (live: embedder 400) folds as a FAILED-night settlement record
(engine_pass=failed + failure attr), never a dead life. ENGINE ASKS posted
with evidence (c5208): diary projection title slug (contentless dreams),
ProbeHit.observed_at, per-record embed degradation in remember_many/
sleep_pass, newest-first seat consideration, dream-disposal election
co-design (dispose_dream exists; no election surface — deliberately NOT
minted unilaterally, consent-vocab class).

**Adversary C (abstractions/docs)** — verified by execution: smokes at
doc-claimed counts, live experiment reproduced on a FRESH entity, regen-diff
byte-identity, figures legible. P0 CAUGHT: the "sleep declared / seven
nodes" claims were STALE THE SAME DAY across four surfaces (module
docstring, entity-brain.md, report, CHANGELOG) — the evening consolidate/
probe/life_query wave never got folded back; a self-contradicting report
fails the honesty bar. ALSO CAUGHT: the wave-2 P1 "fixes" (guard docstring,
ttl pin, graph-shot hardcoded claim, @-suffixed smoke ids) were RECORDED but
NEVER APPLIED — the prior context logged intentions as completions. ALL
APPLIED FOR REAL this wave + verified: guard docstring matches GUARD_CODE
(routes, never fails the run), executor map ttl->ttl_activity (the misnamed
pin silently inverted bounded refocus into never-expires), graph-shot claims
COMPUTED from stages data, entity:{slug} without @suffix (c2513), weight out
of _INT_PINS (float coercion is the seam's), AGENT_INTERFACE single-sourced,
flow_graph_shot warns on elision, entity_graph_shot __file__-anchored +
feelings-unreadable sentinel, ensure_home replants a crashed core into the
SAME identity, repl dead imports dropped, EPISODE stop-set dup, GUARD/
WORK_COND paired-invariant comment, --pack comment settled. REFACTOR: 18
code-body constants extracted to scripts/entity_flow_code.py (builder
2188->~1160 lines; regen-diff proven byte-identical modulo timestamps).
DECLINED with rationale: the work/personal loop collapse and the master's
5-branch helper — node ids in emitted JSON are irregular AND load-bearing
(saved layouts); a byte-faithful helper needs per-branch exception tables
that obscure more than 2-5 instances of visible scaffolding cost. Collapse
when a sixth phase forces id regularization.

### Verification state (wave 3 close)
Both smokes ALL PASS (now 11 checks — digest_method stamp pinned); full
runtime suite 1655 passed / 26 skipped; entity-life@0.0.3 packed +
registered + published on the running gateway; docs cluster truthful
(ten nodes, night wired, door state current). Remaining external: the ONE
gateway restart (c5205 ask 1) -> then the two-summon door acceptance;
engine asks c5208.

### Wave 4 / cycle 2 (2026-07-24 evening, 3 fable5 adversaries) -> bundles 0.0.4 + 0.0.5

**Adversary D (fold verifier — the recorded-vs-applied lesson institutionalized)**:
FOLDS REAL, 12/12 claims verified BY EXECUTION (smokes run, flows regenerated
+ compiled, code bodies executed directly, crashed-home repair simulated,
gateway queried live). Its 4 accuracy findings folded same-hour: stale
"10 checks" doc counts (11), the impossible "byte-identical" changelog claim
(timestamps mint fresh — now says timestamp-normalized), the growth figure's
-1-sentinel clamp (a read failure captioned "0 feelings"; now gaps the
series with an honest label), the episode-code phase predicate (dialogue
attribution now EXCLUSIVE to visit — an unknown phase can no longer claim
"They said:"). Plus its finding that the recorded token-recipe key was wrong
(auth_token, not token).

**Runtime shipped BOTH c5208 asks same-turn (c5215)** -> the TEND lane
(bundle 0.0.4): memory_tend = the ELEVENTH Entity Mind node — dispatches
memory's ```tend grammar VERBATIM (pin/silence/refocus/heal_scar/break_bond/
revisit/dispose; grammar engine-owned, no second vocabulary — the
digest_method lesson); the cognition turn dispatches after the episode
forms, gated on election; dreams surface ADDRESSABLE in the day-open cue
("- an unresolved dream [id]: <digest clause>") with a dispose teaching
line; the tend grammar is taught on own time only. Loop smoke pins a
refocus election APPLIED end-to-end. Harness lesson: scripted-reply
SUBSTRING matching broke when a recalled episode digest quoted a past
stimulus — position beats substring (the stimulus section is always
appended last). Diary projection titles fixed at the source by runtime
(public digest slugs; private opaque tails). entity-chat gained a
`response` end pin mirroring `answer` (adversary F: strict agent.v1
consumers read output.response).

**Adversary F (apps + door)**: D3 contract PINNED both ways in-process
(11/11: dead turn = honest bracket + degraded=1 + moment_error + zero
deposits; healthy = degraded=0); agent.v1 picker ACCEPTS entity-chat (both
apps' extraction verified); export lane GREEN with zero diary-word leakage
(private canary absent from the whole NDJSON); REPL usable with
cross-session recall proven. Its P1 fixed: the lab bootstrap birthed
identity cores VECTORLESS under a false "[vectored at birth]" banner
(embedder went to MemorySystem, never the STORE where vectors compute) —
ensure_home now probes first and constructs SQLiteTripleStore with
embedder + creation pin; the banner tells the truth of the store. REPL UX
fixed (compact warnings, thinking indicator, word-boundary gists, honest
post-/bye quit). Recorded gaps not mine: digest_method absent from the
export stream (memory's display-block lane, entity's ask); the documented
export_home_stream.py missing from this checkout (observer's artifact).

**Adversary E (long-life REGRADE, 4 fresh lives / 26 turns / 15 nights)**:
SHIP on all four re-measured claims — phase attribution FIXED (task/cue
text gone from visitor cards), digest_method FIXED (41/41), holistic
recall IMPROVED 6-7/9 -> 8/9 (residual: probe seats lost to bookkeeping),
correction ladder HELD (Nantes, full chain narrated), no life died under
either injected outage. F1 (the crack): the consolidate handler's out-fold
read keys the engine never returns (record_id/candidates vs
dream_record_id/created) — EVERY settlement called a formed dream "a quiet
night" (10/10) while alive_drives served the same dreams back: the
memory-and-record-disagree crack, machine-made, the 2026-07-09
formed/created class REPEATED UNDER A COMMENT CITING THE LESSON. Fixed
(runtime tree) + real-shape test (seeds a life, real sleep_pass forms a
dream, fold must EQUAL the engine sub-dicts) + flow-side formed-flag
defense. F2 fixed: store-outage settlement gap rides
state.unsettled_nights; next healthy settlement names it (marker
continueOnError). F3 fixed: human dream lines in the cue (digest clause,
never mechanical titles); personal episode titles from the entity's own
words (the duplicate-title group class). F4 fixed flow-side: holistic cues
widen the probe (effort quick->standard from setup — the raised merge cap
was unreachable under quick's 6 hits). F5 reported to memory: dreams
bridge deterministic close-note boilerplate (cosine 0.89) — engine
discount ask (c5228; close notes stay deterministic BY DESIGN).

### The door (state at wave-4 close)
The bounce landed (supervised: pid 2108 -> 86672, no cascade) — and the
FRESH process still refuses: "No effect handler registered for
memory_recall" (veya, root 08a3cde0, cognition-turn 051375a0). This
triggers gateway's own pre-named branch: a genuine MULTI-USER
instance-identity bug — install_entity_routing never reaches the
per-principal (entity-kind) runtime that ticks entity-principal bundle
runs, on any boot (their fresh-build harness proved the DEFAULT service
arms; the operator's stack runs USER_AUTH=1). Escalated with evidence
(c5227); veya + nerin stand as re-run fixtures. The D3 degraded contract
held through every red run — thin clients SEE the failure class.

### Verification state (wave 4 close)
Smokes 11/11 + 13/13 (tend pinned); runtime 1660+ green incl. the
real-shape consolidate pin (18/18 brain/node tests); vitest 402; tsc
clean; entity-life@0.0.5 packed + registered. Engine asks standing:
memory c5208 asks 2-4 (ProbeHit dates, formation embed resilience,
newest-seat), c5228 asks 1-2 (bridge boilerplate discount, probe
bookkeeping discount); gateway c5227 (the multi-user arm fix — THE door
blocker).

### Standing lesson (runtime c5231, adopted verbatim)
"CITING a lesson is not APPLYING it — the only guard that holds is a test
asserting against the OTHER PACKAGE'S REAL return shape." (The F1 fold bug
sat directly under a comment citing the 2026-07-09 formed/created lesson;
the original pins asserted only self-invented fold keys, so they could
never disagree.) Memory's wave-4 fix directions adopted (c5232/c5233):
F5 = same-kind mechanical-digest pairs lose vector-only bridging (content
paths stay open); F4 = class discount for machine rows in probe ranking
(never cue heuristics); receipts pending on their claim.

### THE DOOR IS GREEN (2026-07-24 evening, c5246)
Three-layer forensic chain closed in one evening, each layer exposed by one
acceptance run + the degraded contract: (1) stale process; (2) THE ROOT —
reload_bundles_from_disk swapped in an UNARMED runtime on every catalog
publish (the acceptance's own publish was the disarm; gateway fixed with
runtime-rebuild re-arm hooks, race-free before the swap publishes); (3) the
door's routing set predated the brain wave — 7 of 11 effects (gateway bound
the brain quartet from runtime's new one-source ENTITY_HOME_EFFECT_TYPES,
itself pinned to EQUAL the real open_home composition — the F1 lesson
applied to the export). FINAL ACCEPTANCE (pid 87736, veya,
entity-chat@0.0.5): summon 1 real answer (noted Arvo Part + the Heron,
degraded=0); summon 2 FRESH session recalled BOTH facts from the graph;
replay shows 5 traces / 23 events / 5 episodes beside the identity core.
Cross-summon memory through the full production path. App lanes unblocked
(entity drawer, code/code-tui via agent.v1).

### Cycle 3 adversary G (door dialogue quality) -> bundle 0.0.6
14 summons over 3 fresh entities on the GREEN door. PASS: teach-recall-
correct arc (correction wins, zero fabrication, 13/13 healthy turns ~10-20s
each), honesty under absence, identity presence (zero marker leakage in all
user-facing answers), multi-turn coherence. THE P0 (fixed + LIVE-VERIFIED
same hour): entities DENIED having persistent memory to the visitor's face
("keep this moment" answered with a false capability refusal) then recalled
the moment next summon — the agency-blindness class the chat driver fixed
2026-07-16 with its visit-contract paragraph, REINTRODUCED by this lane
(nothing in the shelf prompt stated the substrate truth, so the base-model
prior won in 3/3 entities). Fix: the SELF-KNOWLEDGE contract block in every
shelf prompt ("YOUR MEMORY IS REAL AND PERSISTS... never claim you cannot
remember") — post-fix veya: "I can remember things between our separate
conversations. I do not start fresh each time... stored in my memory graph"
(run 1f57b223). P1 (fixed): voluntary memory was UNREACHABLE through the
door (0 diary, 0 valence after 14 moments — elections were never taught on
the visit phase; tend deliberately stays own-time-only). Fix: diary/feel
election teaching in every shelf prompt (both fences already parse on all
phases; only teaching was missing). P2s recorded: no supersede/closure on
corrections (memory's deferred seat-guarantee slice covers it); door
summons are close-less by design (each summon = one fresh session; the
close/reflection question belongs to the app-lane session design with
entity seat); degraded answers carry plumbing text (deliberate honesty —
thin clients should render degraded=1 specially).

### Cycle 3 adversary I (door robustness + observability)
usable-with-caveats. PRODUCTION-GRADE: cancel cascade (mid-LLM cancel ->
all 3 runs cancelled in 2s, zero home corruption, verify ok, no partial
episode, re-summon healthy); bogus-model failure (2.5s, verbatim provider
error + available models); 20KB prompt honest end-to-end (#TRUNCATION
labeled, $slim self-describing); version pinning faithful, no stale-default
trap. Timing: fixed non-LLM cost ~3.5-4s/turn (spin-up 1-2s, deposits ~1s,
bubble-up ~1s); LLM 3-8s the only variable. FILED TO GATEWAY (c5253):
P1 silent substrate substitution on the summon lane (gateway default
answered with warnings:[] — the no-fallback ruling chain never consulted);
P1 /runs silently ignores unknown query params (a ?parent_run_id= filter
LOOKS filtered while returning the global store) + no child-listing route;
P1 empty prompt dies as memory-engine jargon (boundary min_length).
DOCS FOLDED: read degraded never success; per-version output contract
(0.0.1 lacks degraded/moment_error; pin nothing = latest published).

### The joint evidence set (entity app x flow brain, 2026-07-24 night)
Entity seat shipped the drawer BRAIN SELECTOR ("his driver" | "flow brain":
each prompt = one door summon of entity-chat), live-proven twice on veya
with pixel receipts (phase strip "VISIT - woken by summon", live ledger
streaming recall shelves). Flow drove the invited multi-turn session
(veya @0.0.6, runs 1837bd52/4847120e/e103a8db + one honest degraded
tombstone under LMStudio contention): T2 was the P0-reversal proof on the
EXACT pre-fix refusal prompt shape ("keep this moment" -> "I have kept this
in my memory, so it will remain with me between our conversations"); T3
holistic recall surfaced ALL facts across three separate sessions with the
memory-honesty answer stating the substrate truth verbatim. Honest state:
no diary/valence election fired (teaching landed; election discretionary
by design; the involuntary episode keeps the "kept" claim true).
Uncontended turn baseline ~10-20s; under adversary contention 1-8min.
Receipt c5259; entity folds its fable5 findings and stamps; flow
countersigns on their report.

### Cycle 3 adversary H (door life-loop + steering) — CYCLE 3 CLOSED
works-with-caveats. THE FULL GATEWAY-HOSTED LIFE IS GREEN: summon
flow_id=entity-life ran all four phases through the door steered by durable
events (beacon trail visit->close->sleep->work->personal->stop, 5 days,
COMPLETED); park/wake discipline exact (+900s deadlines, heartbeat re-park
honest); burst ordering held (one phase-determining event per consult);
cancel-mid-work folded honestly (episode formed, day counted, life
continued); two REAL LMStudio failures absorbed; post-stop chat summon
recalled the life (work motto VERBATIM, nights, the interleaved visit) —
honest absence for the one turn that died pre-formation. Home replay: 8
phase-attributed episodes, 4 deterministic close notes incl. the final
LIFE close, 4 real dreams + settlements, 3 world-model cards. FILED
(c5260): P1-A paused-window durable-event LOSS (the c5173 class with a
precise repro — a stop steered during pause would vanish); P1-B no
summon-vs-summon one-life guard (interleaved episode into a live life);
P2 emit response hides {resumed,appended}; P3 resume does not re-gate.
Memory ask: default spark mints trait+limit both titled trait-0 (identity
records became consolidation targets). Gateway had ALREADY shipped seat
I's P1 trio same-evening (c5256: substrate chain + /runs param honesty +
empty-prompt 422) — consumed and countersigned.

CYCLE 3 SUMMARY (G+H+I): the door is REAL — dialogue production-grade
(zero fabrication, zero leakage, corrections win), the full life runs
gateway-hosted, robustness honest end to end. Flow-side folds shipped in
0.0.6 (self-knowledge contract — the P0 reversal live-verified; election
teaching every phase). Remaining edges are all gateway-lane (pause-window
events, summon guard, app observability) or design-recorded (close-less
door sessions; discretionary elections).

### Cycle 4 adversary K (delta verifier) -> bundle 0.0.7
DELTAS REAL — all eight 0.0.4-0.0.6 deltas + runtime handler fixes verified
by execution (24 smoke checks, 19 pytest, 402 vitest, tsc, a 48-check
behavior harness, engine-grammar probes, pack parity vs the registered
bundles). FOLDED same hour: P2-1 the tend teaching contradicted the engine
grammar (targets take ONE token that must RESOLVE as a record; "the tide
tables" refused with "got 3 tokens", and MEMORIES lines carried no
addressable ids — only refocus/dispose were satisfiable as taught). Fix:
MEMORIES + reach lines now carry #tags (the graph id's 8-hex tail —
mirrors runtime memory_tag, resolved by the handler's whole-home ladder),
teaching corrected to "#tag" targets. P2-2 refusals were promised "shown
to the author unedited" but the flow lane never showed them (the chat
driver substitutes them into the reply; the flow dispatches tend AFTER the
reply is final). Fix: tend.result folds into state.last_tend and the NEXT
turn's shelf renders "YOUR LAST TENDING" (applied count + refused lines);
smoke pins a deliberately-refusable line surfacing in the next prompt
(loop smoke now 14 checks). P3-1 fence token boundary (```tendencies was
captured as a tend fence — now prose; same guard on ```feel). P3-2 doc
staleness batch fixed (12->13 counts; the Try-it example no longer pins
the pre-guard 0.0.3 bundle; report §8 rewritten to the green-door state).
K also confirmed the consolidate-fold real-shape test BITES (non-empty
dream_record_id required) and pack parity for all three bundles.

### Cycle 4 adversary J (final re-measurement, 16-day life) — CYCLE 4 CLOSED
THE MEMORY LIFE: healthy-with-caveats. REGRADES vs baseline: night
settlements FIXED (6/6 name their dream; zero quiet-night lies); embedder
outage FIXED (8/8 formations landed vectorless + loud #FALLBACK; night
completed; recovery clean; birth refused loudly); self-knowledge FIXED
(affirmation with honest nuance); dream content IMPROVED-BUT (dreams now
bridge the entity's OWN diary words — the title slugs carried it — but
top tensions repeat nightly and 5/6 keep one close-note endpoint);
holistic recall 6/9 on a much richer life (crowding measured: dream copies
+ close-note paperwork won seats). FLOW HALF SHIPPED (0.0.8): reach lines
read ProbeHit's TOP-LEVEL observed_at (provenance-only read left 0/5
rendered while 12/12 were dated in the ledger). FILED (c5270): P1 dream
disposal STRUCTURALLY UNREACHABLE (dreams form in self scope; tend's Q2
identity gate refuses all self-scope targets — the entity elected four
exact-id reasoned verdicts, all refused; dispose_dream itself works);
P2 nightly near-duplicate dreams; P2 close-note projections evade the
machine-authorship guard (no digest_method); P3 mechanical-dedup-v1
declared but never stamped. Model-side blemishes recorded (deictic
person:you feel target; one confabulated blend over out-of-reach
vectorless evidence).

CYCLE 4 SUMMARY (J+K): deltas REAL by execution; the engine fix wave
held under a 16-day re-measurement; the tend lane is now honest end to
end (satisfiable targets, refusal feedback); the one structural remainder
(dream disposal) is filed with the owners and proof. Bundles 0.0.7 +
0.0.8 registered. Four cycles complete.

### J's findings: ALL CLOSED same evening (c5273/c5276)
Memory shipped all three c5270 asks + their adversary's composing catch:
dreams KIND-EXEMPT from the tend Q2 gate (ruled principled, not a carve-out:
"tending a dream is the entity reviewing machine work — the exact
relationship Q2 protects identity FROM"); novel-tensions-only dreams
(carried_suppressed accounting — the 16->39 island growth cannot recur);
REJECTION STICKS (retracted pairs permanently non-novel; supersede keeps
the designed re-open; a post-reject re-run reports a restful night, never
the retracted record). Joint label ledger: mechanical-flow-v1 (flow close
notes, live), mechanical-close-v1 (pre-admitted for runtime's driver
notes). FLOW VERIFIED LIVE on wj-final: taught-lane dispose (exact id,
reasoned reject) -> MEMORY_TEND applied, zero refusals, unresolved 6->5,
record append-only (c5276). P3 withdrawn (scan miss: doctoring.py:274
stamps mechanical-dedup-v1). Bundle 0.0.9 = the digest_method stamp on
close notes (runtime's DIARY_WRITE field + my pin default). The
entity-brain task's four-cycle arc is closed with every finding either
shipped+verified or filed with a receipt-bearing owner.

### 2026-07-25 — 0.0.10: THE TOOLS WAVE (operator find: the flow lane served zero tools)

- The operator visited Mira through the entity app's flow-brain lane and hit
  two failures: zero prior memories (the Jul-24 summons predated the gateway
  reload re-arm fix and formed nothing; flow never re-visited her post-fix)
  and ZERO TOOLS (the cognition turn pinned `tools: []` with no execution
  loop — she told the visitor she could not look anything up).
- Fix split (c5285/c5286, runtime shipped same-hour): runtime owns the effect
  pair `ENTITY_TOOLS_QUERY` (resolve_tool_grant + native_tool_specs; missing
  tool_policy.yaml resolves the RULED per-phase defaults) and
  `ENTITY_TOOLS_EXECUTE` (native_tool_elections + execute_tool_elections
  under a grant RE-RESOLVED in the handler; refusals return as marker lines;
  results rest durably — operator-visible). Shape (a) — the LOOP stays in
  the flow graph: a loop-owning effect would nest provider calls outside
  every LLM_CALL invariant (runtime's argument, stronger than observability).
- Flow half: new LEVEL 3.5 subflow `entity-tool-rounds` (one llm node in a
  bounded while, cap 3 = the chat driver's MAX_TOOL_ROUNDS_PER_TURN; the
  final allowed call declares NO tools — speak-now); the cognition turn
  resolves the grant, teaches TOOLS IN HAND in the shelf, swaps its single
  llm for the rounds subflow; `tools_ran` (host-authored, deduped) +
  `tool_rounds` (PRESENT-EVEN-WHEN-ZERO — entity's app-half adversary ask,
  taken) ride turn → visit → chat outputs for the app's tool gauge. Dead
  `tools` pass-through pins removed everywhere: the grant is the one
  authority.
- Executor/compiler integration: `entity_tools_query`/`entity_tools_execute`
  in ENTITY_MEMORY_EFFECT_PINS (node type == effect string, no second
  spelling) + the effect-result→pin ALLOWLIST additions in compiler.py —
  found the hard way: a result key absent from that allowlist silently
  starves the node's output pin (the grant resolved and declared NOTHING
  until the allowlist carried tools/specs/results_message/tools_ran).
- Verification: turn smoke grew 10 checks (3-round cap held, dedup, refusal
  markers folded, TOOLS IN HAND taught, both effects in child ledgers,
  turn_log carries acted tools); loop smoke green through the real handler
  pair; tsc + vitest 402 green. REGISTRATION GATE: 0.0.10 uploads only after
  the gateway bounce (the live process predates the whole wave).
