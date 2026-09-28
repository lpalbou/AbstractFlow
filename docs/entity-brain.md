# The Entity Brain — a visual, observable mind for persistent entities

`entity-life` is a master executable VisualFlow that ANIMATES a persistent
entity — identity, self-evolving memory, diary, feelings — through its four
mutually-exclusive phases (**visit / work / personal / sleep**). It is the
entity's brain drawn as clean graphs: every cognition process is a named
subflow you can open, read, and edit in the AbstractFlow editor.

It converges on the two served blueprints (never forks them):

- the PHASE LAW — `GET /api/gateway/entities/spec/phases` (v21; structural
  transitions ⊕ the operator overlay),
- the MIND MAP — `GET /api/gateway/entities/spec/cognition-graph` (v5; the
  25-node/47-edge cognition graph; the constitutional relations it names —
  seven, and the artifact itself calls the set PROPOSED — are honored
  structurally, no toggle exists here either).

## The hierarchy (three levels, one glance each)

```
entity-life (master)                 LEVEL 1 — the life loop
 └─ THE DAY GATE  ──────────────►    what does this moment call for?
     stop > close-the-visit > visit > work > granted personal > sleep > park
       ├─ entity-visit ──┐           LEVEL 2 — one conversational moment
       ├─ entity-work ───┤           the task, turns until DONE
       ├─ entity-personal┤           own time, bounded self-ticks
       │                 └─ entity-cognition-turn   LEVEL 3 — ONE lived moment:
       │                     passive recall + deliberate reach → the phase's
       │                     TOOL GRANT resolves → prompt shelf → the lived
       │                     turn (entity-tool-rounds) → elections (diary at
       │                     the LLM boundary, feelings here) → usage-trail
       │                     commit → the episode forms
       │                      └─ entity-tool-rounds  LEVEL 3.5 — the mind ACTS:
       │                          one llm in a bounded while (≤3 calls); each
       │                          native tool batch executes UNDER THE GRANT;
       │                          results return before words; the final round
       │                          declares no tools (the moment ends in words)
       ├─ entity-sleep               the night: the engine's six-phase
       │                             sleep_pass, WIRED (memory_consolidate)
       └─ entity-session-close       summary + the DETERMINISTIC diary note

entity-chat (agent.v1)               the chat door: one visit moment per prompt
```

Each subflow is a separate flow in the editor (Flow Library → the
`entity-*` family). The master shows ONLY the high-level functions; open a
subflow to see its process; open `entity-cognition-turn` to watch how memory
and cognition work together in one moment.

The library bundles example flows at build time (`src/utils/bundledFlows.ts`
glob → `dist/`): after editing or regenerating the family, rebuild the editor
(`npm run build`) and hard-reload open tabs. The library shows the flows of the
last build.

## The memory nodes (Entity Mind palette)

Eleven first-class effect nodes make the entity engine VisualFlow-callable —
find them in the editor palette under **Entity Mind**:

| Node | Effect | What it is |
|---|---|---|
| Memory Recall | MEMORY_RECALL | passive/deliberate reconstruction (pure read; identity present by right) |
| Memory Commit | MEMORY_ACCESS | the involuntary usage trail — the ONLY strengthening path |
| Memory Form | MEMORY_FORM | typed records (episode/summary/lesson/interest/...) with verbatim → artifacts |
| Memory Adjust | MEMORY_ADJUST | reinforce / attenuate / refocus / close (reason + turn_id audited) |
| Memory Appraise | MEMORY_APPRAISE | elected feelings, routine band ±1..3; scars/bonds lifecycle |
| Diary Write | DIARY_WRITE | the book — sole-author, hash-chained, never purged |
| Diary Read | DIARY_READ | one entry, with its re-entry key + birth trail |
| Memory Consolidate | MEMORY_CONSOLIDATE | the night: one engine sleep pass (six phases) |
| Memory Probe | MEMORY_PROBE | deliberate reach: probe / expand / familiarity (reason audited) |
| Life Query | LIFE_QUERY | pure life reads: alive_drives / cognition_health / entity_card |
| Memory Tend | MEMORY_TEND | tending elections (the ONE route shared with the chat driver): pin/silence/refocus/heal_scar/break_bond/revisit/dispose — dream disposal rides `dispose confirm\|reject`; refusals are DATA, never a failure |
| Entity Tools (grant) | ENTITY_TOOLS_QUERY | the phase's tool grant resolves (tool_policy.yaml or the RULED defaults) into granted names + native declaration specs — pure read, the ONE authority |
| Entity Tools (execute batch) | ENTITY_TOOLS_EXECUTE | ONE native tool batch runs under the grant RE-RESOLVED at execution (a caller list can never widen it); refusals return as marker lines; `tools_ran` is host-authored |

TOOLS (since bundle 0.0.10): the cognition turn resolves the phase's tool
grant, teaches the granted names in the shelf prompt ("TOOLS IN HAND"),
declares them natively on the lived turn, and runs bounded tool rounds in
`entity-tool-rounds`, so an entity can search, fetch, and read its own memory
verbatims. `tools_ran` + `tool_rounds` (present even when zero) ride the
turn → visit → chat outputs so app tool gauges report what actually ran.

