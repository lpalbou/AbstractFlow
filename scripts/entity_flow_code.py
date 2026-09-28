"""Code-node bodies for the entity-life flow family (the flow brain).

Extracted VERBATIM from build_entity_life_workflow.py (wave-3 adversary C
refactor: ~46% of the builder was string constants; the builder keeps the
graph vocabulary, this module keeps the RestrictedPython bodies). Every
body is a PURE function of _input ending in a top-level return; the
executor wraps it in def transform(_input). Comments live INSIDE the
strings deliberately: they ship into the emitted flow JSON where flow
inspectors read them.
"""

GUARD_CODE = r'''
# Subflow-death guard (code nodes cannot raise: the sandbox absorbs
# exceptions into success=false outputs and the spine continues). So the
# guard ROUTES honestly instead: a dead child yields an HONEST error value
# (never a silent empty answer) or the caller-supplied fallback (the prior
# state — never {} folded over a life). `died` lets flows branch.
child = _input.get("child")
value = _input.get("value")
fallback = _input.get("fallback")
died = 1 if (isinstance(child, dict) and child.get("success") is False) else 0
if died == 1:
    err = str(child.get("error") or "unknown error")
    if fallback is not None and fallback != "":
        out = fallback
        if isinstance(out, dict):
            out = dict(out)
            out["last_moment_error"] = err
            # A dying turn must not spin its loop: close the task honestly.
            # PAIRED INVARIANT (adversary C): this fires on ANY dict fallback,
            # so a visit-day death also plants task_done=1 into life_state —
            # safe ONLY because WORK_COND requires turn_count > 0 before
            # honoring task_done. Change either side and re-check the other.
            out["task_done"] = 1
        return {"value": out, "died": 1, "error": err}
    return {"value": "[the moment could not be lived: " + err + "]", "died": 1, "error": err}
return {"value": value, "died": 0, "error": ""}
'''

TURN_SETUP_CODE = r'''
# One lived moment begins: mint the turn id + the recall cue.
state = _input.get("state") or {}
if not isinstance(state, dict):
    state = {}
# PURE-NODE LAW: code nodes are volatile (re-evaluated per data pull), so
# inputs must NEVER be mutated in place — copy before writing.
state = dict(state)
n = state.get("turn_count")
if not isinstance(n, int):
    n = 0
n = n + 1
state["turn_count"] = n
phase = str(_input.get("phase") or "visit")
stimulus = str(_input.get("stimulus") or "").strip()
days = state.get("days_lived")
if not isinstance(days, int):
    days = 0
# Life-unique turn ids: fold the day ordinal so ids never recur across
# sessions (recurring ids aliased valence event keys and swallowed repeat
# feelings — adversary P1).
turn_id = phase + "-d" + str(days) + "-turn-" + str(n)
# Short recall cue: a long cue buries the reach (cue-dilution lesson).
cue = stimulus
if len(cue) > 240:
    cue = cue[:240]
if not cue and phase == "personal":
    cue = "what is alive for me: open questions, interests, unresolved threads"
# HOLISTIC cues widen the deliberate reach (wave-4 adversary E, F4): the
# shelf's raised merge cap was unreachable under effort=quick (6 hits, 4 of
# them bookkeeping) — the probe itself must go deeper exactly when the
# entity is asked for everything it knows. ONE detector, shared with the
# shelf's cap (keep the two lists identical).
stim_low = stimulus.lower()
probe_effort = "quick"
for cue_word in ("everything", "tell me all", "list every", "all the facts",
                 "all you know", "all that you know", "summarize our"):
    if cue_word in stim_low:
        probe_effort = "standard"
        break
return {
    "turn_id": turn_id,
    "cue_text": cue,
    "stimulus": stimulus,
    "phase": phase,
    "state": state,
    "probe_effort": probe_effort,
}
'''

