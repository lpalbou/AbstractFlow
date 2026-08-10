#!/usr/bin/env python3
"""Generator for the SPEC-CODING family — coding-agent's verify-gated build
loop PLUS an explicit requirements-coverage loop (operator's DigitalArticle:
"two loops"; adversarially-reviewed design 2026-08-01; 0.2.0 same day).

WHAT IT ADDS over coding-agent: SCOPE as a first-class, mechanically-probed
contract. `extract_reqs` (ONE llm_call, temperature 0, strict schema, USER
PROMPT ONLY) produces requirement items {id, requirement, kind, source,
practice_note, probe, proxy_note}; LOOP 1 is the base build->gates->verify
loop (imported LIVE from build_coding_agent_workflow, 0.2.6 three-state
lineage); LOOP 2 probes the delivered bytes and spends scope-completion
rounds on uncovered items until covered or budget. THREE-STATE LAW
throughout: missing evidence is UNKNOWN, routes to judgment, never decides.

0.2.0 (this file) — the measured wall of 0.1.0 was: static probes verify
code PRESENCE, not runtime REACHABILITY (a coverage table can honestly say
"maps -> 22 matches" while the product plays as one screen). Changes:

  1. RUN-PROBE CLASS (general, artifact-class-agnostic): probe.type "run" =
     {cmd (new schema field), pattern (doubles as expect_pattern), min_count}.
     `cmd` is ONE bounded shell line executed in the workspace via the same
     execute_command path the builder itself uses (no privilege change); its
     OUTPUT is the evidence, parsed with the same "REQ <id> COUNT <c> MIN
     <m>" discipline. The extraction prompt teaches cmds that echo their own
     REQ line; the composer wraps cmds that don't (count output lines
     matching pattern, or exit-status 0 => count 1 when pattern is '').
     Run probes ride a SECOND bounded execute_command (timeout-capped) so a
     hung run cmd cannot destroy the grep/file evidence batch. Unparseable
     output = UNKNOWN, never false. A failing run count joins the judge
     second-opinion lane (the cmd may target a wrong entry name), but the
     counted evidence is primary — the judge (which mounts no tools inside
     while-subflows on current runtimes, a known defect) is never the only
     rescue; the real rescue is the reprompt, which names the exact command
     the builder must make pass.
  2. REACHABILITY IS STATED SCOPE (general derivation rule): every request
     for a runnable artifact implicitly requires that the artifact FUNCTIONS
     when exercised. The extractor must emit at least one kind 'behavior'
     item with a 'run' probe per user-facing runtime surface (CLI example
     exits 0, endpoint answers, page scripts parse+load, pipeline processes
     a sample). This holds with derive_standards on OR off, and the fold
     keeps one derived run-probe item even on rich prompts (reachability is
     not "extra standards", it is delivery).
  3. SPECSTD FOLDED IN behind `derive_standards` (pin, default true): the
     spec-std 0.1.3 two-stage extraction (stated first, then field-standard
     practices derived only when stated < min_reqs, hard cap 16), `source`
     column + practice notes in the table/reprompt, the glob doctrine
     (grep globs widen to '*' unless the requirement names a file kind), the
     duplicate-drop belt, and the 0.1.1 grep second-opinion lane. With
     derive_standards false the fold mechanically drops derived items
     (except the single reachability net above).
  4. BUDGET REBALANCE (measured: builds never fail; coverage does):
     max_rounds default 3->2, spec_rounds default 3->4.

DEVIATIONS from the reviewed design (argued):
  - `spec_judge` is an AGENT node, not a bare llm_node: a `llm_call` emits
    ONE LLM_CALL effect and returns tool_calls as data — nothing executes
    them (effect_adapter.create_llm_call_handler), so a tool-reading judge is
    impossible as a single llm node. The base idiom for "LLM with read-only
    tools returning a strict schema" is exactly the coding-agent VERIFIER
    (agent node + tools + resp_schema); the design's own rule ("prefer the
    base idiom") selects it.
  - The probe command re-probes ALL grep/file items every spec iteration,
    not only the unmet ones: the command is one execute_command either way
    (zero marginal cost) and re-probing is what DETECTS a scope regression
    ("never regress covered scope" becomes observable, not just requested).
    Judge verdicts stay sticky once met (bounded LLM cost, per the design's
    "only unknown/judge items").
  - No R2 best-snapshot RESTORE band: loop 2 keeps changing the workspace
    after loop 1, and the requirements table is measured against the LAST
    bytes — restoring an older snapshot would deliver bytes the table never
    measured. Snapshots themselves are kept (forensics + the base
    NEXT_STATE machinery stays byte-identical).
  - `gating_mode` / `browser_probe_available` / `tools` are accepted on the
    wrapper for the seven-pin family parity (ralph/react/multiagent bench
    contract) and recorded in run vars; this family has no ask_user gate
    (both gating modes run unattended) and the builder toolset is fixed by
    the base family's design. Stated here and in the flow description rather
    than silently swallowed.

INTERFACES: `spec-coding` (abstractcode.coding.v1 root) + `spec-coder`
(abstractcode.agent.v1 chat entry) + `spec-verify-gates` (this bundle's own
copy of the base verification subflow — bundle-local flow id, so the two
bundles never share a mutable artifact).
"""
from __future__ import annotations

import json
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

# The base machinery, imported LIVE — code bodies, the verifier schema and the
# whole gates subflow come from the CURRENT file, so the 0.2.6 three-state
# probe fix (and any later fix) rides into this bundle at pack time instead of
# rotting as a hand copy.
import build_coding_agent_workflow as CG

BUNDLE_ID = "spec-coding"
BUNDLE_VERSION = "0.2.0"
ROOT_FLOW_ID = "spec-coding"
VERIFY_FLOW_ID = "spec-verify-gates"
WRAPPER_FLOW_ID = "spec-coder"
CODING_INTERFACE = "abstractcode.coding.v1"

# The judge READS, never edits — coverage judgment with edit tools would let
# the judge "fix" its way to met (the fox-and-henhouse class).
JUDGE_TOOLS = ["read_file", "list_files", "search_files"]

# Builder persona — verbatim from build_coding_agent_workflow.build_root_flow
# (inline literal there, so it cannot be imported by name).
BUILDER_SYSTEM = (
    "You are a senior coding agent. You create and edit real files in the workspace to satisfy "
    "the task, using the file and shell tools. Prefer minimal, runnable code. When given "
    "specific prior failures, fix exactly those."
)

REQS_SYSTEM = (
    "You are a requirements extraction engine. You convert a user's coding request into a small "
    "set of mechanically checkable requirements: the scope the request STATES, plus, when the "
    "request is thin and derivation is enabled, requirements DERIVED from the recognized best "
    "practices of the request's field of interest. You answer ONLY with the structured object "
    "the response schema defines. You never invent stated requirements the request does not "
    "state, you never omit a deliverable it does state, you label every derived item source "
    "'derived' with its practice rationale, and a derived item never duplicates or contradicts "
    "stated scope. You always include runtime-evidence ('run') probes for the artifact's "
    "user-facing surfaces: code that exists but does not function when exercised is not "
    "delivery."
)

JUDGE_SYSTEM = (
    "You are a strict requirements-coverage judge. You never edit files. You inspect the "
    "delivered workspace with read-only tools and return the structured verdict the schema "
    "defines. A requirement is met=true ONLY if you actually observed it in the delivered files "
    "THIS session and can quote the file path plus a short verbatim excerpt as evidence; if you "
    "did not or could not observe it, it is met=false with the absence stated. You never guess "
    "and you never rely on file names alone."
)

# Strict-expressible (the airelay 422 class, same rule as CG.VERIFIER_SCHEMA):
# additionalProperties false => every property required; the model emits empty
# strings where a field does not apply (judge probes carry pattern "").
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
                        "required": ["type", "pattern", "glob", "min_count", "cmd"],
                        "properties": {
                            "type": {"type": "string",
                                     "enum": ["grep", "file", "run", "judge"]},
                            "pattern": {"type": "string"},
                            "glob": {"type": "string"},
                            "min_count": {"type": "number"},
                            "cmd": {"type": "string"},
                        },
                    },
                    "proxy_note": {"type": "string"},
                },
            },
        },
    },
}

JUDGE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["items"],
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "met", "evidence"],
                "properties": {
                    "id": {"type": "string"},
                    "met": {"type": "boolean"},
                    "evidence": {"type": "string"},
                },
            },
        },
    },
}

