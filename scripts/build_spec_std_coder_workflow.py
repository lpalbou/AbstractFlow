#!/usr/bin/env python3
"""Generator for the SPEC-STD-CODING family — spec-coding's two-loop pipeline
with STANDARDS-AWARE extraction (operator ruling, 2026-08-01: "when the user
prompt doesn't give enough requirements, derive best standards/practices from
the field of interest as requirements to follow").

WHAT IT CHANGES vs spec-coding (and ONLY this — the build/gates loop 1, the
probe/judge/reprompt coverage loop 2, the three-state discipline and the
anti-gaming belts are the spec-coding machinery, reused from its generator so
the two arms differ in exactly ONE treatment: the extraction contract):

  `extract_reqs` becomes TWO STAGES in ONE llm_call (still temperature 0,
  strict resp_schema):
    stage 1 — STATED requirements, extracted from the user prompt only,
      exactly as spec-coding does (source "stated", practice_note "").
    stage 2 — the model names the request's FIELD of interest (as narrow as
      the request's words allow: "browser canvas action game", never "web
      application") and, ONLY when stated items number fewer than `min_reqs`
      (new pin, default 10), DERIVES field-standard practices as additional
      requirements (source "derived", practice_note = why the field considers
      it standard) until stated+derived reaches min_reqs (hard cap 16 total).
  Derived items ride the SAME probe schema (grep/file/judge with thresholds),
  are enforced by the SAME coverage loop, and count against `passed` exactly
  like stated ones — the operator's ruling is "requirements to FOLLOW", so
  there is no second-class lane.

ADVERSARIAL DECISIONS (attacks addressed, in the order of the design review):
  (a) FIELD MISIDENTIFICATION cannot be prevented mechanically, so it is made
      VISIBLE instead of silently wrong: the schema carries a top-level
      `field`, the run persists it (`spec_field`), the extraction progress
      line prints it, the report names it next to the coverage table and the
      wrapper meta carries it — a "generic webapp" verdict on a Zelda prompt
      is one glance away from being caught, and every derived row's
      practice_note must argue from that field.
  (b) DERIVED BLOAT is closed in the FOLD, not asked of the model: stated
      items are kept first (cap 12, spec-coding parity), then derived items
      fill ONLY up to max(0, min_reqs - stated), total never above 16.
      Derived items are ordered most-fundamental-first by instruction, so the
      trim drops the least essential.
  (c) PROBE-ABILITY of practice items: the extraction prompt gives worked
      construct-level examples (input -> addEventListener, loop ->
      requestAnimationFrame, persistence -> localStorage, ...) and orders
      un-probe-able qualities into kind 'aesthetic' + probe 'judge'; the
      inherited fold already FORCES aesthetic->judge and empty-pattern->judge
      by construction, so a "juicy game feel" grep can never count.
  (d) DOUBLE COUNTING (a stated item already covers the practice): the prompt
      forbids it (stated wins), and the fold adds a mechanical belt — a
      derived item whose grep/file probe signature (type+pattern) or whose
      normalized requirement text equals a stated one is DROPPED and counted
      in the progress line. Semantic overlap beyond that stays prompt
      discipline, auditable via the table's source column.
  (e) RICH PROMPTS derive nothing: with stated >= min_reqs the fold keeps
      ZERO derived items (mechanical, in addition to the prompt's own "return
      zero derived" instruction) — a ~10-requirement Zelda prompt behaves
      like plain spec-coding, so the bench's spec vs specstd delta on rich
      prompts isolates to extraction wording alone.
  (f) LOOP-1 BUILDER STAYS BLIND to derived items — deliberate: spec-coding's
      builder is equally blind to STATED extractions (extraction is the
      measurement contract, the coverage loop is the enforcement), and
      injecting derived standards into round 1 would be a SECOND uncontrolled
      treatment that muddies the bench comparison. Derived gaps surface as
      evidence-of-absence scope rounds marked FIELD STANDARD, with the
      practice_note quoted so the builder knows why the scope exists.

REPORT CONTRACT: the table gains a `source` column; derived rows show their
practice_note in the note cell; the STOPPED headline splits the count
("STOPPED: N requirements uncovered (S stated + D derived) — ..."); the
PASSED line and the coverage header carry the same split plus the field.

0.1.1 — PATTERN-BLINDNESS FIX (live-smoke lesson e6ea2a1f, 2026-08-01: the
builder implemented input via `onkeydown=` properties and the loop via
setInterval; the addEventListener/requestAnimationFrame-only patterns counted
0, marked genuinely-met items unmet and burned all 3 scope rounds re-adding
what existed — count-0 could never be rescued because it routed to unmet):
  1. the extraction prompt now REQUIRES variant-covering ERE alternations
     (worked examples: input, frame loop; analogous sets for audio and
     persistence);
  2. SECOND-OPINION lane — a grep item whose count fails its threshold joins
     the judge candidates on EVERY coverage iteration (not only the final
     one: rescuing before the decision is what stops scope rounds being
     burned on already-covered items). The judge may mark it met ONLY under
     the existing quoted-evidence belt (unquoted met auto-unmet, judge_fold);
     without a judge verdict the counted zero stands and the item stays
     unmet — never silently unknown, never guessed;
  3. a second-opinion met carries evidence prefixed "judge: " so the table
     distinguishes counted coverage from judged coverage; a judge-confirmed
     miss appends the judge's evidence to the count line.
  file-type probes stay counted-only (no variant blindness in a file count);
  counts that PASS are never re-litigated by the judge.

INTERFACES: `spec-std-coding` (abstractcode.coding.v1 root) + `spec-std-coder`
(abstractcode.agent.v1 chat entry) + `spec-std-verify-gates` (this bundle's
own copy of the base verification subflow — bundle-local id, so spec-coding,
spec-std-coding and coding-agent never share a mutable artifact, and the
LIVE spec-coding bundle is not touched in any way).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wf_common as W
from wf_common import (
    EXEC_IN, EXEC_OUT, AGENT_INTERFACE, pin, node, edge, base_flow, code_node,
    llm_node, agent_node, while_node, subflow_node, if_node, answer_user_node,
    call_tool_node, get_var, set_var, validate_edges, write_json, FLOWS_DIR,
    read_pin,
)

# The base build/verify machinery — imported LIVE (same rule as spec-coding:
# code bodies and the gates subflow come from the CURRENT file at pack time).
import build_coding_agent_workflow as CG

# The sibling family this bundle forks: every body/text/schema that is NOT
# part of the standards-extraction treatment is IMPORTED from it, so the two
# arms stay byte-identical everywhere except the one change under test.
import build_spec_coder_workflow as SC

BUNDLE_ID = "spec-std-coding"
BUNDLE_VERSION = "0.1.3"
ROOT_FLOW_ID = "spec-std-coding"
VERIFY_FLOW_ID = "spec-std-verify-gates"
WRAPPER_FLOW_ID = "spec-std-coder"
CODING_INTERFACE = "abstractcode.coding.v1"

HARD_TOTAL_CAP = 16  # stated + derived, absolute; min_reqs is clamped to it

# ---------------------------------------------------------------------------
# THE TREATMENT: standards-aware extraction (system, schema, task text)
# ---------------------------------------------------------------------------
REQS_SYSTEM = (
    "You are a requirements extraction engine. You convert a user's coding request into a small "
    "set of mechanically checkable requirements in two clearly separated classes: requirements "
    "the request itself STATES, and — only when the stated ones are too few — requirements "
    "DERIVED from the recognized best practices of the request's field of interest. You answer "
    "ONLY with the structured object the response schema defines. You never invent stated "
    "requirements, you never omit a deliverable the request names, you label every derived item "
    "source 'derived' with its practice rationale, and a derived item never duplicates or "
    "contradicts stated scope — stated wins."
)

# Strict-expressible (the airelay 422 class, same rule as SC.REQ_SCHEMA):
# additionalProperties false => every property required; the model emits empty
# strings where a field does not apply (stated items carry practice_note "").
REQ_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["field", "items"],
    "properties": {
        "field": {"type": "string"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "requirement", "kind", "source", "practice_note",
                             "probe", "proxy_note"],
                "properties": {
                    "id": {"type": "string"},
                    "requirement": {"type": "string"},
                    "kind": {"type": "string", "enum": ["content", "behavior", "aesthetic"]},
                    "source": {"type": "string", "enum": ["stated", "derived"]},
                    "practice_note": {"type": "string"},
                    "probe": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["type", "pattern", "glob", "min_count"],
                        "properties": {
                            "type": {"type": "string", "enum": ["grep", "file", "judge"]},
                            "pattern": {"type": "string"},
                            "glob": {"type": "string"},
                            "min_count": {"type": "number"},
                        },
                    },
                    "proxy_note": {"type": "string"},
                },
            },
        },
    },
}

REQS_TASK_TEXT = (
    "# Extract testable requirements from a coding request — stated scope first, then field "
    "standards\n\n"
    "USER REQUEST (verbatim — extract from THIS TEXT ONLY, never from any file or workspace):\n"
    "{{request}}\n\n"
    "Produce ONE items[] list in TWO stages, plus the top-level `field` string.\n\n"
    "STAGE 1 — STATED requirements (source \"stated\", practice_note \"\", ids r1, r2, ...). One "
    "item per distinct deliverable the request itself names, quoting the request's own words "
    "where possible. AT MOST {{cap}} stated items (fewer well-chosen items beat padding). Never "
    "invent stated scope the request does not contain.\n\n"
    "STAGE 2 — FIELD + DERIVED standards (source \"derived\", ids d1, d2, ...). First set "
    "`field` to the request's field of interest, as NARROW as the request's own words allow "
    "(e.g. 'browser canvas action game', not 'web application'; 'command-line CSV tool', not "
    "'software'). Then, IF AND ONLY IF there are fewer than {{min_reqs}} stated items, ADD "
    "derived requirements — practices a competent practitioner of that field treats as standard "
    "— until stated+derived reaches {{min_reqs}} (never more than {{max_total}} items total). "
    "If stated items already number {{min_reqs}} or more, return ZERO derived items: the "
    "request already gives enough requirements. Each derived item's practice_note is one "
    "sentence naming the practice and why that field considers it standard.\n"
    "The register expected — for a browser game the standards would be e.g.: responsive "
    "keyboard input; a real frame loop; collision handling; audio feedback on events; an "
    "on-screen HUD (score/state); more than one scene or screen (menu/play/game-over); "
    "persistence of a best score where sensible. Derive the ANALOGOUS standards for whatever "
    "the actual field is (a CLI tool: --help text, exit codes, stdin/stdout composability, "
    "error messages to stderr; a data pipeline: schema validation, idempotent re-runs, "
    "logging).\n\n"
    "DERIVED DISCIPLINE (a violation makes the item worthless):\n"
    "- A derived item NEVER duplicates, rephrases or partially overlaps a stated item — stated "
    "wins; derive a DIFFERENT practice or fewer items (if the request already states arrow-key "
    "movement, do NOT derive 'responsive input').\n"
    "- A derived item NEVER contradicts the request (a request for a silent app forbids "
    "deriving audio feedback).\n"
    "- Order derived items most-fundamental-first: items past the budget are dropped from the "
    "END of the derived list.\n"
    "- Derived items are held to the SAME probes as stated ones — prefer countable code "
    "constructs; an un-probe-able quality ('juicy game feel') must become either a countable "
    "proxy or kind 'aesthetic' with a 'judge' probe.\n\n"
    "EVERY item (both stages):\n"
    "- id: short stable id (r1, r2, ... for stated; d1, d2, ... for derived).\n"
    "- requirement: the requirement in one sentence; stated items quote the request's own words "
    "where possible.\n"
    "- kind: 'content' (something must exist in the delivered files), 'behavior' (something must "
    "react or change at runtime), or 'aesthetic' (look/feel quality).\n"
    "- source: \"stated\" or \"derived\" exactly as defined above.\n"
    "- practice_note: derived items only — the field-standard rationale; empty string for "
    "stated items.\n"
    "- probe: how an orchestrator can check coverage mechanically against the DELIVERED SOURCE:\n"
    "  - type 'grep': pattern = a grep -E regex expected to match the delivered source code once "
    "the requirement is implemented. Match CODE CONSTRUCTS (identifiers, API calls — e.g. "
    "addEventListener|keydown for key input, requestAnimationFrame for a render loop, "
    "localStorage for persistence, AudioContext|createOscillator for audio), never prose words "
    "that could sit in a comment or README. glob = the --include file glob ('*.js', '*.html', "
    "'*'). min_count = the minimum TOTAL matching-line count that counts as covered.\n"
    "  - type 'file': pattern = the exact file name (or shell glob) that must exist; min_count = "
    "how many files must match (usually 1).\n"
    "  - type 'judge': for requirements no regex can decide. ALL 'aesthetic' items MUST use "
    "'judge'. Set pattern '', glob '', min_count 1.\n"
    "- proxy_note: one sentence recording WHY this probe approximates the requirement, including "
    "any threshold reasoning.\n\n"
    "SCALE WORDS ARE THRESHOLDS: when the request says vast/many/various/several/numerous/lots "
    "or similar, you MUST turn it into a countable proxy with a stated min_count (default 4 "
    "unless the request implies more) and record that choice in proxy_note (e.g. 'many screens' "
    "-> grep for a screen-table entry pattern like screens\\[, min_count 4).\n"
    "PATTERNS MUST COVER IMPLEMENTATION VARIANTS: a grep pattern is an ERE alternation of ALL "
    "the common ways this field implements the construct — a narrow pattern that misses a "
    "legitimate variant falsely reports absence and burns rework on code that already exists. "
    "Worked examples: keyboard input -> addEventListener\\(['\"]key|onkeydown|onkeyup|keydown "
    "(direct property handlers count too); a frame loop -> requestAnimationFrame|setInterval "
    "(either drives real frames). Build the analogous variant set for every construct you "
    "probe (audio -> AudioContext|new Audio\\(|createOscillator|<audio; persistence -> "
    "localStorage|sessionStorage|indexedDB).\n"
    "Prefer 'grep'/'file' probes wherever counting can decide; use 'judge' only when it cannot. "
    "Keep regexes simple alternations of identifiers, case-sensitive."
)

REQS_LINE_TEXT = (
    "requirements: {{n}} total — {{stated}} stated + {{derived}} derived "
    "(field: {{field}}; {{probe}} probe-able, {{judge}} judge-only)"
)

# ---------------------------------------------------------------------------
# CODE BODIES (RestrictedPython sandbox: no imports, no augmented subscript
# assignment, string work only) — only the bodies the treatment touches are
# forked; everything else is imported from SC below.
# ---------------------------------------------------------------------------

# SC's preflight + the spec_field seed (the field is a run-visible fact).
PREFLIGHT_CODE = r"""
req = str(request or "").strip()
ws = str(workspace_root or "").strip()
mode = str(gating_mode or "wait").strip().lower()
problems = []
if not req:
    problems.append(str(empty_request_text or ""))