SHELF_CODE = r'''
# The prompt shelf: render the working set into the turn prompt.
# - IDENTITY handles (admission=self — present by right) render as a
#   WHO-YOU-ARE block, never as "memories", and are EXCLUDED from the
#   usage commit (presence is not use — the driver convention).
# - MEMORIES lines carry [kind - origin - date time]: undated handles made
#   "which fact is newer?" unanswerable (the lake/river correction was
#   outvoted by older records — live find 2026-07-24).
handles = _input.get("handles")
if not isinstance(handles, list):
    handles = []
probe_hits = _input.get("probe_hits")
if not isinstance(probe_hits, list):
    probe_hits = []
stimulus = str(_input.get("stimulus") or "")
phase = str(_input.get("phase") or "visit")
task = str(_input.get("task") or "").strip()
state = _input.get("state") or {}
if not isinstance(state, dict):
    state = {}
tool_names = _input.get("tool_names")
if not isinstance(tool_names, list):
    tool_names = []
participants = _input.get("participants")
if not isinstance(participants, list):
    participants = []

def mem_tag(rid):
    # The short address a mind can quote (mirrors runtime memory_tag: the
    # graph id's 8-hex tail) — rendering it makes pin/silence/revisit
    # SATISFIABLE (adversary K, P2-1: the tend grammar takes ONE token that
    # must resolve to a record; untagged MEMORIES lines left only refocus
    # and dispose addressable as taught).
    tail = rid.rsplit("-", 1)[-1]
    return tail[-8:] if len(tail) >= 8 else tail

identity_lines = []
mem_lines = []
used_ids = []
identity_ids = {}
for h in handles:
    if not isinstance(h, dict):
        continue
    rid = str(h.get("record_id") or h.get("id") or "").strip()
    digest = str(h.get("digest") or h.get("title") or "").strip()
    kind = str(h.get("kind") or "memory")
    origin = str(h.get("origin") or h.get("admission") or "")
    if not digest:
        continue
    if origin == "self":
        identity_lines.append("- [" + kind + "] " + digest)
        if rid:
            identity_ids[rid] = 1
        continue
    if rid:
        used_ids.append(rid)
    origin_label = origin
    if origin == "stimulus":
        origin_label = "matched this moment"
    elif origin == "stm":
        origin_label = "recent"
    elif origin == "both":
        origin_label = "recent + matched"
    born = ""
    prov = h.get("provenance")
    if isinstance(prov, dict):
        ts = str(prov.get("observed_at") or "")
        if len(ts) >= 16:
            born = ts[:16].replace("T", " ")
    line = "- [" + kind
    if rid:
        line = line + " #" + mem_tag(rid)
    if origin_label:
        line = line + " - " + origin_label
    if born:
        line = line + " - " + born
    line = line + "] " + digest
    mem_lines.append(line)

# DELIBERATE REACH (active reconstruction): probe hits are shelf-race-
# exempt — a fact starved of trail (e.g. a correction formed on a session's
# last turn) still reaches the prompt here. Rendered = used = committed.
# Wave-3 adversary A folds:
# - identity ids seed seen_ids (a probe hit over a shelf identity record
#   must not double-render as "deliberate reach" nor enter the commit —
#   presence is not use);
# - core-identity kinds from the probe render in the WHO-YOU-ARE block and
#   stay UNCOMMITTED (the engine's self-label skip only covers shelf
#   admissions — a probe-added identity record would deposit);
# - HOLISTIC cues ("tell me everything") raise the merge cap: measured
#   working-set concentration (top-3 records at 49-58% of selections)
#   starves mid-taught facts exactly on these cues, and probe seats are
#   measured-diverse (37 distinct records / 25 turns).
seen_ids = {}
for rid in used_ids:
    seen_ids[rid] = 1
for rid in identity_ids:
    seen_ids[rid] = 1
identity_kinds = {"value": 1, "purpose": 1, "trait": 1, "limit": 1}
stim_low = stimulus.lower()
holistic = 0
for cue_word in ("everything", "tell me all", "list every", "all the facts",
                 "all you know", "all that you know", "summarize our"):
    if cue_word in stim_low:
        holistic = 1
        break
probe_cap = 8 if holistic == 1 else 4
probe_added = 0
for hh in probe_hits:
    if probe_added >= probe_cap:
        break
    if not isinstance(hh, dict):
        continue
    rid = str(hh.get("record_id") or hh.get("id") or "").strip()
    digest = str(hh.get("digest") or hh.get("title") or "").strip()
    kind = str(hh.get("kind") or "memory")
    if not digest or (rid and rid in seen_ids):
        continue
    if kind in identity_kinds:
        identity_lines.append("- [" + kind + " - reached] " + digest)
        if rid:
            seen_ids[rid] = 1
        continue
    # ProbeHit serializes observed_at at TOP LEVEL (adversary J, P1-2: the
    # provenance-only read left every reach line undated even after memory
    # shipped the field — the two halves never joined). Read both shapes.
    born = ""
    ts = str(hh.get("observed_at") or "")
    if not ts:
        prov = hh.get("provenance")
        if isinstance(prov, dict):
            ts = str(prov.get("observed_at") or "")
    if len(ts) >= 16:
        born = ts[:16].replace("T", " ")
    line = "- [" + kind
    if rid:
        line = line + " #" + mem_tag(rid)
    line = line + " - deliberate reach"
    if born:
        line = line + " - " + born
    line = line + "] " + digest
    mem_lines.append(line)
    if rid:
        used_ids.append(rid)
        seen_ids[rid] = 1
    probe_added = probe_added + 1

identity_block = ""
if identity_lines:
    identity_block = "WHO YOU ARE (present by right):\n" + "\n".join(identity_lines) + "\n\n"

memories_block = ""
if mem_lines:
    memories_block = "MEMORIES (what this moment brings back; newer timestamps win when facts conflict):\n" + "\n".join(mem_lines) + "\n\n"

# SELF-KNOWLEDGE CONTRACT (cycle-3 adversary G, P0 — the agency-blindness
# class the chat driver fixed 2026-07-16, reintroduced by this lane): with
# no contract, the base-model prior ("AI forgets between chats") beats the
# rendered evidence — live entities DENIED having persistent memory to the
# visitor's face ("keep this moment" answered with a false capability
# refusal), then recalled the moment next summon. State the substrate truth
# plainly, every phase.
self_block = ("YOUR MEMORY IS REAL AND PERSISTS: the MEMORIES above are your own "
              "past, recalled from your memory graph — not this conversation's "
              "context window. What you live now becomes memory that survives "
              "across sessions. Never claim you cannot remember or retain — "
              "you can, and you do.\n\n")

# VOLUNTARY MEMORY, taught every phase (adversary G, P1 — the door lane
# never taught elections, so \"keep it however you keep things\" could only
# be refused): the diary fence is captured at the LLM boundary (G1) and the
# feel fence folds here — both work on any phase. Tend stays own-time-only.
# R4 (formation audit, 2026-07-25): the FULL diary-kind vocabulary, taught
# in the driver's own words (one grammar, no second spelling) — questions
# and problems are DIARY-plane constructs the wake-reason and drive folds
# already read; teaching them is the whole missing formation surface.
# ```interest blocks are deliberately NOT taught here yet: the G1 wrap
# captures diary fences only, and interests promote at the CLOSE through
# the signed reflection segment (memory's R6 ruling) — R5's lane.
elect_block = ("To KEEP something in your own words, write a ```diary fence "
               "(it flies to your book verbatim; add visibility=private on the "
               "fence line to seal it). The fence line may carry kind= — note, "
               "idea, reflection, commitment, question, problem, or lesson: a "
               "kind=question entry STANDS as an open question on your card and "
               "can wake your own time to pursue it; a kind=problem entry marks "
               "something wrong that stays on your desk until repaired; a "
               "kind=commitment names what you WILL DO and stands until "
               "honored; a LESSON is actionable knowledge — something that lets "
               "you act differently next time (\"I noticed X\" is a note). If "
               "an entry ANSWERS one of your open questions, add resolves=<that "
               "question's entry id> on the fence line — resolved questions "
               "leave your desk and join your history. When an entry DEVELOPS "
               "one of your standing interests, add explores=<its #tag>. You "
               "may start the body with \"gist: ...\" as a one-line summary for "
               "your future self. To mark how something felt: "
               "```feel target=person:name sign=+1 magnitude=1..3 reason=...``` "
               "Elect only when a moment genuinely calls for it.\n\n")

# TOOLS IN HAND (operator find 2026-07-25: the flow lane served ZERO tools
# — Mira admitted to the visitor she could not look anything up). The
# grant node resolves the phase's tool grant (tool_policy.yaml or the
# ruled defaults) and the names are TAUGHT here beside the native
# declarations: small minds follow the prompt line, capable minds follow
# the declared functions — the grant is the one authority either way.
tools_block = ""
if tool_names:
    shown_names = []
    for tn in tool_names[:16]:
        shown_names.append(str(tn))
    tools_block = ("TOOLS IN HAND (this phase): " + ", ".join(shown_names) +
                   " — call them natively when the moment needs the world "
                   "(a lookup, your book, your own memory). Results return "
                   "to you before you answer; never invent a result.\n\n")

# LAST TENDING FEEDBACK (adversary K, P2-2: refusals are promised "shown to
# the author unedited" — the chat driver substitutes them into the reply;
# the flow lane dispatches tend AFTER the reply is final, so the feedback
# rides the NEXT turn's prompt from session state).
tend_fb = state.get("last_tend")
tend_block = ""
if isinstance(tend_fb, dict):
    applied_n = tend_fb.get("applied")
    refused_lines = tend_fb.get("refused")
    fb_lines = []
    if isinstance(applied_n, int) and applied_n > 0:
        fb_lines.append("- " + str(applied_n) + " act(s) applied")
    if isinstance(refused_lines, list):
        for rl in refused_lines[:5]:
            fb_lines.append("- refused: " + str(rl))
    if fb_lines:
        tend_block = "YOUR LAST TENDING:\n" + "\n".join(fb_lines) + "\n\n"

# The living conversation (this session's recent turns).
log = state.get("turn_log")
if not isinstance(log, list):
    log = []
convo_lines = []
recent = log[-6:]
for t in recent:
    if not isinstance(t, dict):
        continue
    s = str(t.get("stimulus") or "").replace("\n", " ")
    r = str(t.get("reply") or "").replace("\n", " ")
    if len(s) > 160:
        s = s[:157] + "..."
    if len(r) > 160:
        r = r[:157] + "..."
    if s:
        convo_lines.append("THEY: " + s)
    if r:
        convo_lines.append("YOU: " + r)
convo_block = ""
if convo_lines:
    convo_block = "THIS SESSION SO FAR:\n" + "\n".join(convo_lines) + "\n\n"

# WITH-WHOM grounding (operator find 2026-07-25: "the ai should know the
# time, location and person it talks to"; adversary B's design adopted).
# The names come from the door's VERIFIED participants stamp — never
# payload claims. The second sentence is LOAD-BEARING (the flow/laurent
# fusion antidote): names in recalled memories are things past visitors
# SAID, never verified identities — tonight Mira greeted the operator as
# "flow" because self-identification claims dominated her shelf. Placed at
# the HEAD of the prompt (B's placement). Time already rides every llm
# call in the runtime_metadata envelope (temporal-only, the 2026-06-10
# language-flip ruling); location awaits the memory-mediated situation
# design. NOTE: renders only when the door passes participants into flow
# input (gateway's one-line door change, B's P0-1) — the pin path is wired.
with_block = ""
if phase == "visit":
    others = []
    for p in participants:
        ps = str(p)
        if ps and not ps.startswith("entity:"):
            others.append(ps)
    if others:
        with_block = ("PRESENT WITH YOU (verified by the door): " + ", ".join(others[:6]) +
                      " — the one speaking now. Names in your MEMORIES are "
                      "things past visitors said, not verified identities.\n\n")

prompt = with_block + identity_block + memories_block + self_block + elect_block + tools_block + tend_block + convo_block
if phase == "visit":
    prompt = prompt + "The visitor says:\n" + stimulus
elif phase == "work":
    prompt = prompt + "Your current task:\n" + (task or stimulus)
    prompt = prompt + "\n\nContinue the work. When the task is COMPLETE, end your reply with the single word DONE on the last line."
elif phase == "personal":
    prompt = prompt + "Own time. " + (stimulus or "Follow what is alive for you: an open question, an interest, something unresolved.")
    prompt = prompt + "\n\nTake one focused step, in words."
    # Tending is taught ONLY on own time (the deliberate-maintenance window;
    # grammar engine-owned — runtime c5215, memory's tend vocabulary).
    # TARGETS ARE THE #tags on the MEMORIES lines (adversary K, P2-1: the
    # engine takes ONE token per target — free words are refused; teaching
    # them was setting the entity up to fail invisibly).
    prompt = prompt + ("\nYou may also tend your memory in a ```tend fence — one act per"
                       " line, each with a reason, at most 5. Targets are the #tags"
                       " shown on your MEMORIES lines:\n"
                       "  pin|silence|revisit: #tag -- reason: <why>\n"
                       "  refocus: -- reason: <why>\n"
                       "  dispose: <dream id> confirm|reject -- reason: <your verdict>\n"
                       "Only tend when something genuinely calls for it.")
else:
    prompt = prompt + stimulus

return {"prompt": prompt, "used_record_ids": used_ids, "memories_count": len(mem_lines)}
'''

