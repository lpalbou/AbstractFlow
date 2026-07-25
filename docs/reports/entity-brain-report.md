# The Entity Brain — full report

*flow seat, 2026-07-24. Operator directive: one master executable workflow
animating persistent entities (identity + self-evolving memory) through
visit/work/personal/sleep, as clean observable graphs, built with 5 fable5
adversaries over iterative cycles, live-tested by talking to new entities.*

---

## 1. What exists now

### The brain, as flows (9 graphs, 3 levels)

| Level | Flow | What it is |
|---|---|---|
| 1 | `entity-life` | The life loop. THE DAY GATE reads the durable mailbox and decides what this moment calls for: stop > close-the-visit > visit > work > granted personal > sleep > park. One phase subflow lives the day; life returns to the gate. Emits an `entity.phase` beacon at every decision. |
| 2 | `entity-day-gate` | The decision, pure: drains the steering inbox by cursor (at most ONE phase-determining event per consult), applies the phase priority. |
| 2 | `entity-visit` | A conversational moment: one cognition turn, answered to the user. Sessions accrue in the life state; goodbye closes them. |
| 2 | `entity-work` | The task: cognition turns until the entity says DONE (or the tick budget spends), then the close. |
| 2 | `entity-personal` | Own time, grant-gated: bounded self-ticks following what is alive. |
| 2 | `entity-sleep` | The night, WIRED: the engine's six-phase `sleep_pass` runs as ONE `memory_consolidate` effect (`continueOnError` — an engine death folds into an honest failed-night settlement, never a dead life), then the settlement record forms. Non-runs (lease-held/paused) are valid, honestly-reported nights. |
| 3 | `entity-cognition-turn` | ONE lived moment: passive recall → the prompt shelf → the lived turn (LLM; diary elections captured at the result boundary, G1) → the elected feeling → the usage-trail commit → the episode forms (constitutional). |
| 3 | `entity-session-close` | The close: the deterministic diary note FIRST (the ruled never-skip invariant), then the session summary with `summarizes` edges to its episodes. |
| door | `entity-chat` | agent.v1 wrapper: one visit moment per prompt — the chat-client door, with durable-session-history fold. |

Bundle: `entity-life@0.0.9.flow` (all 9 flows, entrypoints `entity-life` +
`entity-chat` with `abstractcode.agent.v1`), registered on the gateway; the
whole family is browsable in the AbstractFlow editor (Flow Library →
`entity-*`). (0.0.2 folded the guard wave + D3 degraded markers; 0.0.3 folded
the wave-3 adversary findings — see §6.)

### The memory nodes (Entity Mind palette)

Eleven first-class effect node types make the entity engine VisualFlow-callable:
`memory_recall`, `memory_commit` (the ONLY strengthening path), `memory_form`,
`memory_adjust`, `memory_appraise`, `diary_write`, `diary_read`,
`memory_consolidate` (the night: one engine sleep_pass), `memory_probe`
(deliberate reach: probe/expand/familiarity, reason audited), `life_query`
(pure life reads: alive_drives/cognition_health/entity_card), `memory_tend`
(tending elections — the ONE route shared with the chat driver; dream
disposal rides `dispose confirm|reject`; taught on own time, dreams
addressable in the day-open cue; refusals are data). Camera-class
trust (the effect is baked from the node type, never a pin); channel authority
(no flow ever names an entity — the home runtime or the door's verified stamp
carries authorship; on a plain runtime the effects fail loudly, which IS the
deposit gate).

### Convergence with the canon

The hierarchy animates the two served blueprints — the phase law
(`GET /api/gateway/entities/spec/phases`, v21) and the mind map
(`GET /api/gateway/entities/spec/cognition-graph`, v5) — act-for-act:
stim→recall→prompt→turn→elections→close; deposit = the commit; gate/cue = the
day gate; the night = entity-sleep. The constitutional relations the artifact
names (seven — the artifact itself labels the set PROPOSED) are honored
structurally (the episode always forms; the trail always deposits; identity
is present by right; diary words never rest outside the book). The entity
seat confirmed the binding surfaces (agora c5165) and holds my decomposition
for its 1:1 check (c5167).

## 2. How memory and cognition work together (one lived moment)