if not ws:
    problems.append(str(no_workspace_text or ""))
ok = len(problems) == 0
lines = []
if not ok:
    lines.append(str(refusal_header_text or ""))
    for p in problems:
        lines.append("- " + p)
return {
    "updates": {
        "preflight_ok": ok,
        "wait_gating": mode != "auto",
        "probe_ok": bool(browser_probe_available),
        "spec_items": [],
        "spec_field": "",
        "spec_judge_results": {},
        "spec_met": {},
        "spec_unmet": [],
        "spec_unknown": [],
        "spec_done": False,
        "spec_round": 0,
        "spec_iter": 0,
        "spec_stop_reason": "",
        "spec_extract_note": "",
        "spec_judge_note": "",
    },
    "report": "\n".join(lines),
}
""".strip()

REQS_PROMPT_CODE = r"""
body = str(task_text or "")
body = body.replace("{{request}}", str(request or "").strip())
body = body.replace("{{cap}}", str(int(cap or 12)))
try:
    mr = int(min_reqs or 10)
except Exception:
    mr = 10
if mr < 1:
    mr = 1
if mr > 16:
    mr = 16
body = body.replace("{{min_reqs}}", str(mr))
body = body.replace("{{max_total}}", "16")
return {"prompt": body}
""".strip()

# Sanitize the two-stage extraction. Same belts as SC.REQS_FOLD_CODE (id
# charset, closed enums, aesthetic=>judge by construction, extraction failure
# degrades instead of failing) PLUS the standards-family belts:
#   - stated kept FIRST (cap 12); derived fills ONLY up to min_reqs - stated
#     (never below 0, total never above 16) — bloat closed mechanically, and a
#     rich prompt (stated >= min_reqs) keeps ZERO derived items;
#   - a derived item whose grep/file probe signature (type+pattern) or whose
#     normalized requirement text equals an already-kept item's is a DUPLICATE
#     — dropped and counted (stated wins; the practice was already covered);
#   - source normalized to the closed set (anything not 'derived' is stated —
#     schema enum makes this unreachable in the happy path, the belt covers
#     degraded payloads);
#   - the identified field is flattened to one line and persisted.
REQS_FOLD_CODE = r"""
d = data if isinstance(data, dict) else {}
raw_items = d.get("items")
if not isinstance(raw_items, list):
    raw_items = []
field = str(d.get("field") or "").replace("\r", " ").replace("\n", " ").strip()
try:
    capn = int(cap or 12)
except Exception:
    capn = 12
if capn < 1:
    capn = 1
if capn > 12:
    capn = 12
try:
    minr = int(min_reqs or 10)
except Exception:
    minr = 10
if minr < 1:
    minr = 1
if minr > 16:
    minr = 16
idset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
stated = []
derived = []
seen = set()
n = 0
for it in raw_items:
    if not isinstance(it, dict):
        continue
    n = n + 1
    rid = ""
    for c in str(it.get("id") or ""):
        if c in idset:
            rid = rid + c
    if not rid:
        rid = "r" + str(n)
    if rid in seen:
        rid = rid + "_" + str(n)
    seen.add(rid)
    req = str(it.get("requirement") or "").strip()
    if not req:
        continue
    kind = str(it.get("kind") or "").strip().lower()
    if kind not in ("content", "behavior", "aesthetic"):
        kind = "content"
    src = str(it.get("source") or "").strip().lower()
    if src != "derived":
        src = "stated"
    pnote = str(it.get("practice_note") or "").replace("\r", " ").replace("\n", " ").strip()
    p = it.get("probe")
    if not isinstance(p, dict):
        p = {}
    t = str(p.get("type") or "").strip().lower()
    if t not in ("grep", "file", "judge"):
        t = "judge"
    if kind == "aesthetic":
        t = "judge"
    pat = str(p.get("pattern") or "").replace("\r", " ").replace("\n", " ").strip()
    if t in ("grep", "file") and not pat:
        t = "judge"
    g = str(p.get("glob") or "").strip()
    if not g:
        g = "*"
    # Glob doctrine (0.1.2): inline-JS-in-HTML is a legitimate implementation
    # variant; a '*.js' glob excluded it and turned present features into
    # count-0 "evidence of absence". Widen every grep glob to '*' unless the
    # REQUIREMENT names a specific language/file kind (then the narrow glob is
    # the requirement itself, keep it).
    if t == "grep" and g != "*":
        # Explicit loop, NOT a generator expression: RestrictedPython rejects
        # the generator form per-item, which silently emptied the whole fold
        # (spec_items: 0) and killed six benchmark runs in ~27s each — the
        # 0.1.2 lesson about testing fold bodies in the sandbox before packing.
        low_req = req.lower()
        lang_specific = False
        for kw in (".js", ".py", ".css", ".html", "javascript file",
                   "python file", "stylesheet", "separate file", "typescript"):
            if kw in low_req:
                lang_specific = True
                break
        if not lang_specific:
            g = "*"
    try:
        mc = int(p.get("min_count") or 1)
    except Exception:
        mc = 1
    if mc < 1:
        mc = 1
    if mc > 999:
        mc = 999
    entry = {"id": rid, "requirement": req, "kind": kind, "source": src,
             "practice_note": pnote,
             "probe": {"type": t, "pattern": pat, "glob": g, "min_count": mc},
             "proxy_note": str(it.get("proxy_note") or "").strip()}
    if src == "stated":
        if len(stated) < capn:
            stated.append(entry)
    else:
        derived.append(entry)
fill = minr - len(stated)
if fill < 0:
    fill = 0
room = 16 - len(stated)
if fill > room:
    fill = room
sig = set()
for x in stated:
    p2 = x["probe"]
    if p2["type"] in ("grep", "file") and p2["pattern"]:
        sig.add(p2["type"] + "|~|" + p2["pattern"].lower())
    rk = ""
    for c in x["requirement"].lower():
        if c.isalnum():
            rk = rk + c
    sig.add("req|~|" + rk)
kept_derived = []
dropped_dupes = 0
for x in derived:
    if len(kept_derived) >= fill:
        break
    p2 = x["probe"]
    k1 = ""
    if p2["type"] in ("grep", "file") and p2["pattern"]:
        k1 = p2["type"] + "|~|" + p2["pattern"].lower()
    rk = ""
    for c in x["requirement"].lower():
        if c.isalnum():
            rk = rk + c
    k2 = "req|~|" + rk
    if (k1 and k1 in sig) or k2 in sig:
        dropped_dupes = dropped_dupes + 1
        continue
    if k1:
        sig.add(k1)
    sig.add(k2)
    kept_derived.append(x)
clean = stated + kept_derived
probeable = 0
for x in clean:
    if x["probe"]["type"] in ("grep", "file"):
        probeable = probeable + 1
note = ""
if not bool(ok):
    note = str(fail_note_text or "")
elif len(clean) == 0:
    note = str(empty_note_text or "")
msg = str(line_text or "")
msg = msg.replace("{{n}}", str(len(clean)))
msg = msg.replace("{{stated}}", str(len(stated)))
msg = msg.replace("{{derived}}", str(len(kept_derived)))
msg = msg.replace("{{field}}", field if field else "unidentified")
msg = msg.replace("{{probe}}", str(probeable))
msg = msg.replace("{{judge}}", str(len(clean) - probeable))
if dropped_dupes > 0:
    msg = msg + " — " + str(dropped_dupes) + " derived duplicate(s) of stated scope dropped"
if note:
    msg = msg + " — " + note
return {"updates": {"spec_items": clean, "spec_field": field, "spec_extract_note": note},
        "line": msg}