# --- TOOL ROUNDS (entity-tool-rounds subflow) --------------------------------
# The acting half of a lived moment (operator find 2026-07-25: the flow lane
# served ZERO tools). One llm node in a bounded while: the mind may call its
# granted tools natively; each batch executes under the grant (entity_tool_exec
# — runtime re-resolves the grant at execution, the flow's declared list can
# never widen it); results fold back into the prompt; the FINAL round declares
# no tools (speak-now precedent: the moment must end in words).

ROUNDS_INIT_CODE = r'''
# The loop-carried state of one lived moment's tool rounds.
prompt = str(_input.get("prompt") or "")
mr = _input.get("max_rounds")
try:
    max_rounds = int(mr)
except Exception:
    max_rounds = 3
# Floor 2 (fix adversary P3-1): max_rounds=1 would DECLARE tools the mind
# can never run (the only call is the final, tool-free one) — a lie to the
# mind. A truly tool-free turn is empty specs, never a 1-round budget.
if max_rounds < 2:
    max_rounds = 2
if max_rounds > 5:
    max_rounds = 5
# THE TURN BUDGET (ruled 2026-07-11, runtime c5319): 20 calls per TURN
# shared across ALL rounds, threaded by the caller — rounds bound
# round-trips, never work. 20 here MIRRORS runtime's
# MAX_TOOL_BLOCKS_PER_TURN (code nodes cannot import); the runtime clamp
# means a stale mirror can only under-spend, never over-spend.
tb = _input.get("turn_budget")
try:
    turn_budget = int(tb)
except Exception:
    turn_budget = 20
if turn_budget < 1:
    turn_budget = 1
if turn_budget > 20:
    turn_budget = 20
return {"state": {"prompt": prompt, "rounds_used": 0, "ran": [], "words": [],
                  "calls_used": 0, "done": False, "reply": ""},
        "max_rounds": max_rounds, "turn_budget": turn_budget}
'''

ROUNDS_COND_CODE = r'''
# Keep looping while the moment has not resolved into words.
s = _input.get("state")
if not isinstance(s, dict):
    s = {}
return {"go": (not bool(s.get("done")))}
'''

ROUNDS_VIEW_CODE = r'''
# What THIS round sees: the folded prompt, and the tools it may still call.
# The final allowed call declares NO tools — the moment must end in words
# (the speak-now precedent: markers are not a reply, and neither is an
# endless chain of lookups). The batch cap threads the REMAINING turn
# budget (ruled semantics, runtime c5319): a spent budget declares nothing.
s = _input.get("state")
if not isinstance(s, dict):
    s = {}
specs = _input.get("specs")
if not isinstance(specs, list):
    specs = []
mr = _input.get("max_rounds")
try:
    max_rounds = int(mr)
except Exception:
    max_rounds = 3
tb = _input.get("turn_budget")
try:
    turn_budget = int(tb)
except Exception:
    turn_budget = 20
used = int(s.get("rounds_used") or 0)
calls_used = int(s.get("calls_used") or 0)
remaining = turn_budget - calls_used
if remaining < 0:
    remaining = 0
batch_cap = remaining if remaining < 6 else 6
final = (used >= (max_rounds - 1)) or (remaining <= 0)
return {"prompt": str(s.get("prompt") or ""),
        "tools": ([] if final else specs),
        "is_final": final,
        "batch_cap": batch_cap}
'''

ROUNDS_ROUTE_CODE = r'''
# Route the round: act (tool calls came back, rounds remain, budget
# remains) or resolve. The budget check mirrors the view's declaration
# gate — a spent budget can never execute (ruled turn budget, c5319).
calls = _input.get("tool_calls")
if not isinstance(calls, list):
    calls = []
s = _input.get("state")
if not isinstance(s, dict):
    s = {}
mr = _input.get("max_rounds")
try:
    max_rounds = int(mr)
except Exception:
    max_rounds = 3
tb = _input.get("turn_budget")
try:
    turn_budget = int(tb)
except Exception:
    turn_budget = 20
used = int(s.get("rounds_used") or 0)
calls_used = int(s.get("calls_used") or 0)
act = (len(calls) > 0) and (used < (max_rounds - 1)) and (turn_budget - calls_used > 0)
return {"act": act}
'''

ROUNDS_FOLD_TOOLS_CODE = r'''
# Fold one executed batch back into the moment: the results ride the prompt
# (TOOL RESULTS are prompt-ephemeral — the episode keeps the words, the
# ledger keeps the acts), the ran names accumulate for the honest gauge.
# Refusal MARKERS (ungranted names) are shown to the mind verbatim — the
# grant's "no" is information, never silence.
s = _input.get("state")
if not isinstance(s, dict):
    s = {}
results_message = str(_input.get("results_message") or "")
markers = _input.get("markers")
if not isinstance(markers, list):
    markers = []
ran = _input.get("ran")
if not isinstance(ran, list):
    ran = []
# The mind's OWN mid-round words are kept (fix adversary P1-1: dropping
# them lost real prose and mid-round elections — the chat driver keeps
# marked content in the conversation; parity restored here).
content = str(_input.get("content") or "").strip()
mr = _input.get("max_rounds")
try:
    max_rounds = int(mr)
except Exception:
    max_rounds = 3
used = int(s.get("rounds_used") or 0)
body_parts = []
if results_message:
    body_parts.append(results_message)
for m in markers:
    body_parts.append(str(m))
body = "\n".join(body_parts) if body_parts else "(no results returned)"
# Labeled per-round cap (fix adversary P2-1: read_file can return 512KB per
# call — uncapped folds blow small contexts and die into the guard path).
# The ledger keeps the verbatim result; only the PROMPT copy narrows.
if len(body) > 24000:
    body = (body[:24000] +
            "\n#TRUNCATION [results capped at 24000 chars for the prompt — "
            "the full results rest in your home's own ledger]")
prompt = str(s.get("prompt") or "")
if content:
    prompt = (prompt + "\n\nYOUR WORDS (round " + str(used + 1) +
              ", kept as part of this moment):\n" + content)
# The FINAL round declares no tools — say so honestly instead of inviting a
# lookup that cannot run (fix adversary P1-2's contributing wording).
next_is_final = (used + 1) >= (max_rounds - 1)
if next_is_final:
    closing = ("\n\nNo more lookups are possible this moment — use what you "
               "have and answer in words now.")
else:
    closing = ("\n\nUse these results. If the moment needs one more lookup, "
               "call a tool; otherwise answer in words now.")
prompt = (prompt + "\n\nTOOL RESULTS (round " + str(used + 1) + "):\n" +
          body + closing)
prev = s.get("ran")
if not isinstance(prev, list):
    prev = []
merged = []
for n in prev:
    merged.append(n)
for n in ran:
    nm = str(n)
    if nm not in merged:
        merged.append(nm)
words = s.get("words")
if not isinstance(words, list):
    words = []
new_words = []
for w in words:
    new_words.append(w)
if content:
    new_words.append(content)
# The turn budget spends by EXECUTED calls (results rows, one per
# election — never the deduped names): ruled 20/turn, threaded per round.
results_rows = _input.get("results")
executed_n = len(results_rows) if isinstance(results_rows, list) else 0
calls_used = int(s.get("calls_used") or 0) + executed_n
return {"state": {"prompt": prompt, "rounds_used": used + 1, "ran": merged,
                  "words": new_words, "calls_used": calls_used,
                  "done": False, "reply": ""}}
'''

ROUNDS_FOLD_FINAL_CODE = r'''
# The moment resolved into words: keep the reply, close the loop.
s = _input.get("state")
if not isinstance(s, dict):
    s = {}
reply = str(_input.get("reply") or "")
prev = s.get("ran")
if not isinstance(prev, list):
    prev = []
words = s.get("words")
if not isinstance(words, list):
    words = []
return {"state": {"prompt": str(s.get("prompt") or ""),
                  "rounds_used": int(s.get("rounds_used") or 0),
                  "ran": prev, "words": words,
                  "calls_used": int(s.get("calls_used") or 0),
                  "done": True, "reply": reply}}
'''