# ---------------------------------------------------------------------------
# EDITABLE TEXT (pin defaults with {{slots}} — the ralph idiom for NEW nodes;
# loop-1 nodes keep the base's own texts via the CG import)
# ---------------------------------------------------------------------------
REQS_TASK_TEXT = (
    "# Extract testable requirements from a coding request — stated scope first, then field "
    "standards\n\n"
    "USER REQUEST (verbatim — extract from THIS TEXT ONLY, never from any file or workspace):\n"
    "{{request}}\n\n"
    "Produce ONE items[] list in TWO stages, plus the top-level `field` string.\n\n"
    "STAGE 1 — STATED requirements (source \"stated\", practice_note \"\", ids r1, r2, ...). "
    "One item per distinct deliverable the request itself names, quoting the request's own "
    "words where possible. AT MOST {{cap}} stated items (fewer well-chosen items beat "
    "padding). Never invent stated scope the request does not contain — with ONE exception "
    "that is ALWAYS stated scope: REACHABILITY (rule below).\n\n"
    "{{stage2}}\n\n"
    "REACHABILITY IS STATED SCOPE: a request for a runnable artifact implicitly requires that "
    "the artifact actually FUNCTIONS when exercised — the presence of code is not delivery. "
    "Include at least ONE kind 'behavior' item with a type 'run' probe for every user-facing "
    "runtime surface the request implies: a CLI's documented invocation exits 0 and prints "
    "what it promises; an HTTP service's endpoint answers; a web page's script files parse "
    "cleanly so the page can load them; a library's example call returns the promised value; "
    "a pipeline processes a small sample end to end. Name the entry file you expect in the "
    "requirement text itself (index.html, main.py, cli.js, ...) — the probe command is part "
    "of the delivery contract and the builder will be told to make exactly that command "
    "pass.\n\n"
    "EVERY item (both stages):\n"
    "- id: short stable id (r1, r2, ... for stated; d1, d2, ... for derived).\n"
    "- requirement: the requirement in one sentence; stated items quote the request's own "
    "words where possible.\n"
    "- kind: 'content' (something must exist in the delivered files), 'behavior' (something "
    "must react or change at runtime), or 'aesthetic' (look/feel quality).\n"
    "- source: \"stated\" or \"derived\" exactly as defined above.\n"
    "- practice_note: derived items only — the field-standard rationale; empty string for "
    "stated items.\n"
    "- probe: how an orchestrator can check coverage mechanically against the DELIVERED "
    "artifact. Unused fields are always the empty string '' (cmd '' for non-run probes, glob "
    "'' for non-grep probes):\n"
    "  - type 'grep': pattern = a grep -E regex expected to match the delivered source code "
    "once the requirement is implemented. Match CODE CONSTRUCTS (identifiers, API calls — "
    "e.g. addEventListener\\(['\"]key|onkeydown|keydown for key input, "
    "requestAnimationFrame|setInterval for a frame loop, localStorage|sessionStorage for "
    "persistence), never prose words that could sit in a comment or README. glob = the "
    "--include file glob ('*.js', '*.py', '*'). min_count = the minimum TOTAL matching-line "
    "count that counts as covered. cmd ''.\n"
    "  - type 'file': pattern = the exact file name (or shell glob) that must exist; "
    "min_count = how many files must match (usually 1). glob '', cmd ''.\n"
    "  - type 'run': RUNTIME EVIDENCE — cmd = ONE bounded shell line the orchestrator "
    "executes inside the workspace root after every build; the command's OUTPUT is the "
    "evidence. HARD BOUNDS: the line MUST terminate on its own within ~20 seconds — one-shot "
    "commands only; never leave a server, watcher or REPL running (if you must start one, "
    "kill it in the SAME line). Prefer commands that END by echoing their own verdict line, "
    "exactly: echo \"REQ <id> COUNT $c MIN <min_count>\" where $c is the measured count. If "
    "your cmd echoes no REQ line, the orchestrator wraps it mechanically: it counts the "
    "cmd's output lines matching pattern (pattern = an ERE the promised output matches), or "
    "when pattern is '' it counts exit status 0 as 1. min_count = the count that means "
    "covered. Worked shapes per artifact class (adapt to the actual request, never copy "
    "blindly):\n"
    "    - library/module: run its test suite or a one-line import+call and count PASS/ok "
    "lines, e.g. c=$(python3 -m pytest -q 2>&1 | grep -Ec 'passed'); echo \"REQ d1 COUNT $c "
    "MIN 1\"\n"
    "    - CLI tool: invoke the documented example on sample input; pattern matches the "
    "promised output; or exit-status form for 'runs cleanly' (cmd runs it, pattern '').\n"
    "    - web page/app: prove every script parses so the page can load, e.g. c=$(for f in "
    "*.js; do node --check \"$f\" 2>/dev/null && echo ok; done | wc -l); echo \"REQ r2 COUNT "
    "$c MIN 1\" — with inline-script pages, extract-and-check or fall back to grep.\n"
    "    - HTTP service: exercise the handler IN-PROCESS, unit-test style — e.g. c=$(python3 "
    "-c 'import app; print(app.app.test_client().get(\"/health\").status_code)' | grep -c "
    "200); echo \"REQ r3 COUNT $c MIN 1\" — never leave a process running (tool policy may "
    "refuse process-termination verbs like kill, and a lingering server forfeits the whole "
    "probe batch's evidence).\n"
    "    - data pipeline/script: run it on tiny sample input and count the promised output "
    "rows/files.\n"
    "  - type 'judge': ONLY for requirements neither a regex nor a command can decide. ALL "
    "'aesthetic' items MUST use 'judge'. pattern '', glob '', cmd '', min_count 1.\n"
    "- proxy_note: one sentence recording WHY this probe approximates the requirement, "
    "including any threshold reasoning.\n\n"
    "SCALE WORDS ARE THRESHOLDS: when the request says vast/many/various/several/numerous/"
    "lots or similar, you MUST turn it into a countable proxy with a stated min_count "
    "(default 4 unless the request implies more) and record that choice in proxy_note.\n"
    "PATTERNS MUST COVER IMPLEMENTATION VARIANTS: a grep pattern is an ERE alternation of "
    "ALL the common ways the field implements the construct — a narrow pattern that misses a "
    "legitimate variant falsely reports absence and burns rework on code that already "
    "exists.\n"
    "Prefer 'run' where exercising the artifact can decide, 'grep'/'file' where counting "
    "source can decide; 'judge' only when neither can. Keep regexes simple alternations of "
    "identifiers, case-sensitive."
)

# Stage-2 slot, derivation ON (derive_standards=true — the specstd fold-in).
REQS_STAGE2_DERIVE_TEXT = (
    "STAGE 2 — FIELD + DERIVED standards (source \"derived\", ids d1, d2, ...). First set "
    "`field` to the request's field of interest, as NARROW as the request's own words allow "
    "(e.g. 'browser canvas action game', not 'web application'; 'command-line CSV tool', not "
    "'software'). Then, IF AND ONLY IF there are fewer than {{min_reqs}} stated items, ADD "
    "derived requirements — practices a competent practitioner of that field treats as "
    "standard — until stated+derived reaches {{min_reqs}} (never more than {{max_total}} "
    "items total). If stated items already number {{min_reqs}} or more, return ZERO derived "
    "items: the request already gives enough requirements. Each derived item's practice_note "
    "is one sentence naming the practice and why that field considers it standard. Derive "
    "the standards of the ACTUAL field (a CLI tool: --help text, exit codes, stdin/stdout "
    "composability, errors to stderr; a browser game: responsive input, a real frame loop, "
    "collision handling, HUD, more than one screen; a data pipeline: schema validation, "
    "idempotent re-runs, logging; a REST service: status codes, input validation, a health "
    "endpoint).\n"
    "DERIVED DISCIPLINE (a violation makes the item worthless):\n"
    "- A derived item NEVER duplicates, rephrases or partially overlaps a stated item — "
    "stated wins; derive a DIFFERENT practice or fewer items.\n"
    "- A derived item NEVER contradicts the request.\n"
    "- Order derived items most-fundamental-first: items past the budget are dropped from "
    "the END of the derived list.\n"
    "- Derived items are held to the SAME probes as stated ones."
)

# Stage-2 slot, derivation OFF (derive_standards=false): field is still named
# (it is a run-visible fact), zero derived items — but the REACHABILITY rule
# above still stands, because reachability is stated scope, not standards.
REQS_STAGE2_OFF_TEXT = (
    "STAGE 2 — FIELD ONLY (standards derivation is DISABLED for this run): set `field` to "
    "the request's field of interest, as NARROW as the request's own words allow. Return "
    "ZERO source \"derived\" items — the only permitted addition beyond the request's own "
    "deliverables is the REACHABILITY item(s) described below, which are stated scope."
)