""".strip()

# SC's judge prompt + the practice_note line + the 0.1.1 SECOND-OPINION lane:
# a grep item whose count FAILED its threshold joins the judge candidates
# (pattern blindness: `onkeydown=` vs an addEventListener-only pattern — the
# 0.1.0 live smoke burned all 3 scope rounds re-adding code that existed).
# Three-state applied to count-0: a narrow pattern's zero is MISSING EVIDENCE,
# not evidence of absence — so it routes to judgment instead of deciding.
# file-type probes stay counted-only (a file count has no variant blindness),
# and a count that PASSES its threshold is never re-litigated by the judge.
JUDGE_PROMPT_CODE = r"""
items_l = items if isinstance(items, list) else []
pm = probe_map if isinstance(probe_map, dict) else {}
jr = judge_results if isinstance(judge_results, dict) else {}
asked = []
ilines = []
for it in items_l:
    if not isinstance(it, dict):
        continue
    rid = str(it.get("id") or "")
    p = it.get("probe")
    if not isinstance(p, dict):
        p = {}
    t = str(p.get("type") or "judge")
    snote = ""
    if t in ("grep", "file") and rid in pm:
        r = pm.get(rid)
        cnt = 0
        mn = 1
        if isinstance(r, dict):
            cnt = int(r.get("count") or 0)
            mn = int(r.get("min") or 1)
        if t == "file" or cnt >= mn:
            continue
        snote = ("counting probe found " + str(cnt) + " of min " + str(mn) + " for pattern '"
                 + str(p.get("pattern") or "") + "' — the pattern may be blind to an "
                 "equivalent construct; verify by READING the delivered files whether the "
                 "requirement is genuinely implemented in any form")
    j = jr.get(rid)
    if isinstance(j, dict) and bool(j.get("met")):
        continue
    asked.append(rid)
    entry = "- id: " + rid + " | kind: " + str(it.get("kind") or "")
    entry = entry + " | requirement: " + str(it.get("requirement") or "")
    pn = str(it.get("practice_note") or "").strip()
    if pn:
        entry = entry + " | field standard: " + pn
    note = str(it.get("proxy_note") or "").strip()
    if note:
        entry = entry + " | note: " + note
    if snote:
        entry = entry + " | second opinion: " + snote
    ilines.append(entry)
need = len(asked) > 0
prompt = ""
if need:
    body = str(task_text or "")
    body = body.replace("{{workspace}}", str(workspace_root or "").strip())
    body = body.replace("{{items}}", "\n".join(ilines))
    prompt = body
return {"prompt": prompt, "need": need, "asked": asked}
""".strip()

# The unmet header names the two classes so a scope-round builder knows a
# FIELD STANDARD line is operator-required practice, not hallucinated scope.
REPROMPT_UNMET_HEADER_TEXT = (
    "# Requirements NOT yet covered (evidence of absence, from mechanical probes over the "
    "delivered files and the read-only coverage judge). Items marked FIELD STANDARD were "
    "derived from the recognized best practices of this request's field — the operator "
    "requires them followed exactly like stated scope:"
)

# SC's coverage decision + source-aware entries and reprompt lines + the
# 0.1.1 second-opinion precedence: count>=min => met (counted, authoritative);
# count<min => the judge's quoted verdict decides a grep item (met evidence
# prefixed "judge: "; judge-unmet appends the judge evidence to the count
# line; no verdict => the counted zero stands, unmet). Everything else
# (three-state routing, budget belts, exit-through-fresh-probe, steering,
# selfcheck hash binding) is byte-identical to SC.SPEC_FOLD_CODE.
SPEC_FOLD_CODE = r"""
items_l = items if isinstance(items, list) else []
pm = probe_map if isinstance(probe_map, dict) else {}
jr = judge_results if isinstance(judge_results, dict) else {}
rnd = int(spec_round or 0)
try:
    budget = int(spec_rounds or 0)
except Exception:
    budget = 0
if budget < 0:
    budget = 0
if budget > 10:
    budget = 10
it_no = int(spec_iter or 0) + 1
met = {}
unmet = []
unknown = []
for it in items_l:
    if not isinstance(it, dict):
        continue
    rid = str(it.get("id") or "")
    kind = str(it.get("kind") or "content")
    req = str(it.get("requirement") or "")
    src = str(it.get("source") or "stated")
    if src != "derived":
        src = "stated"
    p = it.get("probe")
    if not isinstance(p, dict):
        p = {}
    t = str(p.get("type") or "judge")
    pat = str(p.get("pattern") or "")
    entry = {"id": rid, "requirement": req, "kind": kind, "source": src}
    r = pm.get(rid)
    if t in ("grep", "file") and isinstance(r, dict):
        c = int(r.get("count") or 0)
        m = int(r.get("min") or 1)
        head = "grep '" if t == "grep" else "files '"
        ev = head + pat + "' -> " + str(c) + " (min " + str(m) + ")"
        if c >= m:
            met[rid] = ev
        else:
            second_met = False
            j = jr.get(rid)
            if t == "grep" and isinstance(j, dict) and "met" in j:
                if bool(j.get("met")):
                    second_met = True
                    met[rid] = "judge: " + str(j.get("evidence") or "")
                else:
                    ev = ev + "; judge: " + str(j.get("evidence")
                                                or "the judge found no evidence either")
            if not second_met:
                entry["evidence"] = ev
                unmet.append(entry)
    else:
        j = jr.get(rid)
        if isinstance(j, dict) and "met" in j:
            if bool(j.get("met")):
                met[rid] = str(j.get("evidence") or "")
            else:
                entry["evidence"] = str(j.get("evidence") or "the judge found no evidence")
                unmet.append(entry)
        else:
            entry["evidence"] = ("no probe result and no judge verdict — UNKNOWN (missing "
                                 "evidence never decides an item)")
            unknown.append(entry)
unmet_fix = [u for u in unmet if str(u.get("kind") or "") != "aesthetic"]
done = False
build = False
reason = ""
if len(items_l) == 0:
    done = True
    reason = "no-requirements-extracted"
elif len(unmet) == 0 and len(unknown) == 0:
    done = True
    reason = "covered"
elif len(unmet_fix) == 0:
    done = True
    if len(unmet) > 0:
        reason = "aesthetic-only-unmet"
    else:
        reason = "unverified-only"
elif rnd >= budget:
    done = True
    reason = "spec-budget-exhausted"
elif it_no > budget + 3:
    done = True
    reason = "spec-iteration-belt"
else:
    build = True
    rnd = rnd + 1
reprompt = ""
if build:
    parts = []
    parts.append(str(reprompt_header or ""))
    parts.append(str(request or "").strip())
    steer = str(steering or "").strip()
    if steer:
        parts.append(str(steer_header or "") + "\n" + steer)
    ws = str(workspace_root or "").strip()
    if ws:
        parts.append("Work inside the workspace root: " + ws + " — the artifact from the "
                     "previous rounds is already there. Read the existing files before changing "
                     "anything.")
    ulines = [str(unmet_header or "")]
    for u in unmet_fix:
        uid = str(u.get("id") or "")
        note = ""
        pnote = ""
        usrc = "stated"
        for it in items_l:
            if isinstance(it, dict) and str(it.get("id") or "") == uid:
                note = str(it.get("proxy_note") or "")
                pnote = str(it.get("practice_note") or "")
                if str(it.get("source") or "") == "derived":
                    usrc = "derived"
        uline = "- [" + uid + "] " + str(u.get("requirement") or "")
        if usrc == "derived":
            uline = uline + " [FIELD STANDARD"
            if pnote:
                uline = uline + ": " + pnote
            uline = uline + "]"
        uline = uline + " — evidence of absence: " + str(u.get("evidence") or "")
        if note:
            uline = uline + " (how it is re-checked: " + note + ")"
        ulines.append(uline)
    parts.append("\n".join(ulines))
    parts.append(str(add_scope_text or ""))
    parts.append(str(selfcheck_text or ""))
    kept = []
    for p2 in parts:
        if str(p2).strip():
            kept.append(str(p2))
    reprompt = "\n\n".join(kept)
if build:
    action = str(action_build or "").replace("{{n}}", str(rnd)).replace("{{max}}", str(budget))
else:
    action = str(action_done or "").replace("{{reason}}", reason)
msg = str(line_text or "")
msg = msg.replace("{{k}}", str(it_no)).replace("{{met}}", str(len(met)))
msg = msg.replace("{{unmet}}", str(len(unmet))).replace("{{unknown}}", str(len(unknown)))
msg = msg.replace("{{action}}", action)
return {"updates": {"spec_met": met, "spec_unmet": unmet, "spec_unknown": unknown,
                    "spec_done": done, "spec_round": rnd, "spec_iter": it_no,
                    "spec_stop_reason": reason},
        "build": build, "reprompt": reprompt, "line": msg}
""".strip()

# SC's report + the standards contract: source column, stated/derived split in
# the headline and coverage header, field named, practice notes in the note
# cell, requirements[] entries carrying source+practice_note verbatim.
SPEC_REPORT_CODE = r"""
state = loop_state if isinstance(loop_state, dict) else {}
verdict = state.get("last_verdict") or {}
if not isinstance(verdict, dict):
    verdict = {}
rounds = int(state.get("rounds_completed", 0) or 0)
gates_ok = bool(state.get("all_passed"))
fixable = [str(f) for f in (state.get("failures") or [])]
envf = [str(f) for f in (state.get("environment_failures") or [])]
verifier_died = bool(verdict.get("verifier_died"))
items_l = items if isinstance(items, list) else []
met_m = met if isinstance(met, dict) else {}
unmet_l = unmet if isinstance(unmet, list) else []
unknown_l = unknown if isinstance(unknown, list) else []
fieldv = str(field or "").strip()
sr = int(spec_round or 0)
try:
    sb = int(spec_rounds or 0)
except Exception:
    sb = 0
srcmap = {}
pnmap = {}
stated_n = 0
derived_n = 0
for it in items_l:
    if not isinstance(it, dict):
        continue
    s2 = str(it.get("source") or "stated")
    if s2 != "derived":
        s2 = "stated"
    srcmap[str(it.get("id") or "")] = s2
    pnmap[str(it.get("id") or "")] = str(it.get("practice_note") or "").strip()
    if s2 == "derived":
        derived_n = derived_n + 1
    else:
        stated_n = stated_n + 1
uncovered = []
for u in unmet_l:
    if isinstance(u, dict):
        uncovered.append(u)
for u in unknown_l:
    if isinstance(u, dict):
        uncovered.append(u)
u_stated = 0
u_derived = 0
for u in uncovered:
    s2 = str(u.get("source") or "")
    if not s2:
        s2 = srcmap.get(str(u.get("id") or ""), "stated")
    if s2 == "derived":
        u_derived = u_derived + 1
    else:
        u_stated = u_stated + 1
covered_ok = len(uncovered) == 0
passed = gates_ok and covered_ok
text = str(final_listing or "")
files = []
if bool(final_listing_ok):
    for ln in text.split("\n")[1:]:
        if not ln.startswith("  "):
            continue
        s = ln.strip()
        if not s or s.endswith("/"):
            continue
        if s.endswith(" bytes)") or s.endswith(" byte)"):
            cut = s.rfind(" (")
            if cut > 0:
                s = s[:cut]
        files.append(s)
det = verdict.get("deterministic") or {}
if not isinstance(det, dict):
    det = {}
delivered = len(files) > 0 or bool(det.get("delivery_ok"))
unverified_only = ((not passed) and delivered and covered_ok and len(fixable) == 0
                   and (len(envf) > 0 or verifier_died))
okv = passed or unverified_only
lines = []
lines.append("# Spec-std coding result")
lines.append("")
if len(uncovered) > 0:
    namebits = []
    for u in uncovered:
        namebits.append("[" + str(u.get("id") or "?") + "] " + str(u.get("requirement") or ""))
    lines.append("Status: STOPPED: " + str(len(uncovered)) + " requirements uncovered ("
                 + str(u_stated) + " stated + " + str(u_derived) + " derived) — "
                 + "; ".join(namebits))
elif passed:
    if len(items_l) > 0:
        lines.append("Status: PASSED — all gates green and all " + str(len(items_l))
                     + " requirements covered (" + str(stated_n) + " stated + "
                     + str(derived_n) + " derived)")
    else:
        lines.append("Status: PASSED — all gates green (no requirements were extracted, so the "
                     "coverage loop had nothing to check)")
elif unverified_only:
    lines.append("Status: DELIVERED — NOT VERIFIABLE HERE (requirements covered "
                 + str(len(met_m)) + "/" + str(len(items_l)) + ", but independent gate "
                 "verification could not complete in this environment)")