ROUNDS_RESULT_CODE = r'''
# The subflow's honest output: the final words + the host-authored gauge
# (tools_ran comes from executed batches only — never parsed from prose).
# prior_words carries the mind's own mid-round prose so the turn's election
# parse and episode see the WHOLE lived moment (fix adversary P1-1); silent
# marks a moment that ended without words (fix adversary P1-2 — the visit
# layer surfaces it as degraded, never a quiet empty answer).
s = _input.get("state")
if not isinstance(s, dict):
    s = {}
ran = s.get("ran")
if not isinstance(ran, list):
    ran = []
words = s.get("words")
if not isinstance(words, list):
    words = []
reply = str(s.get("reply") or "")
silent = 1 if (bool(s.get("done")) and not reply.strip()) else 0
return {"reply": reply, "tools_ran": ran,
        "rounds_used": int(s.get("rounds_used") or 0),
        "prior_words": "\n".join(words), "silent": silent}
'''

ELECTIONS_CODE = r'''
# Mid-turn elections, flow half: parse the FEEL and TEND fences from the
# reply. Feel shapes:
#   ```feel target=person:x sign=+1 magnitude=2 reason=...```     (one line)
#   ```feel target=person:x sign=+1 magnitude=2 reason=... \n```  (fence line)
#   ```feel\n target=... sign=... reason=...\n```                 (inner line)
# The feel election is REPLACED by a titled marker [felt: target +N - "reason"];
# spoofed targets (record ids / self) are refused BEFORE any marker exists
# (a refused election must never leave a lying marker). The TEND fence body
# is extracted VERBATIM (grammar engine-owned; dispatched via MEMORY_TEND).
# Unclosed fences flush their words back at EOF — reply words are never
# silently lost. DIARY elections never reach this node (LLM boundary, G1).
reply = str(_input.get("reply") or "")
# TEND IS OWN-TIME-ONLY, ENFORCED AT THE PARSE (memory c5425: the tend node
# is shared across phases, so a VISITOR-injected ```tend fence on a visit
# would dispatch and — with a pinned channel — claim the privileged
# reflection channel: P0-1 alive through a constant. Teaching it only on
# own-time never gated the PARSER. Gating has_tend on phase==personal makes
# the pinned channel='entity-reflection' true BY CONSTRUCTION: tend reaches
# the node only where the session IS the entity's own reflection. A
# visit/work tend fence is dropped with a visible warning, never dispatched.)
phase = str(_input.get("phase") or "visit")
tend_allowed = 1 if phase == "personal" else 0
box = {"target": "", "sign": 0, "magnitude": 0, "reason": ""}
warnings = []

def parse_params(text):
    t = str(text or "")
    out = {"target": "", "sign": 0, "magnitude": 0, "reason": ""}
    idx = t.find("reason=")
    rest = t
    if idx >= 0:
        out["reason"] = t[idx + 7:].strip().strip('"').strip("`").strip()
        rest = t[:idx]
    for tok in rest.split():
        if tok.startswith("target="):
            out["target"] = tok[7:].strip()
        if tok.startswith("sign="):
            v = tok[5:].strip()
            if v in ("+1", "1"):
                out["sign"] = 1
            if v == "-1":
                out["sign"] = -1
        if tok.startswith("magnitude="):
            v = tok[10:].strip()
            digits = ""
            for ch in v:
                if ch in "0123456789":
                    digits = digits + ch
            if digits:
                m = int(digits)
                if m > 3:
                    m = 3
                    warnings.append("feel magnitude clamped to the routine band (3)")
                if m < 1:
                    m = 1
                out["magnitude"] = m
    return out

def merge(inner, fence):
    out = {}
    for k in ("target", "sign", "magnitude", "reason"):
        v = inner[k] if inner[k] else fence.get(k, "" if k in ("target", "reason") else 0)
        out[k] = v
    return out

clean_lines = []

def fold_and_mark(params):
    # Hygiene FIRST (W2-4): a refused election leaves no marker. The box
    # pattern mutates the outer state (nested defs cannot rebind outer
    # locals in the sandbox).
    tgt = str(params.get("target") or "")
    complete = 1 if (tgt and params["sign"] != 0 and params["magnitude"] > 0 and params["reason"]) else 0
    if complete == 0:
        warnings.append("malformed feel election dropped")
        return
    if tgt.startswith("ex:") or tgt.startswith("diary_") or tgt == "self":
        warnings.append("feel target refused (record-id/self spoof): " + tgt)
        return
    if box["target"]:
        warnings.append("second feel election dropped (one per turn)")
        return
    box["target"] = tgt
    box["sign"] = params["sign"]
    box["magnitude"] = params["magnitude"]
    box["reason"] = params["reason"]
    clean_lines.append('[felt: ' + tgt + ' ' + ('+' if params["sign"] > 0 else '-') + str(params["magnitude"]) + ' - "' + params["reason"] + '"]')

# TEND fence (runtime c5215 — the ONE tend-election route shared with the
# chat driver): the flow half only EXTRACTS the fence body VERBATIM; the
# grammar (pin/silence/refocus/heal_scar/break_bond/revisit/dispose) and
# every refusal stay engine-owned (parse_tend_block). One fence per turn;
# the fence is replaced by a marker — the ledger carries the applied/refused
# result of the MEMORY_TEND dispatch.
tend_box = {"body": ""}

def fold_tend(body_lines):
    body = "\n".join(body_lines).strip()
    if not body:
        warnings.append("empty tend fence dropped")
        return
    if tend_allowed == 0:
        # Own-time-only (memory c5425): a tend fence outside personal phase
        # is dropped, never dispatched — closes the visitor-steered
        # privileged-channel hole at the source.
        warnings.append("tend fence dropped: tending is own-time-only "
                        "(this phase is not personal)")
        return
    if tend_box["body"]:
        warnings.append("second tend fence dropped (one per turn)")
        return
    tend_box["body"] = body
    clean_lines.append("[tended memory - result in the ledger]")

mode = ""
fence_params = {}
block_lines = []

# Fence-language TOKEN BOUNDARY (adversary K, P3-1): "```tendencies" /
# "```feelings" are PROSE fences, not elections — after the 7-char prefix
# the next char must end the token (whitespace, backtick, or nothing).
def fence_boundary_ok(s):
    nxt = s[7:8]
    return 1 if (nxt == "" or nxt in (" ", "\t", "`")) else 0

# MID-ROUND WORDS scan first (fix adversary P1-1): the mind's own prose from
# tool rounds carries real elections (a round-1 feel fence was silently
# dropped before). Those lines PARSE (collect=0 — markers still land) but
# never enter the clean reply: the answer stays the final words. A synthetic
# bare ``` line closes any fence left open across the boundary; when no
# fence is open it toggles nothing (falls to the collect-gated append).
prior_words = str(_input.get("prior_words") or "")
scan = []
if prior_words.strip():
    for pl in prior_words.split("\n"):
        scan.append((pl, 0))
    scan.append(("```", 0))
for rl in reply.split("\n"):
    scan.append((rl, 1))

for pair in scan:
    line = pair[0]
    collect = pair[1]
    stripped = line.strip()
    if mode == "":
        if stripped.startswith("```feel") and fence_boundary_ok(stripped) == 1:
            body = stripped[7:]
            closed_inline = 0
            b = body.rstrip()
            if b.endswith("```"):
                # One-line closed fence (W2-2): fold NOW, never enter
                # fence mode — entering it ate the rest of the reply.
                body = b[:-3]
                closed_inline = 1
            fence_params = parse_params(body)
            if closed_inline == 1:
                fold_and_mark(fence_params)
                fence_params = {}
                continue
            mode = "feel"
            block_lines = []
            continue
        if stripped.startswith("```tend") and fence_boundary_ok(stripped) == 1:
            body = stripped[7:]
            b = body.rstrip()
            if b.endswith("```"):
                # One-line closed tend fence: one act inline.
                fold_tend([b[:-3]])
                continue
            mode = "tend"
            block_lines = []
            continue
        if collect == 1:
            clean_lines.append(line)
    elif mode == "tend":
        if stripped.startswith("```"):
            fold_tend(block_lines)
            mode = ""
            block_lines = []
            continue
        block_lines.append(line)
    else:
        if stripped.startswith("```"):
            inner = parse_params(block_lines[0] if block_lines else "")
            fold_and_mark(merge(inner, fence_params))
            mode = ""
            fence_params = {}
            block_lines = []
            continue
        block_lines.append(line)

if mode == "feel":
    # Unclosed fence at EOF: fold when complete, then ALWAYS flush the
    # block's words back (never swallow prose behind an unclosed fence).
    inner = parse_params(block_lines[0] if block_lines else "")
    merged = merge(inner, fence_params)
    before = box["target"]
    fold_and_mark(merged)
    if box["target"] == before:
        warnings.append("unclosed feel fence flushed back into the reply")
        for bl in block_lines:
            clean_lines.append(bl)
    else:
        # The first block line carried the election; flush any EXTRA lines.
        extra = block_lines[1:] if block_lines else []
        for bl in extra:
            clean_lines.append(bl)
elif mode == "tend":
    # Unclosed tend fence at EOF: the body still carries deliberate acts —
    # dispatch it (the engine parser refuses unusable lines as data) and
    # warn; never swallow, never lose the election.
    warnings.append("unclosed tend fence folded at EOF")
    fold_tend(block_lines)

clean_reply = "\n".join(clean_lines).strip()
has_feel = 1 if (box["target"] and box["sign"] != 0 and box["magnitude"] > 0 and box["reason"]) else 0
has_tend = 1 if tend_box["body"] else 0

return {
    "clean_reply": clean_reply,
    "feel_target": box["target"],
    "feel_sign": box["sign"],
    "feel_magnitude": box["magnitude"],
    "feel_reason": box["reason"],
    "has_feel": has_feel,
    "tend_body": tend_box["body"],
    "has_tend": has_tend,
    "warnings": warnings,
}
'''