REQS_LINE_TEXT = (
    "requirements: {{n}} total — {{stated}} stated + {{derived}} derived "
    "(field: {{field}}; {{probe}} probe-able incl {{run}} runtime, {{judge}} judge-only)"
)
REQS_FAIL_NOTE_TEXT = (
    "#FALLBACK: requirement extraction failed — the coverage loop has nothing to check and the "
    "run degrades to the plain gated build"
)
REQS_EMPTY_NOTE_TEXT = (
    "#FALLBACK: requirement extraction returned no items — the coverage loop has nothing to check"
)
REQS_NO_RUN_NOTE_TEXT = (
    "#FALLBACK: no runtime-evidence (run) probe was extracted — coverage will verify code "
    "presence only, not that the artifact functions when exercised"
)

JUDGE_TASK_TEXT = (
    "Judge whether each requirement below is ACTUALLY covered by the delivered files in the "
    "workspace: {{workspace}}\n\n"
    "For EACH requirement, inspect the real files with your read-only tools (list_files, "
    "read_file, search_files) and return one items[] entry {id, met, evidence}.\n\n"
    "EVIDENCE DISCIPLINE (mechanically enforced after you answer): met=true is accepted ONLY "
    "when evidence quotes the workspace-relative file path AND a short verbatim excerpt from a "
    "file you actually read in this session, e.g.: game.js: \"ctx.fillText('Score: ' + score, "
    "8, 16)\". A met=true whose evidence quotes no file is automatically counted UNMET. For "
    "met=false, state what you looked for and where it was absent. If you could not determine "
    "coverage, say so in evidence and set met=false — never guess met=true.\n\n"
    "Judge ONLY the requirements listed here, nothing else:\n{{items}}"
)
JUDGE_DIED_NOTE_TEXT = (
    "#FALLBACK: the coverage judge failed before returning a verdict — judge-only items stay "
    "UNVERIFIED (?) rather than being guessed either way"
)

SPEC_LINE_TEXT = "coverage check {{k}}: {{met}} met, {{unmet}} unmet, {{unknown}} unverified — {{action}}"
SPEC_ACTION_BUILD = "scope-completion round {{n}} of {{max}}"
SPEC_ACTION_DONE = "done ({{reason}})"

REPROMPT_HEADER_TEXT = (
    "# SCOPE COMPLETION ROUND — mechanical probes of the delivered files show the requirements "
    "listed below are NOT yet covered. This round ADDS the missing scope to the existing "
    "artifact.\n\n# The full original coding task"
)
REPROMPT_STEER_HEADER_TEXT = (
    "# OPERATOR STEERING (live — arrived while this run was working; it amends the task above)"
)
REPROMPT_UNMET_HEADER_TEXT = (
    "# Requirements NOT yet covered (evidence of absence, from mechanical probes over the "
    "delivered files, runtime probe commands executed against the artifact, and the read-only "
    "coverage judge). Items marked FIELD STANDARD were derived from the recognized best "
    "practices of this request's field — the operator requires them followed exactly like "
    "stated scope:"
)
REPROMPT_ADD_SCOPE_TEXT = (
    "ADD the missing content/behavior; additions are expected and may be large; never regress "
    "covered scope. Extend the artifact IN PLACE: read the existing files first, keep what "
    "works, and make the entrypoint actually load anything you add (an unreferenced file is a "
    "delivery failure). Each evidence line above names how the requirement will be re-checked — "
    "make that check pass for real, never by planting tokens in comments. A 'run [...]' "
    "evidence line quotes the EXACT shell command that will be re-executed in the workspace "
    "root: make that command succeed as given — create or rename the entry file it targets if "
    "needed, and run it yourself with execute_command to confirm before finishing."
)
# The base C8/R3 hash-binding contract, restated for scope rounds: the gates
# subflow re-runs G5 after EVERY round, so a scope round that edits files
# without refreshing SELFCHECK.md would fail the round on a stale hash.
REPROMPT_SELFCHECK_TEXT = (
    "Before finishing, update SELFCHECK.md in the workspace: for EACH behavior the task names, "
    "one line stating how you verified it and the CONCRETE evidence you observed. MANDATORY "
    "HASH BINDING (a deterministic gate recomputes this): AFTER your FINAL edit, compute the "
    "sha256 of every file you claim (execute_command: shasum -a 256 <path>) and END SELFCHECK.md "
    "with one line per claimed file, exactly this format:\n"
    "ARTIFACT-SHA256: <workspace-relative-path> <sha256>\n"
    "If ANY byte of a claimed file changes after its hash line was computed, the round FAILS "
    "('artifact modified after last self-verification') — so once your self-probe passes, STOP."
)

PREFLIGHT_EMPTY_REQUEST_TEXT = (
    "no coding request was provided (send `prompt` on the spec-coder wrapper, or `request` on "
    "the root)"
)
PREFLIGHT_NO_WORKSPACE_TEXT = (
    "no workspace_root was provided; the requirements probes and gates run real shell commands "
    "against a real directory, so an unknown workspace is refused"
)
PREFLIGHT_REFUSAL_HEADER_TEXT = "REFUSED AT THE DOOR — the spec coding loop did not start:"

WRAPPER_DIED_TEXT = (
    "The spec coding run did not finish: {{error}}\n\nThe workspace holds whatever the completed "
    "rounds delivered; the run's own trace holds the failing step."
)
WRAPPER_UNKNOWN_ERROR_TEXT = "the child run ended without producing a report"

# ---------------------------------------------------------------------------
# CODE BODIES (RestrictedPython sandbox: no imports, no augmented subscript
# assignment, string work only; shq/text_of are runtime-granted helpers)
# ---------------------------------------------------------------------------
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
if bool(derive_standards):
    body = body.replace("{{stage2}}", str(stage2_derive_text or ""))
else:
    body = body.replace("{{stage2}}", str(stage2_off_text or ""))
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

# Sanitize the two-stage extraction: ids to a safe charset (echoed through
# shell and parsed back), kinds/types/sources to closed enums, aesthetic =>
# judge by CONSTRUCTION. Extraction failure NEVER fails the run — it degrades
# to the plain gated build with a #FALLBACK note. Specstd belts: stated kept
# FIRST (cap 12); derived fills only up to min_reqs - stated when
# derive_standards is on (total never above 16); dupes of stated scope drop;
# grep glob doctrine (widen to '*' unless the requirement names a file kind).
# Run-probe belts: cmd must be ONE line <= 400 chars or the item downgrades
# to judge (unknown lane, never a fabricated verdict); REACHABILITY NET: one
# derived run item is kept even when fill is 0 (rich prompt or
# derive_standards off) if no kept item carries runtime evidence.
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
    if t not in ("grep", "file", "run", "judge"):
        t = "judge"
    if kind == "aesthetic":
        t = "judge"
    pat = str(p.get("pattern") or "").replace("\r", " ").replace("\n", " ").strip()
    if t in ("grep", "file") and not pat:
        t = "judge"
    cmd = str(p.get("cmd") or "").strip()
    if t == "run":
        if (not cmd) or ("\n" in cmd) or ("\r" in cmd) or len(cmd) > 400:
            t = "judge"
            cmd = ""
    else:
        cmd = ""
    g = str(p.get("glob") or "").strip()
    if not g:
        g = "*"
    if t == "grep" and g != "*":
        # Glob doctrine (std 0.1.2): inline-JS-in-HTML is a legitimate
        # implementation variant; a '*.js' glob excluded it and turned present
        # features into count-0 "evidence of absence". Widen unless the
        # REQUIREMENT itself names a language/file kind. Explicit loop, NOT a
        # generator expression (RestrictedPython rejects the generator form).
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
             "probe": {"type": t, "pattern": pat, "glob": g, "min_count": mc, "cmd": cmd},
             "proxy_note": str(it.get("proxy_note") or "").strip()}
    if src == "stated":
        if len(stated) < capn:
            stated.append(entry)
    else:
        derived.append(entry)
if bool(derive_standards):
    fill = minr - len(stated)
else:
    fill = 0
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
    if p2["type"] == "run" and p2["cmd"]:
        sig.add("run|~|" + p2["cmd"].lower())
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
    if p2["type"] == "run" and p2["cmd"]:
        k1 = "run|~|" + p2["cmd"].lower()
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
# REACHABILITY NET: runtime evidence is delivery, not extra standards — if no
# kept item has a run probe, rescue the first non-duplicate derived run item
# even when fill is 0 (rich prompts, derive_standards off). Cap 16 holds.
has_run = False
for x in stated:
    if x["probe"]["type"] == "run":
        has_run = True
        break
if not has_run:
    for x in kept_derived:
        if x["probe"]["type"] == "run":
            has_run = True
            break