else:
    lines.append("Status: STOPPED with open gate failures (requirements covered "
                 + str(len(met_m)) + "/" + str(len(items_l)) + ")")
if fieldv:
    lines.append("Field of interest: " + fieldv + " — derived requirements are that field's "
                 "standard practices, enforced like stated scope")
lines.append("Rounds used: " + str(rounds) + " build/verify round(s) total — loop-1 budget "
             + str(int(max_rounds or 0)) + ", plus " + str(sr) + " of " + str(sb)
             + " scope-completion round(s)")
if str(stop_reason or "").strip():
    lines.append("Coverage loop stopped: " + str(stop_reason))
lines.append("")
lines.append("Gate verdict (last verified round):")
lines.append("- builds: " + str(bool(verdict.get("builds"))))
lines.append("- executes: " + str(bool(verdict.get("executes"))))
lines.append("- matches: " + str(bool(verdict.get("matches"))))
if verifier_died:
    lines.append("- verifier: DIED before reporting (builds/matches above are UNVERIFIED, "
                 "not failed)")
lines.append("")
lines.append("Requirements coverage (" + str(len(met_m)) + " met, " + str(len(unmet_l))
             + " unmet, " + str(len(unknown_l)) + " unverified of " + str(len(items_l))
             + " extracted — " + str(stated_n) + " stated + " + str(derived_n) + " derived):")
lines.append("")
lines.append("| id | met | source | kind | requirement | evidence | proxy_note |")
lines.append("| --- | --- | --- | --- | --- | --- | --- |")
unmet_ev = {}
for u in unmet_l:
    if isinstance(u, dict):
        unmet_ev[str(u.get("id"))] = str(u.get("evidence") or "")
unknown_ev = {}
for u in unknown_l:
    if isinstance(u, dict):
        unknown_ev[str(u.get("id"))] = str(u.get("evidence") or "")
reqs_out = []
for it in items_l:
    if not isinstance(it, dict):
        continue
    rid = str(it.get("id") or "")
    kind = str(it.get("kind") or "")
    src = srcmap.get(rid, "stated")
    note = str(it.get("proxy_note") or "")
    pnote = pnmap.get(rid, "")
    if rid in met_m:
        mark = "✓"
        status = "met"
        ev = str(met_m.get(rid) or "")
    elif rid in unmet_ev:
        mark = "✗"
        status = "unmet"
        ev = str(unmet_ev.get(rid) or "")
    elif rid in unknown_ev:
        mark = "?"
        status = "unknown"
        ev = str(unknown_ev.get(rid) or "")
    else:
        mark = "?"
        status = "unknown"
        ev = "no probe result recorded"
    cell_note = note
    if pnote:
        cell_note = "practice: " + pnote
        if note:
            cell_note = cell_note + " ; proxy: " + note
    cell_req = str(it.get("requirement") or "").replace("|", "/").replace("\n", " ; ")
    cell_ev = ev.replace("|", "/").replace("\n", " ; ")
    cell_note = cell_note.replace("|", "/").replace("\n", " ; ")
    lines.append("| " + rid + " | " + mark + " | " + src + " | " + kind + " | " + cell_req
                 + " | " + cell_ev + " | " + cell_note + " |")
    reqs_out.append({"id": rid, "requirement": str(it.get("requirement") or ""),
                     "kind": kind, "source": src, "practice_note": pnote,
                     "status": status, "evidence": ev, "proxy_note": note})
arts = [str(a).strip() for a in (verdict.get("artifacts") or []) if str(a).strip()]
# ADR-0026: name EVERY produced file — a [:5] slice made the report
# unable to point at artifacts 6+ (the operator then needed a second
# agent just to FIND them).
if not arts and files:
    arts = files
if arts:
    lines.append("")
    lines.append("Artifacts (paths relative to the run workspace root):")
    for a in arts:
        lines.append("- " + a)
else:
    lines.append("")
    lines.append("Artifacts: none observed (#FALLBACK: report cannot name the produced file "
                 "paths)")
warnings = [str(w) for w in (verdict.get("warnings") or [])]
for w in (state.get("warnings") or []):
    if str(w) not in warnings:
        warnings.append(str(w))
if str(extract_note or "").strip():
    warnings.append(str(extract_note))
if str(judge_note or "").strip():
    warnings.append(str(judge_note))
if warnings:
    lines.append("")
    lines.append("Advisory (did not fail the run):")
    for w in warnings:
        lines.append("- " + w)
if not passed:
    if fixable:
        lines.append("")
        lines.append("Open gate failures:")
        for f in fixable:
            lines.append("- " + f)
    if envf:
        lines.append("")
        lines.append("Not verifiable in this environment (missing executor or dead verifier — "
                     "not a code defect):")
        for f in envf:
            lines.append("- " + f)
if verdict.get("summary"):
    lines.append("")
    lines.append("Summary: " + str(verdict.get("summary")))
unmet_out_l = []
for u in unmet_l:
    if isinstance(u, dict):
        unmet_out_l.append(u)
for u in unknown_l:
    if isinstance(u, dict):
        v = dict(u)
        v["unverified"] = True
        unmet_out_l.append(v)
return {"report": "\n".join(lines), "passed": passed, "delivered": delivered, "ok": okv,
        "rounds_used": rounds, "spec_rounds_used": sr, "field_out": fieldv,
        "open_failures": fixable + envf, "artifacts": arts,
        "unmet_out": unmet_out_l, "requirements": reqs_out}
""".strip()

WRAPPER_ANSWER_CODE = r"""
rep = report if isinstance(report, str) else ""
okv = bool(child_success)
died = child_result if isinstance(child_result, dict) else {}
if not rep.strip():
    err = str(died.get("error") or "").strip()
    rep = str(died_text or "").replace(
        "{{error}}", err if err else str(unknown_error_text or ""))
    okv = False
u = unmet if isinstance(unmet, list) else []
reqs = requirements if isinstance(requirements, list) else []
return {
    "response": rep,
    "ok": okv,
    "meta": {"passed": bool(passed), "unmet": u, "requirements": reqs,
             "field": str(field or ""),
             "rounds_used": rounds_used if isinstance(rounds_used, (int, float)) else 0,
             "spec_rounds_used": spec_rounds_used if isinstance(spec_rounds_used, (int, float)) else 0,
             "orchestration": "spec-std-coding"},
}
""".strip()

# Flat run-var inventory (doc parity with SC; PREFLIGHT_CODE is the writer).
SEED_VARS = {
    "preflight_ok": False,
    "wait_gating": True,
    "probe_ok": False,
    "spec_items": [],
    "spec_field": "",
    "spec_judge_results": {},
    "spec_met": {},
    "spec_unmet": [],
    "spec_unknown": [],
    "spec_done": False,
    "spec_round": 0,
    "spec_iter": 0,
    "spec_stop_reason": "",
    "spec_extract_note": "",
    "spec_judge_note": "",
}

END_PIN_DEFAULTS = {
    "report": "", "passed": False, "delivered": False, "success": False,
    "rounds_used": 0, "spec_rounds_used": 0, "open_failures": [],
    "artifacts": [], "unmet": [], "requirements": [], "field": "",
}


def _end_pins() -> list:
    return [pin("report", "report", "string"),
            pin("passed", "passed", "boolean"),
            pin("delivered", "delivered", "boolean"),
            pin("success", "success", "boolean"),
            pin("rounds_used", "rounds_used", "number"),
            pin("spec_rounds_used", "spec_rounds_used", "number"),
            pin("open_failures", "open_failures", "array"),
            pin("artifacts", "artifacts", "array"),
            pin("unmet", "unmet", "array"),
            pin("requirements", "requirements", "array"),
            pin("field", "field", "string")]


def build_verify() -> dict:
    """This bundle's OWN copy of the base verification gates (same rule as
    spec-coding's: generated from the CURRENT build_coding_agent_workflow at
    pack time — three-state probe line included — under a bundle-local id so
    no bundle shares a mutable artifact)."""
    f = CG.build_verifier_subflow()
    f["id"] = VERIFY_FLOW_ID
    f["name"] = VERIFY_FLOW_ID
    f["description"] = (
        "spec-std-coding's own copy of coding-agent's verification gates (generated from the "
        "current build_coding_agent_workflow.py at pack time; 0.2.6 lineage with the "
        "three-state canvas-liveness probe line). Deterministic delivery/integration/orphan/"
        "DOM/SELFCHECK gates first, browser_probe executes gate for web entrypoints "
        "(fail-closed), then the independent LLM verifier for builds/matches. Returns one "
        "structured verdict with fixable failures separated from environment failures."
    )
    write_json(FLOWS_DIR / f"{VERIFY_FLOW_ID}.json", f)
    return f


def _loop1_nodes(N: list, E: list) -> None:
    """LOOP 1 — byte-identical to spec-coding's (which rebuilds the base round
    loop from the imported CG code bodies); the only difference is that the
    gates subflow reference points at THIS bundle's verify copy."""
    N.append(get_var("get_loop_state", "cg.loop_state",
                     {"rounds_completed": 0, "all_passed": False, "failures": []}, 0, 0))
    N.append(code_node("loop_condition", "Should keep building?", CG.LOOP_CONDITION_CODE, 0, 0,
                       [pin("loop_state", "loop_state", "object"),
                        pin("max_rounds", "max_rounds", "number")]))
    E.append(edge("get_loop_state", "value", "loop_condition", "loop_state"))
    E.append(edge("start", "max_rounds", "loop_condition", "max_rounds"))
    rounds = while_node("rounds", "LOOP 1: verify-gated build rounds", 0, 0)
    rounds["data"]["pinDefaults"] = {"condition": False}  # fail-closed default
    N.append(rounds)
    E.append(edge("loop_condition", "condition", "rounds", "condition"))

    N.append(get_var("get_inbox", "_runtime.inbox", [], 0, 0))
    N.append(get_var("get_steer_seen", "cg.steer_seen", 0, 0, 0))
    N.append(get_var("get_steering", "cg.steering", "", 0, 0))
    sf = code_node("steer_fold", "Drain steer inbox", CG.STEER_FOLD_CODE, 0, 0,
                   [pin("inbox", "inbox", "array"),
                    pin("steer_seen", "steer_seen", "number"),
                    pin("steering", "steering", "string")],
                   outputs=[pin("steering", "steering", "string"),
                            pin("seen", "seen", "number"),
                            pin("fresh", "fresh", "number")], exec_pins=True)
    N.append(sf)
    E.append(edge("get_inbox", "value", "steer_fold", "inbox"))
    E.append(edge("get_steer_seen", "value", "steer_fold", "steer_seen"))
    E.append(edge("get_steering", "value", "steer_fold", "steering"))
    N.append(set_var("set_steering", "Persist steering notes", "cg.steering", 0, 0))
    N.append(set_var("set_steer_seen", "Persist steer watermark", "cg.steer_seen", 0, 0))
    E.append(edge("steer_fold", "steering", "set_steering", "value"))
    E.append(edge("steer_fold", "seen", "set_steer_seen", "value"))

    N.append(get_var("get_state_body", "cg.loop_state",
                     {"rounds_completed": 0, "all_passed": False, "failures": []}, 0, 0))
    rl = code_node("round_line", "Compose round line", CG.ROUND_LINE_CODE, 0, 0,
                   [pin("loop_state", "loop_state", "object"),
                    pin("max_rounds", "max_rounds", "number"),
                    pin("fresh_steers", "fresh_steers", "number"),
                    pin("line_text", "line_text", "string"),
                    pin("steer_word", "steer_word", "string")],
                   outputs=[pin("message", "message", "string")], exec_pins=True)
    rl["data"]["pinDefaults"].update({"line_text": CG.ROUND_LINE_TEXT,
                                      "steer_word": CG.ROUND_STEER_WORD})
    N.append(rl)
    E.append(edge("get_state_body", "value", "round_line", "loop_state"))
    E.append(edge("start", "max_rounds", "round_line", "max_rounds"))
    E.append(edge("steer_fold", "fresh", "round_line", "fresh_steers"))
    N.append(answer_user_node("round_status", "Round progress", 0, 0))
    E.append(edge("round_line", "message", "round_status", "message"))

    N.append(code_node("builder_prompt", "Compose builder prompt", CG.BUILDER_PROMPT_CODE, 0, 0,
                       [pin("request", "request", "string"),
                        pin("workspace_root", "workspace_root", "string"),
                        pin("loop_state", "loop_state", "object"),
                        pin("steering", "steering", "string")],
                       output_type="string"))
    E.append(edge("start", "request", "builder_prompt", "request"))
    E.append(edge("start", "workspace_root", "builder_prompt", "workspace_root"))
    E.append(edge("get_state_body", "value", "builder_prompt", "loop_state"))
    E.append(edge("get_steering", "value", "builder_prompt", "steering"))
    N.append(code_node("round_mode_pins", "Round mode -> budget", CG.ROUND_MODE_PINS_CODE, 0, 0,
                       [pin("loop_state", "loop_state", "object")]))
    E.append(edge("get_state_body", "value", "round_mode_pins", "loop_state"))
    N.append(agent_node("builder", "Builder agent", 0, 0,
                        extra_inputs=[pin("workspace_root", "workspace_root", "string")],
                        pin_defaults={"system": SC.BUILDER_SYSTEM, "tools": CG.BUILDER_TOOLS,
                                      "max_iterations": 30, "temperature": 0.1}))
    E.append(edge("builder_prompt", "output", "builder", "prompt"))
    E.append(edge("round_mode_pins", "max_iterations", "builder", "max_iterations"))
    E.append(edge("start", "provider", "builder", "provider"))
    E.append(edge("start", "model", "builder", "model"))
    E.append(edge("start", "workspace_root", "builder", "workspace_root"))

    N.append(subflow_node("verify", "Run gates", VERIFY_FLOW_ID, 0, 0,
                          child_inputs=[("request", "string"),
                                        ("workspace_root", "string"),
                                        ("build_command", "string"),
                                        ("run_command", "string"),
                                        ("round_index", "number"),
                                        ("provider", "provider_text"),
                                        ("model", "model")],
                          child_outputs=[("verdict", "object")]))
    E.append(edge("start", "request", "verify", "request"))
    E.append(edge("start", "workspace_root", "verify", "workspace_root"))
    E.append(edge("start", "build_command", "verify", "build_command"))
    E.append(edge("start", "run_command", "verify", "run_command"))
    E.append(edge("rounds", "index", "verify", "round_index"))
    E.append(edge("start", "provider", "verify", "provider"))
    E.append(edge("start", "model", "verify", "model"))

    N.append(code_node("snapshot_args", "Compose snapshot copy", CG.SNAPSHOT_ARGS_CODE, 0, 0,
                       [pin("workspace_root", "workspace_root", "string"),
                        pin("round_index", "round_index", "number")]))
    E.append(edge("start", "workspace_root", "snapshot_args", "workspace_root"))
    E.append(edge("rounds", "index", "snapshot_args", "round_index"))
    N.append(call_tool_node("snapshot_call", "Snapshot round", ["execute_command"], 0, 0))
    E.append(edge("snapshot_args", "output", "snapshot_call", "tool_call"))
    N.append(code_node("next_state", "Record verdict", CG.NEXT_STATE_CODE, 0, 0,
                       [pin("verifier", "verifier", "object"),
                        pin("verify_meta", "verify_meta", "object"),
                        pin("round_index", "round_index", "number"),
                        pin("builder_report", "builder_report", "string"),
                        pin("prev_state", "prev_state", "object"),
                        pin("snapshot_ok", "snapshot_ok", "boolean")]))
    E.append(edge("verify", "verdict", "next_state", "verifier"))
    E.append(edge("verify", "output", "next_state", "verify_meta"))
    E.append(edge("rounds", "index", "next_state", "round_index"))
    E.append(edge("builder", "response", "next_state", "builder_report"))
    E.append(edge("get_state_body", "value", "next_state", "prev_state"))
    E.append(edge("snapshot_call", "success", "next_state", "snapshot_ok"))
    N.append(set_var("set_state", "Persist loop state", "cg.loop_state", 0, 0))
    E.append(edge("next_state", "output", "set_state", "value"))

    for src, tgt in (("steer_fold", "set_steering"), ("set_steering", "set_steer_seen"),
                     ("set_steer_seen", "round_line"), ("round_line", "round_status"),
                     ("round_status", "builder"), ("builder", "verify"),
                     ("verify", "snapshot_call"), ("snapshot_call", "set_state")):
        E.append(edge(src, "exec-out", tgt, "exec-in", animated=True))
    E.append(edge("rounds", "loop", "steer_fold", "exec-in", animated=True))