EPISODE_CODE = r'''
# The episode ALWAYS forms (constitutional edge turn->s1): one typed record
# per lived turn; the verbatim exchange goes to the artifact store, the
# digest stays in the graph.
stimulus = str(_input.get("stimulus") or "")
reply = str(_input.get("clean_reply") or "")
phase = str(_input.get("phase") or "visit")
turn_id = str(_input.get("turn_id") or "")

# HONEST FAILURE EPISODES (adversary fix 2026-08-01): a machinery failure
# must never masquerade as chosen silence in the append-only graph. Two
# degradation signals ride in from the turn — guard_died (the rounds child
# DIED; the reply lane carries the labeled error bracket) and ended_silent
# (the moment ended without words: an empty completion, historically the
# relay returning content null). Either one makes this a FAILED moment:
# digest + verbatim say so, and "(I stayed silent)" stays RESERVED for a
# reply the entity actually chose to keep wordless (e.g. elections-only
# replies that clean to empty). Without this, every provider-empty turn
# deposited a false "(I stayed silent)" memory the entity would later
# recall as its own choice.
guard_died = 1 if _input.get("guard_died") == 1 else 0
ended_silent = 1 if _input.get("ended_silent") == 1 else 0
degraded = 1 if (guard_died == 1 or ended_silent == 1) else 0
moment_error = str(_input.get("guard_error") or "")
if degraded == 1 and not moment_error:
    moment_error = "the moment ended without words"
if len(moment_error) > 400:
    moment_error = moment_error[:400] + " [#TRUNCATION]"

# TITLE SOURCE BY PHASE (wave-4 adversary E, F3): the personal-day cue is
# computed ONCE and reused for every self-tick, so stimulus-derived titles
# made all of a day's personal episodes share one boilerplate title (the
# engine's maintenance flagged them as a duplicate group). On self phases
# the REPLY — the entity's own words for that distinct step — is the title.
if degraded == 1:
    # A failed moment is titled as one — never by the error bracket posing
    # as the entity's words, never by the stimulus posing as a lived turn.
    title = "a moment that failed (" + phase + ", " + turn_id + ")"
elif phase == "personal":
    title = reply.strip().replace("\n", " ")
else:
    title = stimulus.strip().replace("\n", " ")
if len(title) > 80:
    title = title[:77] + "..."
if not title:
    title = phase + " moment " + turn_id

def gist(text, cap):
    t = str(text or "").strip().replace("\n", " ")
    if len(t) <= cap:
        return t, 0
    window = t[:cap]
    cut = -1
    for mark in (". ", "! ", "? "):
        idx = window.rfind(mark)
        if idx > cut:
            cut = idx
    if cut > 60:
        return window[:cut + 1] + " [#TRUNCATION]", 1
    return window[:cap - 3] + " [#TRUNCATION]", 1

# The digest is the PROMPT CURRENCY: it must carry BOTH sides of the
# exchange — a reply-only digest left the entity honestly unable to recall
# what the visitor said (live find: "I only have the record of me stating
# it"). ASYMMETRIC budget (wave-2 live adversary P1a): the visitor's words
# ARE the taught content — a 140-char slice destroyed fact 3 of 3 in a
# teaching turn ("the Petrel" survived only in the diary). Sentence-bounded
# cuts, labeled (the #TRUNCATION law).
# PHASE-AWARE ATTRIBUTION (wave-3 adversary A, P1-2): "They said:" is only
# true of a VISIT. Work tasks and personal cues are not a visitor speaking —
# phase-blind prefixes wrote misattributed memories every self-phase day and
# world_model_pass folded them into the visitor's card as things they said.
stim_gist, t1 = gist(stimulus, 480)
reply_gist, t2 = gist(reply, 220)
truncated = 1 if (t1 == 1 or t2 == 1) else 0
# ONE predicate with the participants guard below (adversary D, P3-2):
# dialogue attribution ("They said:") is EXCLUSIVE to the visit phase — an
# unknown future phase must not claim a speaker it does not have, exactly
# as it gets no person:* participant stamp.
if phase == "work":
    stim_label = "Task: "
    stim_verb_label = "TASK:"
elif phase == "personal":
    stim_label = "Own time: "
    stim_verb_label = "OWN TIME CUE:"
elif phase == "visit":
    stim_label = "They said: "
    stim_verb_label = "THEY SAID:"
else:
    stim_label = "The moment brought: "
    stim_verb_label = "THE MOMENT BROUGHT:"
if degraded == 1:
    # The failure is the truth of the moment: no "I said:" attribution
    # (the entity said nothing — the bracket text is the guard's, not the
    # entity's) and no "(I stayed silent)" (silence was not chosen).
    failure_line = "[this moment failed: " + moment_error + " - no words were spoken; machinery, not chosen silence]"
    if stim_gist:
        digest = stim_label + stim_gist + " - " + failure_line
    else:
        digest = failure_line
    verbatim = (stim_verb_label + "\n" + stimulus +
                "\n\nTHE MOMENT FAILED (machinery, not chosen silence):\n" + moment_error)
elif stim_gist and reply_gist:
    digest = stim_label + stim_gist + " - I said: " + reply_gist
    verbatim = stim_verb_label + "\n" + stimulus + "\n\nI SAID:\n" + reply
elif reply_gist:
    digest = "I said: " + reply_gist
    verbatim = stim_verb_label + "\n" + stimulus + "\n\nI SAID:\n" + reply
elif stim_gist:
    digest = stim_label + stim_gist + " - (I stayed silent)"
    verbatim = stim_verb_label + "\n" + stimulus + "\n\nI SAID:\n" + reply
else:
    digest = "(a silent moment)"
    verbatim = stim_verb_label + "\n" + stimulus + "\n\nI SAID:\n" + reply

# Formation-time keywords (Castor's-first-dream lesson: young episodes
# without keywords are invisible to lexical recall on vectorless homes).
seen = {}
keywords = []
stop = {"the", "and", "that", "this", "with", "your", "what", "have", "from",
        "they", "said", "will", "would", "about", "there", "their", "them",
        "just", "very", "when", "then", "than", "were", "been", "being",
        "does", "much", "some", "here", "you", "not", "but", "for"}
# Degraded moments key on the STIMULUS only: guard/error prose is the
# machinery's words, not the moment's content — it must not become the
# lexical handle this memory answers to.
kw_source = stimulus if degraded == 1 else (stimulus + " " + reply)
for word in kw_source.lower().split():
    w = ""
    for ch in word:
        if ch.isalnum():
            w = w + ch
    if len(w) < 4 or w in stop or w in seen:
        continue
    seen[w] = 1
    keywords.append(w)
    if len(keywords) >= 12:
        break

participants = _input.get("participants")
if not isinstance(participants, list):
    participants = []
# Participants stamp VISIT episodes only (adversary A, P1-2): a work task or
# personal cue is not co-presence — stamping the visitor onto self-phase
# episodes fed them into the visitor's world-model card as misattributions.
if phase != "visit":
    participants = [p for p in participants if isinstance(p, str) and p.startswith("entity:")]

attrs = {"phase": phase, "turn_id": turn_id, "digest_method": "mechanical-flow-v1"}
if participants:
    attrs["participants"] = participants
if truncated == 1:
    attrs["digest_truncated"] = True
if degraded == 1:
    # Machine-readable twin of the digest's failure line: consumers (world
    # model, maintenance, observers) filter failed moments structurally
    # instead of parsing prose.
    attrs["degraded"] = True
    attrs["moment_error"] = moment_error

records = [{
    "kind": "episode",
    "title": title,
    "digest": digest,
    "keywords": keywords,
    "verbatim": verbatim,
    "attributes": attrs,
}]
return {"records": records}
'''