if not has_run and len(stated) + len(kept_derived) < 16:
    for x in derived:
        if x["probe"]["type"] != "run":
            continue
        already = False
        for y in kept_derived:
            if y["id"] == x["id"]:
                already = True
                break
        if already:
            continue
        rk = ""
        for c in x["requirement"].lower():
            if c.isalnum():
                rk = rk + c
        if ("req|~|" + rk) in sig:
            continue
        kept_derived.append(x)
        has_run = True
        break
clean = stated + kept_derived
probeable = 0
run_n = 0
for x in clean:
    if x["probe"]["type"] in ("grep", "file", "run"):
        probeable = probeable + 1
    if x["probe"]["type"] == "run":
        run_n = run_n + 1
note = ""
if not bool(ok):
    note = str(fail_note_text or "")
elif len(clean) == 0:
    note = str(empty_note_text or "")
elif run_n == 0:
    note = str(no_run_note_text or "")
msg = str(line_text or "")
msg = msg.replace("{{n}}", str(len(clean)))
msg = msg.replace("{{stated}}", str(len(stated)))
msg = msg.replace("{{derived}}", str(len(kept_derived)))
msg = msg.replace("{{field}}", field if field else "unidentified")
msg = msg.replace("{{probe}}", str(probeable))
msg = msg.replace("{{run}}", str(run_n))
msg = msg.replace("{{judge}}", str(len(clean) - probeable))
if dropped_dupes > 0:
    msg = msg + " — " + str(dropped_dupes) + " derived duplicate(s) of stated scope dropped"
if note:
    msg = msg + " — " + note
return {"updates": {"spec_items": clean, "spec_field": field, "spec_extract_note": note},
        "line": msg}
""".strip()

SPEC_COND_CODE = r"""
return {"condition": not bool(done)}
""".strip()

# ONE command over every grep/file probe (re-probing met items each pass is
# free and detects scope regression). Safety: LLM-authored patterns ride
# inside single quotes with shq (command injection closed); the awk sums the
# per-file counts of `grep -rEc`; file targets are charset-whitelisted and
# deliberately UNQUOTED so shell globs expand ('-'-prefix and '..' refused).
# An item whose probe cannot be composed safely simply emits NO line — the
# fold routes it to the judge as unknown, never to a fabricated verdict.
SPEC_PROBE_ARGS_CODE = r"""
items_l = items if isinstance(items, list) else []
ws = str(workspace_root or "").strip()
idset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
globset = idset + "./*?"
segs = []
for it in items_l:
    if not isinstance(it, dict):
        continue
    p = it.get("probe")
    if not isinstance(p, dict):
        continue
    t = str(p.get("type") or "")
    if t not in ("grep", "file"):
        continue
    rid = ""
    for c in str(it.get("id") or ""):
        if c in idset:
            rid = rid + c
    if not rid:
        continue
    try:
        mc = int(p.get("min_count") or 1)
    except Exception:
        mc = 1
    if mc < 1:
        mc = 1
    if mc > 999:
        mc = 999
    pat = str(p.get("pattern") or "").strip()
    if t == "grep":
        if (not pat) or ("\n" in pat) or ("\r" in pat) or len(pat) > 200:
            continue
        g = str(p.get("glob") or "").strip()
        gok = len(g) > 0
        for c in g:
            if c not in globset:
                gok = False
                break
        if not gok:
            g = "*"
        segs.append("c=$(grep -rEc '" + shq(pat) + "' --include='" + shq(g)
                    + "' . 2>/dev/null | awk -F: '{s+=$2} END {print s+0}'); echo \"REQ "
                    + rid + " COUNT $c MIN " + str(mc) + "\"")
    else:
        target = pat
        tok = len(target) > 0 and len(target) <= 120
        if target.startswith("-") or ".." in target:
            tok = False
        for c in target:
            if c not in globset:
                tok = False
                break
        if not tok:
            continue
        segs.append("c=$(ls -1 " + target + " 2>/dev/null | wc -l); echo \"REQ "
                    + rid + " COUNT $c MIN " + str(mc) + "\"")
cmd = "true"
if segs:
    body = "; ".join(segs)
    if ws:
        cmd = "cd '" + shq(ws) + "' && " + body
    else:
        cmd = body
return {"tool_call": {"name": "execute_command",
                      "arguments": {"command": cmd, "timeout": 120},
                      "call_id": "spec-probe"}}
""".strip()

# The run-probe batch: a SECOND bounded execute_command so a hung run cmd
# cannot destroy the grep/file evidence. Per item, three composition forms:
#   1. cmd already echoes "REQ <id>"  -> trusted as-is inside ( ... );
#   2. pattern set -> wrap: count the cmd's output lines matching pattern;
#   3. pattern ''  -> exit-status form: exit 0 => COUNT 1.
# The cmd is LLM-authored shell run through the SAME execute_command tool the
# builder agent already holds — no privilege change. A cmd that cannot be
# composed safely emits NO line: unknown, judge's lane, never a false verdict.
# Newline-joined so one broken segment damages as little as possible.
SPEC_RUN_ARGS_CODE = r"""
items_l = items if isinstance(items, list) else []
ws = str(workspace_root or "").strip()
idset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
segs = []
for it in items_l:
    if not isinstance(it, dict):
        continue
    p = it.get("probe")
    if not isinstance(p, dict):
        continue
    if str(p.get("type") or "") != "run":
        continue
    rid = ""
    for c in str(it.get("id") or ""):
        if c in idset:
            rid = rid + c
    if not rid:
        continue
    try:
        mc = int(p.get("min_count") or 1)
    except Exception:
        mc = 1
    if mc < 1:
        mc = 1
    if mc > 999:
        mc = 999
    cmd = str(p.get("cmd") or "").strip()
    if (not cmd) or ("\n" in cmd) or ("\r" in cmd) or len(cmd) > 400:
        continue
    pat = str(p.get("pattern") or "").strip()
    if ("\n" in pat) or ("\r" in pat) or len(pat) > 200:
        pat = ""
    if ("REQ " + rid) in cmd:
        segs.append("( " + cmd + " )")
    elif pat:
        segs.append("c=$( { " + cmd + " ; } 2>&1 | grep -Ec '" + shq(pat)
                    + "' ); echo \"REQ " + rid + " COUNT $c MIN " + str(mc) + "\"")
    else:
        segs.append("{ " + cmd + " ; } >/dev/null 2>&1 && c=1 || c=0; echo \"REQ "
                    + rid + " COUNT $c MIN " + str(mc) + "\"")
cmdline = "true"
if segs:
    body = "\n".join(segs)
    if ws:
        cmdline = "cd '" + shq(ws) + "' || exit 0\n" + body
    else:
        cmdline = body
return {"tool_call": {"name": "execute_command",
                      "arguments": {"command": cmdline, "timeout": 240},
                      "call_id": "spec-run-probe"}}
""".strip()

# Parse-what-ran (the gate5 lesson): REQ lines are read out of whatever text
# the two tool envelopes carry, regardless of the calls' own success flags.
# Accepts the full 6-token "REQ id COUNT c MIN m" line AND the 4-token
# "REQ id COUNT c" form (a run cmd that echoed its count without the MIN
# suffix) — min then comes from the item's own min_count. An item with no
# line is simply ABSENT from the map — unknown, judge's lane. Later lines
# overwrite earlier ones, so the orchestrator's own wrapper echo (last in a
# segment) beats any stray REQ-looking text in the artifact's output.
SPEC_PROBE_FOLD_CODE = r"""
txt = text_of(raw) + "\n" + text_of(raw2)
items_l = items if isinstance(items, list) else []
minmap = {}
for it in items_l:
    if not isinstance(it, dict):
        continue
    p = it.get("probe")
    if not isinstance(p, dict):
        continue
    mv = 1
    try:
        mv = int(p.get("min_count") or 1)
    except Exception:
        mv = 1
    if mv < 1:
        mv = 1
    minmap[str(it.get("id") or "")] = mv
pm = {}
for ln in txt.split("\n"):
    bits = [b for b in ln.strip().split(" ") if b]
    if len(bits) >= 4 and bits[0] == "REQ" and bits[2] == "COUNT":
        rid = bits[1]
        cnt = -1
        try:
            cnt = int(bits[3])
        except Exception:
            cnt = -1
        if cnt < 0:
            continue
        mn = 0
        if len(bits) >= 6 and bits[4] == "MIN":
            try:
                mn = int(bits[5])
            except Exception:
                mn = 0
        if mn < 1:
            mn = minmap.get(rid, 1)
        if mn < 1:
            mn = 1
        pm[rid] = {"count": cnt, "min": mn}
