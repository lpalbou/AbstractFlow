#!/usr/bin/env python3
"""Generate the ENTITY LIFE master workflow + its brain subflows.

The operator's directive (2026-07-24): one master executable workflow that
ANIMATES an entity — its 4 mutually-exclusive phases (visit/work/personal/
sleep) and the memory/cognition processes that make it an entity — as CLEAN,
human-readable VisualFlow graphs at three levels:

  LEVEL 1  entity-life            the life loop: THE DAY GATE -> one phase -> back
  LEVEL 2  entity-visit           a conversational moment (someone speaks)
           entity-work            the task (work until done)
           entity-personal        own time (bounded self-ticks)
           entity-sleep           the consolidation night (the engine's
                                  six-phase sleep_pass, WIRED)
           entity-day-gate        what does this moment call for?
  LEVEL 3  entity-cognition-turn  ONE lived moment (recall -> reach -> grant ->
                                  shelf -> the lived turn -> elections ->
                                  deposit -> episode)
           entity-tool-rounds     the acting half of a moment: one llm in a
                                  bounded while; each native tool batch runs
                                  under the grant; the final round answers
                                  in words (LEVEL 3.5)
           entity-session-close   the close (summary + the deterministic
                                  end-of-session diary note)
  CHAT     entity-chat            agent.v1 wrapper: one visit turn per prompt
                                  (the door for chat clients).
           entity-goodbye         the summonable close for chat conversations
                                  (folds durable session history, runs the
                                  real close; bundle entrypoint).

CONVERGENCE: this hierarchy animates the served cognition_graph v5
(GET /api/gateway/entities/spec/cognition-graph) and the phase law
(GET .../spec/phases). The graph is the LAW; this workflow is a ruled
trajectory — acts map 1:1 (stim->recall->prompt->turn->elections->close;
deposit = memory_commit; gate/cue = day-gate; the night = entity-sleep).
Constitutional edges are honored structurally: the episode ALWAYS forms
(turn->s1), the trail ALWAYS deposits (prompt->deposit->s1), identity is
present by right (self seats ride every recall budget), diary elections are
captured at the LLM result boundary (G1 — words fly to the book, the reply
arrives marked), diary projection is engine-side (s2->s1).

CHANNEL AUTHORITY: no flow names an entity. The MEMORY_*/DIARY_* effects
resolve to a home ONLY through the caller channel — the gateway door's
verified stamp routing, or open_entity_runtime in-process (the live-test
lane). On a plain runtime they fail loudly; that asymmetry IS the deposit
gate, not a bug.

ONE MAILBOX, ONE CONSUMER (v1 reception rule): the MASTER declares the
durable mailbox (`events_mailbox` var) and is the only reader of
`events_inbox` — subflow children have fresh vars, so child-side mailbox
reads would see an empty inbox (and dual declaration would double-deliver).
Steer the life by emitting durable events:
  {kind: "visit",  message}   a visitor speaks (also wakes a parked life)
  {kind: "goodbye"}           the visitor leaves (closes the visit session)
  {kind: "task",   task}      queue work
  {kind: "grant_personal"}    grant an own-time day
  {kind: "stop"}              end the life loop (final close + diary)
Pause/resume/cancel are run-level gateway verbs; per-node observation rides
the normal node_start/node_complete ledger stream.

STATUS (updated 2026-07-24 evening — the earlier "sleep pass NOT
effect-wrapped" paragraph here was STALE the same day it shipped, adversary
C's P0): all THIRTEEN brain node types are WIRED to first-class effects —
memory_recall/commit/form/adjust/appraise, diary_write/read,
memory_consolidate (the engine's six-phase sleep_pass runs as the night,
with continueOnError folding an engine death into a failed-night
settlement), memory_probe (deliberate reach), life_query (alive-drives
cue), memory_tend (the ONE tend-election route shared with the chat driver
— dream disposal rides dispose confirm|reject; runtime c5215). The only
remaining `declared`-status things anywhere are the 3 declared edges of
the served cognition graph itself.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from wf_common import (  # noqa: E402
    AGENT_INTERFACE,
    EXEC_IN, EXEC_OUT, pin, node, edge, base_flow, start_node, end_node,
    llm_node, code_node, get_var, set_var, while_node, get_node,
    subflow_node, memory_recall_node, memory_commit_node, memory_form_node,
    memory_appraise_node, diary_write_node, memory_consolidate_node,
    memory_probe_node, life_query_node, memory_tend_node,
    entity_tools_query_node, entity_tools_execute_node,
    write_json, validate_edges, pack_bundle, compile_check,
)
from entity_flow_code import (  # noqa: E402
    CHAT_DEGRADED_CODE, CHAT_STATE_CODE, CLOSE_PREP_CODE, DAY_END_CODE,
    DRIVE_CUE_CODE, ELECTIONS_CODE, EPISODE_CODE, GATE_CODE,
    GOODBYE_WORD_CODE, GUARD_CODE,
    LIFE_COND_CODE, PERSONAL_COND_CODE, PHASE_ROUTE_CODE,
    ROUNDS_COND_CODE, ROUNDS_FOLD_FINAL_CODE, ROUNDS_FOLD_TOOLS_CODE,
    ROUNDS_INIT_CODE, ROUNDS_RESULT_CODE, ROUNDS_ROUTE_CODE,
    ROUNDS_VIEW_CODE, SEED_CODE,
    SETTLE_CHECK_CODE, SHELF_CODE, SLEEP_REPORT_CODE, TURN_FOLD_CODE,
    TURN_SETUP_CODE, WORK_COND_CODE,
)

OUT = Path(__file__).resolve().parents[1] / "examples" / "flows"

MASTER_ID = "entity-life"
VISIT_ID = "entity-visit"
WORK_ID = "entity-work"
PERSONAL_ID = "entity-personal"
SLEEP_ID = "entity-sleep"
GATE_ID = "entity-day-gate"
TURN_ID = "entity-cognition-turn"
CLOSE_ID = "entity-session-close"
CHAT_ID = "entity-chat"
ROUNDS_ID = "entity-tool-rounds"
GOODBYE_ID = "entity-goodbye"

BUNDLE_ID = "entity-life"
BUNDLE_VERSION = "0.0.16"
# Version history: CHANGELOG.md (entity-life entries) — the per-version
# ledger moved there 2026-07-25 (cleanup adversary P1-2: the header-comment
# practice bloated this file AND silently stopped at 0.0.11 while five
# versions shipped). Site comments below keep their load-bearing WHY notes.

EVENT_KEY_PREFIX = "evt:global:global:"
# AGENT_INTERFACE imported from wf_common (one definition — adversary C).


def guard_node(node_id, label, x, y):
    """EXEC guard on the spine: passes `value` through and ROUTES honestly on
    a dead child (honest error value or the caller's fallback — see
    GUARD_CODE). It does NOT fail the run: the sandbox absorbs code-node
    raises into success=false outputs and the spine continues (wave-3
    adversary C proved a 1/0 spine node completes the run). Do not
    "simplify" this to a raise — that recreates the silent swallow the
    guard exists to prevent."""
    n = code_node(node_id, label, GUARD_CODE, x, y,
                  [pin("value", "value", "any"), pin("child", "child", "object"),
                   pin("fallback", "fallback", "any")])
    n["data"]["pinDefaults"] = {**(n["data"].get("pinDefaults") or {}), "fallback": ""}
    n["data"]["inputs"].insert(0, EXEC_IN)
    n["data"]["outputs"].insert(0, EXEC_OUT)
    return n


def if_node(node_id, label, x, y):
    return node(node_id, "if", label, x, y,
                inputs=[EXEC_IN, pin("condition", "condition", "boolean")],
                outputs=[pin("true", "true", "execution"),
                         pin("false", "false", "execution")])


def make_obj(node_id, label, fields, x, y, *, pin_defaults=None):
    """make_object with optional constant fields (pin defaults)."""
    return node(node_id, "make_object", label, x, y,
                inputs=[pin(f, f, t) for f, t in fields],
                outputs=[pin("result", "result", "object")],
                pin_defaults=pin_defaults)


def wait_event_node(node_id, label, x, y, *, timeout_s=None):
    """Durable event wait; timeout_s bounds the park (the runtime resumes
    {"timed_out": true} past the deadline — the master then re-consults the
    gate, draining any envelope that landed in the drain-then-park window)."""
    defaults = {"timeout_s": timeout_s} if timeout_s else None
    return node(node_id, "wait_event", label, x, y,
                inputs=[EXEC_IN, pin("event_key", "event_key", "string"),
                        pin("timeout_s", "timeout_s", "number")],
                outputs=[EXEC_OUT, pin("event_data", "event_data", "object")],
                pin_defaults=defaults)


def concat_node(node_id, label, x, y, *, prefix):
    return node(node_id, "concat", label, x, y,
                inputs=[pin("a", "a", "string"), pin("b", "b", "string")],
                outputs=[pin("result", "result", "string")],
                pin_defaults={"a": prefix},
                extra={"concatConfig": {"separator": ""}})


def answer_node(node_id, label, x, y):
    return node(node_id, "answer_user", label, x, y,
                inputs=[EXEC_IN, pin("message", "message", "string")],
                outputs=[EXEC_OUT, pin("message", "message", "string")])


# ---------------------------------------------------------------------------
# LEVEL 3 builders (code bodies live in entity_flow_code.py —
# RestrictedPython-safe, pure/lazy: evaluated on data pull, volatile
# get_var reads keep loop conditions fresh).
# ---------------------------------------------------------------------------


def build_cognition_turn() -> dict:
    """ONE lived moment: recall -> shelf -> the turn -> elections -> deposits."""
    f = base_flow(TURN_ID, "Entity — Cognition Turn",
                  "ONE lived moment: passive recall feeds the prompt shelf; the turn "
                  "is lived (LLM; diary elections captured at the result boundary, "
                  "G1); the elected feeling applies; the usage trail deposits "
                  "(commit); the episode forms (constitutional).")
    N = f["nodes"]
    E = f["edges"]

    N.append(start_node("Moment begins", [
        pin("stimulus", "stimulus", "string"),
        pin("phase", "phase", "string"),
        pin("task", "task", "string"),
        pin("state", "state", "object"),
        pin("system", "system", "string"),
        pin("provider", "provider", "string"),
        pin("model", "model", "string"),
        pin("participants", "participants", "array"),
    ], 80, 360, pin_defaults={"task": "", "phase": "visit", "participants": []}))

    N.append(code_node("setup", "Mint turn id + cue", TURN_SETUP_CODE, 400, 160,
                       [pin("state", "state", "object"), pin("phase", "phase", "string"),
                        pin("stimulus", "stimulus", "string")]))

    N.append(memory_recall_node("recall", "Passive recall — what this moment brings back", 400, 360,
                                pin_defaults={"view": "working_set", "effort": "standard",
                                              "scopes": ["self", "diary", "life"]}))
    # effort rides from setup (F4): holistic cues widen the reach to
    # "standard" — the static "quick" pin capped hits below the shelf's
    # holistic merge cap. The pin default remains the non-holistic value.
    N.append(memory_probe_node("reach", "Deliberate reach (shelf-race-exempt)", 400, 560,
                               pin_defaults={"op": "probe", "effort": "quick",
                                             "reason": "visit-turn deliberate reach over the stimulus"}))

    N.append(code_node("shelf", "The prompt shelf", SHELF_CODE, 720, 160,
                       [pin("handles", "handles", "array"), pin("probe_hits", "probe_hits", "array"),
                        pin("stimulus", "stimulus", "string"),
                        pin("phase", "phase", "string"), pin("task", "task", "string"),
                        pin("state", "state", "object"),
                        pin("tool_names", "tool_names", "array"),
                        pin("participants", "participants", "array")]))

    # TOOLS (0.0.10, operator find 2026-07-25): the phase's grant resolves
    # (tool_policy.yaml or the ruled defaults), its names teach the shelf,
    # its specs declare natively inside the TOOL ROUNDS subflow — the acting
    # half of the lived moment (llm may call tools; batches execute under
    # the re-resolved grant; the final round must answer in words).
    N.append(entity_tools_query_node("grant", "What may I touch this phase", 560, 560))
    N.append(make_obj("rounds_in", "Compose the acting moment", [
        ("prompt", "string"), ("system", "string"), ("turn_id", "string"),
        ("phase", "string"), ("specs", "array"),
        ("provider", "string"), ("model", "string"),
    ], 720, 560, pin_defaults={"max_rounds": 3}))
    N.append(subflow_node("turn", "THE LIVED TURN — mind + tools", ROUNDS_ID, 720, 360))
    N.append(get_node("reply_r", "reply", "", 900, 60))
    N.append(get_node("ran_r", "tools_ran", [], 900, 560))
    # tool_rounds is PRESENT-EVEN-WHEN-ZERO (entity's app-half adversary,
    # c5290): structural proof the tools lane executed lets the app's
    # fabrication gauge accuse from turn one — an absent field stays blind.
    N.append(get_node("rounds_r", "rounds_used", 0, 900, 660))
    N.append(get_node("words_r", "prior_words", "", 900, 760))
    N.append(get_node("silent_r", "silent", 0, 900, 860))
    # DEATH GUARD on the rounds child (fix adversary P0-1: this was the ONE
    # turn-level subflow call without the guard idiom — a provider failure
    # mid-round was absorbed into a FALSE "(I stayed silent)" episode in the
    # append-only graph with degraded=0 and a gauge contradicting the home's
    # own ledger). On death the honest error text becomes the reply lane and
    # the turn marks DEGRADED; the episode then records the truth.
    N.append(guard_node("rounds_guard", "The rounds must have lived", 900, 360))

    N.append(code_node("elections", "Mid-turn elections (feel fence)", ELECTIONS_CODE, 1040, 160,
                       [pin("reply", "reply", "string"),
                        pin("prior_words", "prior_words", "string"),
                        pin("phase", "phase", "string")]))

    N.append(if_node("if_feel", "feeling elected?", 1040, 360))
    N.append(memory_appraise_node("feel", "Elected feeling — valence", 1300, 200,
                                  pin_defaults={"op": "appraise", "scope": "self"}))

    N.append(memory_commit_node("deposit", "Deposit the usage trail", 1300, 460))
    N.append(code_node("episode_prep", "Shape the episode", EPISODE_CODE, 1560, 160,
                       [pin("stimulus", "stimulus", "string"), pin("clean_reply", "clean_reply", "string"),
                        pin("phase", "phase", "string"), pin("turn_id", "turn_id", "string"),
                        pin("participants", "participants", "array")]))
    N.append(memory_form_node("episode", "The episode forms (turn -> graph)", 1560, 460,
                              pin_defaults={"scope": "life"}))

    # Tending (runtime c5215): waking review disposes — the tend fence body
    # dispatches AFTER the episode forms, only when elected (empty body
    # fails the effect loudly by contract, so the if gates dispatch).
    N.append(if_node("if_tend", "tending elected?", 1820, 640))
    # channel='entity-reflection' (runtime tend.py P0-1 fix 2026-07-25):
    # tending refuses without the verified channel. Own-time tending IS the
    # entity's own reflection — the flow states it where true by
    # construction; the door re-verifies against the stamp regardless.
    N.append(memory_tend_node("tend", "Tend the memory (elections)", 2080, 520,
                              pin_defaults={"scope": "life",
                                            "channel": "entity-reflection"}))

    N.append(code_node("fold", "Fold the turn into session state", TURN_FOLD_CODE, 1820, 160,
                       [pin("state", "state", "object"), pin("clean_reply", "clean_reply", "string"),
                        pin("stimulus", "stimulus", "string"),
                        pin("episode_record_ids", "episode_record_ids", "array"),
                        pin("tend_result", "tend_result", "object"),
                        pin("tools_ran", "tools_ran", "array"),
                        pin("guard_died", "guard_died", "number"),
                        pin("guard_error", "guard_error", "string"),
                        pin("ended_silent", "ended_silent", "number")]))

    N.append(end_node("Moment ends", [
        pin("reply", "reply", "string"),
        pin("state", "state", "object"),
        pin("done", "done", "boolean"),
        pin("tools_ran", "tools_ran", "array"),
        pin("tool_rounds", "tool_rounds", "number"),
        pin("degraded", "degraded", "number"),
        pin("moment_error", "moment_error", "string"),
    ], 2080, 300))

    # Execution spine (effect/if nodes only; code nodes are pure/lazy).
    E.append(edge("start", "exec-out", "recall", "exec-in"))
    E.append(edge("recall", "exec-out", "reach", "exec-in"))
    E.append(edge("reach", "exec-out", "grant", "exec-in"))
    E.append(edge("grant", "exec-out", "turn", "exec-in"))
    E.append(edge("turn", "exec-out", "rounds_guard", "exec-in"))
    E.append(edge("rounds_guard", "exec-out", "if_feel", "exec-in"))
    E.append(edge("if_feel", "true", "feel", "exec-in"))
    E.append(edge("if_feel", "false", "deposit", "exec-in"))
    E.append(edge("feel", "exec-out", "deposit", "exec-in"))
    E.append(edge("deposit", "exec-out", "episode", "exec-in"))
    E.append(edge("episode", "exec-out", "if_tend", "exec-in"))
    E.append(edge("if_tend", "true", "tend", "exec-in"))
    E.append(edge("if_tend", "false", "end", "exec-in"))
    E.append(edge("tend", "exec-out", "end", "exec-in"))

    # Data.
    E.append(edge("start", "state", "setup", "state"))
    E.append(edge("start", "phase", "setup", "phase"))
    E.append(edge("start", "stimulus", "setup", "stimulus"))

    E.append(edge("setup", "cue_text", "recall", "cue_text"))
    E.append(edge("setup", "turn_id", "recall", "turn_id"))
    E.append(edge("start", "participants", "recall", "participants"))

    E.append(edge("recall", "handles", "shelf", "handles"))
    E.append(edge("reach", "hits", "shelf", "probe_hits"))
    E.append(edge("setup", "cue_text", "reach", "cue"))
    E.append(edge("setup", "probe_effort", "reach", "effort"))
    E.append(edge("setup", "stimulus", "shelf", "stimulus"))
    E.append(edge("setup", "phase", "shelf", "phase"))
    E.append(edge("start", "task", "shelf", "task"))
    E.append(edge("setup", "state", "shelf", "state"))
    E.append(edge("grant", "tools", "shelf", "tool_names"))
    E.append(edge("start", "participants", "shelf", "participants"))

    E.append(edge("setup", "phase", "grant", "phase"))
    E.append(edge("shelf", "prompt", "rounds_in", "prompt"))
    E.append(edge("start", "system", "rounds_in", "system"))
    E.append(edge("setup", "turn_id", "rounds_in", "turn_id"))
    E.append(edge("setup", "phase", "rounds_in", "phase"))
    E.append(edge("grant", "specs", "rounds_in", "specs"))
    E.append(edge("start", "provider", "rounds_in", "provider"))
    E.append(edge("start", "model", "rounds_in", "model"))
    E.append(edge("rounds_in", "result", "turn", "input"))

    E.append(edge("turn", "output", "reply_r", "object"))
    E.append(edge("turn", "output", "ran_r", "object"))
    E.append(edge("turn", "output", "rounds_r", "object"))
    E.append(edge("turn", "output", "words_r", "object"))
    E.append(edge("turn", "output", "silent_r", "object"))
    E.append(edge("reply_r", "value", "rounds_guard", "value"))
    E.append(edge("turn", "child_output", "rounds_guard", "child"))
    E.append(edge("rounds_guard", "value", "elections", "reply"))
    E.append(edge("words_r", "value", "elections", "prior_words"))
    E.append(edge("setup", "phase", "elections", "phase"))

    E.append(edge("elections", "has_feel", "if_feel", "condition"))
    E.append(edge("elections", "feel_target", "feel", "target_id"))
    E.append(edge("elections", "feel_sign", "feel", "sign"))
    E.append(edge("elections", "feel_magnitude", "feel", "magnitude"))
    E.append(edge("elections", "feel_reason", "feel", "reason"))
    E.append(edge("setup", "turn_id", "feel", "turn_id"))

    E.append(edge("elections", "has_tend", "if_tend", "condition"))
    E.append(edge("elections", "tend_body", "tend", "body"))
    # Feedback carry (adversary K, P2-2): the tend result folds into session
    # state so the NEXT turn's shelf shows applied/refused. When if_tend
    # routes false the pin resolves empty and the fold clears the carry.
    E.append(edge("tend", "result", "fold", "tend_result"))

    E.append(edge("recall", "trace_id", "deposit", "trace_id"))
    E.append(edge("shelf", "used_record_ids", "deposit", "used_record_ids"))

    E.append(edge("setup", "stimulus", "episode_prep", "stimulus"))
    E.append(edge("elections", "clean_reply", "episode_prep", "clean_reply"))
    E.append(edge("setup", "phase", "episode_prep", "phase"))
    E.append(edge("setup", "turn_id", "episode_prep", "turn_id"))
    E.append(edge("start", "participants", "episode_prep", "participants"))

    E.append(edge("episode_prep", "records", "episode", "records"))
    E.append(edge("setup", "turn_id", "episode", "turn_id"))

    E.append(edge("setup", "state", "fold", "state"))
    E.append(edge("elections", "clean_reply", "fold", "clean_reply"))
    E.append(edge("setup", "stimulus", "fold", "stimulus"))
    E.append(edge("episode", "record_ids", "fold", "episode_record_ids"))
    E.append(edge("ran_r", "value", "fold", "tools_ran"))
    E.append(edge("rounds_guard", "died", "fold", "guard_died"))
    E.append(edge("rounds_guard", "error", "fold", "guard_error"))
    E.append(edge("silent_r", "value", "fold", "ended_silent"))

    E.append(edge("fold", "reply", "end", "reply"))
    E.append(edge("fold", "state", "end", "state"))
    E.append(edge("fold", "done", "end", "done"))
    E.append(edge("ran_r", "value", "end", "tools_ran"))
    E.append(edge("rounds_r", "value", "end", "tool_rounds"))
    E.append(edge("fold", "degraded", "end", "degraded"))
    E.append(edge("fold", "moment_error", "end", "moment_error"))

    return f


def build_tool_rounds() -> dict:
    """LEVEL 3.5 — the acting half of one lived moment (0.0.10).

    One llm node inside a bounded while (the ReAct-from-primitives
    precedent): the mind sees the shelf prompt + the phase's granted tools
    declared NATIVELY; each returned batch executes under the grant
    (entity_tools_execute — the runtime re-resolves the grant at execution, this
    flow can never widen it); results fold back into the prompt; the FINAL
    allowed call declares no tools so the moment must end in words
    (speak-now precedent). tools_ran is host-authored from executed batches
    — never parsed from reply prose (marker-imitation lesson)."""
    f = base_flow(ROUNDS_ID, "Entity — Tool Rounds (the mind acts)",
                  "The acting half of a lived moment: the mind may call its "
                  "granted tools (declared natively); each batch runs under the "
                  "grant; results return before the answer; the final round "
                  "must answer in words. Bounded (max_rounds, default 3).")
    N = f["nodes"]
    E = f["edges"]

    N.append(start_node("The moment may act", [
        pin("prompt", "prompt", "string"),
        pin("system", "system", "string"),
        pin("turn_id", "turn_id", "string"),
        pin("phase", "phase", "string"),
        pin("specs", "specs", "array"),
        pin("provider", "provider", "string"),
        pin("model", "model", "string"),
        pin("max_rounds", "max_rounds", "number"),
        pin("turn_budget", "turn_budget", "number"),
    ], 80, 300, pin_defaults={"specs": [], "max_rounds": 3, "turn_budget": 20}))

    N.append(code_node("init", "The rounds begin", ROUNDS_INIT_CODE, 360, 140,
                       [pin("prompt", "prompt", "string"),
                        pin("max_rounds", "max_rounds", "number"),
                        pin("turn_budget", "turn_budget", "number")]))
    N.append(set_var("seed", "Seed the rounds state", "tr_state", 360, 300))
    N.append(get_var("cur", "tr_state", {}, 620, 80))
    N.append(code_node("cond", "Words yet?", ROUNDS_COND_CODE, 620, 180,
                       [pin("state", "state", "object")]))
    N.append(while_node("rounds", "TOOL ROUNDS", 620, 300))

    N.append(code_node("view", "What this round sees", ROUNDS_VIEW_CODE, 880, 80,
                       [pin("state", "state", "object"), pin("specs", "specs", "array"),
                        pin("max_rounds", "max_rounds", "number"),
                        pin("turn_budget", "turn_budget", "number")]))
    act_llm = llm_node("act", "The mind acts", 880, 300, pin_defaults={"temperature": 0.7})
    # turn_id rides the LLM payload: the entity runtime's diary-capture wrap
    # (G1) needs it to make elected book writes replay-safe.
    act_llm["data"]["inputs"].append(pin("turn_id", "turn_id", "string"))
    N.append(act_llm)

    N.append(code_node("route", "Act or resolve?", ROUNDS_ROUTE_CODE, 1140, 80,
                       [pin("tool_calls", "tool_calls", "array"),
                        pin("state", "state", "object"),
                        pin("max_rounds", "max_rounds", "number"),
                        pin("turn_budget", "turn_budget", "number")]))
    N.append(if_node("if_act", "tools called?", 1140, 300))
    N.append(entity_tools_execute_node("run_tools", "The granted tools run", 1400, 200))
    N.append(code_node("fold_tools", "Results return to the mind", ROUNDS_FOLD_TOOLS_CODE, 1660, 80,
                       [pin("state", "state", "object"),
                        pin("results_message", "results_message", "string"),
                        pin("markers", "markers", "array"),
                        pin("ran", "ran", "array"),
                        pin("results", "results", "array"),
                        pin("content", "content", "string"),
                        pin("max_rounds", "max_rounds", "number")]))
    N.append(set_var("keep_tools", "Carry the acted round", "tr_state", 1660, 200))
    N.append(code_node("fold_final", "The moment resolves in words", ROUNDS_FOLD_FINAL_CODE, 1400, 480,
                       [pin("state", "state", "object"), pin("reply", "reply", "string")]))
    N.append(set_var("keep_final", "Carry the words", "tr_state", 1660, 480))

    N.append(code_node("result", "The rounds report", ROUNDS_RESULT_CODE, 880, 560,
                       [pin("state", "state", "object")]))
    N.append(end_node("Acted and answered", [
        pin("reply", "reply", "string"),
        pin("tools_ran", "tools_ran", "array"),
        pin("rounds_used", "rounds_used", "number"),
        pin("prior_words", "prior_words", "string"),
        pin("silent", "silent", "number"),
    ], 620, 560))

    # Spine: seed -> while(cond) -> [llm -> if -> exec -> keep | keep] -> done.
    E.append(edge("start", "exec-out", "seed", "exec-in"))
    E.append(edge("seed", "exec-out", "rounds", "exec-in"))
    E.append(edge("rounds", "loop", "act", "exec-in"))
    E.append(edge("act", "exec-out", "if_act", "exec-in"))
    E.append(edge("if_act", "true", "run_tools", "exec-in"))
    E.append(edge("run_tools", "exec-out", "keep_tools", "exec-in"))
    E.append(edge("if_act", "false", "keep_final", "exec-in"))
    E.append(edge("rounds", "done", "end", "exec-in"))

    # Data.
    E.append(edge("start", "prompt", "init", "prompt"))
    E.append(edge("start", "max_rounds", "init", "max_rounds"))
    E.append(edge("start", "turn_budget", "init", "turn_budget"))
    E.append(edge("init", "state", "seed", "value"))
    E.append(edge("cur", "value", "cond", "state"))
    E.append(edge("cond", "go", "rounds", "condition"))

    E.append(edge("cur", "value", "view", "state"))
    E.append(edge("start", "specs", "view", "specs"))
    E.append(edge("init", "max_rounds", "view", "max_rounds"))
    E.append(edge("init", "turn_budget", "view", "turn_budget"))
    E.append(edge("view", "prompt", "act", "prompt"))
    E.append(edge("view", "tools", "act", "tools"))
    E.append(edge("start", "system", "act", "system"))
    E.append(edge("start", "turn_id", "act", "turn_id"))
    E.append(edge("start", "provider", "act", "provider"))
    E.append(edge("start", "model", "act", "model"))

    E.append(edge("act", "tool_calls", "route", "tool_calls"))
    E.append(edge("cur", "value", "route", "state"))
    E.append(edge("init", "max_rounds", "route", "max_rounds"))
    E.append(edge("init", "turn_budget", "route", "turn_budget"))
    E.append(edge("route", "act", "if_act", "condition"))

    E.append(edge("act", "tool_calls", "run_tools", "tool_calls"))
    E.append(edge("start", "phase", "run_tools", "phase"))
    # The batch cap threads the REMAINING turn budget (ruled 20/turn,
    # runtime c5319) — the runtime clamp above it means a stale mirror can
    # only under-spend.
    E.append(edge("view", "batch_cap", "run_tools", "max_calls"))

    E.append(edge("cur", "value", "fold_tools", "state"))
    E.append(edge("run_tools", "results_message", "fold_tools", "results_message"))
    E.append(edge("run_tools", "markers", "fold_tools", "markers"))
    E.append(edge("run_tools", "tools_ran", "fold_tools", "ran"))
    E.append(edge("run_tools", "results", "fold_tools", "results"))
    E.append(edge("act", "response", "fold_tools", "content"))
    E.append(edge("init", "max_rounds", "fold_tools", "max_rounds"))
    E.append(edge("fold_tools", "state", "keep_tools", "value"))

    E.append(edge("cur", "value", "fold_final", "state"))
    E.append(edge("act", "response", "fold_final", "reply"))
    E.append(edge("fold_final", "state", "keep_final", "value"))

    E.append(edge("cur", "value", "result", "state"))
    E.append(edge("result", "reply", "end", "reply"))
    E.append(edge("result", "tools_ran", "end", "tools_ran"))
    E.append(edge("result", "rounds_used", "end", "rounds_used"))
    E.append(edge("result", "prior_words", "end", "prior_words"))
    E.append(edge("result", "silent", "end", "silent"))

    return f


def build_session_close() -> dict:
    """The close: summary forms + the deterministic end-of-session diary note."""
    f = base_flow(CLOSE_ID, "Entity — Session Close",
                  "The close of a session: the summary record forms, and the diary "
                  "receives its DETERMINISTIC end-of-session note (the conscious "
                  "history never skips a day).")
    N = f["nodes"]
    E = f["edges"]

    N.append(start_node("Close begins", [
        pin("state", "state", "object"),
        pin("phase", "phase", "string"),
        pin("reason", "reason", "string"),
    ], 80, 260, pin_defaults={"reason": "session end"}))

    N.append(code_node("prep", "Shape summary + diary note", CLOSE_PREP_CODE, 400, 120,
                       [pin("state", "state", "object"), pin("phase", "phase", "string"),
                        pin("reason", "reason", "string")]))

    N.append(memory_form_node("summary", "The session summary forms", 400, 320,
                              pin_defaults={"scope": "life"}))
    # digest_method stamps the MACHINE-worded close note (runtime c5271 —
    # the projection carries it, closing the bridge-guard hole where
    # deterministic close notes stayed vector-bridgeable; adversary J P2-2).
    # Entity-elected diary words (the G1 fence lane) never carry it.
    N.append(diary_write_node("diary", "The deterministic diary note", 720, 320,
                              pin_defaults={"kind": "note", "visibility": "self",
                                            "digest_method": "mechanical-flow-v1"}))

    N.append(end_node("Closed", [
        pin("summary_record_ids", "summary_record_ids", "array"),
        pin("diary_entry_id", "diary_entry_id", "string"),
        pin("turns", "turns", "number"),
        pin("state", "state", "object"),
    ], 1040, 320))

    # Diary FIRST (the ruled never-skip invariant), summary second: a cancel
    # between the two leaves diary-without-summary — the safer partial.
    E.append(edge("start", "exec-out", "diary", "exec-in"))
    E.append(edge("diary", "exec-out", "summary", "exec-in"))
    E.append(edge("summary", "exec-out", "end", "exec-in"))

    E.append(edge("start", "state", "prep", "state"))
    E.append(edge("start", "phase", "prep", "phase"))
    E.append(edge("start", "reason", "prep", "reason"))

    E.append(edge("prep", "summary_records", "summary", "records"))
    E.append(edge("prep", "close_turn_id", "summary", "turn_id"))

    E.append(edge("prep", "diary_text", "diary", "text"))
    E.append(edge("prep", "close_turn_id", "diary", "turn_id"))

    E.append(edge("summary", "record_ids", "end", "summary_record_ids"))
    E.append(edge("diary", "entry_id", "end", "diary_entry_id"))
    E.append(edge("prep", "turns", "end", "turns"))
    E.append(edge("start", "state", "end", "state"))

    return f


def build_goodbye() -> dict:
    """The summonable goodbye (adversary C, R2): drawer conversations are
    summon-per-prompt and never ran a close — 26 summons, 0 closes, so no
    summary, no deterministic diary note, no reflection ever formed for
    them. This wrapper gives chat clients a CLOSE they can summon with the
    same session id: the durable session history seeds the turn log
    (use_session_history -> context.messages, the CHAT_STATE fold), then
    the real entity-session-close runs. An empty session closes honestly
    ("0 turns" is an observation, never an error)."""
    f = base_flow(GOODBYE_ID, "Entity Goodbye (close the conversation)",
                  "The chat-client goodbye: fold the durable session history "
                  "into the turn log, then run the session close (summary + "
                  "the deterministic diary note). Summon it with the SAME "
                  "session_id as the conversation, use_session_history=true.",
                  interfaces=[AGENT_INTERFACE])
    N = f["nodes"]
    E = f["edges"]

    N.append(start_node("The visitor leaves", [
        pin("prompt", "prompt", "string"),
        pin("reason", "reason", "string"),
        pin("state", "state", "object"),
    ], 80, 260, pin_defaults={"reason": "the visitor left", "prompt": ""}))

    N.append(get_var("ctx_var", "context", {}, 200, 100))
    N.append(code_node("chat_state", "Session history folds", CHAT_STATE_CODE, 400, 100,
                       [pin("state", "state", "object"), pin("context", "context", "object")]))
    N.append(make_obj("close_in", "Compose the close", [
        ("state", "object"), ("reason", "string"),
    ], 640, 100, pin_defaults={"phase": "visit"}))
    N.append(subflow_node("close", "CLOSE — summary + diary note", CLOSE_ID, 640, 260))
    N.append(get_node("turns_out", "turns", 0, 940, 100))
    N.append(get_node("entry_out", "diary_entry_id", "", 940, 200))
    # agent.v1 consumers read answer/response — the close reports itself.
    N.append(code_node("close_word", "The close reports", GOODBYE_WORD_CODE, 940, 460,
                       [pin("turns", "turns", "number"), pin("reason", "reason", "string")]))
    N.append(end_node("Closed", [
        pin("answer", "answer", "string"),
        pin("response", "response", "string"),
        pin("turns", "turns", "number"),
        pin("diary_entry_id", "diary_entry_id", "string"),
    ], 940, 320))

    E.append(edge("start", "exec-out", "close", "exec-in"))
    E.append(edge("close", "exec-out", "end", "exec-in"))

    E.append(edge("start", "state", "chat_state", "state"))
    E.append(edge("ctx_var", "value", "chat_state", "context"))
    E.append(edge("chat_state", "state", "close_in", "state"))
    E.append(edge("start", "reason", "close_in", "reason"))
    E.append(edge("close_in", "result", "close", "input"))

    E.append(edge("close", "output", "turns_out", "object"))
    E.append(edge("close", "output", "entry_out", "object"))
    E.append(edge("turns_out", "value", "close_word", "turns"))
    E.append(edge("start", "reason", "close_word", "reason"))
    E.append(edge("close_word", "answer", "end", "answer"))
    E.append(edge("close_word", "answer", "end", "response"))
    E.append(edge("turns_out", "value", "end", "turns"))
    E.append(edge("entry_out", "value", "end", "diary_entry_id"))

    return f


# ---------------------------------------------------------------------------
# LEVEL 2 builders
# ---------------------------------------------------------------------------


def build_day_gate() -> dict:
    """THE DAY GATE: pure decision over the master-supplied inbox + state."""
    f = base_flow(GATE_ID, "Entity — The Day Gate",
                  "What does this moment call for? The MASTER hands in its durable "
                  "inbox + life state; the gate drains by cursor and decides: stop > "
                  "close-the-open-visit > visit > work > granted personal > the "
                  "maintenance nap > park. One mailbox, one consumer.")
    N = f["nodes"]
    E = f["edges"]

    N.append(start_node("Gate consult", [
        pin("state", "state", "object"),
        pin("inbox", "inbox", "array"),
    ], 80, 240))
    N.append(code_node("gate", "THE DAY GATE (stop > close > visit > work > personal > sleep)",
                       GATE_CODE, 400, 240,
                       [pin("state", "state", "object"), pin("inbox", "inbox", "array")]))
    N.append(end_node("Decision", [
        pin("phase", "phase", "string"),
        pin("visitor_message", "visitor_message", "string"),
        pin("task", "task", "string"),
        pin("stop", "stop", "boolean"),
        pin("state", "state", "object"),
    ], 720, 240))

    E.append(edge("start", "exec-out", "end", "exec-in"))

    E.append(edge("start", "state", "gate", "state"))
    E.append(edge("start", "inbox", "gate", "inbox"))

    E.append(edge("gate", "phase", "end", "phase"))
    E.append(edge("gate", "visitor_message", "end", "visitor_message"))
    E.append(edge("gate", "task", "end", "task"))
    E.append(edge("gate", "stop", "end", "stop"))
    E.append(edge("gate", "state", "end", "state"))

    return f


def build_visit() -> dict:
    """A conversational moment: ONE cognition turn, answered to the user.
    The conversation session accrues in the life state (the master routes
    each visitor message here as one visit day; goodbye closes the session)."""
    f = base_flow(VISIT_ID, "Entity — Visit (a conversational moment)",
                  "Someone speaks. ONE cognition turn for the message, answered to "
                  "the user; the session log accrues in the life state. The master's "
                  "gate closes the session (summary + diary) on goodbye.")
    N = f["nodes"]
    E = f["edges"]

    N.append(start_node("The visitor speaks", [
        pin("message", "message", "string"),
        pin("state", "state", "object"),
        pin("system", "system", "string"),
        pin("provider", "provider", "string"),
        pin("model", "model", "string"),
        pin("participants", "participants", "array"),
    ], 80, 300, pin_defaults={"participants": []}))

    N.append(make_obj("turn_in", "Compose the moment", [
        ("stimulus", "string"), ("state", "object"), ("system", "string"),
        ("provider", "string"), ("model", "string"),
        ("participants", "array"),
    ], 360, 120, pin_defaults={"phase": "visit"}))
    N.append(subflow_node("turn", "Cognition Turn", TURN_ID, 360, 300))
    N.append(get_node("reply_out", "reply", "", 660, 60))
    N.append(get_node("tools_out", "tools_ran", [], 660, 500))
    N.append(get_node("rounds_out", "tool_rounds", 0, 660, 620))
    N.append(guard_node("turn_guard", "The moment must have lived", 660, 180))
    N.append(answer_node("answer", "The entity answers", 660, 300))
    N.append(get_node("state_out", "state", {}, 940, 60))
    # PURE state guard (W2-1): a dead turn must hand back the INCOMING state,
    # never {} — the master folds this into life_state.
    N.append(code_node("state_guard", "State survives a dead moment", GUARD_CODE, 940, 180,
                       [pin("value", "value", "any"), pin("child", "child", "object"),
                        pin("fallback", "fallback", "any")]))
    # Two degradation signals fold (fix adversary P0-1): the turn CHILD dying
    # (guard) OR the turn itself reporting a degraded moment (dead rounds /
    # ended-without-words) — same shape the chat layer already uses.
    N.append(code_node("deg_fold", "Degradation folds (turn + guard)", CHAT_DEGRADED_CODE, 940, 500,
                       [pin("visit_out", "visit_out", "object"),
                        pin("guard_died", "guard_died", "number"),
                        pin("guard_error", "guard_error", "string")]))
    # D3 (wave-3 adversary B): the output surface must distinguish "the entity
    # said nothing" from "the turn died" — degraded rides beside the reply.
    N.append(end_node("Moment answered", [
        pin("state", "state", "object"),
        pin("reply", "reply", "string"),
        pin("degraded", "degraded", "number"),
        pin("moment_error", "moment_error", "string"),
        pin("tools_ran", "tools_ran", "array"),
        pin("tool_rounds", "tool_rounds", "number"),
    ], 940, 300))

    E.append(edge("start", "exec-out", "turn", "exec-in"))
    E.append(edge("turn", "exec-out", "turn_guard", "exec-in"))
    E.append(edge("turn_guard", "exec-out", "answer", "exec-in"))
    E.append(edge("answer", "exec-out", "end", "exec-in"))

    E.append(edge("start", "message", "turn_in", "stimulus"))
    E.append(edge("start", "state", "turn_in", "state"))
    E.append(edge("start", "system", "turn_in", "system"))
    E.append(edge("start", "provider", "turn_in", "provider"))
    E.append(edge("start", "model", "turn_in", "model"))
    E.append(edge("start", "participants", "turn_in", "participants"))
    E.append(edge("turn_in", "result", "turn", "input"))

    E.append(edge("turn", "output", "reply_out", "object"))
    E.append(edge("reply_out", "value", "turn_guard", "value"))
    E.append(edge("turn", "child_output", "turn_guard", "child"))
    E.append(edge("turn_guard", "value", "answer", "message"))
    E.append(edge("turn", "output", "state_out", "object"))
    E.append(edge("state_out", "value", "state_guard", "value"))
    E.append(edge("turn", "child_output", "state_guard", "child"))
    E.append(edge("start", "state", "state_guard", "fallback"))
    E.append(edge("state_guard", "value", "end", "state"))
    E.append(edge("turn_guard", "value", "end", "reply"))
    E.append(edge("turn", "output", "deg_fold", "visit_out"))
    E.append(edge("turn_guard", "died", "deg_fold", "guard_died"))
    E.append(edge("turn_guard", "error", "deg_fold", "guard_error"))
    E.append(edge("deg_fold", "degraded", "end", "degraded"))
    E.append(edge("deg_fold", "moment_error", "end", "moment_error"))
    E.append(edge("turn", "output", "tools_out", "object"))
    E.append(edge("tools_out", "value", "end", "tools_ran"))
    E.append(edge("turn", "output", "rounds_out", "object"))
    E.append(edge("rounds_out", "value", "end", "tool_rounds"))

    return f


def build_work() -> dict:
    """The task: cognition turns until DONE or the tick budget; then the close."""
    f = base_flow(WORK_ID, "Entity — Work (the task)",
                  "The entity works the given task in bounded cognition turns until "
                  "it declares DONE (or the tick budget spends), then closes the "
                  "session reflectively. Completed work is the road to sleep.")
    N = f["nodes"]
    E = f["edges"]

    N.append(start_node("Work opens", [
        pin("task", "task", "string"),
        pin("state", "state", "object"),
        pin("system", "system", "string"),
        pin("provider", "provider", "string"),
        pin("model", "model", "string"),
        pin("max_ticks", "max_ticks", "number"),
        pin("participants", "participants", "array"),
    ], 80, 300, pin_defaults={"max_ticks": 12, "participants": []}))

    N.append(set_var("state_init", "Session state", "work_state", 380, 300))
    N.append(while_node("loop", "While the task lives", 640, 300))

    N.append(get_var("state_for_cond", "work_state", {}, 400, 620))
    N.append(code_node("wcond", "Task done or budget spent?", WORK_COND_CODE, 640, 620,
                       [pin("state", "state", "object"), pin("max_ticks", "max_ticks", "number")]))

    N.append(get_var("state_cur", "work_state", {}, 700, 60))
    N.append(make_obj("turn_in", "Compose the moment", [
        ("stimulus", "string"), ("task", "string"), ("state", "object"),
        ("system", "string"), ("provider", "string"), ("model", "string"),
        ("participants", "array"),
    ], 940, 60, pin_defaults={"phase": "work"}))
    N.append(subflow_node("turn", "Cognition Turn", TURN_ID, 940, 300))
    N.append(get_node("state_out", "state", {}, 1240, 480))
    N.append(guard_node("turn_guard", "The moment must have lived", 1240, 600))
    N.append(set_var("state_fold", "Fold session state", "work_state", 1240, 300))

    N.append(get_var("state_for_close", "work_state", {}, 640, 900))
    N.append(make_obj("close_in", "Compose the close", [("state", "object")], 900, 900,
                      pin_defaults={"phase": "work", "reason": "the task closed"}))
    N.append(subflow_node("close", "Session Close (summary + diary)", CLOSE_ID, 1160, 900))
    N.append(get_node("turns_out", "turns", 0, 1460, 840))
    N.append(get_node("closed_state", "state", {}, 1460, 1020))
    N.append(end_node("Work closed", [
        pin("state", "state", "object"),
        pin("turns", "turns", "number"),
    ], 1740, 900))

    E.append(edge("start", "exec-out", "state_init", "exec-in"))
    E.append(edge("state_init", "exec-out", "loop", "exec-in"))
    E.append(edge("loop", "loop", "turn", "exec-in"))
    E.append(edge("turn", "exec-out", "turn_guard", "exec-in"))
    E.append(edge("turn_guard", "exec-out", "state_fold", "exec-in"))
    E.append(edge("loop", "done", "close", "exec-in"))
    E.append(edge("close", "exec-out", "end", "exec-in"))

    E.append(edge("start", "state", "state_init", "value"))

    E.append(edge("state_for_cond", "value", "wcond", "state"))
    E.append(edge("start", "max_ticks", "wcond", "max_ticks"))
    E.append(edge("wcond", "condition", "loop", "condition"))

    E.append(edge("start", "task", "turn_in", "stimulus"))
    E.append(edge("start", "task", "turn_in", "task"))
    E.append(edge("state_cur", "value", "turn_in", "state"))
    E.append(edge("start", "system", "turn_in", "system"))
    E.append(edge("start", "provider", "turn_in", "provider"))
    E.append(edge("start", "model", "turn_in", "model"))
    E.append(edge("start", "participants", "turn_in", "participants"))
    E.append(edge("turn_in", "result", "turn", "input"))

    E.append(edge("turn", "output", "state_out", "object"))
    E.append(edge("state_out", "value", "turn_guard", "value"))
    E.append(edge("turn", "child_output", "turn_guard", "child"))
    E.append(edge("state_for_cond", "value", "turn_guard", "fallback"))
    E.append(edge("turn_guard", "value", "state_fold", "value"))

    E.append(edge("state_for_close", "value", "close_in", "state"))
    E.append(edge("close_in", "result", "close", "input"))
    E.append(edge("close", "output", "turns_out", "object"))
    E.append(edge("close", "output", "closed_state", "object"))
    E.append(edge("closed_state", "value", "end", "state"))
    E.append(edge("turns_out", "value", "end", "turns"))

    return f


def build_personal() -> dict:
    """Own time: bounded self-ticks following what is alive; then the close."""
    f = base_flow(PERSONAL_ID, "Entity — Personal (own time)",
                  "Granted own time: the entity ticks itself — explores an interest, "
                  "works an open question, follows what is alive — in bounded turns, "
                  "then closes the day reflectively.")
    N = f["nodes"]
    E = f["edges"]

    N.append(start_node("Own time opens", [
        pin("state", "state", "object"),
        pin("system", "system", "string"),
        pin("provider", "provider", "string"),
        pin("model", "model", "string"),
        pin("max_ticks", "max_ticks", "number"),
        pin("participants", "participants", "array"),
    ], 80, 300, pin_defaults={"max_ticks": 3, "participants": []}))

    N.append(set_var("state_init", "Session state", "personal_state", 380, 300))
    N.append(while_node("loop", "While the day lasts", 640, 300))

    N.append(get_var("state_for_cond", "personal_state", {}, 400, 620))
    N.append(code_node("pcond", "Day budget", PERSONAL_COND_CODE, 640, 620,
                       [pin("state", "state", "object"), pin("max_ticks", "max_ticks", "number")]))

    N.append(life_query_node("drives", "What is alive? (day-open cue)", 640, 60,
                             pin_defaults={"op": "alive_drives", "k": 5}))
    N.append(code_node("drive_cue", "Compose the cue", DRIVE_CUE_CODE, 800, 180,
                       [pin("items", "items", "array")]))
    N.append(get_var("state_cur", "personal_state", {}, 700, 300))
    N.append(make_obj("turn_in", "Compose the moment", [
        ("stimulus", "string"), ("state", "object"), ("system", "string"),
        ("provider", "string"), ("model", "string"),
        ("participants", "array"),
    ], 940, 60, pin_defaults={"phase": "personal"}))
    N.append(subflow_node("turn", "Cognition Turn (self-directed)", TURN_ID, 940, 300))
    N.append(get_node("state_out", "state", {}, 1240, 480))
    N.append(guard_node("turn_guard", "The moment must have lived", 1240, 600))
    N.append(set_var("state_fold", "Fold session state", "personal_state", 1240, 300))

    N.append(get_var("state_for_close", "personal_state", {}, 640, 900))
    N.append(make_obj("close_in", "Compose the close", [("state", "object")], 900, 900,
                      pin_defaults={"phase": "personal", "reason": "own time ended"}))
    N.append(subflow_node("close", "Session Close (summary + diary)", CLOSE_ID, 1160, 900))
    N.append(get_node("turns_out", "turns", 0, 1460, 840))
    N.append(get_node("closed_state", "state", {}, 1460, 1020))
    N.append(end_node("Day closed", [
        pin("state", "state", "object"),
        pin("turns", "turns", "number"),
    ], 1740, 900))

    E.append(edge("start", "exec-out", "drives", "exec-in"))
    E.append(edge("drives", "exec-out", "state_init", "exec-in"))
    E.append(edge("state_init", "exec-out", "loop", "exec-in"))
    E.append(edge("loop", "loop", "turn", "exec-in"))
    E.append(edge("turn", "exec-out", "turn_guard", "exec-in"))
    E.append(edge("turn_guard", "exec-out", "state_fold", "exec-in"))
    E.append(edge("loop", "done", "close", "exec-in"))
    E.append(edge("close", "exec-out", "end", "exec-in"))

    E.append(edge("start", "state", "state_init", "value"))

    E.append(edge("state_for_cond", "value", "pcond", "state"))
    E.append(edge("start", "max_ticks", "pcond", "max_ticks"))
    E.append(edge("pcond", "condition", "loop", "condition"))

    E.append(edge("drives", "items", "drive_cue", "items"))
    E.append(edge("drive_cue", "cue", "turn_in", "stimulus"))
    E.append(edge("state_cur", "value", "turn_in", "state"))
    E.append(edge("start", "system", "turn_in", "system"))
    E.append(edge("start", "provider", "turn_in", "provider"))
    E.append(edge("start", "model", "turn_in", "model"))
    E.append(edge("start", "participants", "turn_in", "participants"))
    E.append(edge("turn_in", "result", "turn", "input"))

    E.append(edge("turn", "output", "state_out", "object"))
    E.append(edge("state_out", "value", "turn_guard", "value"))
    E.append(edge("turn", "child_output", "turn_guard", "child"))
    E.append(edge("state_for_cond", "value", "turn_guard", "fallback"))
    E.append(edge("turn_guard", "value", "state_fold", "value"))

    E.append(edge("state_for_close", "value", "close_in", "state"))
    E.append(edge("close_in", "result", "close", "input"))
    E.append(edge("close", "output", "turns_out", "object"))
    E.append(edge("close", "output", "closed_state", "object"))
    E.append(edge("closed_state", "value", "end", "state"))
    E.append(edge("turns_out", "value", "end", "turns"))

    return f


def build_sleep() -> dict:
    """The night, WIRED: one engine sleep_pass (six phases) + the settlement
    record folding its honest result. Non-runs (lease-held/paused) are valid
    nights, reported as such."""
    f = base_flow(SLEEP_ID, "Entity — Sleep (consolidation night)",
                  "The rest window: the engine's six-phase consolidation runs as ONE "
                  "memory_consolidate call (resolution, maintenance, world models, "
                  "lesson mining, identity review, dream — sleep proposes, waking "
                  "disposes), then the settlement record folds its honest result. "
                  "A non-run (another writer holds the home; operator pause) is a "
                  "valid, honestly-reported night.")
    N = f["nodes"]
    E = f["edges"]

    N.append(start_node("Night falls", [pin("state", "state", "object")], 80, 240))
    night_node = memory_consolidate_node("night", "The engine pass (six phases)", 380, 240,
                                         pin_defaults={"include_dream": True,
                                                       "include_identity": True})
    # continueOnError (adversary A, P1-3): a mid-life engine death (live
    # case: embedder 400 during an LMStudio outage) must fold as a FAILED
    # night in the settlement record, never kill the whole life run.
    night_node["data"]["effectConfig"] = {"continueOnError": True}
    N.append(night_node)
    N.append(code_node("prep", "Fold the night honestly", SLEEP_REPORT_CODE, 680, 120,
                       [pin("state", "state", "object"), pin("night", "night", "object")]))
    marker_node = memory_form_node("marker", "The night settlement forms", 680, 360,
                                   pin_defaults={"scope": "life"})
    # continueOnError (wave-4 adversary E, F2): a store-path outage kills the
    # settlement's OWN formation — the sleep child must still complete; the
    # settle-check fold remembers the gap in state.unsettled_nights and the
    # next healthy settlement names it.
    marker_node["data"]["effectConfig"] = {"continueOnError": True}
    N.append(marker_node)
    N.append(code_node("settle_check", "The gap is remembered (F2)", SETTLE_CHECK_CODE, 1000, 120,
                       [pin("state", "state", "object"),
                        pin("marker_result", "marker_result", "object")]))
    N.append(end_node("Morning", [
        pin("report", "report", "string"),
        pin("state", "state", "object"),
    ], 1000, 360))

    E.append(edge("start", "exec-out", "night", "exec-in"))
    E.append(edge("night", "exec-out", "marker", "exec-in"))
    E.append(edge("marker", "exec-out", "end", "exec-in"))

    E.append(edge("start", "state", "prep", "state"))
    E.append(edge("night", "result", "prep", "night"))
    E.append(edge("prep", "records", "marker", "records"))
    E.append(edge("prep", "turn_id", "marker", "turn_id"))
    E.append(edge("prep", "report", "end", "report"))
    E.append(edge("prep", "state", "settle_check", "state"))
    E.append(edge("marker", "result", "settle_check", "marker_result"))
    E.append(edge("settle_check", "state", "end", "state"))

    return f


# ---------------------------------------------------------------------------
# LEVEL 1 — the master
# ---------------------------------------------------------------------------


def build_master() -> dict:
    """LEVEL 1: the life loop — THE DAY GATE routes each moment to ONE phase."""
    f = base_flow(MASTER_ID, "Entity Life (master)",
                  "The entity's life loop: THE DAY GATE decides what this moment "
                  "calls for (stop > close-the-visit > visit > work > granted "
                  "personal > sleep > park), the phase subflow lives it, and life "
                  "returns to the gate. Every memory act resolves to the entity's "
                  "own home (channel authority). Steer with durable events "
                  "(visit/goodbye/task/grant_personal/stop) on the life mailbox; "
                  "pause/resume/cancel are run-level verbs.")
    N = f["nodes"]
    E = f["edges"]

    # visit_tools/work_tools pins REMOVED in 0.0.10: the grant node inside
    # the cognition turn resolves the phase's tools from the HOME (the one
    # authority) — a caller-supplied tool list was a dead pin at best and a
    # widen-attempt at worst.
    N.append(start_node("Life begins", [
        pin("prompt", "prompt", "string"),
        pin("system", "system", "string"),
        pin("provider", "provider", "string"),
        pin("model", "model", "string"),
        pin("max_days", "max_days", "number"),
        pin("mailbox", "mailbox", "string"),
        pin("participants", "participants", "array"),
    ], 80, 480, pin_defaults={"max_days": 30, "mailbox": "entity-life",
                              "participants": []}))

    N.append(code_node("seed", "Seed: the first visit", SEED_CODE, 380, 200,
                       [pin("prompt", "prompt", "string")]))
    N.append(set_var("sv_mailbox", "Declare the mailbox", "events_mailbox", 380, 480))
    N.append(set_var("sv_inbox", "The durable inbox", "events_inbox", 620, 480))
    N.append(set_var("sv_inbox_seq", "Continue the seq from the seed", "events_inbox_seq", 620, 640))
    N.append(set_var("sv_state", "Life state", "life_state", 860, 480))

    N.append(while_node("life", "While the entity lives", 1120, 480))

    # PURE life condition (volatile get_var keeps it fresh per iteration).
    N.append(get_var("state_for_alive", "life_state", {}, 880, 800))
    N.append(code_node("alive", "Still alive?", LIFE_COND_CODE, 1120, 800,
                       [pin("state", "state", "object"), pin("max_days", "max_days", "number")]))

    # Body: gate -> route -> one phase -> day end.
    N.append(get_var("state_for_gate", "life_state", {}, 1180, 60))
    N.append(get_var("inbox_for_gate", "events_inbox", [], 1180, 220))
    N.append(make_obj("gate_in", "Gate consult", [("state", "object"), ("inbox", "array")], 1420, 140))
    N.append(subflow_node("gate", "THE DAY GATE", GATE_ID, 1420, 480))
    N.append(get_node("g_phase", "phase", "park", 1720, 200))
    N.append(get_node("g_msg", "visitor_message", "", 1720, 360))
    N.append(get_node("g_task", "task", "", 1720, 680))
    N.append(get_node("g_state", "state", {}, 1720, 840))
    N.append(set_var("sv_gate_state", "Fold gate state", "life_state", 1980, 480))
    N.append(set_var("sv_phase", "This moment's phase", "current_phase", 2240, 480))
    N.append(code_node("route", "Which phase?", PHASE_ROUTE_CODE, 2240, 200,
                       [pin("phase", "phase", "string")]))
    # Observation beacon: every gate decision emits entity.phase so external
    # observers (consoles, other agents) subscribe without ledger parsing.
    N.append(node("beacon", "emit_event", "Beacon: entity.phase", 2240, 700,
                  inputs=[EXEC_IN, pin("name", "name", "string"),
                          pin("scope", "scope", "string"),
                          pin("payload", "payload", "any")],
                  outputs=[EXEC_OUT, pin("delivered", "delivered", "number")],
                  pin_defaults={"name": "entity.phase", "scope": "session"}))
    N.append(make_obj("beacon_payload", "Beacon payload", [("phase", "string")], 2000, 700))

    N.append(if_node("if_stop", "stop?", 2500, -60))
    N.append(if_node("if_close", "close the visit?", 2500, 120))
    N.append(if_node("if_visit", "visit?", 2500, 320))
    N.append(if_node("if_work", "work?", 2500, 520))
    N.append(if_node("if_personal", "personal?", 2500, 720))
    N.append(if_node("if_sleep", "sleep?", 2500, 920))

    # CLOSE-VISIT branch (goodbye or a different call while the session is open).
    N.append(get_var("cstate", "life_state", {}, 2780, 40))
    N.append(make_obj("closev_in", "Compose the session close", [("state", "object")], 3020, 40,
                      pin_defaults={"phase": "visit", "reason": "the visitor left"}))
    N.append(subflow_node("close_visit", "CLOSE — the visit session", CLOSE_ID, 3020, 200))
    N.append(get_node("closev_state_out", "state", {}, 3320, 120))
    N.append(set_var("sv_after_close", "Fold closed state", "life_state", 3580, 200))

    # VISIT branch (one conversational moment).
    N.append(get_var("vstate", "life_state", {}, 2780, 320))
    N.append(make_obj("visit_in", "Compose the visit", [
        ("message", "string"), ("state", "object"), ("system", "string"),
        ("provider", "string"), ("model", "string"),
        ("participants", "array"),
    ], 3020, 320))
    N.append(subflow_node("visit", "VISIT — a conversational moment", VISIT_ID, 3020, 480))
    N.append(get_node("visit_state_out", "state", {}, 3320, 400))
    N.append(set_var("sv_after_visit", "Fold visit state", "life_state", 3580, 480))

    # WORK branch.
    N.append(get_var("wstate", "life_state", {}, 2780, 620))
    # participants field REMOVED (adversary A, P1-2): work is a self phase —
    # an unwired field would inject None over the child's [] default.
    N.append(make_obj("work_in", "Compose the work", [
        ("task", "string"), ("state", "object"), ("system", "string"),
        ("provider", "string"), ("model", "string"),
    ], 3020, 620))
    N.append(subflow_node("work", "WORK — the task", WORK_ID, 3020, 780))
    N.append(get_node("work_state_out", "state", {}, 3320, 700))
    N.append(set_var("sv_after_work", "Fold work state", "life_state", 3580, 780))

    # PERSONAL branch.
    N.append(get_var("pstate", "life_state", {}, 2780, 920))
    N.append(make_obj("personal_in", "Compose own time", [
        ("state", "object"), ("system", "string"), ("provider", "string"), ("model", "string"),
    ], 3020, 920))
    N.append(subflow_node("personal", "PERSONAL — own time", PERSONAL_ID, 3020, 1080))
    N.append(get_node("personal_state_out", "state", {}, 3320, 1000))
    N.append(set_var("sv_after_personal", "Fold own-time state", "life_state", 3580, 1080))

    # SLEEP branch.
    N.append(get_var("sstate", "life_state", {}, 2780, 1220))
    N.append(make_obj("sleep_in", "Compose the night", [("state", "object")], 3020, 1220))
    N.append(subflow_node("sleep", "SLEEP — consolidation", SLEEP_ID, 3020, 1380))
    N.append(get_node("sleep_state_out", "state", {}, 3320, 1300))
    N.append(set_var("sv_after_sleep", "Fold night state", "life_state", 3580, 1380))

    # PARK branch (nothing calls): wait for a durable wake event.
    N.append(get_var("mbx", "events_mailbox", "entity-life", 2780, 1520))
    N.append(concat_node("wake_key", "Wake key", 3020, 1520, prefix=EVENT_KEY_PREFIX))
    N.append(wait_event_node("park", "Park (nothing calls; heartbeat re-gate)", 3280, 1520,
                             timeout_s=900))

    # Phase-death guards: a dead phase child must never fold {} into
    # life_state — the fallback is the PRIOR life state (volatile pull).
    N.append(guard_node("guard_close_visit", "close guard", 3460, 120))
    N.append(guard_node("guard_visit", "visit guard", 3460, 400))
    N.append(guard_node("guard_work", "work guard", 3460, 700))
    N.append(guard_node("guard_personal", "personal guard", 3460, 1000))
    N.append(guard_node("guard_sleep", "sleep guard", 3460, 1300))
    N.append(get_var("fb_close_visit", "life_state", {}, 3320, 60))
    N.append(get_var("fb_visit", "life_state", {}, 3320, 340))
    N.append(get_var("fb_work", "life_state", {}, 3320, 640))
    N.append(get_var("fb_personal", "life_state", {}, 3320, 940))
    N.append(get_var("fb_sleep", "life_state", {}, 3320, 1240))

    # Day end: fold the day into life state (single writer via get_var pull).
    N.append(get_var("state_for_dayend", "life_state", {}, 3840, 300))
    N.append(get_var("phase_for_dayend", "current_phase", "park", 3840, 640))
    N.append(code_node("day_end", "The day ends", DAY_END_CODE, 4100, 480,
                       [pin("state", "state", "object"), pin("phase", "phase", "string")]))
    N.append(set_var("sv_day_end", "Fold the day", "life_state", 4380, 480))

    # After the loop: the final close (life parks/stops with a diary note).
    N.append(get_var("state_final", "life_state", {}, 1120, 1200))
    N.append(make_obj("final_in", "Compose the final close", [("state", "object")], 1380, 1200,
                      pin_defaults={"phase": "life", "reason": "the life loop ended"}))
    N.append(subflow_node("final_close", "Life pauses (final diary)", CLOSE_ID, 1640, 1200))
    N.append(get_node("final_state_out", "state", {}, 1940, 1120))
    N.append(end_node("Life parked", [pin("state", "state", "object")], 2220, 1200))

    # Exec spine.
    E.append(edge("start", "exec-out", "sv_mailbox", "exec-in"))
    E.append(edge("sv_mailbox", "exec-out", "sv_inbox", "exec-in"))
    E.append(edge("sv_inbox", "exec-out", "sv_inbox_seq", "exec-in"))
    E.append(edge("sv_inbox_seq", "exec-out", "sv_state", "exec-in"))
    E.append(edge("sv_state", "exec-out", "life", "exec-in"))

    E.append(edge("life", "loop", "gate", "exec-in"))
    E.append(edge("gate", "exec-out", "sv_gate_state", "exec-in"))
    E.append(edge("sv_gate_state", "exec-out", "sv_phase", "exec-in"))
    E.append(edge("sv_phase", "exec-out", "beacon", "exec-in"))
    E.append(edge("beacon", "exec-out", "if_stop", "exec-in"))
    E.append(edge("if_stop", "true", "sv_day_end", "exec-in"))
    E.append(edge("if_stop", "false", "if_close", "exec-in"))
    E.append(edge("if_close", "true", "close_visit", "exec-in"))
    E.append(edge("if_close", "false", "if_visit", "exec-in"))
    E.append(edge("if_visit", "true", "visit", "exec-in"))
    E.append(edge("if_visit", "false", "if_work", "exec-in"))
    E.append(edge("if_work", "true", "work", "exec-in"))
    E.append(edge("if_work", "false", "if_personal", "exec-in"))
    E.append(edge("if_personal", "true", "personal", "exec-in"))
    E.append(edge("if_personal", "false", "if_sleep", "exec-in"))
    E.append(edge("if_sleep", "true", "sleep", "exec-in"))
    E.append(edge("if_sleep", "false", "park", "exec-in"))

    E.append(edge("close_visit", "exec-out", "guard_close_visit", "exec-in"))
    E.append(edge("guard_close_visit", "exec-out", "sv_after_close", "exec-in"))
    E.append(edge("visit", "exec-out", "guard_visit", "exec-in"))
    E.append(edge("guard_visit", "exec-out", "sv_after_visit", "exec-in"))
    E.append(edge("work", "exec-out", "guard_work", "exec-in"))
    E.append(edge("guard_work", "exec-out", "sv_after_work", "exec-in"))
    E.append(edge("personal", "exec-out", "guard_personal", "exec-in"))
    E.append(edge("guard_personal", "exec-out", "sv_after_personal", "exec-in"))
    E.append(edge("sleep", "exec-out", "guard_sleep", "exec-in"))
    E.append(edge("guard_sleep", "exec-out", "sv_after_sleep", "exec-in"))

    E.append(edge("sv_after_close", "exec-out", "sv_day_end", "exec-in"))
    E.append(edge("sv_after_visit", "exec-out", "sv_day_end", "exec-in"))
    E.append(edge("sv_after_work", "exec-out", "sv_day_end", "exec-in"))
    E.append(edge("sv_after_personal", "exec-out", "sv_day_end", "exec-in"))
    E.append(edge("sv_after_sleep", "exec-out", "sv_day_end", "exec-in"))
    E.append(edge("park", "exec-out", "sv_day_end", "exec-in"))

    E.append(edge("life", "done", "final_close", "exec-in"))
    E.append(edge("final_close", "exec-out", "end", "exec-in"))

    # Data.
    E.append(edge("start", "prompt", "seed", "prompt"))
    E.append(edge("start", "mailbox", "sv_mailbox", "value"))
    E.append(edge("seed", "inbox", "sv_inbox", "value"))
    E.append(edge("seed", "inbox_seq", "sv_inbox_seq", "value"))
    E.append(edge("seed", "state", "sv_state", "value"))

    E.append(edge("state_for_alive", "value", "alive", "state"))
    E.append(edge("start", "max_days", "alive", "max_days"))
    E.append(edge("alive", "condition", "life", "condition"))

    E.append(edge("state_for_gate", "value", "gate_in", "state"))
    E.append(edge("inbox_for_gate", "value", "gate_in", "inbox"))
    E.append(edge("gate_in", "result", "gate", "input"))
    E.append(edge("gate", "output", "g_phase", "object"))
    E.append(edge("gate", "output", "g_msg", "object"))
    E.append(edge("gate", "output", "g_task", "object"))
    E.append(edge("gate", "output", "g_state", "object"))
    E.append(edge("g_state", "value", "sv_gate_state", "value"))
    E.append(edge("g_phase", "value", "sv_phase", "value"))
    E.append(edge("g_phase", "value", "route", "phase"))
    E.append(edge("g_phase", "value", "beacon_payload", "phase"))
    E.append(edge("beacon_payload", "result", "beacon", "payload"))

    E.append(edge("route", "is_stop", "if_stop", "condition"))
    E.append(edge("route", "is_close", "if_close", "condition"))
    E.append(edge("route", "is_visit", "if_visit", "condition"))
    E.append(edge("route", "is_work", "if_work", "condition"))
    E.append(edge("route", "is_personal", "if_personal", "condition"))
    E.append(edge("route", "is_sleep", "if_sleep", "condition"))

    E.append(edge("cstate", "value", "closev_in", "state"))
    E.append(edge("closev_in", "result", "close_visit", "input"))
    E.append(edge("close_visit", "output", "closev_state_out", "object"))
    E.append(edge("closev_state_out", "value", "guard_close_visit", "value"))
    E.append(edge("close_visit", "child_output", "guard_close_visit", "child"))
    E.append(edge("fb_close_visit", "value", "guard_close_visit", "fallback"))
    E.append(edge("guard_close_visit", "value", "sv_after_close", "value"))

    E.append(edge("g_msg", "value", "visit_in", "message"))
    E.append(edge("vstate", "value", "visit_in", "state"))
    E.append(edge("start", "system", "visit_in", "system"))
    E.append(edge("start", "provider", "visit_in", "provider"))
    E.append(edge("start", "model", "visit_in", "model"))
    E.append(edge("start", "participants", "visit_in", "participants"))
    E.append(edge("visit_in", "result", "visit", "input"))
    E.append(edge("visit", "output", "visit_state_out", "object"))
    E.append(edge("visit_state_out", "value", "guard_visit", "value"))
    E.append(edge("visit", "child_output", "guard_visit", "child"))
    E.append(edge("fb_visit", "value", "guard_visit", "fallback"))
    E.append(edge("guard_visit", "value", "sv_after_visit", "value"))

    E.append(edge("g_task", "value", "work_in", "task"))
    E.append(edge("wstate", "value", "work_in", "state"))
    E.append(edge("start", "system", "work_in", "system"))
    E.append(edge("start", "provider", "work_in", "provider"))
    E.append(edge("start", "model", "work_in", "model"))
    # NO participants into work (adversary A, P1-2): a work day is a SELF
    # phase — the visitor is not present; stamping them misattributed task
    # episodes into the visitor's world-model card. Subflow default = [].
    E.append(edge("work_in", "result", "work", "input"))
    E.append(edge("work", "output", "work_state_out", "object"))
    E.append(edge("work_state_out", "value", "guard_work", "value"))
    E.append(edge("work", "child_output", "guard_work", "child"))
    E.append(edge("fb_work", "value", "guard_work", "fallback"))
    E.append(edge("guard_work", "value", "sv_after_work", "value"))

    E.append(edge("pstate", "value", "personal_in", "state"))
    E.append(edge("start", "system", "personal_in", "system"))
    E.append(edge("start", "provider", "personal_in", "provider"))
    E.append(edge("start", "model", "personal_in", "model"))
    # NO participants into personal (same rule as work — self phase).
    E.append(edge("personal_in", "result", "personal", "input"))
    E.append(edge("personal", "output", "personal_state_out", "object"))
    E.append(edge("personal_state_out", "value", "guard_personal", "value"))
    E.append(edge("personal", "child_output", "guard_personal", "child"))
    E.append(edge("fb_personal", "value", "guard_personal", "fallback"))
    E.append(edge("guard_personal", "value", "sv_after_personal", "value"))

    E.append(edge("sstate", "value", "sleep_in", "state"))
    E.append(edge("sleep_in", "result", "sleep", "input"))
    E.append(edge("sleep", "output", "sleep_state_out", "object"))
    E.append(edge("sleep_state_out", "value", "guard_sleep", "value"))
    E.append(edge("sleep", "child_output", "guard_sleep", "child"))
    E.append(edge("fb_sleep", "value", "guard_sleep", "fallback"))
    E.append(edge("guard_sleep", "value", "sv_after_sleep", "value"))

    E.append(edge("mbx", "value", "wake_key", "b"))
    E.append(edge("wake_key", "result", "park", "event_key"))

    E.append(edge("state_for_dayend", "value", "day_end", "state"))
    E.append(edge("phase_for_dayend", "value", "day_end", "phase"))
    E.append(edge("day_end", "state", "sv_day_end", "value"))

    E.append(edge("state_final", "value", "final_in", "state"))
    E.append(edge("final_in", "result", "final_close", "input"))
    E.append(edge("final_close", "output", "final_state_out", "object"))
    E.append(edge("final_state_out", "value", "end", "state"))

    return f


# ---------------------------------------------------------------------------
# CHAT wrapper (agent.v1): one visit turn per prompt — the chat-client door.
# ---------------------------------------------------------------------------


def build_chat() -> dict:
    """agent.v1 wrapper: prompt -> ONE visit moment -> answer."""
    f = base_flow(CHAT_ID, "Entity Chat (one visit moment)",
                  "The chat-client door to an entity: each prompt is one visit "
                  "moment (recall -> the lived turn -> elections -> deposits) "
                  "answered back. Run it on an entity runtime (the gateway door "
                  "or open_entity_runtime); on a plain runtime the memory effects "
                  "refuse loudly.",
                  interfaces=[AGENT_INTERFACE])
    N = f["nodes"]
    E = f["edges"]

    N.append(start_node("Prompt arrives", [
        pin("prompt", "prompt", "string"),
        pin("system", "system", "string"),
        pin("provider", "provider", "string"),
        pin("model", "model", "string"),
        pin("state", "state", "object"),
        pin("participants", "participants", "array"),
    ], 80, 260, pin_defaults={"participants": []}))

    N.append(get_var("ctx_var", "context", {}, 200, 100))
    N.append(code_node("chat_state", "Session state (durable history fold)", CHAT_STATE_CODE, 360, 100,
                       [pin("state", "state", "object"), pin("context", "context", "object")]))
    N.append(make_obj("visit_in", "Compose the visit", [
        ("message", "string"), ("state", "object"), ("system", "string"),
        ("provider", "string"), ("model", "string"),
        ("participants", "array"),
    ], 620, 100))
    N.append(subflow_node("visit", "VISIT — a conversational moment", VISIT_ID, 620, 260))
    N.append(get_node("reply_out", "reply", "", 920, 100))
    N.append(get_node("chat_tools_out", "tools_ran", [], 920, 500))
    N.append(get_node("chat_rounds_out", "tool_rounds", 0, 920, 620))
    N.append(guard_node("visit_guard", "The moment must have lived", 920, 220))
    N.append(code_node("degraded_fold", "Degradation is visible (D3)", CHAT_DEGRADED_CODE, 1160, 100,
                       [pin("visit_out", "visit_out", "object"),
                        pin("guard_died", "guard_died", "number"),
                        pin("guard_error", "guard_error", "string")]))
    # `response` mirrors `answer` (adversary F, P2): the documented agent.v1
    # contract reads output.response; both apps fall back to `answer` today,
    # but a strict consumer reading only `response` would get "" — carry both.
    N.append(end_node("Answered", [
        pin("answer", "answer", "string"),
        pin("response", "response", "string"),
        pin("degraded", "degraded", "number"),
        pin("moment_error", "moment_error", "string"),
        pin("tools_ran", "tools_ran", "array"),
        pin("tool_rounds", "tool_rounds", "number"),
    ], 920, 380))

    E.append(edge("start", "exec-out", "visit", "exec-in"))
    E.append(edge("visit", "exec-out", "visit_guard", "exec-in"))
    E.append(edge("visit_guard", "exec-out", "end", "exec-in"))

    E.append(edge("start", "state", "chat_state", "state"))
    E.append(edge("ctx_var", "value", "chat_state", "context"))
    E.append(edge("start", "prompt", "visit_in", "message"))
    E.append(edge("chat_state", "state", "visit_in", "state"))
    E.append(edge("start", "system", "visit_in", "system"))
    E.append(edge("start", "provider", "visit_in", "provider"))
    E.append(edge("start", "model", "visit_in", "model"))
    E.append(edge("start", "participants", "visit_in", "participants"))
    E.append(edge("visit_in", "result", "visit", "input"))

    E.append(edge("visit", "output", "reply_out", "object"))
    E.append(edge("reply_out", "value", "visit_guard", "value"))
    E.append(edge("visit", "child_output", "visit_guard", "child"))
    E.append(edge("visit_guard", "value", "end", "answer"))
    E.append(edge("visit_guard", "value", "end", "response"))
    E.append(edge("visit", "output", "degraded_fold", "visit_out"))
    E.append(edge("visit_guard", "died", "degraded_fold", "guard_died"))
    E.append(edge("visit_guard", "error", "degraded_fold", "guard_error"))
    E.append(edge("degraded_fold", "degraded", "end", "degraded"))
    E.append(edge("degraded_fold", "moment_error", "end", "moment_error"))
    E.append(edge("visit", "output", "chat_tools_out", "object"))
    E.append(edge("chat_tools_out", "value", "end", "tools_ran"))
    E.append(edge("visit", "output", "chat_rounds_out", "object"))
    E.append(edge("chat_rounds_out", "value", "end", "tool_rounds"))

    return f


# ---------------------------------------------------------------------------
# Emit + verify
# ---------------------------------------------------------------------------


def main() -> int:
    flows = {
        MASTER_ID: build_master(),
        GATE_ID: build_day_gate(),
        VISIT_ID: build_visit(),
        WORK_ID: build_work(),
        PERSONAL_ID: build_personal(),
        SLEEP_ID: build_sleep(),
        TURN_ID: build_cognition_turn(),
        ROUNDS_ID: build_tool_rounds(),
        CLOSE_ID: build_session_close(),
        CHAT_ID: build_chat(),
        GOODBYE_ID: build_goodbye(),
    }

    problems: list[str] = []
    for fid, flow in flows.items():
        errs = validate_edges(flow)
        for e in errs:
            problems.append(f"{fid}: {e}")
    if problems:
        print("EDGE AUDIT FAILURES:")
        for p in problems:
            print("  -", p)
        return 1

    for fid, flow in flows.items():
        write_json(OUT / f"{fid}.json", flow)
        print(f"wrote {fid}.json  nodes={len(flow['nodes'])} edges={len(flow['edges'])}")

    compile_check(MASTER_ID, list(flows.keys()))
    print("compile check OK")

    if "--pack" in sys.argv:
        # SETTLED RULE (multiagent-coder manifest lesson): the packer collects
        # flows reachable from root_flow_id AND from every entrypoint. Root at
        # entity-life (reaches all subflows) and list entity-chat as a second
        # entrypoint (it is not called by entity-life, so entrypoint-reach
        # is what brings it in).
        bundle = pack_bundle(
            root_flow_id=MASTER_ID,
            bundle_id=BUNDLE_ID,
            bundle_version=BUNDLE_VERSION,
            entrypoints=[MASTER_ID, CHAT_ID, GOODBYE_ID],
            metadata={
                "title": "Entity Life (the flow brain)",
                "description": "Master life loop + cognition subflows animating a persistent entity (visit/work/personal/sleep). Requires an ENTITY runtime (gateway door stamp routing or open_entity_runtime).",
            },
        )
        print(f"packed {bundle}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