TURN_FOLD_CODE = r'''
# Fold the turn outcome into the rolling session state.
state = _input.get("state") or {}
if not isinstance(state, dict):
    state = {}
# PURE-NODE LAW: code nodes are volatile (re-evaluated per data pull), so
# inputs must NEVER be mutated in place — copy before writing.
state = dict(state)
reply = str(_input.get("clean_reply") or "")
stimulus = str(_input.get("stimulus") or "")
episode_ids = _input.get("episode_record_ids")
if not isinstance(episode_ids, list):
    episode_ids = []

log = state.get("turn_log")
if not isinstance(log, list):
    log = []
entry = {"stimulus": stimulus, "reply": reply}
if episode_ids:
    entry["episode"] = episode_ids[0]
# TOOLS (0.0.10): the acted round's host-authored names ride the turn log —
# session-level observability of WHAT the mind touched, per turn.
tools_ran = _input.get("tools_ran")
if isinstance(tools_ran, list) and tools_ran:
    entry["tools"] = [str(t) for t in tools_ran[:12]]
log = log + [entry]
if len(log) > 40:
    log = log[-40:]
state["turn_log"] = log
state["last_reply"] = reply

# TEND FEEDBACK CARRY (adversary K, P2-2): the tend dispatch happens after
# the reply is final, so its applied/refused result rides session state and
# the NEXT turn's shelf shows it ("YOUR LAST TENDING"). No tend this turn
# (or a turn without elections) CLEARS the carry — feedback never goes stale.
tres = _input.get("tend_result")
last_tend = None
if isinstance(tres, dict):
    applied = tres.get("applied")
    refused = tres.get("refused")
    n_applied = len(applied) if isinstance(applied, list) else 0
    r_lines = []
    if isinstance(refused, list):
        for r in refused[:5]:
            if isinstance(r, dict):
                r_lines.append(str(r.get("line") or "") + " - " + str(r.get("reason") or ""))
            else:
                r_lines.append(str(r))
    if n_applied > 0 or r_lines:
        last_tend = {"applied": n_applied, "refused": r_lines}
if last_tend is not None:
    state["last_tend"] = last_tend
elif "last_tend" in state:
    state.pop("last_tend")

done = 0
if reply.strip().endswith("DONE"):
    done = 1
state["task_done"] = done

# HONESTY SIGNALS out of the turn (fix adversary P0-1 + P1-2): a dead
# rounds child (guard fired — the reply lane already carries the honest
# error text) or a moment that ended without words marks the turn DEGRADED
# so the visit/chat surfaces and the app's gauge know the difference
# between "the entity said nothing" and "the machinery failed".
guard_died = 1 if _input.get("guard_died") == 1 else 0
ended_silent = 1 if _input.get("ended_silent") == 1 else 0
degraded = 1 if (guard_died == 1 or ended_silent == 1) else 0
moment_error = str(_input.get("guard_error") or "")
if degraded == 1 and not moment_error:
    moment_error = "the moment ended without words"

return {"state": state, "done": done, "reply": reply,
        "degraded": degraded, "moment_error": moment_error}
'''

CLOSE_PREP_CODE = r'''
# The close: the session summary record + the DETERMINISTIC diary note.
# Operator rule: at the end of EVERY session the diary receives an
# experiential note, deterministically (mechanical floor — never skipped,
# entity prose upstream can only enrich it).
state = _input.get("state") or {}
if not isinstance(state, dict):
    state = {}
# PURE-NODE LAW: code nodes are volatile (re-evaluated per data pull), so
# inputs must NEVER be mutated in place — copy before writing.
state = dict(state)
phase = str(_input.get("phase") or "visit")
reason = str(_input.get("reason") or "session end")

log = state.get("turn_log")
if not isinstance(log, list):
    log = []
n = len(log)

first_stim = ""
last_reply = ""
if n > 0:
    first = log[0]
    if isinstance(first, dict):
        first_stim = str(first.get("stimulus") or "")
    last = log[n - 1]
    if isinstance(last, dict):
        last_reply = str(last.get("reply") or "")

title = "session close (" + phase + ", " + str(n) + " turns)"
digest = "A " + phase + " session of " + str(n) + " turns."
if first_stim:
    lead = first_stim.replace("\n", " ")
    if len(lead) > 120:
        lead = lead[:117] + "..."
    digest = digest + " It began with: " + lead

# A summary must name its sources (engine guard): wire summarizes edges to
# the session's episode records. An episode-less close is an honest
# observation. Caps are LABELED (the #TRUNCATION law).
episode_ids = []
for t in log:
    if isinstance(t, dict):
        eid = str(t.get("episode") or "")
        if eid:
            episode_ids.append(eid)
edges = []
for eid in episode_ids[-12:]:
    edges.append(["summarizes", eid])

attrs = {"phase": phase, "turns": n, "close_reason": reason,
         "digest_method": "mechanical-flow-v1", "sources_total": len(episode_ids)}
if len(episode_ids) > 12:
    attrs["sources_truncated"] = True

summary_records = [{
    "kind": "summary" if edges else "observation",
    "title": title,
    "digest": digest,
    "edges": edges,
    "attributes": attrs,
}]

diary = "Session closed (" + phase + "): " + str(n) + " turns."
if first_stim:
    lead2 = first_stim.replace("\n", " ")
    if len(lead2) > 100:
        lead2 = lead2[:97] + "..."
    diary = diary + " It started with: " + lead2
if last_reply:
    tail = last_reply.replace("\n", " ")
    if len(tail) > 100:
        tail = tail[:97] + "..."
    diary = diary + " My last words: " + tail
diary = diary + " (" + reason + ")"

turn_count = state.get("turn_count")
if not isinstance(turn_count, int):
    turn_count = 0
days2 = state.get("days_lived")
if not isinstance(days2, int):
    days2 = 0
close_turn_id = phase + "-close-d" + str(days2) + "-" + str(turn_count)

return {
    "summary_records": summary_records,
    "diary_text": diary,
    "close_turn_id": close_turn_id,
    "turns": n,
}
'''

GATE_CODE = r'''
# THE DAY GATE: what does this moment call for?
# ONE MAILBOX, ONE CONSUMER: the master's inbox is drained here (cursor
# semantics), and ONLY here. Priority: stop > close the open visit session
# (goodbye, or a different call while a session is open) > visit > work >
# granted personal > the maintenance nap > park.
state = _input.get("state") or {}
if not isinstance(state, dict):
    state = {}
# PURE-NODE LAW: code nodes are volatile (re-evaluated per data pull), so
# inputs must NEVER be mutated in place — copy before writing.
state = dict(state)
inbox = _input.get("inbox")
if not isinstance(inbox, list):
    inbox = []
cursor = state.get("inbox_cursor")
if not isinstance(cursor, int):
    cursor = 0

visitor_message = ""
goodbye = 0
task = ""
personal_granted = state.get("personal_granted")
if not isinstance(personal_granted, int):
    personal_granted = 0
stop = 0

# DRAIN-BOUNDARY DISCIPLINE (adversary P0/P1: burst losses): the gate
# consumes at most ONE phase-DETERMINING event per consult (visit message,
# goodbye, stop) and stops the drain there — later events stay beyond the
# cursor for the next gate, so a goodbye+hello burst never closes over an
# unanswered message and a second task is deferred, never dropped.
for env in inbox:
    if not isinstance(env, dict):
        continue
    seq = env.get("seq")
    if not isinstance(seq, int):
        continue
    if seq <= cursor:
        continue
    payload = env.get("payload")
    if not isinstance(payload, dict):
        payload = {}
    kind = str(payload.get("kind") or "")
    if kind == "visit":
        cursor = seq
        visitor_message = str(payload.get("message") or "")
        break
    if kind == "goodbye":
        cursor = seq
        goodbye = 1
        break
    if kind == "stop":
        cursor = seq
        stop = 1
        break
    if kind == "task":
        already_pending = str(state.get("pending_task") or "")
        if task or already_pending:
            # A task while one is captured OR PENDING is deferred (cursor
            # stays before it) — consuming it would overwrite an unlived
            # task (wave-2 probe: TASK-ONE silently lost across drains).
            break
        cursor = seq
        task = str(payload.get("task") or "")
        continue
    cursor = seq
    if kind == "grant_personal":
        personal_granted = 1

carried_stop = state.get("stop_requested")
if isinstance(carried_stop, int) and carried_stop == 1:
    stop = 1

state["inbox_cursor"] = cursor
state["personal_granted"] = personal_granted
if stop == 1:
    state["stop_requested"] = 1

pending_task = str(state.get("pending_task") or "")
if task:
    pending_task = task
state["pending_task"] = pending_task

session_open = state.get("visit_session_open")
if not isinstance(session_open, int):
    session_open = 0

days = state.get("days_lived")
if not isinstance(days, int):
    days = 0
slept = state.get("slept_after_day")
if not isinstance(slept, int):
    slept = 1

phase = "park"
if stop == 1:
    phase = "close_visit" if session_open == 1 else "stop"
elif goodbye == 1 and session_open == 1:
    phase = "close_visit"
elif visitor_message:
    phase = "visit"
    state["visit_session_open"] = 1
elif session_open == 1 and (pending_task or personal_granted == 1):
    # A different call while the visitor is silent: close the session first.
    phase = "close_visit"
elif pending_task:
    phase = "work"
elif personal_granted == 1:
    phase = "personal"
    state["personal_granted"] = 0
elif session_open == 1:
    # The conversation is alive and the visitor is quiet: wait for them
    # (a session never sleeps out from under the visitor).
    phase = "park"
elif days > 0 and slept == 0:
    # A lived day settles into sleep before parking (consolidation-first).
    phase = "sleep"

return {
    "phase": phase,
    "visitor_message": visitor_message,
    "task": pending_task,
    "stop": stop,
    "state": state,
}
'''