CHANNEL AUTHORITY: no flow ever names an entity. These effects resolve to a
home ONLY through the caller channel — the gateway door's verified stamp, or
`open_entity_runtime` in-process. On a plain runtime they fail loudly; that
asymmetry IS the deposit gate.

G1 (diary privacy): diary elections in the LLM's reply are captured AT THE
RESULT BOUNDARY by the entity runtime (words fly to the book; the reply
arrives marked `[kept in diary …]`). The flow passes `turn_id` into the LLM
call so those book writes are replay-safe.

## Steering (events, triggers, hooks)

The master declares a durable mailbox (`events_mailbox`, default
`entity-life`). Emit durable events to steer the life at any moment:

| Event payload | Effect |
|---|---|
| `{"kind":"visit","message":"…"}` | a visitor speaks (wakes a parked life) |
| `{"kind":"goodbye"}` | closes the visit session (summary + diary note) |
| `{"kind":"task","task":"…"}` | queues work |
| `{"kind":"grant_personal"}` | grants one own-time day |
| `{"kind":"stop"}` | ends the life loop (final close + diary) |

Pause/resume/cancel are the normal run-level gateway verbs. Observation:
every node start/complete streams on the run ledger (flow UI run modal);
every memory act is a first-class effect record; the entity's own journal
streams at `GET /api/gateway/entities/{name}/replay[/stream]`.

## Try it

All commands run from `abstractflow/` with the monorepo runtime on the path:

```bash
export PYTHONPATH=../abstractruntime/src:../abstractmemory/src
```

1. **One lived moment against a real (temp) home** — the cognition-turn proof:

```bash
python3 scripts/entity_life_smoke.py          # 12 checks
```

2. **A full life** (visit ×2 → goodbye close → sleep → work → personal → stop),
   steered entirely by durable events:

```bash
python3 scripts/entity_life_loop_smoke.py     # 15 checks (incl. the tend election + refusal feedback)
```

3. **A LIVE entity with a real LLM** (LMStudio; born under `lab/entities/`):

```bash
python3 scripts/entity_live_experiment.py     # the cross-session Tolstoy test
```

4. **Talk to it** — one visit moment per line, memory persists between
   sessions:

```bash
python3 scripts/entity_repl.py florin
# /diary /memories /bye (deterministic close) /quit
```

5. **Through the gateway** (the door): the bundle
   `entity-life@0.0.18.flow` (its version is `BUNDLE_VERSION` in
   `scripts/build_entity_life_workflow.py`) registers from the gateway bundles dir; summon
   any entity with the chat door:

```bash
curl -X POST $GW/api/gateway/entities/<name>/summon \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"prompt": "Hello!", "flow_id": "entity-chat",
       "bundle_id": "entity-life",
       "context_window_tokens": 262144,
       "input_data": {"provider": "lmstudio", "model": "qwen/qwen3.6-35b-a3b"}}'
```

   The summon renders the identity prelude, stamps the run, and routes every
   memory effect to the entity's own home. (Requires a Gateway whose runner
   process carries entity routing.)

## Status

- Everything in the table above is **wired**: the night runs the engine's
  real six-phase `sleep_pass` (`memory_consolidate`, with `continueOnError`
  folding an engine death into an honest failed-night settlement — never a
  dead life), deliberate reach runs (`memory_probe` feeds the prompt shelf,
  shelf-race-exempt), and the personal day opens on the real alive-drives
  cue (`life_query`).
- The only remaining `declared` things are the three `declared` edges in
  cognition_graph v5 itself (incl. gate→idreview): they render read-only and
  do not fire — per the artifact's own status.
- Degradation surfaces honestly: a dead cognition turn answers
  `[the moment could not be lived: …]` and the visit/chat outputs carry
  `degraded` + `moment_error` pins so thin clients never confuse "the entity
  said nothing" with "the turn died". The agent.v1 end pins follow the same
  signal: `entity-chat` sets `success` to true only when the moment was not
  degraded and `meta` to `{provider, model, tools_ran, tool_rounds, degraded}`
  (the provider/model the host asked for, empty for the Gateway default);
  `entity-goodbye` sets `success` when the session close ran and `meta` to
  `{turns, reason}`. The run-level status only says "the flow executed": a
  degraded turn still completes its flow.
- SESSION HISTORY: the turn prompt's `THIS SESSION SO FAR` block carries
  every turn of the session, whole. A chat client's replayed history
  (`use_session_history`) arrives already bounded by the Gateway's replay
  window (the most recent 50,000 tokens of whole turns; older turns are
  dropped with a labeled `#TRUNCATION` notice), and the flows add no second,
  smaller bound.
- VERSION CONTRACT: bundle versions are immutable and PINNABLE
  (`bundle_version` on the summon). The `degraded`/`moment_error` output
  pins exist from 0.0.2; `response` (agent.v1 mirror) from 0.0.4; the
  self-knowledge + election teaching from 0.0.6. An app pinned to 0.0.1
  gets only `{answer}` and cannot detect degraded turns — pin nothing and
  the gateway serves the latest published version.

## Regenerate / verify

```bash
python3 scripts/build_entity_life_workflow.py         # emit + audit + compile
python3 scripts/build_entity_life_workflow.py --pack  # + pack the .flow bundle
```