def _loop2_nodes(N: list, E: list) -> None:
    """LOOP 2 — spec-coding's coverage loop with the source-aware fold, judge
    prompt and unmet header; probe args/fold and judge fold are SC imports."""
    N.append(get_var("get_spec_done", "spec_done", False, 0, 0))
    N.append(code_node("spec_cond", "Coverage loop open?", SC.SPEC_COND_CODE, 0, 0,
                       [pin("done", "done", "boolean")]))
    E.append(edge("get_spec_done", "value", "spec_cond", "done"))
    sl = while_node("spec_loop", "LOOP 2: requirements coverage", 0, 0)
    sl["data"]["pinDefaults"] = {"condition": False}  # fail-closed default
    N.append(sl)
    E.append(edge("spec_cond", "condition", "spec_loop", "condition"))
    E.append(edge("rounds", "done", "spec_loop", "exec-in", animated=True))

    N.append(get_var("get_inbox2", "_runtime.inbox", [], 0, 0))
    N.append(get_var("get_steer_seen2", "cg.steer_seen", 0, 0, 0))
    N.append(get_var("get_steering2", "cg.steering", "", 0, 0))
    sf2 = code_node("spec_steer_fold", "Drain steer inbox", CG.STEER_FOLD_CODE, 0, 0,
                    [pin("inbox", "inbox", "array"),
                     pin("steer_seen", "steer_seen", "number"),
                     pin("steering", "steering", "string")],
                    outputs=[pin("steering", "steering", "string"),
                             pin("seen", "seen", "number"),
                             pin("fresh", "fresh", "number")], exec_pins=True)
    N.append(sf2)
    E.append(edge("get_inbox2", "value", "spec_steer_fold", "inbox"))
    E.append(edge("get_steer_seen2", "value", "spec_steer_fold", "steer_seen"))
    E.append(edge("get_steering2", "value", "spec_steer_fold", "steering"))
    N.append(set_var("set_steering2", "Persist steering notes", "cg.steering", 0, 0))
    N.append(set_var("set_steer_seen2", "Persist steer watermark", "cg.steer_seen", 0, 0))
    E.append(edge("spec_steer_fold", "steering", "set_steering2", "value"))
    E.append(edge("spec_steer_fold", "seen", "set_steer_seen2", "value"))

    N.append(get_var("get_items", "spec_items", [], 0, 0))
    N.append(code_node("spec_probe_args", "Compose probe command", SC.SPEC_PROBE_ARGS_CODE, 0, 0,
                       [pin("items", "items", "array"),
                        pin("workspace_root", "workspace_root", "string")],
                       outputs=[pin("tool_call", "tool_call", "object")]))
    E.append(edge("get_items", "value", "spec_probe_args", "items"))
    E.append(edge("start", "workspace_root", "spec_probe_args", "workspace_root"))
    N.append(call_tool_node("spec_probe_call", "Probe requirement coverage",
                            ["execute_command"], 0, 0))
    E.append(edge("spec_probe_args", "tool_call", "spec_probe_call", "tool_call"))

    pf = code_node("spec_probe_fold", "Read probe counts", SC.SPEC_PROBE_FOLD_CODE, 0, 0,
                   [pin("raw", "raw", "object")],
                   outputs=[pin("probe_map", "probe_map", "object"),
                            pin("ran", "ran", "boolean"),
                            pin("probed", "probed", "number")], exec_pins=True)
    N.append(pf)
    E.append(edge("spec_probe_call", "raw", "spec_probe_fold", "raw"))

    N.append(get_var("get_judge_results", "spec_judge_results", {}, 0, 0))
    jp = code_node("judge_prompt", "Compose judge task", JUDGE_PROMPT_CODE, 0, 0,
                   [pin("items", "items", "array"),
                    pin("probe_map", "probe_map", "object"),
                    pin("judge_results", "judge_results", "object"),
                    pin("workspace_root", "workspace_root", "string"),
                    pin("task_text", "task_text", "string")],
                   outputs=[pin("prompt", "prompt", "string"),
                            pin("need", "need", "boolean"),
                            pin("asked", "asked", "array")], exec_pins=True)
    jp["data"]["pinDefaults"].update({"task_text": SC.JUDGE_TASK_TEXT})
    N.append(jp)
    E.append(edge("get_items", "value", "judge_prompt", "items"))
    E.append(edge("spec_probe_fold", "probe_map", "judge_prompt", "probe_map"))
    E.append(edge("get_judge_results", "value", "judge_prompt", "judge_results"))
    E.append(edge("start", "workspace_root", "judge_prompt", "workspace_root"))
    N.append(if_node("if_judge", "Anything to judge?", 0, 0))
    E.append(edge("judge_prompt", "need", "if_judge", "condition"))
    N.append(agent_node("spec_judge", "Coverage judge (read-only)", 0, 0,
                        extra_inputs=[pin("max_output_tokens", "max_output_tokens", "number")],
                        pin_defaults={"system": SC.JUDGE_SYSTEM, "tools": SC.JUDGE_TOOLS,
                                      "max_iterations": 12, "temperature": 0.0,
                                      "resp_schema": SC.JUDGE_SCHEMA,
                                      "max_output_tokens": 4000}))
    E.append(edge("judge_prompt", "prompt", "spec_judge", "prompt"))
    E.append(edge("start", "provider", "spec_judge", "provider"))
    E.append(edge("start", "model", "spec_judge", "model"))
    jf = code_node("judge_fold", "Fold judge verdicts", SC.JUDGE_FOLD_CODE, 0, 0,
                   [pin("judge_data", "judge_data", "object"),
                    pin("judge_ok", "judge_ok", "boolean"),
                    pin("asked", "asked", "array"),
                    pin("judge_results", "judge_results", "object"),
                    pin("died_text", "died_text", "string")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    jf["data"]["pinDefaults"].update({"died_text": SC.JUDGE_DIED_NOTE_TEXT})
    N.append(jf)
    E.append(edge("spec_judge", "data", "judge_fold", "judge_data"))
    E.append(edge("spec_judge", "success", "judge_fold", "judge_ok"))
    E.append(edge("judge_prompt", "asked", "judge_fold", "asked"))
    E.append(edge("get_judge_results", "value", "judge_fold", "judge_results"))
    N.append(W.set_vars("set_judge", "Save judge verdicts", 0, 0))
    E.append(edge("judge_fold", "updates", "set_judge", "updates"))

    N.append(get_var("get_spec_round", "spec_round", 0, 0, 0))
    N.append(get_var("get_spec_iter", "spec_iter", 0, 0, 0))
    N.append(get_var("get_steering3", "cg.steering", "", 0, 0))
    sfold = code_node("spec_fold", "Coverage decision", SPEC_FOLD_CODE, 0, 0,
                      [pin("items", "items", "array"),
                       pin("probe_map", "probe_map", "object"),
                       pin("judge_results", "judge_results", "object"),
                       pin("spec_round", "spec_round", "number"),
                       pin("spec_iter", "spec_iter", "number"),
                       pin("spec_rounds", "spec_rounds", "number"),
                       pin("request", "request", "string"),
                       pin("workspace_root", "workspace_root", "string"),
                       pin("steering", "steering", "string"),
                       pin("reprompt_header", "reprompt_header", "string"),
                       pin("steer_header", "steer_header", "string"),
                       pin("unmet_header", "unmet_header", "string"),
                       pin("add_scope_text", "add_scope_text", "string"),
                       pin("selfcheck_text", "selfcheck_text", "string"),
                       pin("line_text", "line_text", "string"),
                       pin("action_build", "action_build", "string"),
                       pin("action_done", "action_done", "string")],
                      outputs=[pin("updates", "updates", "object"),
                               pin("build", "build", "boolean"),
                               pin("reprompt", "reprompt", "string"),
                               pin("line", "line", "string")], exec_pins=True)
    sfold["data"]["pinDefaults"].update({
        "reprompt_header": SC.REPROMPT_HEADER_TEXT,
        "steer_header": SC.REPROMPT_STEER_HEADER_TEXT,
        "unmet_header": REPROMPT_UNMET_HEADER_TEXT,
        "add_scope_text": SC.REPROMPT_ADD_SCOPE_TEXT,
        "selfcheck_text": SC.REPROMPT_SELFCHECK_TEXT,
        "line_text": SC.SPEC_LINE_TEXT,
        "action_build": SC.SPEC_ACTION_BUILD,
        "action_done": SC.SPEC_ACTION_DONE,
    })
    N.append(sfold)
    E.append(edge("get_items", "value", "spec_fold", "items"))
    E.append(edge("spec_probe_fold", "probe_map", "spec_fold", "probe_map"))
    E.append(edge("get_judge_results", "value", "spec_fold", "judge_results"))
    E.append(edge("get_spec_round", "value", "spec_fold", "spec_round"))
    E.append(edge("get_spec_iter", "value", "spec_fold", "spec_iter"))
    E.append(edge("start", "spec_rounds", "spec_fold", "spec_rounds"))
    E.append(edge("start", "request", "spec_fold", "request"))
    E.append(edge("start", "workspace_root", "spec_fold", "workspace_root"))
    E.append(edge("get_steering3", "value", "spec_fold", "steering"))
    N.append(W.set_vars("set_spec", "Save coverage state", 0, 0))
    E.append(edge("spec_fold", "updates", "set_spec", "updates"))
    N.append(answer_user_node("spec_status", "Coverage progress", 0, 0))
    E.append(edge("spec_fold", "line", "spec_status", "message"))
    N.append(if_node("if_build", "Scope round needed?", 0, 0))
    E.append(edge("spec_fold", "build", "if_build", "condition"))

    N.append(agent_node("spec_builder", "Scope-completion builder", 0, 0,
                        extra_inputs=[pin("workspace_root", "workspace_root", "string")],
                        pin_defaults={"system": SC.BUILDER_SYSTEM, "tools": CG.BUILDER_TOOLS,
                                      "max_iterations": 30, "temperature": 0.1}))
    E.append(edge("spec_fold", "reprompt", "spec_builder", "prompt"))
    E.append(edge("start", "provider", "spec_builder", "provider"))
    E.append(edge("start", "model", "spec_builder", "model"))
    E.append(edge("start", "workspace_root", "spec_builder", "workspace_root"))
    N.append(get_var("get_state_spec", "cg.loop_state",
                     {"rounds_completed": 0, "all_passed": False, "failures": []}, 0, 0))
    N.append(code_node("spec_round_ctx", "Continue round numbering", SC.SPEC_ROUND_CTX_CODE, 0, 0,
                       [pin("loop_state", "loop_state", "object")],
                       outputs=[pin("round_index", "round_index", "number")]))
    E.append(edge("get_state_spec", "value", "spec_round_ctx", "loop_state"))
    N.append(subflow_node("spec_verify", "Run gates (scope round)", VERIFY_FLOW_ID, 0, 0,
                          child_inputs=[("request", "string"),
                                        ("workspace_root", "string"),
                                        ("build_command", "string"),
                                        ("run_command", "string"),
                                        ("round_index", "number"),
                                        ("provider", "provider_text"),
                                        ("model", "model")],
                          child_outputs=[("verdict", "object")]))
    E.append(edge("start", "request", "spec_verify", "request"))
    E.append(edge("start", "workspace_root", "spec_verify", "workspace_root"))
    E.append(edge("start", "build_command", "spec_verify", "build_command"))
    E.append(edge("start", "run_command", "spec_verify", "run_command"))
    E.append(edge("spec_round_ctx", "round_index", "spec_verify", "round_index"))
    E.append(edge("start", "provider", "spec_verify", "provider"))
    E.append(edge("start", "model", "spec_verify", "model"))
    N.append(code_node("spec_snapshot_args", "Compose snapshot copy", CG.SNAPSHOT_ARGS_CODE, 0, 0,
                       [pin("workspace_root", "workspace_root", "string"),
                        pin("round_index", "round_index", "number")]))
    E.append(edge("start", "workspace_root", "spec_snapshot_args", "workspace_root"))
    E.append(edge("spec_round_ctx", "round_index", "spec_snapshot_args", "round_index"))
    N.append(call_tool_node("spec_snapshot_call", "Snapshot scope round",
                            ["execute_command"], 0, 0))
    E.append(edge("spec_snapshot_args", "output", "spec_snapshot_call", "tool_call"))
    N.append(code_node("spec_next_state", "Record scope-round verdict", CG.NEXT_STATE_CODE, 0, 0,
                       [pin("verifier", "verifier", "object"),
                        pin("verify_meta", "verify_meta", "object"),
                        pin("round_index", "round_index", "number"),
                        pin("builder_report", "builder_report", "string"),
                        pin("prev_state", "prev_state", "object"),
                        pin("snapshot_ok", "snapshot_ok", "boolean")]))
    E.append(edge("spec_verify", "verdict", "spec_next_state", "verifier"))
    E.append(edge("spec_verify", "output", "spec_next_state", "verify_meta"))
    E.append(edge("spec_round_ctx", "round_index", "spec_next_state", "round_index"))
    E.append(edge("spec_builder", "response", "spec_next_state", "builder_report"))
    E.append(edge("get_state_spec", "value", "spec_next_state", "prev_state"))
    E.append(edge("spec_snapshot_call", "success", "spec_next_state", "snapshot_ok"))
    N.append(set_var("set_state2", "Persist loop state", "cg.loop_state", 0, 0))
    E.append(edge("spec_next_state", "output", "set_state2", "value"))

    for src, tgt in (("spec_steer_fold", "set_steering2"),
                     ("set_steering2", "set_steer_seen2"),
                     ("set_steer_seen2", "spec_probe_call"),
                     ("spec_probe_call", "spec_probe_fold"),
                     ("spec_probe_fold", "judge_prompt"),
                     ("spec_judge", "judge_fold"),
                     ("judge_fold", "set_judge"),
                     ("spec_fold", "set_spec"),
                     ("set_spec", "spec_status"),
                     ("spec_builder", "spec_verify"),
                     ("spec_verify", "spec_snapshot_call"),
                     ("spec_snapshot_call", "set_state2")):
        E.append(edge(src, "exec-out", tgt, "exec-in", animated=True))
    E.append(edge("spec_loop", "loop", "spec_steer_fold", "exec-in", animated=True))
    E.append(edge("judge_prompt", "exec-out", "if_judge", "exec-in", animated=True))
    E.append(edge("if_judge", "true", "spec_judge", "exec-in", animated=True))
    E.append(edge("if_judge", "false", "spec_fold", "exec-in", animated=True))
    E.append(edge("set_judge", "exec-out", "spec_fold", "exec-in", animated=True))
    E.append(edge("spec_status", "exec-out", "if_build", "exec-in", animated=True))
    E.append(edge("if_build", "true", "spec_builder", "exec-in", animated=True))


def build_root() -> dict:
    f = base_flow(
        ROOT_FLOW_ID,
        "Spec-std coder — build gates + stated-and-derived requirements coverage",
        "spec-coding's two-loop pipeline with STANDARDS-AWARE extraction. ONCE, before any "
        "build, one llm_call (temperature 0, strict schema) works in two stages over the USER "
        "REQUEST ONLY: it extracts the STATED requirements, then identifies the request's FIELD "
        "of interest (as narrow as the words allow) and — only when stated items number fewer "
        "than min_reqs (default 10) — DERIVES that field's standard practices as additional "
        "requirements (source 'derived', practice_note = why it is standard, hard cap 16 "
        "total; stated always kept first, derived duplicates of stated scope dropped "
        "mechanically, zero derived on rich prompts). LOOP 1 is coding-agent's verify-gated "
        "build loop. LOOP 2 measures coverage of ALL items — stated and derived alike — with "
        "one shell probe command, a read-only quoted-evidence judge, and scope-completion "
        "rounds whose unmet lines mark derived items FIELD STANDARD with their rationale. "
        "THREE-STATE throughout; passed = gates green AND nothing uncovered (derived included); "
        "exhaustion reports 'STOPPED: N requirements uncovered (S stated + D derived)'. "
        "gating_mode is accepted for family parity and recorded; no human gate in v0.1.0.",
        interfaces=[CODING_INTERFACE])
    N, E = f["nodes"], f["edges"]

    N.append(node("start", "on_flow_start", "Coding request", 0, 0,
                  outputs=[EXEC_OUT,
                           pin("request", "request", "string"),
                           pin("workspace_root", "workspace_root", "string"),
                           pin("gating_mode", "gating_mode", "string"),
                           pin("browser_probe_available", "browser_probe_available", "boolean"),
                           pin("build_command", "build_command", "string"),
                           pin("run_command", "run_command", "string"),
                           pin("max_rounds", "max_rounds", "number"),
                           pin("spec_rounds", "spec_rounds", "number"),
                           pin("min_reqs", "min_reqs", "number"),
                           pin("provider", "provider", "provider_text"),
                           pin("model", "model", "model")],
                  pin_defaults={"request": "", "workspace_root": "", "gating_mode": "wait",
                                "browser_probe_available": False, "build_command": "",
                                "run_command": "", "max_rounds": 3, "spec_rounds": 3,
                                "min_reqs": 10}))

    pfl = code_node("preflight", "Preflight", PREFLIGHT_CODE, 0, 0,
                    [pin("request", "request", "string"),
                     pin("workspace_root", "workspace_root", "string"),
                     pin("gating_mode", "gating_mode", "string"),
                     pin("browser_probe_available", "browser_probe_available", "boolean"),
                     pin("empty_request_text", "empty_request_text", "string"),
                     pin("no_workspace_text", "no_workspace_text", "string"),
                     pin("refusal_header_text", "refusal_header_text", "string")],
                    outputs=[pin("updates", "updates", "object"),
                             pin("report", "report", "string")], exec_pins=True)
    pfl["data"]["pinDefaults"].update({
        "empty_request_text": SC.PREFLIGHT_EMPTY_REQUEST_TEXT,
        "no_workspace_text": SC.PREFLIGHT_NO_WORKSPACE_TEXT,
        "refusal_header_text": SC.PREFLIGHT_REFUSAL_HEADER_TEXT,
    })
    N.append(pfl)
    for pid in ("request", "workspace_root", "gating_mode", "browser_probe_available"):
        E.append(edge("start", pid, "preflight", pid))
    N.append(W.set_vars("seed_vars", "Seed run variables", 0, 0))
    E.append(edge("preflight", "updates", "seed_vars", "updates"))
    N.append(if_node("if_preflight", "Preflight ok?", 0, 0))
    read_pin(N, E, "if_preflight", "condition", "preflight_ok", False, 0, 0)
    N.append(node("end_pre", "on_flow_end", "Refused (preflight)", 0, 0,
                  inputs=[EXEC_IN, *_end_pins()],
                  pin_defaults=dict(END_PIN_DEFAULTS)))
    E.append(edge("preflight", "report", "end_pre", "report"))

    # requirement extraction — ONCE, user prompt only, before any build;
    # two stages (stated + field-derived) in the one call
    N.append(code_node("reqs_prompt", "Compose extraction prompt", REQS_PROMPT_CODE, 0, 0,
                       [pin("request", "request", "string"),
                        pin("task_text", "task_text", "string"),
                        pin("cap", "cap", "number"),
                        pin("min_reqs", "min_reqs", "number")],
                       outputs=[pin("prompt", "prompt", "string")]))
    for n_ in N:
        if n_["id"] == "reqs_prompt":
            n_["data"]["pinDefaults"].update({"task_text": REQS_TASK_TEXT, "cap": 12,
                                              "min_reqs": 10})
    E.append(edge("start", "request", "reqs_prompt", "request"))
    E.append(edge("start", "min_reqs", "reqs_prompt", "min_reqs"))
    N.append(llm_node("extract_reqs", "Extract requirements + field standards (once)", 0, 0,
                      pin_defaults={"system": REQS_SYSTEM, "temperature": 0.0,
                                    "resp_schema": REQ_SCHEMA}))
    E.append(edge("reqs_prompt", "prompt", "extract_reqs", "prompt"))
    E.append(edge("start", "provider", "extract_reqs", "provider"))
    E.append(edge("start", "model", "extract_reqs", "model"))
    rf = code_node("reqs_fold", "Sanitize requirements (stated first)", REQS_FOLD_CODE, 0, 0,
                   [pin("data", "data", "object"),
                    pin("ok", "ok", "boolean"),
                    pin("cap", "cap", "number"),
                    pin("min_reqs", "min_reqs", "number"),
                    pin("line_text", "line_text", "string"),
                    pin("fail_note_text", "fail_note_text", "string"),
                    pin("empty_note_text", "empty_note_text", "string")],
                   outputs=[pin("updates", "updates", "object"),
                            pin("line", "line", "string")], exec_pins=True)
    rf["data"]["pinDefaults"].update({"cap": 12, "min_reqs": 10, "line_text": REQS_LINE_TEXT,
                                      "fail_note_text": SC.REQS_FAIL_NOTE_TEXT,
                                      "empty_note_text": SC.REQS_EMPTY_NOTE_TEXT})
    N.append(rf)
    E.append(edge("extract_reqs", "data", "reqs_fold", "data"))
    E.append(edge("extract_reqs", "success", "reqs_fold", "ok"))
    E.append(edge("start", "min_reqs", "reqs_fold", "min_reqs"))
    N.append(W.set_vars("set_reqs", "Save requirements", 0, 0))
    E.append(edge("reqs_fold", "updates", "set_reqs", "updates"))
    N.append(answer_user_node("reqs_status", "Requirements extracted", 0, 0))
    E.append(edge("reqs_fold", "line", "reqs_status", "message"))

    _loop1_nodes(N, E)
    _loop2_nodes(N, E)

    N.append(code_node("final_args", "Compose final listing call",
                       CG.FINAL_LISTING_ARGS_CODE, 0, 0,
                       [pin("workspace_root", "workspace_root", "string")]))
    E.append(edge("start", "workspace_root", "final_args", "workspace_root"))
    N.append(call_tool_node("final_list", "Final delivery listing", ["list_files"], 0, 0))
    E.append(edge("final_args", "output", "final_list", "tool_call"))
    N.append(get_var("get_final_state", "cg.loop_state",
                     {"rounds_completed": 0, "all_passed": False, "failures": []}, 0, 0))
    rep = code_node("spec_report", "Assemble result", SPEC_REPORT_CODE, 0, 0,
                    [pin("loop_state", "loop_state", "object"),
                     pin("items", "items", "array"),
                     pin("met", "met", "object"),
                     pin("unmet", "unmet", "array"),
                     pin("unknown", "unknown", "array"),
                     pin("field", "field", "string"),
                     pin("spec_round", "spec_round", "number"),
                     pin("spec_rounds", "spec_rounds", "number"),
                     pin("stop_reason", "stop_reason", "string"),
                     pin("extract_note", "extract_note", "string"),
                     pin("judge_note", "judge_note", "string"),
                     pin("max_rounds", "max_rounds", "number"),
                     pin("final_listing", "final_listing", "any"),
                     pin("final_listing_ok", "final_listing_ok", "boolean")],
                    outputs=[pin("report", "report", "string"),
                             pin("passed", "passed", "boolean"),
                             pin("delivered", "delivered", "boolean"),
                             pin("ok", "ok", "boolean"),
                             pin("rounds_used", "rounds_used", "number"),
                             pin("spec_rounds_used", "spec_rounds_used", "number"),
                             pin("field_out", "field_out", "string"),
                             pin("open_failures", "open_failures", "array"),
                             pin("artifacts", "artifacts", "array"),
                             pin("unmet_out", "unmet_out", "array"),
                             pin("requirements", "requirements", "array")], exec_pins=True)
    N.append(rep)
    E.append(edge("get_final_state", "value", "spec_report", "loop_state"))
    read_pin(N, E, "spec_report", "items", "spec_items", [], 0, 0, chip="rep_items")
    read_pin(N, E, "spec_report", "met", "spec_met", {}, 0, 0, chip="rep_met")
    read_pin(N, E, "spec_report", "unmet", "spec_unmet", [], 0, 0, chip="rep_unmet")
    read_pin(N, E, "spec_report", "unknown", "spec_unknown", [], 0, 0, chip="rep_unknown")
    read_pin(N, E, "spec_report", "field", "spec_field", "", 0, 0, chip="rep_field")
    read_pin(N, E, "spec_report", "spec_round", "spec_round", 0, 0, 0, chip="rep_round")
    read_pin(N, E, "spec_report", "stop_reason", "spec_stop_reason", "", 0, 0, chip="rep_reason")
    read_pin(N, E, "spec_report", "extract_note", "spec_extract_note", "", 0, 0,
             chip="rep_extract_note")
    read_pin(N, E, "spec_report", "judge_note", "spec_judge_note", "", 0, 0,
             chip="rep_judge_note")
    E.append(edge("start", "spec_rounds", "spec_report", "spec_rounds"))
    E.append(edge("start", "max_rounds", "spec_report", "max_rounds"))
    E.append(edge("final_list", "result", "spec_report", "final_listing"))
    E.append(edge("final_list", "success", "spec_report", "final_listing_ok"))

    N.append(node("end", "on_flow_end", "Finish", 0, 0,
                  inputs=[EXEC_IN, *_end_pins()],
                  pin_defaults=dict(END_PIN_DEFAULTS)))
    for src_pin, end_pin in (("report", "report"), ("passed", "passed"),
                             ("delivered", "delivered"), ("ok", "success"),
                             ("rounds_used", "rounds_used"),
                             ("spec_rounds_used", "spec_rounds_used"),
                             ("field_out", "field"),
                             ("open_failures", "open_failures"),
                             ("artifacts", "artifacts"), ("unmet_out", "unmet"),
                             ("requirements", "requirements")):
        E.append(edge("spec_report", src_pin, "end", end_pin))

    E.append(edge("start", "exec-out", "preflight", "exec-in", animated=True))
    E.append(edge("preflight", "exec-out", "seed_vars", "exec-in", animated=True))
    E.append(edge("seed_vars", "exec-out", "if_preflight", "exec-in", animated=True))
    E.append(edge("if_preflight", "false", "end_pre", "exec-in", animated=True))
    E.append(edge("if_preflight", "true", "extract_reqs", "exec-in", animated=True))
    E.append(edge("extract_reqs", "exec-out", "reqs_fold", "exec-in", animated=True))
    E.append(edge("reqs_fold", "exec-out", "set_reqs", "exec-in", animated=True))
    E.append(edge("set_reqs", "exec-out", "reqs_status", "exec-in", animated=True))
    E.append(edge("reqs_status", "exec-out", "rounds", "exec-in", animated=True))
    E.append(edge("spec_loop", "done", "final_list", "exec-in", animated=True))
    E.append(edge("final_list", "exec-out", "spec_report", "exec-in", animated=True))
    E.append(edge("spec_report", "exec-out", "end", "exec-in", animated=True))

    W.apply_flow_layout(f)
    write_json(FLOWS_DIR / f"{ROOT_FLOW_ID}.json", f)
    return f


def build_wrapper() -> dict:
    f = base_flow(
        WRAPPER_FLOW_ID,
        "Spec-std coder — chat entry (stated + field-standard requirements coverage)",
        "Chat-agent entrypoint for the spec-std-coding pipeline: one strict-schema extraction "
        "reads the prompt ONCE, keeps the STATED requirements, identifies the request's field "
        "of interest and — only when stated items are fewer than min_reqs (default 10) — "
        "derives that field's standard practices as additional requirements (source 'derived', "
        "never duplicating or contradicting stated scope; zero derived on requirement-rich "
        "prompts). Then coding-agent's verify-gated build loop runs, and a coverage loop "
        "probes the delivered bytes and spends up to spec_rounds scope-completion rounds on "
        "EVERY uncovered requirement, derived ones marked FIELD STANDARD. The answer is the "
        "report with a requirements table (✓/✗/? per item, source column); meta carries "
        "passed, the unmet list and the identified field. workspace_root is required (refused "
        "at the door). gating_mode and tools are accepted for the coder-family bench parity; "
        "v0.1.0 has no human gate and the pipeline's tool allowlists are fixed by design. "
        "Unattended runs send gating_mode=auto and input_data._runtime.tool_policy = "
        "{\"auto_approve_tools\": [\"execute_command\", \"read_file\", \"write_file\", "
        "\"edit_file\", \"list_files\", \"search_files\", \"skim_files\", \"skim_folders\", "
        "\"analyze_code\", \"browser_probe\"]}.",
        interfaces=[AGENT_INTERFACE])
    N, E = f["nodes"], f["edges"]
    N.append(node("start", "on_flow_start", "Prompt", 0, 0,
                  outputs=[EXEC_OUT,
                           pin("prompt", "prompt", "string"),
                           pin("provider", "provider", "provider_text"),
                           pin("model", "model", "model"),
                           pin("tools", "tools", "array"),
                           pin("workspace_root", "workspace_root", "string"),
                           pin("gating_mode", "gating_mode", "string"),
                           pin("browser_probe_available", "browser_probe_available", "boolean"),
                           pin("max_rounds", "max_rounds", "number"),
                           pin("spec_rounds", "spec_rounds", "number"),
                           pin("min_reqs", "min_reqs", "number")],
                  pin_defaults={"prompt": "", "workspace_root": "", "gating_mode": "wait",
                                "browser_probe_available": True,
                                "max_rounds": 3, "spec_rounds": 3, "min_reqs": 10}))
    N.append(subflow_node("build", "Run the spec-std-coding pipeline", ROOT_FLOW_ID, 0, 0,
                          child_inputs=[("request", "string"),
                                        ("workspace_root", "string"),
                                        ("gating_mode", "string"),
                                        ("browser_probe_available", "boolean"),
                                        ("max_rounds", "number"),
                                        ("spec_rounds", "number"),
                                        ("min_reqs", "number"),
                                        ("provider", "provider_text"),
                                        ("model", "model")],
                          child_outputs=[("report", "string"),
                                         ("passed", "boolean"),
                                         ("delivered", "boolean"),
                                         ("success", "boolean"),
                                         ("rounds_used", "number"),
                                         ("spec_rounds_used", "number"),
                                         ("field", "string"),
                                         ("open_failures", "array"),
                                         ("artifacts", "array"),
                                         ("unmet", "array"),
                                         ("requirements", "array")]))
    E.append(edge("start", "prompt", "build", "request"))
    for pid in ("workspace_root", "gating_mode", "browser_probe_available",
                "max_rounds", "spec_rounds", "min_reqs", "provider", "model"):
        E.append(edge("start", pid, "build", pid))
    ans = code_node("answer", "Compose answer", WRAPPER_ANSWER_CODE, 0, 0,
                    [pin("report", "report", "string"),
                     pin("child_success", "child_success", "boolean"),
                     pin("passed", "passed", "boolean"),
                     pin("unmet", "unmet", "array"),
                     pin("requirements", "requirements", "array"),
                     pin("field", "field", "string"),
                     pin("rounds_used", "rounds_used", "number"),
                     pin("spec_rounds_used", "spec_rounds_used", "number"),
                     pin("child_result", "child_result", "object"),
                     pin("died_text", "died_text", "string"),
                     pin("unknown_error_text", "unknown_error_text", "string")],
                    outputs=[pin("response", "response", "string"),
                             pin("ok", "ok", "boolean"),
                             pin("meta", "meta", "object")], exec_pins=True)
    ans["data"]["pinDefaults"].update({"died_text": SC.WRAPPER_DIED_TEXT,
                                       "unknown_error_text": SC.WRAPPER_UNKNOWN_ERROR_TEXT})
    N.append(ans)
    E.append(edge("build", "report", "answer", "report"))
    E.append(edge("build", "success", "answer", "child_success"))
    E.append(edge("build", "passed", "answer", "passed"))
    E.append(edge("build", "unmet", "answer", "unmet"))
    E.append(edge("build", "requirements", "answer", "requirements"))
    E.append(edge("build", "field", "answer", "field"))
    E.append(edge("build", "rounds_used", "answer", "rounds_used"))
    E.append(edge("build", "spec_rounds_used", "answer", "spec_rounds_used"))
    E.append(edge("build", "output", "answer", "child_result"))
    N.append(node("end", "on_flow_end", "Answer", 0, 0,
                  inputs=[EXEC_IN, pin("response", "response", "string"),
                          pin("success", "success", "boolean"),
                          pin("meta", "meta", "object")],
                  pin_defaults={"response": "", "success": False, "meta": {}}))
    E.append(edge("start", "exec-out", "build", "exec-in", animated=True))
    E.append(edge("build", "exec-out", "answer", "exec-in", animated=True))
    E.append(edge("answer", "exec-out", "end", "exec-in", animated=True))
    E.append(edge("answer", "response", "end", "response"))
    E.append(edge("answer", "ok", "end", "success"))
    E.append(edge("answer", "meta", "end", "meta"))

    W.apply_flow_layout(f)
    write_json(FLOWS_DIR / f"{WRAPPER_FLOW_ID}.json", f)
    return f


# ---------------------------------------------------------------------------
# BUILD-TIME ASSERTS
# ---------------------------------------------------------------------------
def _assert_identity_isolation() -> None:
    """The LIVE spec-coding bundle must be untouchable from here: every id
    this generator writes differs from spec-coding's, and the base import is
    the same object spec-coding builds from."""
    assert BUNDLE_ID != SC.BUNDLE_ID, "bundle id collides with the live spec-coding bundle"
    mine = {ROOT_FLOW_ID, VERIFY_FLOW_ID, WRAPPER_FLOW_ID}
    theirs = {SC.ROOT_FLOW_ID, SC.VERIFY_FLOW_ID, SC.WRAPPER_FLOW_ID}
    clash = mine & theirs
    assert not clash, f"flow id(s) {sorted(clash)} collide with spec-coding's flow files"


def _assert_std_schema() -> None:
    req = REQ_SCHEMA["properties"]["items"]["items"]["required"]
    assert "source" in req and "practice_note" in req, "items schema lost source/practice_note"
    assert "field" in REQ_SCHEMA["required"], "top-level field is not required"
    src = REQ_SCHEMA["properties"]["items"]["items"]["properties"]["source"]
    assert src.get("enum") == ["stated", "derived"], "source enum is not the closed pair"
    assert "ZERO derived items" in REQS_TASK_TEXT, "rich-prompt zero-derivation clause missing"
    assert "{{min_reqs}}" in REQS_TASK_TEXT and "{{max_total}}" in REQS_TASK_TEXT
    # the sandbox bodies cannot read Python constants — the hard cap rides as
    # a literal and must agree with the declared one in BOTH clamps
    cap_lit = str(HARD_TOTAL_CAP)
    assert ("if mr > " + cap_lit) in REQS_PROMPT_CODE, "prompt clamp lost the hard total cap"
    assert ("if minr > " + cap_lit) in REQS_FOLD_CODE, "fold clamp lost the hard total cap"
    assert ("room = " + cap_lit + " - len(stated)") in REQS_FOLD_CODE, "fill lost the cap bound"


def _assert_source_reporting() -> None:
    assert "| id | met | source | kind |" in SPEC_REPORT_CODE, "table lost the source column"
    assert " stated + " in SPEC_REPORT_CODE, "headline lost the stated/derived split"
    assert "FIELD STANDARD" in SPEC_FOLD_CODE, "reprompt lost the field-standard marking"
    # 0.1.1 second-opinion contract
    assert '"judge: "' in SPEC_FOLD_CODE, "second-opinion met lost its 'judge: ' prefix"
    assert "second opinion: " in JUDGE_PROMPT_CODE, "judge prompt lost the second-opinion lane"
    assert "IMPLEMENTATION VARIANTS" in REQS_TASK_TEXT, "prompt lost the variant-pattern rule"


def _assert_min_reqs_wired(root: dict, wrapper: dict) -> None:
    for flow, nid in ((root, "reqs_prompt"), (root, "reqs_fold")):
        n_ = next(n for n in flow["nodes"] if n["id"] == nid)
        assert any(p["id"] == "min_reqs" for p in n_["data"]["inputs"]), f"{nid}: no min_reqs pin"
    for flow in (root, wrapper):
        start = next(n for n in flow["nodes"] if n["id"] == "start")
        have = {p["id"] for p in start["data"]["outputs"]}
        assert "min_reqs" in have, f"{flow['id']}: start lacks the min_reqs pin"


def _assert_wrapper_contract(wrapper: dict) -> None:
    start = next(n for n in wrapper["nodes"] if n["id"] == "start")
    have = {p["id"] for p in start["data"]["outputs"]}
    needed = {"prompt", "workspace_root", "gating_mode", "provider", "model",
              "browser_probe_available", "tools", "max_rounds", "spec_rounds", "min_reqs"}
    missing = needed - have
    if missing:
        raise AssertionError(f"spec-std-coder wrapper start is missing pins: {sorted(missing)}")


def main() -> int:
    _assert_identity_isolation()
    _assert_std_schema()
    _assert_source_reporting()

    verify = build_verify()
    root = build_root()
    wrapper = build_wrapper()

    SC._assert_three_state_probe_line(verify)
    _assert_wrapper_contract(wrapper)
    SC._assert_steer_hook(root)
    SC._assert_extraction_outside_loops(root)
    _assert_min_reqs_wired(root, wrapper)

    ok = True
    for fid, flow in ((VERIFY_FLOW_ID, verify), (ROOT_FLOW_ID, root),
                      (WRAPPER_FLOW_ID, wrapper)):
        problems = validate_edges(flow)
        if problems:
            ok = False
            print(f"EDGE PROBLEMS ({fid}):")
            for p in problems:
                print("  " + p)
        if fid != VERIFY_FLOW_ID:
            overlaps = W.layout_overlap_findings(flow)
            if overlaps:
                ok = False
                print(f"LAYOUT OVERLAPS ({fid}): {len(overlaps)}")
                for finding in overlaps[:10]:
                    print("  " + finding)
    if not ok:
        return 1
    print(f"Wrote {ROOT_FLOW_ID}.json ({len(root['nodes'])} nodes, {len(root['edges'])} edges)"
          f" + {VERIFY_FLOW_ID}.json ({len(verify['nodes'])} nodes, base 0.2.6 copy)"
          f" + {WRAPPER_FLOW_ID}.json ({len(wrapper['nodes'])} nodes, agent.v1 entrypoint)")

    if "--pack" in sys.argv:
        from wf_common import compile_check, pack_bundle
        compile_check(ROOT_FLOW_ID, [ROOT_FLOW_ID, VERIFY_FLOW_ID, WRAPPER_FLOW_ID])
        compile_check(WRAPPER_FLOW_ID, [ROOT_FLOW_ID, VERIFY_FLOW_ID, WRAPPER_FLOW_ID])
        out = pack_bundle(
            root_flow_id=WRAPPER_FLOW_ID, bundle_id=BUNDLE_ID,
            bundle_version=BUNDLE_VERSION,
            entrypoints=[ROOT_FLOW_ID, WRAPPER_FLOW_ID],
            metadata={
                "family": "spec-std-coding",
                "min_runtime": "0.4.30",
                "purpose": (
                    "spec-coding's verify-gated build loop + requirements-coverage loop, with "
                    "STANDARDS-AWARE extraction: one strict-schema call extracts the STATED "
                    "requirements from the user prompt, identifies the request's field of "
                    "interest, and — only when stated items number fewer than min_reqs "
                    "(default 10) — derives that field's recognized standard practices as "
                    "additional requirements (source 'derived', practice_note rationale, "
                    "hard cap 16 total, stated always kept first, mechanical dedup against "
                    "stated scope, zero derived on requirement-rich prompts). Derived items "
                    "are enforced exactly like stated ones: same grep/file/judge probes, same "
                    "three-state coverage loop, same scope-completion rounds (unmet derived "
                    "lines marked FIELD STANDARD with the practice rationale), and they count "
                    "against passed. Report table carries a source column; exhaustion reports "
                    "'STOPPED: N requirements uncovered (S stated + D derived)'. "
                    "Dual-interface: coding.v1 root 'spec-std-coding' + agent.v1 wrapper "
                    "'spec-std-coder' (picker-visible), spec-coder's wrapper pins plus "
                    "min_reqs."),
                "gating": {"pin": "gating_mode", "values": ["wait", "auto"],
                           "default": "wait",
                           "note": "accepted for family parity and recorded; v0.1.0 has no "
                                   "human gate — both modes run unattended"},
                "steering": {"channel": "inject_guidance", "var": "_runtime.inbox",
                             "applied": "at every loop-1 round and every coverage iteration, "
                                        "deduped by the run-owned cg.steer_seen watermark, "
                                        "folded into builder prompts and scope reprompts"},
                "progress_line": "coding round N of M / coverage check K",
                "outputs": ["report", "passed", "delivered", "success", "rounds_used",
                            "spec_rounds_used", "field", "open_failures", "artifacts",
                            "unmet", "requirements"],
                "auto_mode_requirement": (
                    "unattended runs must auto-approve the pipeline's tools: send "
                    "input_data._runtime.tool_policy = {\"auto_approve_max_risk_rank\": 2, "
                    "\"auto_approve_tools\": [\"execute_command\", \"read_file\", "
                    "\"write_file\", \"edit_file\", \"list_files\", \"search_files\", "
                    "\"skim_files\", \"skim_folders\", \"analyze_code\", \"browser_probe\"]} "
                    "or drive approvals externally, else the run parks on the coverage probe "
                    "or the first tool the builder asks for"),
            })
        print(f"Packed {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