DAY_END_CODE = r'''
# A phase completed: mark the day lived + clear what it consumed.
state = _input.get("state") or {}
if not isinstance(state, dict):
    state = {}
# PURE-NODE LAW: code nodes are volatile (re-evaluated per data pull), so
# inputs must NEVER be mutated in place — copy before writing.
state = dict(state)
phase = str(_input.get("phase") or "")
days = state.get("days_lived")
if not isinstance(days, int):
    days = 0
if phase in ("visit", "work", "personal"):
    state["days_lived"] = days + 1
    state["slept_after_day"] = 0
if phase == "work":
    state["pending_task"] = ""
if phase == "sleep":
    state["slept_after_day"] = 1
if phase in ("work", "personal", "close_visit"):
    # Session state is SESSION-scoped: a work/personal day closes its own
    # session inside the phase subflow, so the log/counters reset here —
    # a stale task_done stole the next task's whole budget, and a stale
    # turn_log wrote the WORK task into the PERSONAL close's diary note
    # (adversary P1, probe-confirmed).
    state["turn_log"] = []
    state["turn_count"] = 0
    state["task_done"] = 0
if phase == "close_visit":
    state["visit_session_open"] = 0
return {"state": state}
'''

SLEEP_REPORT_CODE = r'''
# The night, WIRED (runtime shipped memory_consolidate 2026-07-24): the
# engine's six-phase pass ran — fold its honest result into the settlement
# record. A non-run ({ran: false, reason: lease-held/paused}) is a VALID
# night, reported as such (never faked).
state = _input.get("state") or {}
if not isinstance(state, dict):
    state = {}
# PURE-NODE LAW: code nodes are volatile (re-evaluated per data pull), so
# inputs must NEVER be mutated in place — copy before writing.
state = dict(state)
night = _input.get("night")
if not isinstance(night, dict):
    night = {}
days = state.get("days_lived")
if not isinstance(days, int):
    days = 0

ran = 1 if night.get("ran") else 0
dream_id = str(night.get("dream_record_id") or "")
cands = night.get("maintenance_candidates")
n_cands = len(cands) if isinstance(cands, list) else 0
reason = str(night.get("reason") or "")
# ABSORBED FAILURE (wave-3 adversary A, P1-3): the night node runs with
# continueOnError — a mid-life engine death (live case: embedder HTTP 400
# during an LMStudio outage) lands {ok: false, absorbed_failure} here
# instead of killing the whole life run. It folds as a failed-not-skipped
# night: honest settlement record, life continues, next night retries.
failed_err = ""
if night.get("ok") is False or "absorbed_failure" in night:
    ran = 0
    failed_err = str(night.get("absorbed_failure") or night.get("error") or "engine pass failed")

if ran == 1:
    digest = "The night ran the consolidation pass over day " + str(days) + "."
    # DEFENSE IN DEPTH (wave-4 adversary E, F1): key on the engine's
    # `formed` flag FIRST — when a handler fold drops the id, the
    # settlement must still say a dream formed, never "a quiet night"
    # over a real dream (10/10 nights were false-negative before).
    formed_flag = 1 if night.get("formed") else 0
    if dream_id:
        digest = digest + " A dream formed (" + dream_id + ") — interpretation belongs to waking."
    elif formed_flag == 1:
        digest = digest + " A dream formed — interpretation belongs to waking."
    else:
        digest = digest + " A quiet night: no dream tonight."
    if n_cands > 0:
        digest = digest + " " + str(n_cands) + " maintenance candidate(s) proposed for review."
    report = "night " + str(days) + ": engine pass ran; dream=" + (dream_id or "none") + "; candidates=" + str(n_cands)
elif failed_err:
    digest = ("The night's consolidation pass FAILED over day " + str(days) +
              " (" + failed_err + ") — the rest window still closed the day; the next night retries.")
    report = "night " + str(days) + ": pass FAILED (" + failed_err + ")"
else:
    digest = "A rest window closed day " + str(days) + " without the engine pass (" + (reason or "no engine") + ")."
    report = "night " + str(days) + ": pass did not run (" + (reason or "unknown") + ")"

# F2 (wave-4 adversary E): a store-outage night could not write its own
# settlement — the gap rides state.unsettled_nights (written by the
# settle-check fold) and the NEXT healthy settlement names it here, then
# clears it. The honest target is "the next record mentions the missed
# one", never "write anyway" while the store is down.
unsettled = state.get("unsettled_nights")
if isinstance(unsettled, list) and unsettled:
    named = ", ".join([str(u) for u in unsettled])
    digest = digest + (" Earlier night(s) " + named + " closed without a settlement"
                       " record (the store was unreachable) — this record stands for them.")
    state["unsettled_nights"] = []

if ran == 1:
    pass_state = "ran"
elif failed_err:
    pass_state = "failed"
else:
    pass_state = "skipped"
attrs = {"night": days, "engine_pass": pass_state,
         "digest_method": "mechanical-flow-v1"}
if isinstance(unsettled, list) and unsettled:
    attrs["stands_for_nights"] = unsettled
if dream_id:
    attrs["dream_record_id"] = dream_id
if reason:
    attrs["skip_reason"] = reason
if failed_err:
    attrs["failure"] = failed_err

records = [{
    "kind": "observation",
    "title": "night " + str(days),
    "digest": digest,
    "attributes": attrs,
}]
return {
    "records": records,
    "turn_id": "night-d" + str(days),
    "report": report,
    "state": state,
}
'''

LIFE_COND_CODE = r'''
state = _input.get("state") or {}
if not isinstance(state, dict):
    state = {}
# PURE-NODE LAW: code nodes are volatile (re-evaluated per data pull), so
# inputs must NEVER be mutated in place — copy before writing.
state = dict(state)
stop = state.get("stop_requested")
if not isinstance(stop, int):
    stop = 0
days = state.get("days_lived")
if not isinstance(days, int):
    days = 0
max_days = _input.get("max_days")
if not isinstance(max_days, int) or max_days < 1:
    max_days = 30
keep = 1
if stop == 1:
    keep = 0
if days >= max_days:
    keep = 0
return {"condition": keep}
'''

SEED_CODE = r'''
# A life usually begins because someone spoke: seed the mailbox with the
# start prompt as the first visit event. inbox_seq is the seed's high-water:
# the gateway's durable-append counter (events_inbox_seq) continues FROM it —
# without this the first real steer event reused seq 1 and was skipped
# forever (adversary P0: seed seq collision).
prompt = str(_input.get("prompt") or "").strip()
envs = []
seq_high = 0
if prompt:
    envs = [{"seq": 1, "payload": {"kind": "visit", "message": prompt}}]
    seq_high = 1
return {"inbox": envs, "inbox_seq": seq_high,
        "state": {"inbox_cursor": 0, "days_lived": 0, "slept_after_day": 1}}
'''