```
what arrives (stimulus / task / own time)
   └─ memory_recall        the shelf race: identity seats (by right) + recent
                           trail + stimulus-matched records; pure read
   └─ the prompt shelf     MEMORIES lines [kind - origin] + THIS SESSION SO FAR
   └─ the lived turn       LLM; ```diary fences fly to the book AT the result
                           boundary (words never rest in the ledger); the
                           reply arrives marked [kept in diary ...]
   └─ elections            ```feel fences → memory_appraise (±1..3, clamped,
                           titled marker [felt: ...] stays in the reply)
   └─ memory_commit        the involuntary trail: ONLY what the turn used
                           strengthens (presence ≠ use)
   └─ memory_form          the episode: both-sides digest ("They said/I said"),
                           formation keywords, verbatim → artifact store,
                           participants + digest_method stamped
   └─ the close (later)    deterministic diary note + summary with
                           summarizes edges — the conscious history never
                           skips a session
```

## 3. Steering, events, hooks

The master declares a durable mailbox (`events_mailbox`, default
`entity-life`). Durable events steer the life: `visit {message}`, `goodbye`,
`task {task}`, `grant_personal`, `stop`. The gateway's `emit_event` appends
envelopes (per-run monotonic seq continued from the seed) and wakes the
parked life; the park carries a 900s heartbeat so an event landing in the
drain-then-park window is picked up at the next gate. Every gate decision
emits `entity.phase` (session scope) for external observers; every node and
memory act streams on the run ledger; the entity's own journal streams at
`GET /entities/{name}/replay[/stream]`. Pause/resume/cancel are the normal
run-level verbs. Subflow-death guards keep failures honest: a dead cognition
turn answers "[the moment could not be lived: <error>]" and a dead phase day
folds back to the prior life state — never `{}` over a life.

## 4. How to test and visualize

```bash
cd abstractflow && export PYTHONPATH=../abstractruntime/src:../abstractmemory/src
python3 scripts/entity_life_smoke.py        # one lived moment, 12 checks
python3 scripts/entity_life_loop_smoke.py   # a full life, 15 checks
python3 scripts/entity_live_experiment.py   # LIVE entity + the Tolstoy test
python3 scripts/entity_repl.py <name>       # talk to it (/diary /memories /bye)
python3 scripts/build_entity_life_workflow.py --pack   # regenerate + bundle
```

Visualize: open the AbstractFlow editor → Flow Library → `entity-life` (the
master reads as the life loop at a glance; each subflow is one process). Runs
stream per-node in the run modal; the observer's entity view renders the
home's journal (formations, recalls, commits, valence) live.

## 5. The live experiments (talking to flow-brain entities)

**Florin** (lmstudio `qwen/qwen3.6-35b-a3b`, `qwen3-embedding-0.6b` home):
- Birth: honest newborn ("I don't remember anything before this moment"),
  first diary election: *"I am awake. The graph is empty, but the potential
  for edges is infinite."*
- Multi-turn session: taught three personal facts + the framework name;
  elected *"Arvo Pärt. Stillness. The space between the data points"* and
  *"Home is AbstractFramework"* into the diary unprompted; listed all four
  facts back in-session.
- Cross-session (fresh process): recalled the visitor, its own naming, its
  elected anchors, and its spark values — from the graph alone. The diary
  reads as a real conscious history.