return {"probe_map": pm, "ran": len(pm) > 0, "probed": len(pm)}
""".strip()

# Candidates = judge-typed items + any probe item whose probe produced no
# line (unknown routes TO judgment — three-state) + the SECOND-OPINION lane
# (std 0.1.1, extended to run): a grep count below threshold may be pattern
# blindness, a run count below threshold may be a cmd targeting the wrong
# entry file — both join the judge with the counted context quoted. file
# counts stay counted-only; a count that PASSES is never re-litigated.
# Judge-met verdicts are sticky; judge-unmet items are re-judged after each
# scope round because the build may have covered them.
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
    if t in ("grep", "file", "run") and rid in pm:
        r = pm.get(rid)
        cnt = 0
        mn = 1
        if isinstance(r, dict):
            cnt = int(r.get("count") or 0)
            mn = int(r.get("min") or 1)
        if t == "file" or cnt >= mn:
            continue
        if t == "grep":
            snote = ("counting probe found " + str(cnt) + " of min " + str(mn)
                     + " for pattern '" + str(p.get("pattern") or "") + "' — the pattern may "
                     "be blind to an equivalent construct; verify by READING the delivered "
                     "files whether the requirement is genuinely implemented in any form")
        else:
            snote = ("runtime probe command [" + str(p.get("cmd") or "") + "] measured "
                     + str(cnt) + " of min " + str(mn) + " — the command may target a wrong "
                     "entry file or an output shape this artifact does not use; verify by "
                     "READING the delivered files whether the behavior is genuinely "
                     "implemented")
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

# The auto-unmet belt: a met=true claim must carry a file-path-looking token
# AND enough text to hold an excerpt, or it is DOWNGRADED to unmet with the
# mechanism named ("unquoted claims are auto-unmet" — enforced, not asked).
# A dead judge merges NOTHING: its items stay unknown (never guessed) and a
# #FALLBACK note rides to the report.
JUDGE_FOLD_CODE = r"""
d = judge_data if isinstance(judge_data, dict) else {}
entries = d.get("items")
if not isinstance(entries, list):
    entries = []
asked_l = [str(a) for a in (asked if isinstance(asked, list) else [])]
prev = judge_results if isinstance(judge_results, dict) else {}
merged = {}
for k in prev:
    merged[k] = prev[k]
for e in entries:
    if not isinstance(e, dict):
        continue
    rid = str(e.get("id") or "")
    if rid not in asked_l:
        continue
    met_flag = bool(e.get("met"))
    ev = str(e.get("evidence") or "").strip()
    if met_flag:
        haspath = False
        for tokn in ev.replace("\n", " ").split(" "):
            tk = tokn.strip("\"'`:;,()[]")
            if len(tk) >= 4 and "." in tk[1:-1] and not tk.lower().startswith("http"):
                haspath = True
                break
        if (not haspath) or len(ev) < 15:
            met_flag = False
            ev = ("judge claimed met without quoting file evidence — auto-unmet. Claim was: "
                  + (ev if ev else "(empty)"))
    merged[rid] = {"met": met_flag, "evidence": ev}
note = ""
if judge_ok is False and len(entries) == 0:
    note = str(died_text or "")
updates = {"spec_judge_results": merged}
if note:
    updates["spec_judge_note"] = note
return {"updates": updates}
""".strip()

# The three-state decision + the SCOPE COMPLETION reprompt. Every iteration
# either finishes (covered / nothing rebuildable / budget) or spends one
# scope round — so iterations are bounded by construction, and the loop can
# only EXIT through a fresh probe of the final bytes (the build branch loops
# back to the probe, never straight to the report). ADR-0026: the reprompt
# carries the FULL request and FULL evidence lines, untruncated.
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
    if t in ("grep", "file", "run") and isinstance(r, dict):
        c = int(r.get("count") or 0)
        m = int(r.get("min") or 1)
        if t == "grep":
            head = "grep '" + pat + "'"
        elif t == "file":
            head = "files '" + pat + "'"
        else:
            head = ("run [" + str(p.get("cmd") or "") + "] expect '"
                    + (pat if pat else "exit 0") + "'")
        ev = head + " -> " + str(c) + " (min " + str(m) + ")"
        if c >= m:
            met[rid] = ev
        else:
            # second opinion (grep: pattern blindness; run: wrong-entry
            # blindness) — a quoted judge verdict may rescue; a count that
            # passed is never re-litigated; file counts are authoritative.
            second_met = False
            j = jr.get(rid)
            if t in ("grep", "run") and isinstance(j, dict) and "met" in j:
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

SPEC_ROUND_CTX_CODE = r"""
state = loop_state if isinstance(loop_state, dict) else {}
return {"round_index": int(state.get("rounds_completed", 0) or 0)}
""".strip()

# The coding-agent-style report + the requirements table. Three-state to the
# end: ✓ met with evidence, ✗ unmet with evidence of absence, ? unverified
# (probe silent and judge unavailable — reported, never resolved by fiat).
# `passed` = gates green AND nothing uncovered; any uncovered residue makes
# the headline "STOPPED: N requirements uncovered — ..." (never "done").
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
run_total = 0
run_met = 0
for it in items_l:
    if not isinstance(it, dict):
        continue
    iid = str(it.get("id") or "")
    s2 = str(it.get("source") or "stated")
    if s2 != "derived":
        s2 = "stated"
    srcmap[iid] = s2
    pnmap[iid] = str(it.get("practice_note") or "").strip()
    if s2 == "derived":
        derived_n = derived_n + 1
    else:
        stated_n = stated_n + 1
    p2 = it.get("probe")
    if isinstance(p2, dict) and str(p2.get("type") or "") == "run":
        run_total = run_total + 1
        if iid in met_m:
            run_met = run_met + 1
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
lines.append("# Spec coding result")
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
if run_total > 0:
    lines.append("Runtime evidence: " + str(run_met) + "/" + str(run_total) + " run-probe "
                 "requirement(s) met by executing the artifact (not by reading its source)")
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
             "orchestration": "spec-coding"},
}
""".strip()

# Flat run-var inventory for loop 2 (the anti-blob doctrine for NEW state).
# Loop 1 deliberately keeps the base's cg.loop_state/cg.steering/cg.steer_seen
# names and set_var blob — that state machine (NEXT_STATE_CODE) is imported
# byte-identical and its var shape is part of what "reuse the machinery"
# means. The two loops share the steering vars ON PURPOSE: a steer queued in
# loop 1 still stands in loop 2's reprompts.
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
    """This bundle's OWN copy of the base verification gates — generated by
    the base's builder at pack time, so it is the CURRENT machinery by
    construction (0.2.6 lineage: deterministic G0/G1/G4/G5/G6 gates, the
    browser-probe executes gate, and the three-state verifier probe line).
    Only identity fields change; every node, edge and code body is the
    base's."""
    f = CG.build_verifier_subflow()
    f["id"] = VERIFY_FLOW_ID
    f["name"] = VERIFY_FLOW_ID
    f["description"] = (
        "spec-coding's own copy of coding-agent's verification gates (generated from the "
        "current build_coding_agent_workflow.py at pack time; 0.2.6 lineage with the "
        "three-state canvas-liveness probe line). Deterministic delivery/integration/orphan/"
        "DOM/SELFCHECK gates first, browser_probe executes gate for web entrypoints "
        "(fail-closed), then the independent LLM verifier for builds/matches. Returns one "
        "structured verdict with fixable failures separated from environment failures."
    )
    write_json(FLOWS_DIR / f"{VERIFY_FLOW_ID}.json", f)
    return f


def _loop1_nodes(N: list, E: list) -> None:
    """LOOP 1 — the base round loop, rebuilt node-for-node from the imported
    code bodies (steer drain -> progress line -> builder -> gates subflow ->
    snapshot -> state fold). Wiring mirrors build_coding_agent_workflow.
    build_root_flow 0.2.6; only the subflow call uses wf_common's per-field
    pins (operator ruling 2026-07-30) instead of the legacy input object."""
    # loop condition (volatile get_var -> pure code -> while.condition)
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

    # steer drain (base 0.2.5 block; the runtime owns _runtime.inbox, the run
    # owns the cg.steer_seen watermark)
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

    # progress line
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

    # builder prompt + mode-shaped budget + the builder agent
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
                        pin_defaults={"system": BUILDER_SYSTEM, "tools": CG.BUILDER_TOOLS,
                                      "max_iterations": 30, "temperature": 0.1}))
    E.append(edge("builder_prompt", "output", "builder", "prompt"))
    E.append(edge("round_mode_pins", "max_iterations", "builder", "max_iterations"))
    E.append(edge("start", "provider", "builder", "provider"))
    E.append(edge("start", "model", "builder", "model"))
    E.append(edge("start", "workspace_root", "builder", "workspace_root"))

    # gates subflow (per-field pins; verdict spread onto its own handle)
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

    # R2 snapshot + the state fold (base machinery, byte-identical bodies)
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
    # verdict via the declared child pin; `output` doubles as the death
    # channel ({success:false, error} when the child run dies before its end
    # node — wf_common's subflow contract, ralph-proven).
    E.append(edge("verify", "verdict", "next_state", "verifier"))
    E.append(edge("verify", "output", "next_state", "verify_meta"))
    E.append(edge("rounds", "index", "next_state", "round_index"))
    E.append(edge("builder", "response", "next_state", "builder_report"))
    E.append(edge("get_state_body", "value", "next_state", "prev_state"))
    E.append(edge("snapshot_call", "success", "next_state", "snapshot_ok"))
    N.append(set_var("set_state", "Persist loop state", "cg.loop_state", 0, 0))
    E.append(edge("next_state", "output", "set_state", "value"))

    # loop-1 body exec spine
    for src, tgt in (("steer_fold", "set_steering"), ("set_steering", "set_steer_seen"),
                     ("set_steer_seen", "round_line"), ("round_line", "round_status"),
                     ("round_status", "builder"), ("builder", "verify"),
                     ("verify", "snapshot_call"), ("snapshot_call", "set_state")):
        E.append(edge(src, "exec-out", tgt, "exec-in", animated=True))
    E.append(edge("rounds", "loop", "steer_fold", "exec-in", animated=True))