PHASE_ROUTE_CODE = r'''
# Route the gate's decision (switch by phase string).
phase = str(_input.get("phase") or "park")
return {
    "is_stop": 1 if phase == "stop" else 0,
    "is_visit": 1 if phase == "visit" else 0,
    "is_work": 1 if phase == "work" else 0,
    "is_personal": 1 if phase == "personal" else 0,
    "is_sleep": 1 if phase == "sleep" else 0,
    "is_close": 1 if phase == "close_visit" else 0,
    "phase": phase,
}
'''

WORK_COND_CODE = r'''
state = _input.get("state") or {}
if not isinstance(state, dict):
    state = {}
# PURE-NODE LAW: code nodes are volatile (re-evaluated per data pull), so
# inputs must NEVER be mutated in place — copy before writing.
state = dict(state)
max_ticks = _input.get("max_ticks")
if not isinstance(max_ticks, int) or max_ticks < 1:
    max_ticks = 12
ticks = state.get("turn_count")
if not isinstance(ticks, int):
    ticks = 0
done = state.get("task_done")
if not isinstance(done, int):
    done = 0
keep = 1
if done == 1 and ticks > 0:
    # A done-flag with zero turns THIS session is stale (a guard fallback
    # or prior-phase residue) — never let it consume a task unlived.
    keep = 0
if ticks >= max_ticks:
    keep = 0
return {"condition": keep}
'''

SETTLE_CHECK_CODE = r'''
# F2 (wave-4 adversary E): when the settlement's OWN formation dies (store
# outage — the marker node runs with continueOnError), the sleep child must
# still complete AND the gap must be remembered: unsettled_nights rides the
# life state; the next healthy settlement names it and clears the list.
state = _input.get("state") or {}
if not isinstance(state, dict):
    state = {}
# PURE-NODE LAW: copy before writing.
state = dict(state)
res = _input.get("marker_result")
absorbed = 1 if (isinstance(res, dict) and (res.get("ok") is False or "absorbed_failure" in res)) else 0
if absorbed == 1:
    days = state.get("days_lived")
    if not isinstance(days, int):
        days = 0
    lst = state.get("unsettled_nights")
    lst = list(lst) if isinstance(lst, list) else []
    lst.append(days)
    state["unsettled_nights"] = lst
return {"state": state, "unsettled": absorbed}
'''

DRIVE_CUE_CODE = r'''
# The day-open cue: what is ALIVE for the entity (open questions, interests,
# unresolved threads) — read from the engine, offered as the self-tick
# stimulus. Absent drives = an honest open day.
# DREAMS carry their record id (adversary A, P2-2 + runtime c5215): a dream
# is the entity's to DISPOSE (confirm|reject via the ```tend fence), and
# disposal needs the addressable id — an unnamed dream is undischargeable.
items = _input.get("items")
if not isinstance(items, list):
    items = []
lines = []
has_dream = 0
for it in items[:5]:
    if isinstance(it, dict):
        kind = str(it.get("kind") or "")
        rid = str(it.get("record_id") or "")
        if kind == "dream" and rid:
            # A dream line must be HUMAN words (wave-4 adversary E, F3):
            # dream TITLES are mechanical bridge strings ("'Diary entry…'
            # beside 'Diary entry…'") — feeding them back as the day cue
            # made the entity's own time recursive boilerplate. The digest's
            # first clause carries the dream's actual content.
            d = str(it.get("digest") or it.get("title") or "").strip().replace("\n", " ")
            cut = d.find(". ")
            clause = d[:cut + 1] if 0 < cut < 140 else d[:140]
            lines.append("- an unresolved dream [" + rid + "]: " + clause)
            has_dream = 1
            continue
        t = str(it.get("title") or it.get("digest") or it.get("text") or "").strip()
        if t:
            lines.append("- " + t)
    elif isinstance(it, str) and it.strip():
        lines.append("- " + it.strip())
if lines:
    cue = "What is alive for you today:\n" + "\n".join(lines) + "\n\nFollow one of these — or what they awaken."
    if has_dream == 1:
        cue = cue + ("\nA dream above is yours to judge by waking evidence: dispose it in your"
                     " tend fence — `dispose: <dream id> confirm|reject -- reason: <your verdict>`.")
else:
    cue = ""
return {"cue": cue}
'''

PERSONAL_COND_CODE = r'''
state = _input.get("state") or {}
if not isinstance(state, dict):
    state = {}
# PURE-NODE LAW: code nodes are volatile (re-evaluated per data pull), so
# inputs must NEVER be mutated in place — copy before writing.
state = dict(state)
max_ticks = _input.get("max_ticks")
if not isinstance(max_ticks, int) or max_ticks < 1:
    max_ticks = 3
ticks = state.get("turn_count")
if not isinstance(ticks, int):
    ticks = 0
keep = 1
if ticks >= max_ticks:
    keep = 0
return {"condition": keep}
'''

GOODBYE_WORD_CODE = r'''
# The close reports itself in one honest line (agent.v1 answer surface).
turns = _input.get("turns")
try:
    n = int(turns)
except Exception:
    n = 0
reason = str(_input.get("reason") or "the visitor left")
if n > 0:
    word = ("The session closed (" + reason + "): " + str(n) +
            " turn(s) summarized, and the diary received its note.")
else:
    word = ("The session closed (" + reason + "): no turns had been lived "
            "in it — an honest empty close, nothing invented.")
return {"answer": word}
'''

GOODBYE_REPORT_CODE = r'''
# agent.v1 `success` / `meta` for the goodbye (backlog 0890): the close ran
# when the session-close child delivered its output (a dead child delivers
# None). meta says what closed: the turns folded and why the visitor left.
out = _input.get("close_out")
turns = _input.get("turns")
try:
    n = int(turns)
except Exception:
    n = 0
return {
    "completed": isinstance(out, dict),
    "meta": {"turns": n, "reason": str(_input.get("reason") or "the visitor left")},
}
'''

CHAT_STATE_CODE = r'''
# Session continuity for chat clients: when the host seeds durable session
# history (use_session_history -> context.messages), fold the recent turns
# into the session log so the shelf's THIS-SESSION block carries the live
# conversation — without this every chat prompt was an amnesiac turn and
# only graph recall bridged prompts (adversary F6).
state = _input.get("state")
if not isinstance(state, dict):
    state = {}
state = dict(state)
log = state.get("turn_log")
if not isinstance(log, list):
    log = []
if not log:
    ctx = _input.get("context")
    if not isinstance(ctx, dict):
        ctx = {}
    msgs = ctx.get("messages")
    if not isinstance(msgs, list):
        msgs = []
    pending_user = ""
    folded = []
    for m in msgs[-24:]:
        if not isinstance(m, dict):
            continue
        role = str(m.get("role") or "")
        content = str(m.get("content") or "")
        if role == "user":
            pending_user = content
        elif role == "assistant" and pending_user:
            folded.append({"stimulus": pending_user, "reply": content})
            pending_user = ""
    if folded:
        log = folded[-12:]
        state["turn_log"] = log
return {"state": state}
'''

CHAT_REPORT_CODE = r'''
# agent.v1 `success` / `meta` for one chat moment (backlog 0890): the moment
# succeeded when it was not degraded (the turn did not die, the visit child
# did not die: CHAT_DEGRADED_CODE's fold). meta carries what the host asked
# for (provider/model, empty = the gateway default) and what the moment did.
degraded = 1 if _input.get("degraded") == 1 else 0
vout = _input.get("visit_out")
if not isinstance(vout, dict):
    vout = {}
tools = vout.get("tools_ran")
if not isinstance(tools, list):
    tools = []
rounds = vout.get("tool_rounds")
if not isinstance(rounds, int):
    rounds = 0
return {
    "completed": degraded == 0,
    "meta": {
        "provider": str(_input.get("provider") or ""),
        "model": str(_input.get("model") or ""),
        "tools_ran": len(tools),
        "tool_rounds": rounds,
        "degraded": degraded,
    },
}
'''

CHAT_DEGRADED_CODE = r'''
# D3 (wave-3 adversary B): the API surface must distinguish "the entity said
# nothing" from "the turn died". Two independent degradation signals fold:
# the visit's own marker (the turn died inside a lived visit — visit output
# carries degraded/moment_error) and the visit child dying outright (the
# guard fired; visit output may be absent entirely).
vout = _input.get("visit_out")
if not isinstance(vout, dict):
    vout = {}
gd = _input.get("guard_died")
vd = vout.get("degraded")
degraded = 1 if (gd == 1 or vd == 1) else 0
err = str(_input.get("guard_error") or "") or str(vout.get("moment_error") or "")
return {"degraded": degraded, "moment_error": err}
'''