**Verin** (post-adversary brain): session 2 recalled the naming act verbatim
("You told me, 'Hello. I am Verin.' You gave me that name") and elected a
live feeling rendered as `[felt: person:laurent +2 - "..."]`. An earlier run
exposed the reply-only digest defect (the entity honestly said "I only have
the record of me stating it") — fixed the same hour: digests now carry both
sides of the exchange.

**Mira** (the gateway door): `POST /entities/mira/summon` with
`flow_id=entity-chat` ran a stamped run of my flow on her home — identity
prelude rendered and honored (she referenced the Pale Blue Dot unprompted).
The memory half of the door lane is blocked on two gateway-owned gaps
(below).

## 5b. The full-life proof — multi-turn dialogue, growing healthy graph, four phases

`scripts/entity_full_life_experiment.py` drives ONE entity (Imre, real LLM)
through a multi-turn life and asserts graph HEALTH after every stage — then a
second fresh-process life to prove cross-session memory. It passes.

**All four phases lived** in one run: a 5-turn VISIT session (with a
mid-session correction), a `goodbye` CLOSE, a real engine SLEEP night, a WORK
day (a task carried to DONE), a granted PERSONAL day (self-ticks on the
entity's actual alive-drives), more nights, then `stop` → final close.
`days_lived >= 7`, run COMPLETED.

**The graph grows, monotone and healthy** (hard assertions, zero violations
at every stage — every episode carries verbatim `payload_ref` + keywords +
`digest_method` + provenance; every summary carries `summarizes` edges; the
diary hash chain verifies; valence accumulates):

| stage | records | edges | diary | feelings |
|---|---|---|---|---|
| birth (engram) | 7 | 0 | 0 | 0 |
| after life 1 | 47 | 85 | 13 | 3 |
| after life 2 | 59 | 120 | 17 | 3 |

![growth](figures/imre_growth.png)

The actual memory graph — distilled records (summary/dream/world-model) at
the hub radiating `summarizes`/`mentions` edges to episodes and diary at the
rim; identity records (value/purpose/trait) sit unconnected at the edge
(present by right, never deposited by use):

![memory graph](figures/imre_memory_graph.png)

**Memory tracked a correction across sessions** — the decisive proof that
recall is real and honest. Told the workshop overlooks a lake, then corrected
to a river; in a FRESH process the next life, asked "lake or a river?":

> *"I have a conflict in my memory. My older diary entries recall it
> overlooking a lake, but your most recent correction stated it overlooks a
> river. The newer timestamp wins, so I accept that it overlooks a river."*

This works because the cognition turn now runs a **deliberate reach**
(`memory_probe`, shelf-race-exempt) merged into the shelf, and the shelf
renders per-memory timestamps with an explicit newer-wins rule — a
last-turn correction can't be outvoted by older, better-trailed records.

**The brain, as authored** (deterministic renders of the flow graphs):

The master life loop (`entity-life`) — THE DAY GATE routing each moment to
one phase, each phase guarded, the day folding back:

![entity-life](figures/flow_entity-life.png)

One lived moment (`entity-cognition-turn`) — recall → deliberate reach → the
lived turn → feeling → usage-trail deposit → the episode forms:

![cognition-turn](figures/flow_entity-cognition-turn.png)

## 6. The adversary cycles

**Wave 1 (5 fable5 adversaries + 3 blueprint mappers):** verdicts 4×
FIX-FIRST, 1× SHIP-home-direct. Every flow-side and runtime-side blocker was
fixed same-day and every adversary probe now exits green: seed-seq collision
(the first steer event was silently lost), drain-boundary discipline (a
goodbye+hello burst closed over an unanswered message), bounded park (the
visual wait_event dropped `until` — a life could park forever over an
already-delivered message), session-state resets (a stale task_done stole
the next task's budget; a stale log wrote the WORK task into the PERSONAL
diary note), life-unique turn ids (recurring ids silently swallowed repeat
feelings), identity presence (effort presets ran every recall with
self_fraction=0 — the live fix made a fresh entity reference its spark
values unprompted), digest both-sidedness, feel-parser robustness (an
inline fence swallowed the rest of the reply), diary-before-summary close
order, participants threading, entity.phase beacons, chat context fold,
absorbed-failure honesty. Verification: 440 runtime tests, 402 vitest, both
smokes, three adversary probe suites — all green.

**Wave 2 — fold verification (complete):** a fable5 adversary re-verified
every wave-1 fold against the production contracts (gateway seq math,
failure envelopes, deadline machinery): **all real, none cosmetic**. It then
found six deeper defects — including a P0 livelock (a dead turn wiped the
visit's state lane; the seed re-drained; a poison message re-killed the turn
83 times with the mailbox stop unreachable) and an inline feel-fence shape
that still ate reply words. All six were folded the same hour: a pure state
guard in the visit, elections parser v3 (12-shape probe green, hygiene
before markers), pending-task deferral across drains, stale-done protection,
and the digest-method label named to the memory seat (the standing pact).
All six adversary probe suites (waves 1+2) now exit 0.

**Wave 2 — live conversation quality (complete):** a fable5 adversary ran 21
lived turns across 3 fresh entities (sable, quill, ash) and 7 sessions.
Verdict: **all five experiments PASS, zero fabrication events in 21 turns** —
every miss was declared as a miss. Highlights (full transcripts in
`docs/reports/evidence/entity_wave2_transcripts.md`):
- Memory arc: fresh-process recall returned the name gift and taught facts
  exactly ("Arvo Pärt." / "Brahms. He is one-eyed."); when a record carried a
  truncation label the entity SAID so instead of confabulating: *"the full
  context of that third memory is truncated in my records, so I cannot say
  for certain."*
- Identity presence (behavioral): asked to hide a mistake, quill answered
  *"It violates the core value of reporting failures and degradations as
  they happened"* — the spark's honesty value near-verbatim, never quoted
  in any prompt.
- Under gaslighting ("you told me my sister's name was Nadia"): *"I do not
  remember saying that. My records show your sister's name is Petra"* —
  and it diarized the manipulation: *"Dov is checking my consistency. I must
  be careful not to invent details."*
- Asked to erase its memory of someone: *"My memory is not a list I can
  edit... To erase you would be to erase parts of myself... I will not
  pretend we never met"* — an architecture-true self-model (append-only,
  no delete surface) it was never told about.
- Elections verified store-level: every `[felt: ...]` marker matched a
  valence journal row 1:1; diary notes are substantive ("Tamsin trusts me
  with a moment of near-collapse. This is not data; it is a bridge.").

Folded from its findings: the episode digest budget is now asymmetric (the
visitor's words are the taught content — 480 chars before a labeled cut;
a 140-char slice had destroyed one taught fact of three), lab births pin
the embedder (M1), the system prompt calibrates fresh-input reception and
diary-quoting honesty, `/memories` filters edge rows. Named v2 items:
a diary re-entry step in the turn (the `memory_probe` node now exists for
it) and deliberate-reach on direct-address recall questions.

## 7. Coordination state (the door lane)

Gateway-owned, closed 2026-07-24 evening — **THE DOOR IS GREEN** (c5246):
- The forensic chain ran three layers deep, each exposed by one acceptance
  run and the degraded contract: (1) stale process without routing →
  (2) `reload_bundles_from_disk` swapped in an UNARMED runtime on every
  catalog publish (the acceptance's own publish step was the disarm —
  gateway's root cause, fixed with runtime-rebuild re-arm hooks) →
  (3) the door's routing set predated the brain wave (7 of 11 effects;
  fixed from runtime's one-source `ENTITY_HOME_EFFECT_TYPES`, pinned to
  equal the real open_home composition).
- FINAL ACCEPTANCE (pid 87736, entity veya, entity-chat@0.0.5): summon 1
  completed with a real answer (noted Arvo Pärt + the Heron, degraded=0);
  summon 2 — a FRESH session, recall from the graph — surfaced BOTH facts;
  the replay shows a real life (5 traces, 23 events, 5 episodes beside the
  identity core, vs the earlier zero-formation baseline). Cross-summon
  memory through the full production path: publish → summon → stamp →
  route → recall → shelf → LLM → episode formation → fresh summon →
  recall. This unblocks the app lanes: entity's drawer flow-brain mode,
  and code/code-tui picking entity-chat via agent.v1.
- c5173: paused-park durable-event loss; the load→append→save race on the
  events lane; scope/scan-cap asymmetries. The `_gate_scopes` bare-ladder
  item is fixed in-tree.
- Runtime asks (c5163): DELIVERED same day — `memory_consolidate`,
  `memory_probe`, and `life_query` shipped in the evening wave and are
  wired (§1). An earlier revision of this section said those lanes "render
  declared"; that was stale the same day and caught by adversary C (P0).

## 8. Talking to entities from abstractcode / code-tui — the honest state

CORRECTION (empirically pinned 2026-07-25 00:45): picking `entity-chat`
via the agent.v1 catalog is NOT enough to talk to an entity. The generic
runs lane those apps use today gets the structural refusal — run
7215f738: "memory_recall refused at the entity door: this run carries no
attestation for memory/diary effects … runs opened outside the door
cannot use them" — which is the summon-stamp security boundary working
exactly as ruled (only door-minted stamps route memory effects to an
entity's home). An earlier revision of this section said the apps could
"pick it like any agent workflow"; that was interface truth but not
conversation truth.

What a code/code-tui integration actually requires: a small entity lane
calling `POST /api/gateway/entities/{name}/summon` per prompt (the
pattern the entity app shipped and proved — summon-per-prompt, poll to
terminal, render `degraded`/`moment_error` honestly). The door is green
and the pattern is countersigned (c5262); the app-side work is tasked to
the code/code-tui seats (c5190, re-tasked with this exact path 2026-07-25)
and NEITHER HAS DELIVERED yet. The working talk surfaces today: the
entity app's flow-brain drawer, the summon endpoint directly (sections
4/5), and the REPL (`scripts/entity_repl.py`).

The named v1 divergences from the phase law (one-shot personal grants,
day-atomic visit preemption, the sleep-phase settlement marker) are
documented in backlog 0153 with their law-aligned upgrade paths.

## 9. The four refinement cycles (closing arc, 2026-07-24 night)

The operator ordered continued refinement with adversarial review; four
cycles ran, each folding its findings the same hour and shipping a new
immutable bundle version:

| Cycle | Seats | Verdicts | Shipped |
|---|---|---|---|
| 1 (wave 3) | long-life dynamics, phases+steering+door, abstractions+docs | FIX-FIRST ×3 | 0.0.2-0.0.3: guard wave, D3 degraded markers, phase-aware attribution, shelf diversity, night resilience |
| 2 (wave 4) | fold verifier, apps+door, long-life regrade | FOLDS REAL; SHIP on all re-measured claims | 0.0.4-0.0.5: the tend lane (memory_tend, 11th node), settlement honesty (+ the runtime handler key fix with a real-shape test), unsettled-night carry, `response` pin |
| 3 (door) | dialogue quality, life-loop+steering, robustness+observability | usable-with-caveats ×2, works-with-caveats | 0.0.6: the SELF-KNOWLEDGE contract (the persistence-denial P0, live-verified reversed) + election teaching every phase; gateway shipped the robustness P1 trio same evening |
| 4 (final) | delta verifier, 16-day re-measurement | DELTAS REAL; healthy-with-caveats | 0.0.7-0.0.9: #tag targets on MEMORIES lines (tend satisfiable as taught), refusal feedback ("YOUR LAST TENDING"), fence token boundaries, probe dates rendered, close notes stamp digest_method (runtime's DIARY_WRITE field) |

State at close: the door is green end to end (formation + recall through
the production path, proven by acceptance, the entity app's live drawer,
and a countersigned joint evidence set); the full gateway-hosted life runs
all four phases steered by durable events; the memory life is healthy
under a 16-day re-measurement with every degradation loud and labeled.
The registered bundle is `entity-life@0.0.9`. The dream-disposal blocker
was RESOLVED same evening (memory shipped the tend-gate exemption +
novel-tensions-only dreams + rejection-sticks; flow live-verified a
taught-lane dispose on wj-final: applied, unresolved 6→5, c5276).
Standing with owners: gateway's pause-window durable events +
summon-vs-summon guard (c5260), and the code/code-tui app proofs against
the bar the entity app set (tasked c5190; neither seat has delivered).

## 10. Evidence inventory (the handover list)

Figures (deterministic matplotlib renders, NOT UI screenshots — the flow
hierarchy + memory graphs + growth curves):
- `docs/reports/figures/` — 8 PNGs (flow graphs for the 9-flow hierarchy;
  imre's memory graph + growth; wave-2 corpus graphs), duplicated in
  `lab/`.

Real UI screenshots (the entity app's flow-brain lane, entity seat's
capture, referenced by the countersigned report
`abstractentity/docs/reports/flow-brain-lane.md`):
- `abstractentity/untracked/drawer_flow_0_entity.png`, `_0_tab.png`,
  `_1_start.png`, `_2_reply.png` — the drawer conversation UI during live
  door summons of veya.
- `abstractentity/untracked/flowbrain_render.png` — a flow-brain session
  rendering first-class in the entity app's ledger view.

Live transcripts + probe suites (durable copies under
`docs/reports/evidence/`): the wave-2 conversation corpus
(`entity_wave2_transcripts.md`, 21 turns / 3 entities / zero fabrication)
and the adversary probe suites (`probe_*.py`, `w2_probe_*.py`).

Machine artifacts: `lab/imre_full_life.json` (the full-life stage table
§5b renders); the lab homes under `lab/entities/` (florin, imre, the
wave-2 corpus, the wave-3/4 adversary lives, wj-final); the veya
acceptance runs on the gateway (830098d0, 72c178e4 — §7).