def _loop2_nodes(N: list, E: list) -> None:
    """LOOP 2 — the requirements-coverage loop. Probe -> judge -> decide ->
    (maybe) one scope-completion build round, then RE-PROBE: the loop's only
    exit runs through a fresh measurement of the final bytes."""
    N.append(get_var("get_spec_done", "spec_done", False, 0, 0))
    N.append(code_node("spec_cond", "Coverage loop open?", SPEC_COND_CODE, 0, 0,
                       [pin("done", "done", "boolean")]))
    E.append(edge("get_spec_done", "value", "spec_cond", "done"))
    sl = while_node("spec_loop", "LOOP 2: requirements coverage", 0, 0)
    sl["data"]["pinDefaults"] = {"condition": False}  # fail-closed default
    N.append(sl)
    E.append(edge("spec_cond", "condition", "spec_loop", "condition"))
    E.append(edge("rounds", "done", "spec_loop", "exec-in", animated=True))

    # steer drain at the coverage boundary too (same watermark vars — a steer
    # queued during loop 1 still stands here, nothing is applied twice)
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

    # a. the static probe command (grep/file batch) + the SECOND, bounded
    # runtime-evidence command (run probes) — separate execute_command calls
    # so a hung run cmd cannot destroy the static evidence
    N.append(get_var("get_items", "spec_items", [], 0, 0))
    N.append(code_node("spec_probe_args", "Compose probe command", SPEC_PROBE_ARGS_CODE, 0, 0,
                       [pin("items", "items", "array"),
                        pin("workspace_root", "workspace_root", "string")],
                       outputs=[pin("tool_call", "tool_call", "object")]))
    E.append(edge("get_items", "value", "spec_probe_args", "items"))
    E.append(edge("start", "workspace_root", "spec_probe_args", "workspace_root"))
    N.append(call_tool_node("spec_probe_call", "Probe requirement coverage",
                            ["execute_command"], 0, 0))
    E.append(edge("spec_probe_args", "tool_call", "spec_probe_call", "tool_call"))
    N.append(code_node("spec_run_args", "Compose runtime probe command", SPEC_RUN_ARGS_CODE,
                       0, 0,
                       [pin("items", "items", "array"),
                        pin("workspace_root", "workspace_root", "string")],
                       outputs=[pin("tool_call", "tool_call", "object")]))
    E.append(edge("get_items", "value", "spec_run_args", "items"))
    E.append(edge("start", "workspace_root", "spec_run_args", "workspace_root"))
    N.append(call_tool_node("spec_run_call", "Execute runtime probes",
                            ["execute_command"], 0, 0))
    E.append(edge("spec_run_args", "tool_call", "spec_run_call", "tool_call"))

    # b. fold REQ lines from BOTH envelopes (4-token lines take the item's
    # own min_count — the minmap belt)
    pf = code_node("spec_probe_fold", "Read probe counts", SPEC_PROBE_FOLD_CODE, 0, 0,
                   [pin("raw", "raw", "object"),
                    pin("raw2", "raw2", "object"),
                    pin("items", "items", "array")],
                   outputs=[pin("probe_map", "probe_map", "object"),
                            pin("ran", "ran", "boolean"),
                            pin("probed", "probed", "number")], exec_pins=True)
    N.append(pf)
    E.append(edge("spec_probe_call", "raw", "spec_probe_fold", "raw"))
    E.append(edge("spec_run_call", "raw", "spec_probe_fold", "raw2"))
    E.append(edge("get_items", "value", "spec_probe_fold", "items"))

    # c. the judge (only unknown/judge items; skipped when there are none)
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
    jp["data"]["pinDefaults"].update({"task_text": JUDGE_TASK_TEXT})
    N.append(jp)
    E.append(edge("get_items", "value", "judge_prompt", "items"))
    E.append(edge("spec_probe_fold", "probe_map", "judge_prompt", "probe_map"))
    E.append(edge("get_judge_results", "value", "judge_prompt", "judge_results"))
    E.append(edge("start", "workspace_root", "judge_prompt", "workspace_root"))
    N.append(if_node("if_judge", "Anything to judge?", 0, 0))
    E.append(edge("judge_prompt", "need", "if_judge", "condition"))
    N.append(agent_node("spec_judge", "Coverage judge (read-only)", 0, 0,
                        extra_inputs=[pin("max_output_tokens", "max_output_tokens", "number")],
                        pin_defaults={"system": JUDGE_SYSTEM, "tools": JUDGE_TOOLS,
                                      "max_iterations": 12, "temperature": 0.0,
                                      "resp_schema": JUDGE_SCHEMA,
                                      "max_output_tokens": 4000}))
    E.append(edge("judge_prompt", "prompt", "spec_judge", "prompt"))
    E.append(edge("start", "provider", "spec_judge", "provider"))
    E.append(edge("start", "model", "spec_judge", "model"))
    jf = code_node("judge_fold", "Fold judge verdicts", JUDGE_FOLD_CODE, 0, 0,
                   [pin("judge_data", "judge_data", "object"),
                    pin("judge_ok", "judge_ok", "boolean"),
                    pin("asked", "asked", "array"),
                    pin("judge_results", "judge_results", "object"),
                    pin("died_text", "died_text", "string")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    jf["data"]["pinDefaults"].update({"died_text": JUDGE_DIED_NOTE_TEXT})
    N.append(jf)
    E.append(edge("spec_judge", "data", "judge_fold", "judge_data"))
    E.append(edge("spec_judge", "success", "judge_fold", "judge_ok"))
    E.append(edge("judge_prompt", "asked", "judge_fold", "asked"))
    E.append(edge("get_judge_results", "value", "judge_fold", "judge_results"))
    N.append(W.set_vars("set_judge", "Save judge verdicts", 0, 0))
    E.append(edge("judge_fold", "updates", "set_judge", "updates"))

    # d. decide + compose the scope-completion reprompt
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
        "reprompt_header": REPROMPT_HEADER_TEXT,
        "steer_header": REPROMPT_STEER_HEADER_TEXT,
        "unmet_header": REPROMPT_UNMET_HEADER_TEXT,
        "add_scope_text": REPROMPT_ADD_SCOPE_TEXT,
        "selfcheck_text": REPROMPT_SELFCHECK_TEXT,
        "line_text": SPEC_LINE_TEXT,
        "action_build": SPEC_ACTION_BUILD,
        "action_done": SPEC_ACTION_DONE,
    })
    N.append(sfold)
    E.append(edge("get_items", "value", "spec_fold", "items"))
    E.append(edge("spec_probe_fold", "probe_map", "spec_fold", "probe_map"))
    # volatile read: on the judge branch this resolves AFTER set_judge wrote
    # the merged verdicts; on the skip branch it carries the sticky ones.
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

    # the scope-completion build round: builder -> gates -> snapshot -> fold
    # (the same base machinery as loop 1; round numbering continues through
    # cg.loop_state.rounds_completed so snapshots and history stay one line)
    N.append(agent_node("spec_builder", "Scope-completion builder", 0, 0,
                        extra_inputs=[pin("workspace_root", "workspace_root", "string")],
                        pin_defaults={"system": BUILDER_SYSTEM, "tools": CG.BUILDER_TOOLS,
                                      "max_iterations": 30, "temperature": 0.1}))
    E.append(edge("spec_fold", "reprompt", "spec_builder", "prompt"))
    E.append(edge("start", "provider", "spec_builder", "provider"))
    E.append(edge("start", "model", "spec_builder", "model"))
    E.append(edge("start", "workspace_root", "spec_builder", "workspace_root"))
    N.append(get_var("get_state_spec", "cg.loop_state",
                     {"rounds_completed": 0, "all_passed": False, "failures": []}, 0, 0))
    N.append(code_node("spec_round_ctx", "Continue round numbering", SPEC_ROUND_CTX_CODE, 0, 0,
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

    # loop-2 body exec spine (if_build FALSE stays unwired: the branch ends,
    # control returns to the innermost open frame — the while — and the
    # condition reads the spec_done the fold just wrote)
    for src, tgt in (("spec_steer_fold", "set_steering2"),
                     ("set_steering2", "set_steer_seen2"),
                     ("set_steer_seen2", "spec_probe_call"),
                     ("spec_probe_call", "spec_run_call"),
                     ("spec_run_call", "spec_probe_fold"),
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
    # multi-entry join on spec_fold — exec edges only, data pins single-source
    E.append(edge("if_judge", "false", "spec_fold", "exec-in", animated=True))
    E.append(edge("set_judge", "exec-out", "spec_fold", "exec-in", animated=True))
    E.append(edge("spec_status", "exec-out", "if_build", "exec-in", animated=True))
    E.append(edge("if_build", "true", "spec_builder", "exec-in", animated=True))


def build_root() -> dict:
    f = base_flow(
        ROOT_FLOW_ID,
        "Spec coder — verify-gated build + requirements-coverage loop",
        "Two-loop coding pipeline with runtime-evidence coverage. ONCE, before any build, an "
        "llm_call extracts mechanically checkable requirements from the USER REQUEST ONLY: "
        "stated scope first (scale words become countable proxies; aesthetic items judge-only; "
        "reachability of every user-facing runtime surface is stated scope by definition), "
        "then — when derive_standards is true and stated items number under min_reqs — "
        "field-standard practices derived for the request's field of interest (source column, "
        "practice notes, hard cap 16). LOOP 1 is coding-agent's verify-gated build loop. LOOP "
        "2 measures coverage against the delivered bytes: one shell command counts grep/file "
        "probes, a SECOND bounded shell command executes 'run' probes (runtime evidence — the "
        "artifact exercised for real: CLI invoked, scripts parse-checked, endpoints curled), "
        "a read-only judge with quoted-evidence discipline decides judge items and gives "
        "second opinions on failed grep/run counts, and every still-uncovered non-aesthetic "
        "requirement drives one scope-completion build round, re-verified and re-probed, up "
        "to spec_rounds. THREE-STATE: missing evidence is unknown; unknown routes to judgment "
        "and never passes or blocks an item by itself. passed = gates green AND nothing "
        "uncovered; on exhaustion the report headline is 'STOPPED: N requirements uncovered'. "
        "gating_mode is accepted for family parity and recorded; this version has no human "
        "gate (both modes run unattended).",
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
                           pin("derive_standards", "derive_standards", "boolean"),
                           pin("provider", "provider", "provider_text"),
                           pin("model", "model", "model")],
                  # 0.2.0 budget rebalance (measured: builds never fail;
                  # coverage does): max_rounds 3->2, spec_rounds 3->4.
                  pin_defaults={"request": "", "workspace_root": "", "gating_mode": "wait",
                                "browser_probe_available": False, "build_command": "",
                                "run_command": "", "max_rounds": 2, "spec_rounds": 4,
                                "min_reqs": 10, "derive_standards": True}))

    # preflight door (the ralph idiom): a probe loop needs a real workspace
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
        "empty_request_text": PREFLIGHT_EMPTY_REQUEST_TEXT,
        "no_workspace_text": PREFLIGHT_NO_WORKSPACE_TEXT,
        "refusal_header_text": PREFLIGHT_REFUSAL_HEADER_TEXT,
    })
    N.append(pfl)
    for pid in ("request", "workspace_root", "gating_mode", "browser_probe_available"):
        E.append(edge("start", pid, "preflight", pid))
    N.append(W.set_vars("seed_vars", "Seed run variables", 0, 0, seed=SEED_VARS))
    E.append(edge("preflight", "updates", "seed_vars", "updates"))
    N.append(if_node("if_preflight", "Preflight ok?", 0, 0))
    read_pin(N, E, "if_preflight", "condition", "preflight_ok", False, 0, 0)
    N.append(node("end_pre", "on_flow_end", "Refused (preflight)", 0, 0,
                  inputs=[EXEC_IN, *_end_pins()],
                  pin_defaults=dict(END_PIN_DEFAULTS)))
    E.append(edge("preflight", "report", "end_pre", "report"))

    # requirement extraction — ONCE, user prompt only, before any build
    N.append(code_node("reqs_prompt", "Compose extraction prompt", REQS_PROMPT_CODE, 0, 0,
                       [pin("request", "request", "string"),
                        pin("task_text", "task_text", "string"),
                        pin("stage2_derive_text", "stage2_derive_text", "string"),
                        pin("stage2_off_text", "stage2_off_text", "string"),
                        pin("cap", "cap", "number"),
                        pin("min_reqs", "min_reqs", "number"),
                        pin("derive_standards", "derive_standards", "boolean")],
                       outputs=[pin("prompt", "prompt", "string")]))
    for n_ in N:
        if n_["id"] == "reqs_prompt":
            n_["data"]["pinDefaults"].update({"task_text": REQS_TASK_TEXT,
                                              "stage2_derive_text": REQS_STAGE2_DERIVE_TEXT,
                                              "stage2_off_text": REQS_STAGE2_OFF_TEXT,
                                              "cap": 12})
    E.append(edge("start", "request", "reqs_prompt", "request"))
    E.append(edge("start", "min_reqs", "reqs_prompt", "min_reqs"))
    E.append(edge("start", "derive_standards", "reqs_prompt", "derive_standards"))
    N.append(llm_node("extract_reqs", "Extract requirements (once)", 0, 0,
                      pin_defaults={"system": REQS_SYSTEM, "temperature": 0.0,
                                    "resp_schema": REQ_SCHEMA}))
    E.append(edge("reqs_prompt", "prompt", "extract_reqs", "prompt"))
    E.append(edge("start", "provider", "extract_reqs", "provider"))
    E.append(edge("start", "model", "extract_reqs", "model"))
    rf = code_node("reqs_fold", "Sanitize requirements", REQS_FOLD_CODE, 0, 0,
                   [pin("data", "data", "object"),
                    pin("ok", "ok", "boolean"),
                    pin("cap", "cap", "number"),
                    pin("min_reqs", "min_reqs", "number"),
                    pin("derive_standards", "derive_standards", "boolean"),
                    pin("line_text", "line_text", "string"),
                    pin("fail_note_text", "fail_note_text", "string"),
                    pin("empty_note_text", "empty_note_text", "string"),
                    pin("no_run_note_text", "no_run_note_text", "string")],
                   outputs=[pin("updates", "updates", "object"),
                            pin("line", "line", "string")], exec_pins=True)
    rf["data"]["pinDefaults"].update({"cap": 12, "line_text": REQS_LINE_TEXT,
                                      "fail_note_text": REQS_FAIL_NOTE_TEXT,
                                      "empty_note_text": REQS_EMPTY_NOTE_TEXT,
                                      "no_run_note_text": REQS_NO_RUN_NOTE_TEXT})
    N.append(rf)
    E.append(edge("extract_reqs", "data", "reqs_fold", "data"))
    E.append(edge("extract_reqs", "success", "reqs_fold", "ok"))
    E.append(edge("start", "min_reqs", "reqs_fold", "min_reqs"))
    E.append(edge("start", "derive_standards", "reqs_fold", "derive_standards"))
    N.append(W.set_vars("set_reqs", "Save requirements", 0, 0))
    E.append(edge("reqs_fold", "updates", "set_reqs", "updates"))
    N.append(answer_user_node("reqs_status", "Requirements extracted", 0, 0))
    E.append(edge("reqs_fold", "line", "reqs_status", "message"))

    _loop1_nodes(N, E)
    _loop2_nodes(N, E)

    # final band: terminal listing (delivery ground truth) + the report
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
    read_pin(N, E, "spec_report", "field", "spec_field", "", 0, 0, chip="rep_field")
    read_pin(N, E, "spec_report", "items", "spec_items", [], 0, 0, chip="rep_items")
    read_pin(N, E, "spec_report", "met", "spec_met", {}, 0, 0, chip="rep_met")
    read_pin(N, E, "spec_report", "unmet", "spec_unmet", [], 0, 0, chip="rep_unmet")
    read_pin(N, E, "spec_report", "unknown", "spec_unknown", [], 0, 0, chip="rep_unknown")
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

    # top-level exec spine
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
        "Spec coder — chat entry (requirements-coverage coding)",
        "Chat-agent entrypoint for the spec-coding pipeline: extracts mechanically checkable "
        "requirements from the prompt ONCE (stated scope + reachability run-probes for every "
        "runtime surface + optional field-standard derivation via derive_standards/min_reqs), "
        "runs coding-agent's verify-gated build loop, then a coverage loop that probes the "
        "delivered bytes (grep/file counts + executed 'run' probes whose output is runtime "
        "evidence + a read-only quoted-evidence judge) and spends up to spec_rounds "
        "scope-completion rounds on uncovered requirements. The answer is the report with a "
        "requirements table (✓/✗/? per item, source column); meta carries passed + the unmet "
        "list + the field. workspace_root is required (refused at the door). gating_mode and "
        "tools are accepted for the coder-family bench parity; there is no human gate (wait "
        "and auto both run unattended) and the pipeline's tool allowlists are fixed by design. "
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
                           pin("min_reqs", "min_reqs", "number"),
                           pin("derive_standards", "derive_standards", "boolean")],
                  pin_defaults={"prompt": "", "workspace_root": "", "gating_mode": "wait",
                                "browser_probe_available": True,
                                "max_rounds": 2, "spec_rounds": 4,
                                "min_reqs": 10, "derive_standards": True}))
    N.append(subflow_node("build", "Run the spec-coding pipeline", ROOT_FLOW_ID, 0, 0,
                          child_inputs=[("request", "string"),
                                        ("workspace_root", "string"),
                                        ("gating_mode", "string"),
                                        ("browser_probe_available", "boolean"),
                                        ("max_rounds", "number"),
                                        ("spec_rounds", "number"),
                                        ("min_reqs", "number"),
                                        ("derive_standards", "boolean"),
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
                "max_rounds", "spec_rounds", "min_reqs", "derive_standards",
                "provider", "model"):
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
    ans["data"]["pinDefaults"].update({"died_text": WRAPPER_DIED_TEXT,
                                       "unknown_error_text": WRAPPER_UNKNOWN_ERROR_TEXT})
    N.append(ans)
    E.append(edge("build", "report", "answer", "report"))
    E.append(edge("build", "success", "answer", "child_success"))
    E.append(edge("build", "passed", "answer", "passed"))
    E.append(edge("build", "unmet", "answer", "unmet"))
    E.append(edge("build", "requirements", "answer", "requirements"))
    E.append(edge("build", "field", "answer", "field"))
    E.append(edge("build", "rounds_used", "answer", "rounds_used"))
    E.append(edge("build", "spec_rounds_used", "answer", "spec_rounds_used"))
    # `output` is the death channel: {success:false, error} when the child run
    # dies before its end node (wf_common subflow contract).
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


def _assert_three_state_probe_line(verify_flow: dict) -> None:
    """The bundle's own gates copy MUST carry the base's 0.2.6 three-state
    verifier probe line (diag absent => canvas liveness UNKNOWN, never a
    fabricated 'canvas present: False'). Refused at build time so a stale
    base import can never ship."""
    blob = json.dumps(verify_flow, ensure_ascii=False)
    if "canvas liveness: UNKNOWN" not in blob:
        raise AssertionError(
            f"{verify_flow['id']}: the verifier prompt does not carry the three-state "
            "canvas-liveness line — the base import is stale or the copy diverged")


def _assert_wrapper_contract(wrapper: dict) -> None:
    start = next(n for n in wrapper["nodes"] if n["id"] == "start")
    have = {p["id"] for p in start["data"]["outputs"]}
    needed = {"prompt", "workspace_root", "gating_mode", "provider", "model",
              "browser_probe_available", "tools", "max_rounds", "spec_rounds",
              "min_reqs", "derive_standards"}
    missing = needed - have
    if missing:
        raise AssertionError(f"spec-coder wrapper start is missing pins: {sorted(missing)}")
    dflt = start["data"].get("pinDefaults") or {}
    assert dflt.get("max_rounds") == 2 and dflt.get("spec_rounds") == 4, (
        "0.2.0 budget rebalance regressed: wrapper defaults must be max_rounds=2, "
        f"spec_rounds=4, got {dflt.get('max_rounds')}/{dflt.get('spec_rounds')}")
    assert dflt.get("derive_standards") is True, "derive_standards must default true"


def _assert_run_probe_class(root: dict) -> None:
    """The 0.2.0 treatment must actually ship: the extraction schema accepts
    probe type 'run' with a cmd field, the extraction prompt teaches the
    reachability rule, and the runtime probe call is wired into loop 2."""
    ids = {n["id"] for n in root["nodes"]}
    assert "spec_run_args" in ids and "spec_run_call" in ids, (
        "runtime probe nodes missing from loop 2")
    enum = REQ_SCHEMA["properties"]["items"]["items"]["properties"]["probe"][
        "properties"]["type"]["enum"]
    assert "run" in enum, f"probe type enum lacks 'run': {enum}"
    req = REQ_SCHEMA["properties"]["items"]["items"]["properties"]["probe"]["required"]
    assert "cmd" in req, f"probe schema lacks required cmd: {req}"
    assert "REACHABILITY IS STATED SCOPE" in REQS_TASK_TEXT, (
        "extraction prompt lost the reachability rule")
    assert "REQ " in SPEC_RUN_ARGS_CODE, "run composer lost the REQ-line discipline"
    spine = [(e["source"], e["target"]) for e in root["edges"]
             if e.get("targetHandle") == "exec-in"]
    assert ("spec_probe_call", "spec_run_call") in spine, (
        "spec_run_call is not on the loop-2 exec spine after spec_probe_call")
    assert ("spec_run_call", "spec_probe_fold") in spine, (
        "spec_probe_fold no longer follows spec_run_call")


def _assert_steer_hook(flow: dict) -> None:
    getters = {(n["data"].get("pinDefaults") or {}).get("name")
               for n in flow["nodes"] if n["data"].get("nodeType") == "get_var"}
    assert "_runtime.inbox" in getters, f"{flow['id']}: no Get Variable reads _runtime.inbox"
    assert "cg.steer_seen" in getters, f"{flow['id']}: no steer watermark read"


def _assert_extraction_outside_loops(root: dict) -> None:
    """extract_reqs runs ONCE: nothing may exec-wire into it except the
    preflight branch, and no loop handle may reach it."""
    for e in root["edges"]:
        if e["target"] == "extract_reqs" and e["targetHandle"] == "exec-in":
            assert (e["source"], e["sourceHandle"]) == ("if_preflight", "true"), (
                f"extract_reqs is exec-wired from {e['source']}.{e['sourceHandle']} — "
                "extraction must run exactly once, before loop 1")


def main() -> int:
    verify = build_verify()
    root = build_root()
    wrapper = build_wrapper()

    _assert_three_state_probe_line(verify)
    _assert_wrapper_contract(wrapper)
    _assert_steer_hook(root)
    _assert_extraction_outside_loops(root)
    _assert_run_probe_class(root)

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
            # the verify copy keeps the base's hand layout; only the new flows
            # run the auto layout + overlap audit
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
                "family": "spec-coding",
                "min_runtime": "0.4.30",
                "purpose": (
                    "coding-agent's verify-gated build loop PLUS a requirements-coverage loop "
                    "with RUNTIME EVIDENCE (0.2.0): one strict-schema extraction from the "
                    "user prompt — stated scope (scale words become counted thresholds; "
                    "reachability of every user-facing runtime surface is stated scope: at "
                    "least one 'run' probe per surface) plus, behind derive_standards "
                    "(default true), field-standard practices derived when stated items "
                    "number under min_reqs (source column, practice notes, cap 16). Then "
                    "build->gates rounds, then while uncovered non-aesthetic requirements "
                    "remain and spec_rounds allows: one shell command counts every grep/file "
                    "probe, a second bounded shell command EXECUTES every 'run' probe (cmd "
                    "output parsed under the same REQ id COUNT c MIN m discipline; "
                    "unparseable = UNKNOWN, never false), a read-only judge with "
                    "quoted-evidence discipline decides judge items and second-opinions "
                    "failed grep/run counts, and a scope-completion round (full request + "
                    "evidence of absence, including the exact run command to satisfy) "
                    "re-builds, re-verifies and re-probes. passed = gates green AND nothing "
                    "uncovered; exhaustion reports 'STOPPED: N requirements uncovered'. "
                    "Dual-interface: coding.v1 root 'spec-coding' + agent.v1 wrapper "
                    "'spec-coder' (picker-visible), same seven wrapper pins as "
                    "ralph/react/multiagent plus max_rounds/spec_rounds/min_reqs/"
                    "derive_standards pass-throughs. Budgets rebalanced on measurement: "
                    "max_rounds default 2, spec_rounds default 4."),
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
