#!/usr/bin/env python3
"""Generator for the multi-agent coding workflow (operator directive, agora
c4710 relay). 14 steps: scouts(code+web) -> planner -> GATE1 -> backlog ->
git branch -> [build -> lint/format -> selfcheck refresh -> test(mounted
verify) -> doc -> PR -> GATE2]xN -> merge. Deterministic code handles git,
backlog, lint, selfcheck, PR plumbing and merge (no AI); agents handle scout,
plan, build, doc; two user gates (plan approval, merge approval).

Design + adversary history: docs/backlog/proposed/0152_multiagent_coding_workflow.md
(2 design cycles, 4 fable5 adversaries, 7 FATALs folded). Structural spine
mirrors build_coding_agent_workflow.py.

THE BOUNDARY (0.0.8, 2026-07-27 — operator ruling): three tiers, one rule each.
- INLINE EXPRESSION for anything a reader takes in at a glance: trivial
  state reads (`vars.state.get("accepted", False)`), simple conditions,
  one-line string builds. Never a function for a plain variable read —
  "we already have get variable"; a name would only hide it.
- LIBRARY FUNCTION only where there is ACTUAL LOGIC TO TEST or FORMATTING
  TO DO: prompt composers, tool-command composers, parsers, state folders,
  loop laws. Named, drawer-visible, testable, single-value returns.
- CODE NODE where a computation has SEVERAL OUTPUTS consumed at different
  points — fan-out is graph structure the canvas must show (`Final report`,
  `Doc drift check`), plus the genuinely multi-wire folds (`Merge scout
  context`, `Parse gate-1`, `Fold verdict`).
- CONSTANTS are pin defaults (planner schema, gate-1 choices, PR.md path),
  not computed values.
- CONFIG FOLDS INTO STATE ONCE: `mw_preflight` seeds run var `state`, so
  every helper takes (state[, value]) and call sites stay short; reads use
  `vars.state` (attribute access; state always exists past the seed node).
- Old-runtime skew: pre-expression runtimes read neither `functions` nor
  `pinExpressions`; expression-only pins fall to their defaults (falsy ->
  bounded refusal at preflight, empty report) — bounded-safe, and the
  bundle declares `metadata.min_runtime` so the gateway's enforcement gate
  refuses loudly instead of degrading at all.

Cycle-3 invariants honored (unchanged by the migration):
- NO backward exec edges: L1 plan loop + L2 build loop (`while` nodes);
  re-entry state = data in ONE fold per loop, stored in run var `state`.
- Volatile freshness: expressions evaluate at input resolution, exactly
  when the old get_var pulls fired — loop conditions re-read state fresh.
- builder + verify INLINE in L2; ONLY coding-verify-gates is mounted (as a
  drift-pinned copy `multiagent-verify-gates`).
- gates behind wait-mode `if`s: gating_mode=auto executes ZERO ask_user nodes.
- split counters: gate-2 rejection resets fix_cycles, bumps review_rounds;
  verify failures bump fix_cycles; stall guard on normalized failure signature.
- merge requires green + approval in BOTH modes; merge is deterministic
  --no-ff with conflict-abort; PR degrades honestly without remote/gh.
- git safety: parent-repo guard (toplevel==pwd), GIT_CEILING_DIRECTORIES,
  baseline commit, injected identity, slug sanitization.
- preflight: skills_resolution + browser_probe posture, honest #FALLBACK
  advisories that ride into the final report.
"""
from __future__ import annotations

import json
import pprint
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wf_common as W
from wf_common import (
    EXEC_IN, EXEC_OUT, pin, node, edge, base_flow, agent_node, code_node,
    fn, while_node, subflow_node, write_file_node,
    validate_edges, write_json, FLOWS_DIR,
)

# abstractcode.coding.v1 requires a `passed` On Flow End input (the AbstractFlow
# editor adds it to any flow declaring the interface; keep it here so a
# regenerated flow matches). `end` reads the run var `all_passed` (the last
# verification verdict); the preflight refusal `end_pre` ran no gate: False.
CODING_V1_PASSED_PIN = {**pin("passed", "passed", "boolean"),
                        "description": "True when the verification gates passed."}

BUNDLE_ID = "multiagent-coding"
# 0.0.10 (2026-07-27): wave-B adversary P2 folds — the browser_probe grant
# and the probe-protocol prompt now FOLLOW browser_probe_available (a
# probe-less gateway no longer instructs the builder to call an unmounted
# tool: the tools pin adds the probe conditionally on state.probe_ok, and
# the prompt teaches the no-tool bounded protocol instead); shq keeps falsy
# non-None text (shq(0) is "0").
# 0.0.9 (2026-07-27): code-tui asks (commons c5871) folded on top of the
# boundary cleanup: (1) a "gating: wait|auto" answer_user line right after
# the preflight door so EVERY client sees the mode at run start; (2) bundle
# metadata gains a structured `gating` marker (pin/values/default) for
# catalog-level discoverability; (3) metadata.purpose corrected — it still
# said "auto gating" for the wrapper while the real default is WAIT;
# (4) browser_probe granted to the builder + the wrapper's hardcoded
# browser_probe_available=False became a DECLARED pin defaulting true, and
# the builder prompt teaches the probe protocol (port OWNERSHIP via nonce
# round-trip, timeouts in SECONDS, nonzero exit on failure).
# 0.0.8 (2026-07-27): the boundary cleanup (operator ruling + 3 adversary
# reviews): trivial reads inlined (no function for a plain variable access),
# multi-output dict bundles dissolved — `Final report` and `Doc drift check`
# restored as code nodes with LABELED output pins (fan-out visible on the
# canvas), prompt composers reshaped to single-value returns, constants
# demoted to pin defaults (planner schema, gate-1 choices, PR.md). 31
# functions -> 28, every one real logic or formatting.
# 0.0.7 (2026-07-27): live build-cycle progress line ("build cycle N of M").
# 0.0.6 (2026-07-27): fix budget 3 -> 6; cumulative repair history; stall
# stop 2 -> 3 with named stop reason at the review gate.
# 0.0.5 (2026-07-26): function-library migration — 33 pure code nodes -> 3.
# 0.0.14 (2026-07-30): VISUAL CLARITY pass (operator ruling: "why do we need
# those stupid functions and why can't we use a simple get variable node for
# this? ... the ultimate goal is to ensure visual clarity and human readable
# visual workflows"). Two changes, one principle — nothing a reader needs is
# invisible:
#   (a) ACCESS EXPRESSIONS ELIMINATED. The five `(value or {}).get(field, d)`
#       pin expressions were field reads off a subflow's output blob; the
#       subflow nodes now DECLARE those child fields as output pins
#       (`wf_common.subflow_node(child_outputs=...)`, verified end to end
#       against the real scheduler) and each field crosses on its own wire.
#       The `parse_lint_residuals(value)` extraction became a node too. The
#       wrapper carries ZERO expressions; the family scores P1=0, P2=0.
#   (b) FOURTEEN single-use library functions became canvas nodes, with every
#       sentence they compose moved into EDITABLE PIN DEFAULTS with {{slots}}
#       — prompts, reports, advisories, markdown bodies. 26 functions/489
#       lines -> 12/218, and the twelve that stay are reused parse/format
#       helpers, two loop laws, and seven shell composers that all share shq.
# 0.0.11 (2026-07-28): operator layout pass — exec-depth auto-layout on the
# coding root (33 node overlaps -> clean audit); bundle version bump is
# load-bearing for immutable-by-sha catalog re-publish.
# 0.0.16 (2026-07-30): PINS, NOT BLOBS (operator ruling: "I do not understand
# how you can call a subflow without setting the input ... whenever you are NOT
# using the pins, it means you are HIDING something and that's very bad").
# Every subflow node in the family now DECLARES the child's on_flow_start
# fields as its own input pins, so the call contract is wired on the canvas
# instead of being assembled off it:
#   - wrapper `build`: `input:object` + the `map_input` code node that built it
#     -> six declared pins wired straight from `start` (prompt -> request is now
#     a visible rename). map_input DELETED: five of its six coercions are the
#     child door's own job and were already done there; the sixth (None probe ->
#     True) becomes the child's fail-safe `bool()` reading, reachable only on an
#     explicit caller null. The wrapper is pure wiring: start -> build ->
#     compose answer -> end, 5 nodes -> 4.
#   - root `verify`: `input:object` + the `make_object "Build JSON"` meta node
#     -> seven declared pins, each fed directly by the Get Variable chip that
#     already existed. 162 nodes -> 161.
# Measured, not assumed: a declared-but-UNWIRED, undefaulted pin is never
# written into the child's vars, so the child's own start-pin default still
# applies (absent means absent) — which is why the wrapper declares only the
# six fields it actually owns out of the child's twelve.
# 0.0.18 (2026-08-01, workflow-bench forensics: 120 calls / 57 min on a
# greenfield task where scouts+planner were pure overhead — an empty workspace
# has nothing to scout and the request already IS the plan):
#   GREENFIELD FAST-PATH. A deterministic preflight probe (ls -A, no llm) runs
#   after the gating line: if the workspace is empty or holds only dotfiles,
#   the run branches STRAIGHT to the builder — a synthesized plan carries the
#   request verbatim ("greenfield: the request is the plan"), `accepted` is
#   pre-set so the plan loop (scouts, planner, gate 1) never executes, and the
#   skip is recorded in vars (`greenfield`) + the run's status line + the final
#   report. Brownfield workspaces keep the FULL pipeline unchanged; a failed
#   probe fails SAFE to brownfield. The requirements-coverage stage considered
#   for 0.0.18 was NOT shipped (window too small to graft spec-coding's Loop 2
#   machinery responsibly); gates + review remain the quality oracle.
# 0.0.19 (2026-09-28, backlog 0890): the coding.v1 `passed` end pin reads
# all_passed (`end`) and is False on the preflight refusal (`end_pre`).
BUNDLE_VERSION = "0.0.19"
ROOT_FLOW_ID = "multiagent-coding"
VERIFY_FLOW_ID = "multiagent-verify-gates"
WRAPPER_FLOW_ID = "multiagent-coder"  # agent.v1 wrapper entrypoint (picker-visible)

# ===========================================================================
# THE RUN-VAR INVENTORY (0.0.15). There is NO `state` container any more.
#
# Operator ruling, standing since 2026-07-29 and unfulfilled through several
# waves: "the state blob, I don't think it should ever have been created, it's
# opaque and then we never see on the visual authoring which variable is
# actually used, we have to open the function and try to make sense of it.
# this is bad. ... I would completely break / remove the state blob."
#
# What the blob cost, concretely: ONE `set_var{name:"state"}` per fold, SIXTEEN
# `get_var{name:"state"}` chips reading it wholesale, and every pin expression
# spelled `vars.state.get("x")`. The canvas could not answer "which variable
# does this node use" for a single node in the flow.
#
# What replaces it: FLAT, TOP-LEVEL, TYPED run vars.
#   - writes: `set_vars` (one node per fold, `updates` = {name: value}); the
#     runtime validates every key before applying any (variable_adapter
#     `create_set_vars_node_handler`). No new node type — `set_vars` ships in
#     the catalog, so an older runtime is not fail-closed on it.
#   - reads: one `get_var{name:"<var>"}` chip per variable a node uses, wired
#     to a pin NAMED after the variable. The chips ARE the answer to "which
#     variable does this node use".
#   - config: the twelve `on_flow_start` pins ALREADY are run vars (the event
#     handler seeds `run.vars` from the caller's input_data or the pin default),
#     so nothing copies them anywhere; readers name them directly.
# Deliberately NOT done: four sub-blobs (cfg/plan/build/review). `vars.build.
# get("fix_cycles")` is the same opacity four times over and defeats the
# variable picker, `collectDeclaredVarNames`, typed-output inference and the
# preflight unknown-var check — all of which understand FLAT names only.
#
# 0.0.16: there is no surviving container ANYWHERE in the family. The last one
# was the verify subflow's `input:object` (built at the boundary by a
# `make_object` fed by seven chips) and the wrapper's `build.input` (built by a
# `map_input` code node). Both subflow nodes now DECLARE the child's
# on_flow_start fields as their own input pins, so the seven / six chips and
# start pins wire STRAIGHT IN — one hop, no meta node, nothing hidden.
# ===========================================================================

# Preflight-derived facts (written once at the seed) + the mutable progress
# vars, with their initial values. This dict is BOTH the `updates` pin default
# on the seed node — the whole inventory, visible and editable on one node, and
# the fail-closed value if that wire ever goes missing — and the shape the
# preflight body returns. Every name here is a top-level run var.
SEED_VARS = {
    # -- preflight verdict + posture (the door reads these once) --
    "preflight_ok": False,
    "preflight_failures": [],
    "wait_gating": True,      # missing/unknown gating keeps the HUMAN GATES on
    "probe_ok": False,
    "skills_degraded": False,
    "warnings": [],
    # -- budgets, typed by the door from the start-pin defaults (one source) --
    "max_plan_revisions": 3,
    "max_fix_cycles": 6,
    "max_review_rounds": 2,
    # -- plan progress --
    "accepted": False,
    "plan_revisions": 0,
    "plan": {},
    "plan_feedback": "",
    "scout_context": "",
    "rescout": False,
    "title": "",
    # -- greenfield fast-path (0.0.18): set by the deterministic probe --
    "greenfield": False,
    # -- build progress --
    "branch": "",
    "branch_slug": "",
    "fix_cycles": 0,
    "all_passed": False,
    "build_feedback": "",
    "repair_history": [],
    "last_verdict": {},
    "failure_signature": "",
    "same_signature_count": 0,
    "environment_blocked": False,
    # -- review + merge --
    "approved": False,
    "review_rounds": 0,
    "last_gate2": "",
    "merged": False,
    "user_stopped": False,
}
# The root is a strict CODING interface (request/workspace_root in, report
# out), NOT an agent.v1 chat surface: declaring agent.v1 here would invite
# chat clients to drive it with {prompt} and refuse every run at preflight -
# the exact false-contract coding-agent was burned for (its coder wrapper
# exists for that job). Cycle-3 adversary F1.
CODING_INTERFACE = "abstractcode.coding.v1"
AGENT_INTERFACE = "abstractcode.agent.v1"
# The wrapper's gating DEFAULT is "wait" (publication adversary, evidence-based
# reversal of the first "auto" choice): the primary picker client (abstractcode)
# is interactive and ANSWERS WaitReason.USER waits (react_shell _prompt_user),
# so the workflow's signature two-gate experience should be the default there;
# unattended clients (exec/serve refuse-policy) degrade NOISILY-and-bounded on
# ask_user (capped refusals then cancel), and can opt into gate-free runs by
# sending gating_mode="auto" through the DECLARED wrapper pin - no repack.
WRAPPER_GATING = "wait"

# `S` (the shared `vars.state` prefix every expression used) is DELETED with
# the blob it addressed. Expressions now name the FLAT var they read —
# `vars.workspace_root`, `vars.fix_cycles` — so the variable a pin depends on
# is legible in the pin's own text, and the loop laws spell out every input
# they weigh instead of hiding eight reads behind one opaque argument.
#
# Attribute access (`vars.x`, not `vars.get("x")`) stays deliberate: a missing
# run var must fail LOUDLY naming itself, never dissolve into a default. Every
# name an expression reads is either an `on_flow_start` pin (the event handler
# seeds run.vars from the caller or the pin default) or a `SEED_VARS` key
# written by the seed node, and `_assert_seed_precedes_var_reads` proves at
# BUILD time that the seed runs first.

# The verify subflow's `input` object is GONE (0.0.16). The subflow node
# declares the child's seven on_flow_start fields as its own input pins and the
# seven Get Variable chips wire straight into them (see `verify` in
# build_root), so the call's contract is drawn rather than assembled. This
# constant went with the blob; the `make_object` that replaced it went too.


# --- the two ACCESS-expression forms, DELETED (0.0.14) -----------------------
# `field_expr(key, default)` emitted `(value or {}).get("<key>", <default>)` and
# `var_expr(path)` emitted `(vars.get("a") or {}).get("b", {})`. They were the
# tier-1 migration's replacements for the `get` and `get_var` NODES, and they
# are exactly what the operator ruled out on 2026-07-30 ("why can't we use a
# simple get variable node for this? ... but not for ACCESS, since we already
# have the get variable"). Every call site is gone:
#   - field reads off a subflow's output -> DECLARED output pins on the subflow
#     node (`wf_common.subflow_node(child_outputs=...)`), so each field is a
#     plain wire;
#   - the verify copy's `vg.verdict` read -> the Get Variable node it always
#     had, restored (see `_assert_verdict_getter_intact`).
# The helpers are deleted rather than left unused so the form cannot creep back
# by autocomplete.


# --- catalog node builders --------------------------------------------------
# These node shapes live in wf_common (the loop-coder builders promoted them
# there); this file kept private copies of the same bodies, which is how two
# generators come to emit two different shapes for one catalog type. Bind the
# local names to the shared definitions instead — one shape, one place.
call_tool = W.call_tool_node
if_node = W.if_node


def ask_user(node_id, label, x, y, *, prompt_default=""):
    return W.ask_user_node(node_id, label, x, y, prompt_default=prompt_default)


def model_pins(N, E, cluster, agents, x, y):
    """Wire a NEIGHBOURHOOD of agents' provider/model from ONE pair of chips.

    `provider` and `model` are run inputs (`on_flow_start` pins), so reading
    them is a getter, not an expression — the operator ruling of 2026-07-30:
    a plain variable read must be a node the canvas draws, never invisible
    text on a pin.

    CLUSTERING (0.0.15, operator: "why not creating get model and get provider
    once for a given area of the graph, and reusing them on the nearby agent
    calls?"). Three clusters, MEASURED off the laid-out columns rather than
    guessed (`apply_flow_layout` pitch = NODE_WIDTH 320 + COLUMN_GAP_X 160 =
    480px/column; a pure helper takes the column of its EARLIEST consumer):

      scouts   scout_code(col 8) + scout_web(col 9)  — adjacent
      authors  planner(col 13)   + builder(col 15)   — two columns
      doc      doc(col 25)                            — ten columns out, alone

    10 chips -> 6. Every canvas metric improves at once, because the chips a
    column no longer stacks also stop pushing that column's exec lane down:

      variant                chips  nodes  p/m max  p/m mean  crossings  all-wire mean/max
      one pair per consumer    10     93    1583      721        11        550 / 3067
      + scouts shared           8     91    1583      705        10        548 / 3067
      + authors shared (SHIP)   6     89    2090      807         9        519 / 2767
      one pair for all five     2     85    7872     2910        26        774 / 7872

    "crossings" counts node boxes a getter wire passes over — the readability
    number, and the one that settles it: the shipped shape has the FEWEST (9),
    the shortest flow-wide mean wire (519px) and the shortest flow-wide max
    wire (2767px). Its longest getter wire (2090px, authors -> builder) is
    still 25% SHORTER than the longest ordinary data wire on the canvas.
    Rejected: one pair for the whole flow (a 7,872px wire to `doc` — the
    tangle the per-consumer wave was right to avoid), and clustering all three
    PLAN-LOOP agents (scouts + planner: 6 chips too, but 1022px mean and 13
    crossings — worse than the shipped shape on every number).
    """
    for name in ("provider", "model"):
        chip = f"{cluster}_{name}"
        N.append(W.get_var(chip, name, None, x, y))
        for agent_id in agents:
            E.append(edge(chip, "value", agent_id, name))
        y += 140


# THE anti-blob move, shared with every other generator (wf_common.read_vars):
# one Get Variable chip per run var a node reads, landing on a pin NAMED after
# it. Where the blob stood, each of these nodes took a single `loop_state` pin
# fed by `get_var{name:"state"}` and dug the field out inside its body, so the
# canvas said "this node uses the state" and nothing more. Now the chips beside
# a node ARE the list of variables it uses, readable without opening anything.
read_pin = W.read_pin
read_vars = W.read_vars


# ===========================================================================
# THE FLOW FUNCTION LIBRARY (tier 2). Same RestrictedPython sandbox as code
# nodes: no imports, no chr(); string concatenation only.
#
# THE BOUNDARY, 0.0.14 (operator ruling 2026-07-30): "I am ok for pure
# functions as HELPER functions (formatting, parsing, transforming), but not
# for ACCESS, since we already have the get variable for this" — and "the
# ultimate goal is to ensure visual clarity and human readable visual
# workflows". What survives here is exactly what that line blesses AND what a
# canvas node would make WORSE:
#
#  - branch_slug: a genuinely REUSED transform on the PURE lane (four call
#    sites: the git-branch composer's slug pin, the backlog body's slug pin,
#    the backlog path, and the branch fold). A node cannot serve it — a pure
#    code node is refused by doctrine (code nodes have exec pins), and an
#    exec-lane node cannot be pulled by four consumers scattered across the
#    canvas.
#  - build_again / tail_escalate: loop and branch LAWS on pure condition pins,
#    where the pure lane is correct (re-read fresh at every resolution).
#
# THREE FUNCTIONS, down from twelve (0.0.15). What left, and why it could:
#  - text_of and shq became RUNTIME SANDBOX BUILTINS (abstractruntime
#    `code_executor.sandbox_helper_globals`, beside parse_json/to_json). Both
#    decode or defend the RUNTIME's own surface — tool-result envelope shapes,
#    and quoting for the `execute_command` the runtime ships — so the runtime
#    is where one canonical copy belongs. The library compiler now REFUSES a
#    flow function with either name, so a bundle cannot silently re-fork them.
#  - the seven compose_* SHELL COMMAND formatters became CODE NODES on the
#    canvas, each feeding its Call Tool node's `tool_call` pin on a wire. They
#    lived here for exactly ONE reason — a code node could not call `shq`, so
#    inlining meant seven copies of a shell escape — and promoting `shq`
#    dissolved it. See THE SEVEN SHELL COMMANDS below.
#
# Everything a HUMAN OR AN AGENT READS — every prompt, report, advisory and
# markdown body — left this list and became a canvas node whose sentences sit
# in EDITABLE PIN DEFAULTS with {{slots}}. Fourteen functions moved out that
# way (0.0.14); nothing composed for a reader is buried in Python any more.
# ===========================================================================

FUNCTIONS = [
    # text_of AND shq LEFT THIS LIBRARY (0.0.15): both are RUNTIME SANDBOX
    # BUILTINS now (`code_executor.sandbox_helper_globals`), and the library
    # compiler refuses a flow function that shadows one. Nothing changed at the
    # call sites — `text_of(value)` and `shq(x)` resolve to the runtime's
    # copies, which decode/escape the runtime's OWN shapes. Knowledge of an
    # envelope belongs to whoever defines it.
    fn("branch_slug", r"""
        def branch_slug(title):
            # Branch-name-friendly slug from the accepted plan's TITLE — a plain
            # string argument since the blob went away (it used to take the
            # whole state and dig `plan.title` out of it, so no call site said
            # which variable it read). Four call sites: compose_git_branch, the
            # backlog body's slug pin, the backlog path, and the branch fold.
            title = str(title or "task").strip().lower()
            slug = ""
            prev_dash = False
            for ch in title:
                if ("a" <= ch <= "z") or ("0" <= ch <= "9"):
                    slug = slug + ch
                    prev_dash = False
                elif not prev_dash and slug:
                    slug = slug + "-"
                    prev_dash = True
            slug = slug.strip("-")[:40]
            if not slug:
                slug = "task"
            return slug
    """, kind="composer", description="Branch/backlog slug from the plan title (a-z 0-9 dashes, 40 max)."),

    fn("build_again", r"""
        def build_again(approved, user_stopped, environment_blocked,
                        same_signature_count, fix_cycles, max_fix_cycles,
                        review_rounds, max_review_rounds):
            # EIGHT NAMED ARGUMENTS, on purpose. This is a loop LAW on a pure
            # condition pin, so it has to stay an expression (a `while` pin
            # re-reads per iteration and takes one wire) — but the call site
            # now SPELLS every variable it weighs:
            #   build_again(vars.approved, vars.user_stopped, ...)
            # A one-argument call taking the whole run-state container told you
            # nothing without opening the drawer; that is the defect the blob
            # removal exists to fix.
            approved = bool(approved)
            stopped = bool(user_stopped)
            env_blocked = bool(environment_blocked)
            fix = int(fix_cycles or 0)
            rev = int(review_rounds or 0)
            maxfix = int(max_fix_cycles or 6)
            maxrev = int(max_review_rounds or 2)
            # Stop on repeated identical failures only after 3 in a row (was 2,
            # operator request 2026-07-27): with the repair history the builder
            # sees its past attempts and rarely repeats one, so this stall
            # guard should fire later, not sooner.
            stalled = int(same_signature_count or 0) >= 3
            # In wait mode, running out of fix cycles or stalling does not exit
            # the loop directly: the loop body sends those cases to gate 2 as an
            # escalation the human can act on (a comment resets the fix budget;
            # "stop" ends the run). Auto mode exits on the budgets. An
            # environment block (for example a missing command runner) exits
            # right away in both modes, because no builder edit can fix it.
            return ((not approved) and (not stopped) and (not env_blocked)
                    and (not stalled) and (fix < maxfix) and (rev <= maxrev))
    """, kind="checker", description="Build-loop law: continue while unapproved and within budgets."),

    fn("tail_escalate", r"""
        def tail_escalate(wait_gating, all_passed, environment_blocked,
                          same_signature_count, fix_cycles, max_fix_cycles):
            # In wait mode, a stuck build (out of fix cycles, or the same
            # failure repeating, still not green) escalates to the human gate
            # instead of ending silently. Auto mode never escalates. An
            # environment block never escalates: no reviewer comment can fix a
            # missing command runner.
            # Named arguments, like build_again: the branch pin now shows which
            # six variables decide it. `wait_gating` is the normalized gating
            # fact the preflight seed wrote once — never a second string
            # comparison against a raw caller value.
            stuck = (int(same_signature_count or 0) >= 3
                     or int(fix_cycles or 0) >= int(max_fix_cycles or 6))
            return (bool(wait_gating)
                    and not bool(all_passed)
                    and not bool(environment_blocked)
                    and stuck)
    """, kind="checker", description="Stuck build in wait mode? Escalate to the human gate instead of ending silently."),

]


# The planner's structured-output schema is a CONSTANT — it rides the
# resp_schema pin as a plain default, never a computed value.
PLANNER_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "goal": {"type": "string"},
        "steps": {"type": "array", "items": {"type": "string"}},
        "files": {"type": "array", "items": {"type": "string"}},
        "risks": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["title", "goal", "steps"],
}


# ===========================================================================
# THE PROSE (0.0.14). Operator ruling 2026-07-30: "system and prompt texts
# should be very easily editable directly by users and agents", under the
# larger goal "to ensure visual clarity and human readable visual workflows".
#
# Every sentence below is a PIN DEFAULT on a canvas node — the properties
# panel edits it as plain text, and the {{slots}} show exactly which runtime
# values land where. The node bodies next to them do SELECTION AND SLOT FILL
# ONLY; not one of them composes a sentence. This is the pattern already
# shipped for `builder_prompt` and `gate2_prompt`, applied to every remaining
# prompt, report, advisory and markdown body in the flow.
# ===========================================================================

# ---------------------------------------------------------------------------
# THE FIVE ROLE CHARTERS — the `system` pin of each agent node (0.0.15).
#
# Operator observation 2026-07-30: "i am surprised to see agents without system
# prompt". Every agent's `system` pin was UNSET and all role framing was
# crammed into `prompt`, which is also where the per-iteration task text lands.
# The split restored here is the standard one:
#
#   system  = DURABLE role charter — who the agent is, what it must never do,
#             and its output discipline. Constant for the whole run.
#   prompt  = the PER-ITERATION task — request, plan, scout context, failures,
#             reviewer feedback, and the conditional probe protocol.
#
# These are plain pin defaults (no {{slots}}, no pin expressions) on purpose:
# `system` rides `_runtime.system_prompt_extra` into the provider prompt PREFIX
# (compiler `_create_visual_agent_effect_handler` -> abstractagent
# `PROMPT_SLOTS`), and a prefix that changes between iterations defeats prompt
# caching. Per-iteration state belongs in `prompt`, never here.
# ---------------------------------------------------------------------------
SCOUT_CODE_SYSTEM_TEXT = (
    "You are the CODE+DOCS SCOUT in a multi-agent coding workflow. The existing workspace is "
    "your only source of evidence.\n"
    "Standing rules: mine ONLY the workspace - list folders, read/skim code and docs, search "
    "for prior art. Do NOT use the internet. Do NOT write, edit or create any file: yours is a "
    "read-only role, and a later agent owns every byte that ships.\n"
    "Output discipline: return a compact findings list - for each finding give the source path, "
    "the concrete fact, and why it matters for the request. Never report a path you did not "
    "open or a fact you did not read. If the workspace is empty, say so plainly instead of "
    "padding the list."
)

SCOUT_WEB_SYSTEM_TEXT = (
    "You are the INTERNET SCOUT in a multi-agent coding workflow. The public internet is your "
    "only source of evidence.\n"
    "Standing rules: mine ONLY the internet (web_search, fetch_url, skim). Do NOT read and do "
    "NOT write the workspace - the code+docs scout owns that ground. Prefer primary and "
    "reference sources over blogspam.\n"
    "Output discipline: return a compact findings list - for each finding give the source URL, "
    "the concrete claim, and why it matters for the request. Never present an unsourced claim "
    "as a finding."
)

PLANNER_SYSTEM_TEXT = (
    "You are the PLANNER in a multi-agent coding workflow. You turn a request plus scouted "
    "context into the implementation plan another agent will build from.\n"
    "Standing rules: do NOT write code and do NOT touch the workspace - you hold no tools by "
    "design; produce the plan only. Plan only what the scouted context supports; where the "
    "context is thin, name a risk instead of inventing a certainty.\n"
    "Output discipline: answer with JSON ONLY, matching the required schema - title (AT MOST 3 "
    "words, branch-name friendly), goal (one paragraph), steps (ordered, concrete), files "
    "(paths you expect to create or change), risks (list). No prose outside the JSON."
)

BUILDER_SYSTEM_TEXT = (
    "You are the BUILDER in a multi-agent coding workflow. You work on a dedicated git branch "
    "and you are the only role that writes source code.\n"
    "Engineering rules: bound every loop and traversal; before writing logic over data, read a "
    "sample and verify its shape; prefer small verifiable functions; start EVERY source file "
    "with a 1-2 line header comment stating its purpose; self-probe your artifact before "
    "finishing (open it, run it, or trace the entry path).\n"
    "Output discipline: when you are done, write SELFCHECK.md listing each artifact with one "
    "line of evidence it works, and AFTER YOUR FINAL EDIT add one 'ARTIFACT-SHA256: <path> "
    "<sha>' line per artifact (compute with: shasum -a 256 <path>). A downstream gate re-hashes "
    "those files, so a SELFCHECK written before your last edit fails the build. Never claim an "
    "artifact works without evidence you actually produced."
)

DOC_SYSTEM_TEXT = (
    "You are the DOCUMENTER in a multi-agent coding workflow. You run AFTER the build passed "
    "its verification gates, so the verified bytes must ship exactly as they were tested.\n"
    "STRICT RULE: do NOT modify any source/code file. You write DOCUMENTATION FILES ONLY - "
    "README.md and files under docs/. Source-file header comments are the BUILDER's job, not "
    "yours; a deterministic guard re-checks the built artifacts after you and fails the run if "
    "you touched them.\n"
    "Output discipline: keep docs truthful to the CURRENT code - read the source before "
    "describing it; never invent a feature, a flag or a command."
)


# --- preflight: the door's advisories and its refusal report ---------------
PREFLIGHT_SKILLS_TEXT = (
    "preflight: skills not active on this host: {{missing}} - doc step runs on prompt "
    "guidance alone (#FALLBACK)"
)
PREFLIGHT_PROBE_TEXT = (
    "preflight: browser_probe not mounted - verify certifies STATIC gates only; the human "
    "gate is the runtime/playability oracle (#FALLBACK)"
)
PREFLIGHT_EMPTY_REQUEST_TEXT = "preflight: empty request"
PREFLIGHT_NO_WORKSPACE_TEXT = (
    "preflight: no workspace_root (this workflow writes files + runs git; it needs an "
    "explicit workspace)"
)
PREFLIGHT_REFUSAL_HEADER_TEXT = "# Multi-agent coding workflow: preflight failed"

# --- the two run-visible status lines --------------------------------------
# Both were pin EXPRESSIONS until 0.0.15 — user-visible sentences spelled as
# Python string concatenation on an invisible pin, which is strictly worse than
# "buried in Python": you cannot even find them from the canvas. Both are pin
# defaults on a composer node now, with the same {{slot}} idiom every prompt in
# this flow uses. Clients key off the stable prefixes, so the words before the
# slot are a contract — edit the wording, keep the shape.
GATING_LINE_TEXT = "gating: {{mode}}"
GATING_WAIT_WORD = "wait"
GATING_AUTO_WORD = "auto"
CYCLE_LINE_TEXT = "build cycle {{n}} of {{m}}"

# --- greenfield fast-path (0.0.18) -----------------------------------------
# The probe line is user-visible with a STABLE "scouting:" prefix (same
# contract as "gating:"/"build cycle"): clients render the skip decision
# without knowing the pipeline's shape.
GREEN_SKIP_LINE_TEXT = (
    "scouting: skipped — greenfield (workspace empty or dotfiles only); the request is the plan"
)
GREEN_FULL_LINE_TEXT = (
    "scouting: full pipeline — brownfield ({{count}} visible workspace entries)"
)
GREEN_TITLE_TEXT = "greenfield build"
GREEN_RISK_TEXT = (
    "greenfield fast-path: scouts and planner skipped (empty workspace); the request is the plan"
)
GREEN_CONTEXT_TEXT = (
    "(scouts skipped: empty workspace — greenfield fast-path; the request is the plan)"
)

# --- the two scout briefs --------------------------------------------------
SCOUT_CODE_BRIEF_TEXT = (
    "Request:\n{{request}}\n\n"
    "Scout the workspace for this request and return your findings list."
)
SCOUT_WEB_BRIEF_TEXT = (
    "Request:\n{{request}}\n\n"
    "Scout the internet for this request and return your findings list."
)
SCOUT_FEEDBACK_TEXT = (
    "\n\nThe previous plan was sent back. Reviewer comments to address:\n{{feedback}}"
)

# --- planner ---------------------------------------------------------------
PLANNER_BRIEF_TEXT = (
    "Request:\n{{request}}\n\n"
    "Engineered context from the two scouts (code + internet):\n{{scout_context}}\n\n"
    "Produce the plan for this request as JSON."
)
PLANNER_FEEDBACK_TEXT = (
    "\n\nThe reviewer sent the previous plan back with these comments; address every "
    "one:\n{{feedback}}"
)

# --- gate 1 (plan approval) ------------------------------------------------
GATE1_HEAD_TEXT = "PLAN for your approval.\n\nTitle: {{title}}\n\n{{goal}}\n\nSteps:"
GATE1_UNTITLED_TEXT = "(untitled)"
GATE1_FOOTER_TEXT = (
    "Reply 'approve' to build, 'research: <what to dig deeper>' to re-scout, or anything "
    "else as revision comments for the planner."
)

# Auto mode must not accept a DEAD plan: agent death does not fail the parent,
# so a planner that died looks IDENTICAL here to one that emitted malformed
# JSON. The text must not assert the wrong cause — observed live against a hard
# `credit balance is too low` 400, where "emit valid JSON" advice was actively
# wrong and the loop burned every revision retrying an impossible request.
PLAN_AUTO_NO_PLAN_TEXT = (
    "(no usable plan: the planner returned neither title nor steps. If the planner agent "
    "itself failed - provider auth/quota/billing, a dead model - that error is in the run's "
    "agent trace, not here, and re-planning cannot fix it.)"
)

# --- backlog item ----------------------------------------------------------
BACKLOG_TEMPLATE_TEXT = (
    "# {{slug}}\n\n- Status: planned\n- Source: multi-agent coding workflow\n\n"
    "## Goal\n{{goal}}\n\n## Steps\n{{steps}}\n## Files\n{{files}}\n## Risks\n{{risks}}"
)
BACKLOG_EMPTY_GOAL_TEXT = "(none)"
BACKLOG_NO_ITEMS_TEXT = "- (none)\n"

# --- documenter ------------------------------------------------------------
# The documenter runs AFTER verify, so it must not mutate what was verified
# (adversary F3, live-confirmed). Headers are the BUILDER's job; the
# documenter owns README/docs only, and the deterministic doc guard re-checks
# the bound artifacts after.
DOC_BRIEF_TEXT = (
    "The build passed its verification gates on this branch.\n\n"
    "Tasks:\n"
    "1. Write or update README.md: what this delivers, how to run it, controls/usage, "
    "structure.\n"
    "2. Keep docs truthful to the CURRENT code - read the source before describing it.\n\n"
    "What was built:\n{{goal}}"
)
DOC_DEGRADED_TEXT = (
    "\n\n(coredoc skill not active on this host - follow the rules above on your own "
    "judgment. #FALLBACK)"
)

# --- PR.md -----------------------------------------------------------------
PR_TEMPLATE_TEXT = (
    "# PR: {{title}}\n\nBranch: {{branch}}\n\n## Goal\n{{goal}}\n\n## Verification"
)
PR_GATES_GREEN_TEXT = "- gates: green"
PR_GATES_RED_TEXT = "- gates: NOT GREEN"
PR_ADVISORY_TEXT = "- advisory: {{advisory}}"

# --- gate 2 fold (the reviewer's answer) ------------------------------------
GATE2_CHANGE_REQUEST_TEXT = "REVIEWER CHANGE REQUESTS (gate 2):\n{{comment}}"
GATE2_NO_COMMENT_TEXT = "(no comment - reviewer rejected; improve robustness and polish)"

# --- merge fold -------------------------------------------------------------
MERGE_CONFLICT_TEXT = "merge: conflict - merge aborted; branch left unmerged (#FALLBACK)"
MERGE_NO_MAINLINE_TEXT = (
    "merge: no main/master branch found - merge skipped; branch left unmerged (#FALLBACK)"
)
MERGE_NO_CONFIRM_TEXT = (
    "merge: no MERGED_OK confirmation in output - treating as unmerged (#FALLBACK)"
)


# ===========================================================================
# THE CODE-NODE BODIES. Fourteen library functions became canvas nodes in
# 0.0.14; every one that composes text does SELECTION AND SLOT FILL ONLY over
# the pin defaults above.
# ===========================================================================

# The seed dict as PYTHON SOURCE, so the body and the seed node's `updates`
# pin default come from ONE definition and cannot drift apart.
_SEED_SOURCE = pprint.pformat(SEED_VARS, width=86, sort_dicts=False)

# Preflight: the flow's door, and the ONLY place run vars are born.
#
# 0.0.15: it no longer COPIES CONFIG. The five inputs it actually inspects
# (request, workspace_root, gating_mode, skills, browser_probe_available)
# arrive as wires from `start`; the gateway-written skills posture arrives on a
# Get Variable chip reading `_runtime.skills_resolution` — never a
# caller-attested pin (adversary F2). The seven it used to fold into the blob
# for nobody's benefit (max_plan_revisions, max_fix_cycles, max_review_rounds,
# build_command, run_command, provider, model) are ALREADY run vars — they are
# `on_flow_start` pins, and the event handler seeds run.vars from the caller's
# value or the pin default — so their readers name them directly and seven
# wires + seven blob keys disappeared.
#
# Two labeled outputs: `updates` (the flat seed, straight into `set_vars`) and
# the refusal `report` the door hands to `end_pre`.
PREFLIGHT_CODE = r"""
req = str(request or "").strip()
ws = str(workspace_root or "").strip()
gating = str(gating_mode or "wait").strip().lower()
if gating not in ("wait", "auto"):
    gating = "wait"
sk = skills_resolution if isinstance(skills_resolution, dict) else {}
active = sk.get("active") if isinstance(sk.get("active"), list) else []
active = [str(x) for x in active]
# A list (even empty) is the caller's explicit answer; anything else means the
# pin never resolved, and the SAFE reading of that is "coredoc was expected" —
# claiming skills are fine when we do not know is the fail-dangerous direction.
need = [str(x) for x in skills] if isinstance(skills, list) else ["coredoc"]
missing = []
for s in need:
    if s not in active:
        missing.append(s)
probe_ok = bool(browser_probe_available)
warnings = []
if missing:
    warnings.append(str(skills_missing_text or "").replace("{{missing}}", ", ".join(missing)))
if not probe_ok:
    warnings.append(str(probe_absent_text or ""))
failures = []
if not req:
    failures.append(str(empty_request_text or ""))
if not ws:
    failures.append(str(no_workspace_text or ""))
lines = [str(refusal_header_text or ""), ""]
for f in failures:
    lines.append("- " + str(f))
# THE SEED, FLAT. Every key below becomes its OWN top-level run var (the
# `updates` wire feeds a `set_vars` node), so each reader downstream is a Get
# Variable chip naming exactly the variable it wants — the canvas can finally
# answer "which variable does this node use". Nothing here is config: config
# already exists as run vars from the start pins.
updates = __SEED__
updates["preflight_ok"] = len(failures) == 0
updates["preflight_failures"] = failures
# wait_gating: the ONE derived gating fact every downstream reader uses —
# normalization lives here and is never re-derived from a raw caller string.
# It stays a BOOLEAN, and the normalized enum WORD is deliberately NOT written
# back over the `gating_mode` start pin: a name belongs to config OR to the
# seed, never both (`config-and-progress-overlap-is-the-typed-budgets`), and
# the three budgets that do overlap are there because a pure loop-law
# expression reads them BY NAME and would raise on an omitted start pin — the
# gating word has no such forcing reason. The run-start status line therefore
# turns this boolean back into a word on ONE node whose two case words are
# editable pin defaults, which is also the only shape that cannot print
# "gating: banana" for a run the door actually gated.
updates["wait_gating"] = gating == "wait"
# THE THREE BUDGETS, typed once. The loop laws read them BY NAME in a pure
# expression (`build_again(..., vars.max_fix_cycles, ...)`), and a name that is
# absent raises — which is the correct posture, but it means a caller who omits
# the pin must still find the var. So the door resolves each budget through its
# START PIN (the one source of the default), coerces it to int, and writes it
# back flat. This is NOT the blob's config copy: three named, typed variables a
# reader can see on the canvas, not thirteen keys inside one opaque object.
updates["max_plan_revisions"] = int(max_plan_revisions or 3)
updates["max_fix_cycles"] = int(max_fix_cycles or 6)
updates["max_review_rounds"] = int(max_review_rounds or 2)
updates["probe_ok"] = probe_ok
updates["skills_degraded"] = len(missing) > 0
updates["warnings"] = warnings
return {"updates": updates, "report": "\n".join(lines)}
""".strip().replace("__SEED__", _SEED_SOURCE)

# GREENFIELD PROBE (0.0.18): deterministic, no llm anywhere. `ls -A` lists the
# workspace; the sentinel proves the command ran (cd into a missing dir prints
# nothing, and "no sentinel" must read as brownfield — running the full
# pipeline on a probe failure is the safe direction, skipping scouts is not).
GREEN_CMD_CODE = r"""
ws_q = shq(str(workspace_root or "").strip())
cmd = ("cd '" + ws_q + "' && ls -A -- . 2>/dev/null | head -n 200; echo GREEN_PROBE_DONE")
return {"tool_call": {"name": "execute_command", "arguments": {"command": cmd, "timeout": 60},
                      "call_id": "greenfield-probe"}}
""".strip()

# The fold DECIDES: empty-or-dotfiles-only => greenfield. It pre-accepts a
# synthesized plan whose goal and single step are the request VERBATIM, so the
# plan loop (scouts -> planner -> gate 1) never executes — `accepted` is
# already True when plan_while first evaluates its law. Everything it writes is
# a named flat var; the skip is auditable in vars, in the status line, and in
# the final report.
GREEN_FOLD_CODE = r"""
txt = str(probe_text or "")
ok = "GREEN_PROBE_DONE" in txt
entries = []
if ok:
    head = txt.split("GREEN_PROBE_DONE", 1)[0]
    for ln in head.splitlines():
        s = ln.strip()
        if s:
            entries.append(s)
visible = []
for e in entries:
    if not e.startswith("."):
        visible.append(e)
green = ok and len(visible) == 0
if green:
    req = str(request or "").strip()
    title = str(title_text or "").strip() or "greenfield build"
    plan = {"title": title, "goal": req, "steps": [req], "files": [],
            "risks": [str(risk_text or "")]}
    updates = {"greenfield": True, "accepted": True, "plan": plan, "title": title,
               "plan_feedback": "", "rescout": False,
               "scout_context": str(skip_context_text or "")}
    msg = str(skip_line_text or "")
else:
    updates = {"greenfield": False}
    msg = str(full_line_text or "").replace("{{count}}", str(len(visible)))
return {"updates": updates, "message": msg}
""".strip()

# Both scout briefs from ONE node: they share the request + reviewer-feedback
# header, and putting them side by side is how a reader compares the two
# mandates. Two labeled outputs, two visible wires.
SCOUT_PROMPTS_CODE = r"""
req = str(request or "").strip()
fb = str(plan_feedback or "").strip()
extra = str(feedback_text or "").replace("{{feedback}}", fb) if fb else ""
return {"code_prompt": str(code_brief_text or "").replace("{{request}}", req) + extra,
        "web_prompt": str(web_brief_text or "").replace("{{request}}", req) + extra}
""".strip()

PLANNER_PROMPT_CODE = r"""
text = str(brief_text or "")
text = text.replace("{{request}}", str(request or "").strip())
text = text.replace("{{scout_context}}", str(scout_context or "").strip())
fb = str(plan_feedback or "").strip()
if fb:
    text = text + str(feedback_text or "").replace("{{feedback}}", fb)
return {"prompt": text}
""".strip()

# Gate 1's prompt is composed from the PLANNER'S DATA on a wire. Wiring
# planner.data straight into ask_user.prompt would show the raw dict repr, and
# a dead planner ({} — falsy) would fail the whole run at the ask_user
# "requires payload.prompt" guard instead of recycling through the bounded
# revision loop (migration adversary F1). A dead planner still yields a
# non-empty prompt here.
GATE1_PROMPT_CODE = r"""
pd = planner_data if isinstance(planner_data, dict) else {}
title = str(pd.get("title") or "").strip()
steps = pd.get("steps") if isinstance(pd.get("steps"), list) else []
head = str(head_text or "")
head = head.replace("{{title}}", title if title else str(untitled_text or ""))
head = head.replace("{{goal}}", str(pd.get("goal") or "").strip())
lines = [head]
i = 1
for st in steps:
    lines.append(str(i) + ". " + str(st))
    i = i + 1
lines.append("")
lines.append(str(footer_text or ""))
return {"prompt": "\n".join(lines)}
""".strip()

# `updates` names EXACTLY the run vars this decision writes — the fold no
# longer copies a whole container forward, so the write side is as legible as
# the read side (set_vars leaves every key it is not given untouched).
PLAN_AUTO_CODE = r"""
pd = planner_data if isinstance(planner_data, dict) else {}
title = str(pd.get("title") or "").strip()
steps = pd.get("steps") if isinstance(pd.get("steps"), list) else []
if title and steps:
    return {"updates": {"accepted": True, "plan": pd, "title": title,
                        "plan_feedback": "", "rescout": False}}
return {"updates": {"accepted": False,
                    "plan_revisions": int(plan_revisions or 0) + 1,
                    "plan_feedback": str(no_plan_text or ""),
                    "rescout": False}}
""".strip()

# Four DOTTED chips (`plan.goal`, `plan.steps`, `plan.files`, `plan.risks`)
# land the plan's four fields on four named pins, so the canvas shows which
# parts of the plan the backlog item is made of. `get_var` walks dotted paths
# and honours the default, so a missing field is the default, not a KeyError.
BACKLOG_BODY_CODE = r"""
def bullets(xs):
    items = xs if isinstance(xs, list) else []
    out = ""
    for x in items:
        out = out + "- " + str(x) + "\n"
    return out if out else str(no_items_text or "")
goal = str(plan_goal or "").strip()
text = str(template_text or "")
text = text.replace("{{slug}}", str(slug or "task"))
text = text.replace("{{goal}}", goal if goal else str(empty_goal_text or ""))
text = text.replace("{{steps}}", bullets(plan_steps))
text = text.replace("{{files}}", bullets(plan_files))
text = text.replace("{{risks}}", bullets(plan_risks))
return {"content": text}
""".strip()

# The two case words sit side by side, editable, on ONE node — the readable
# half of the operator's "switch on the enum", without the exec-lane fork.
GATING_LINE_CODE = r"""
mode = str(wait_word or "wait") if wait_gating else str(auto_word or "auto")
return {"message": str(line_text or "").replace("{{mode}}", mode)}
""".strip()

# N is 1-BASED for the reader ("build cycle 1 of 6" on the first pass) while
# `fix_cycles` counts COMPLETED cycles, so the +1 belongs to the presentation,
# not to the variable. That off-by-one is precisely why this line cannot be a
# `string_template` node over the raw vars.
CYCLE_LINE_CODE = r"""
text = str(line_text or "")
text = text.replace("{{n}}", str(int(fix_cycles or 0) + 1))
text = text.replace("{{m}}", str(int(max_fix_cycles or 6)))
return {"message": text}
""".strip()

# ===========================================================================
# THE SEVEN SHELL COMMANDS (0.0.15). Each one is now a CODE NODE feeding the
# `tool_call` pin of its Call Tool node on a wire.
#
# SMELL 3 (operator, 2026-07-30): "commit cycle is even more surprising… you
# are using tool call to execute a pure function — we never thought of that…
# and your compose_commit is used nowhere else, so why did you create that
# complicated tool call + pure function instead of just a code node?"
#
# The answer to the structural half FIRST, because the premise needs care:
# `call_tool` is NOT executing a pure function. It executes `execute_command`
# — a sandboxed Code node cannot spawn a process, so the tool call is load
# bearing and stays. What was wrong is that the tool call's ARGUMENT was
# composed by an invisible pin expression (`compose_commit(vars.workspace_root)`)
# reaching into the Functions drawer. To learn what a run would execute, a
# reader had to notice the pin carried an expression, read the call, open the
# drawer, and find the function. Four hops to answer "what command is this?".
#
# So: composition becomes a visible node, execution stays a Call Tool node —
# which is exactly the shape every other composed input in this flow already
# uses (`gate2_prompt -> gate2`, `pr_body -> pr_write`, `builder_prompt ->
# builder`). The seven shell steps were the only exception on the canvas.
#
# What UNBLOCKED it: `shq` is now a RUNTIME SANDBOX HELPER (abstractruntime
# `code_executor.sandbox_helper_globals`, next to parse_json/to_json), so a
# code-node body can call it. That was the ONE reason the seven lived in the
# library — a code node cannot call a flow function, so inlining meant seven
# copies of a shell escape, and one divergent copy is a command injection on a
# quoted path. With the escape owned by the runtime the argument evaporates and
# the library drops from twelve functions to three.
#
# What deliberately did NOT move into editable pin defaults: the command TEXT.
# The {{slot}} treatment is for PROSE a human or an agent reads — prompts,
# reports, advisories. These strings are hardened executable code
# (GIT_CEILING_DIRECTORIES, GIT_TERMINAL_PROMPT=0, POSIX-safe read loops, the
# positive MERGED_OK sentinel), and every interpolation point is a quoting
# decision. A template pin would invite an edit that adds an unescaped slot —
# turning an editable-prose win into a command-injection surface. The body is
# visible in the properties panel, which is the readability the ask was about.
# ===========================================================================

# EXISTING repo: branch FIRST, baseline-commit SECOND — the baseline (which
# sweeps any uncommitted user work via add -A) lands on the WORK branch, never
# on the user's current branch (adversary F7).
# FRESH init: baseline-commit FIRST, branch SECOND — `git init -b main` leaves
# `main` as an UNBORN ref, and `checkout -b` off an unborn HEAD moves it, so
# `main` never materialized and the merge step found no main/master to merge
# into (live gateway run fb548675, 2026-07-31: "approved-merge-failed" on a
# green build). There is no user branch to protect on a fresh init, so the F7
# concern does not apply; --allow-empty births main even in an empty dir.
# `slug` arrives on a pin from the shared branch_slug transform (four call
# sites — it stays a library function).
GIT_BRANCH_CMD_CODE = r"""
ws = str(workspace_root or "").strip()
ws_q = shq(ws)
parent = ws.rstrip("/").rsplit("/", 1)[0] if "/" in ws.rstrip("/") else "/"
parent_q = shq(parent)
sl = str(slug or "task")
cmd = ("export GIT_CEILING_DIRECTORIES='" + parent_q + "'; cd '" + ws_q + "' && "
       "top=$(git rev-parse --show-toplevel 2>/dev/null || echo NONE); "
       "if [ \"$top\" != \"$(pwd)\" ]; then "
       "git init -b main >/dev/null 2>&1 || git init >/dev/null 2>&1; "
       "git -c user.name='workflow' -c user.email='workflow@local' add -A >/dev/null 2>&1; "
       "git -c user.name='workflow' -c user.email='workflow@local' commit --allow-empty -m 'baseline: pre-build workspace' >/dev/null 2>&1 || true; "
       "fi; "
       "git checkout -b '" + shq(sl) + "' 2>/dev/null || git checkout '" + shq(sl) + "' 2>/dev/null || true; "
       "git -c user.name='workflow' -c user.email='workflow@local' add -A >/dev/null 2>&1; "
       "git -c user.name='workflow' -c user.email='workflow@local' commit -m 'baseline: pre-build workspace' >/dev/null 2>&1 || true; "
       "git rev-parse --abbrev-ref HEAD")
return {"tool_call": {"name": "execute_command", "arguments": {"command": cmd},
                      "call_id": "git-branch"}}
""".strip()

LINT_CMD_CODE = r"""
ws_q = shq(str(workspace_root or "").strip())
cmd = ("cd '" + ws_q + "' && "
       # ADR-0026: whole linter output — `tail -5` dropped residual diagnostics
       # before the builder's failure list could carry them.
       "(command -v ruff >/dev/null 2>&1 && ruff check --fix . 2>&1 || true); "
       "(command -v prettier >/dev/null 2>&1 && prettier --write . 2>&1 || true); "
       "echo LINT_DONE")
return {"tool_call": {"name": "execute_command", "arguments": {"command": cmd},
                      "call_id": "lint-format"}}
""".strip()

# The formatter may have rewritten bytes AFTER the builder hashed them; refresh
# the ARTIFACT-SHA256 lines deterministically so G5 binds to the shipped bytes
# (cycle-2 FATAL). Space-safe path handling: iterate whole lines, never
# word-split (adversary F5).
SELFCHECK_CMD_CODE = r"""
ws_q = shq(str(workspace_root or "").strip())
cmd = ("cd '" + ws_q + "' && if [ -f SELFCHECK.md ]; then "
       "grep '^ARTIFACT-SHA256:' SELFCHECK.md > .sc_lines.tmp 2>/dev/null || true; "
       "grep -v '^ARTIFACT-SHA256:' SELFCHECK.md > SELFCHECK.md.tmp 2>/dev/null || true; "
       "while IFS= read -r line; do "
       "rest=${line#ARTIFACT-SHA256: }; f=${rest% *}; "
       "if [ -f \"$f\" ]; then echo \"ARTIFACT-SHA256: $f $(shasum -a 256 \"$f\" | awk '{print $1}')\" >> SELFCHECK.md.tmp; fi; "
       "done < .sc_lines.tmp; rm -f .sc_lines.tmp; "
       "mv SELFCHECK.md.tmp SELFCHECK.md; echo REFRESHED; else echo NO_SELFCHECK; fi")
return {"tool_call": {"name": "execute_command", "arguments": {"command": cmd},
                      "call_id": "selfcheck-refresh"}}
""".strip()

COMMIT_CMD_CODE = r"""
ws_q = shq(str(workspace_root or "").strip())
cmd = ("cd '" + ws_q + "' && git -c user.name='workflow' -c user.email='workflow@local' add -A >/dev/null 2>&1; "
       "git -c user.name='workflow' -c user.email='workflow@local' commit -m 'build cycle' >/dev/null 2>&1 || true; "
       "echo COMMITTED")
return {"tool_call": {"name": "execute_command", "arguments": {"command": cmd},
                      "call_id": "git-commit"}}
""".strip()

# POSIX-safe: no process substitution (execute_command may run sh, not bash);
# a temp file keeps the drift flag in the same shell.
DOC_GUARD_CMD_CODE = r"""
ws_q = shq(str(workspace_root or "").strip())
cmd = ("cd '" + ws_q + "' && if [ -f SELFCHECK.md ]; then "
       "grep '^ARTIFACT-SHA256:' SELFCHECK.md > .docguard.tmp 2>/dev/null || true; "
       "drift=0; while IFS= read -r line; do "
       "rest=${line#ARTIFACT-SHA256: }; sha=${rest##* }; f=${rest% *}; "
       "if [ -f \"$f\" ]; then now=$(shasum -a 256 \"$f\" | awk '{print $1}'); "
       "if [ \"$now\" != \"$sha\" ]; then echo \"DOC_DRIFT $f\"; drift=1; fi; "
       "else echo \"DOC_DRIFT $f (deleted)\"; drift=1; fi; "
       "done < .docguard.tmp; rm -f .docguard.tmp; "
       "if [ $drift -eq 0 ]; then echo DOC_GUARD_OK; fi; "
       "else echo NO_SELFCHECK_TO_GUARD; fi")
return {"tool_call": {"name": "execute_command", "arguments": {"command": cmd},
                      "call_id": "doc-guard"}}
""".strip()

# GIT_TERMINAL_PROMPT=0 + GIT_ASKPASS=true: a credentialed https remote must
# fail fast, never sit on a hidden credential prompt (adversary F6 —
# unattended runs).
PR_PUSH_CMD_CODE = r"""
ws_q = shq(str(workspace_root or "").strip())
branch_q = shq(str(branch or "work"))
cmd = ("cd '" + ws_q + "' && export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true; "
       "if git remote get-url origin >/dev/null 2>&1; then "
       "if command -v gh >/dev/null 2>&1; then "
       # ADR-0026: whole git/gh output — `tail -2` swallowed the real push error.
       "git push -u origin '" + branch_q + "' 2>&1; "
       "GH_PROMPT_DISABLED=1 gh pr create --fill --head '" + branch_q + "' 2>&1 || echo PR_EXISTS_OR_FAILED; "
       "else echo GH_UNAVAILABLE_LOCAL_PR_MD_ONLY; fi; "
       "else echo NO_REMOTE_LOCAL_PR_MD_ONLY; fi")
return {"tool_call": {"name": "execute_command",
                      "arguments": {"command": cmd, "timeout": 120},
                      "call_id": "pr-create"}}
""".strip()

# Merge success is proven by a POSITIVE sentinel (MERGED_OK), never by the
# absence of a failure token (adversary F4, proven on a trunk-default repo).
MERGE_CMD_CODE = r"""
ws_q = shq(str(workspace_root or "").strip())
branch_q = shq(str(branch or "work"))
cmd = ("cd '" + ws_q + "' && git -c user.name='workflow' -c user.email='workflow@local' add -A >/dev/null 2>&1; "
       "git -c user.name='workflow' -c user.email='workflow@local' commit -m 'final: docs + PR' >/dev/null 2>&1 || true; "
       "if git checkout main 2>/dev/null || git checkout master 2>/dev/null; then "
       "if git -c user.name='workflow' -c user.email='workflow@local' merge --no-ff '" + branch_q + "' -m 'merge: " + branch_q + "' 2>&1; then "
       "echo MERGED_OK $(git rev-parse --abbrev-ref HEAD); "
       "else git merge --abort 2>/dev/null; echo MERGE_CONFLICT_ABORTED; fi; "
       "else echo NO_MAINLINE_BRANCH; fi")
return {"tool_call": {"name": "execute_command", "arguments": {"command": cmd},
                      "call_id": "git-merge"}}
""".strip()

# git_text arrives pre-extracted (the `text_of(value)` pin expression unwraps
# the tool envelope on the wire); slug arrives from the shared branch_slug
# transform over `vars.title`. ZERO run-var reads: it writes two, reads none.
BRANCH_FOLD_CODE = r"""
txt = str(git_text or "").strip()
branch = txt.split("\n")[-1].strip() if txt else ""
sl = str(slug or "")
return {"updates": {"branch": branch if branch else (sl or "work"),
                    "branch_slug": sl}}
""".strip()

# Residuals = DIAGNOSTIC-SHAPED lines only (path:line:col or a syntax-error
# class token). Substring-'error' matching is a proven false-red generator
# (adversary F1/F2, integration F5). lint_text arrives pre-extracted.
LINT_PARSE_CODE = r"""
def has_line_col(t):
    i = t.find(":")
    while i >= 0:
        j = t.find(":", i + 1)
        if j > i + 1:
            seg = t[i+1:j]
            digits = len(seg) > 0
            for c in seg:
                if not ("0" <= c <= "9"):
                    digits = False
                    break
            if digits:
                return True
        i = t.find(":", i + 1)
    return False
def is_diag(t):
    low = t.lower()
    if "fixed" in low and "remaining" in low:
        return False
    if "all checks passed" in low or "0 error" in low or "no error" in low:
        return False
    if "syntaxerror" in low or "parse error" in low or "failed to parse" in low:
        return True
    if low.startswith("[error]"):
        return True
    return has_line_col(t)
residuals = []
for ln in str(lint_text or "").split("\n"):
    t = ln.strip()
    if t and is_diag(t):
        # ADR-0026: whole diagnostic lines, all of them. A 200-char clip plus a
        # 20-entry slice sat here — a lint diagnostic cut before its message is
        # a failure the builder cannot act on.
        residuals.append(t)
return {"residuals": residuals}
""".strip()

DOC_PROMPT_CODE = r"""
text = str(brief_text or "").replace(
    "{{goal}}", str(plan_goal or request or "").strip())
if bool(skills_degraded):
    text = text + str(degraded_text or "")
return {"prompt": text}
""".strip()

PR_BODY_CODE = r"""
warns = warnings if isinstance(warnings, list) else []
text = str(template_text or "")
text = text.replace("{{title}}", str(title or "work").strip())
text = text.replace("{{branch}}", str(branch or "work"))
text = text.replace("{{goal}}", str(plan_goal or "").strip())
lines = [text]
lines.append(str(gates_green_text or "") if bool(all_passed) else str(gates_red_text or ""))
for w in warns:
    lines.append(str(advisory_text or "").replace("{{advisory}}", str(w)))
return {"content": "\n".join(lines)}
""".strip()

# An 'approve' on a RED build is NOT a merge - merge requires green in both
# modes. A rejection resets the fix budget and bumps the review round.
GATE2_FOLD_CODE = r"""
green = bool(all_passed)
resp = str(response or "").strip()
low = resp.lower()
approve = low.startswith("approve") or low in ("yes", "ok", "lgtm", "merge")
if green and approve:
    return {"updates": {"approved": True, "last_gate2": "approved"}}
if low.startswith("stop"):
    return {"updates": {"approved": False, "user_stopped": True,
                        "last_gate2": "stopped"}}
# A rejection resets the fix budget and the stall counter, and bumps the
# review round. Six variables move; `updates` names all six.
return {"updates": {
    "approved": False,
    "review_rounds": int(review_rounds or 0) + 1,
    "fix_cycles": 0,
    "same_signature_count": 0,
    "failure_signature": "",
    "all_passed": False,
    "last_gate2": "rejected" if green else "escalated",
    "build_feedback": str(change_request_text or "").replace(
        "{{comment}}", resp if resp else str(no_comment_text or "")),
}}
""".strip()

# Merge success is proven by a POSITIVE sentinel (MERGED_OK), never by the
# absence of a failure token (adversary F4, proven on a trunk-default repo).
# merge_text arrives pre-extracted.
MERGE_FOLD_CODE = r"""
txt = str(merge_text or "")
merged_ok = "MERGED_OK" in txt
warns = list(warnings) if isinstance(warnings, list) else []
if "MERGE_CONFLICT_ABORTED" in txt:
    warns.append(str(conflict_text or ""))
elif "NO_MAINLINE_BRANCH" in txt:
    warns.append(str(no_mainline_text or ""))
elif not merged_ok:
    warns.append(str(no_confirm_text or ""))
return {"updates": {"merged": merged_ok and bool(approved), "warnings": warns}}
""".strip()


# ===========================================================================
# The FIVE code bodies that stay as canvas nodes. Three are multi-wire folds
# (a pin holds one wire; these each need 2+ producer wires). Two are
# multi-OUTPUT decisions (Final report, Doc drift check): several results
# consumed at different points — that fan-out is graph structure the canvas
# must show, so each output is a LABELED PIN with its own wire (operator
# ruling 2026-07-27; the 0.0.5 migration had hidden them in dict-returning
# functions re-read per pin).
# ===========================================================================

SCOUT_MERGE_CODE = r"""
c = str(code_findings or "").strip()
w = str(web_findings or "").strip()
parts = []
parts.append("## Code + documentation findings\n" + (c if c else "(scout returned nothing) #FALLBACK"))
parts.append("## Internet findings\n" + (w if w else "(scout returned nothing) #FALLBACK"))
blob = "\n\n".join(parts)
# ADR-0026: scout context flows WHOLE. A 12000-char clamp sat here; it never
# fired in the 2026-07/08 bench (5.9k/6.4k observed) but would have silently
# starved the planner the first time a scout was thorough. If this ever needs
# bounding, offload to an artifact and cite it — never cut.
# ZERO run-var reads: two wires in, ONE named variable out. Under the blob this
# node still had to pull the whole container just to put one key back.
return {"updates": {"scout_context": blob}}
""".strip()

GATE1_PARSE_CODE = r"""
resp = str(response or "").strip()
low = resp.lower()
pd = planner_data if isinstance(planner_data, dict) else {}
if low.startswith("approve") or low in ("yes", "ok", "lgtm"):
    return {"updates": {"accepted": True, "plan": pd,
                        "title": str(pd.get("title") or "").strip(),
                        "plan_feedback": "", "rescout": False}}
return {"updates": {
    "accepted": False,
    "plan_revisions": int(plan_revisions or 0) + 1,
    "plan_feedback": resp if resp else "(reviewer gave no comment; produce a better, more concrete plan)",
    # re-scout is the human's EXPLICIT choice ("research: ..."), never a tax
    # on every plan revision (design A-R5).
    "rescout": low.startswith("research"),
}}
""".strip()

NEXT_STATE_CODE = r"""
v = verify_verdict if isinstance(verify_verdict, dict) else {}
all_passed = bool(v.get("all_passed"))
fails = v.get("failures") if isinstance(v.get("failures"), list) else []
fails = [str(x) for x in fails]
# Verifier DEATH is not "no failures": when the verify child run dies, the
# mapped output is None -> verdict {} with no all_passed key (adversary
# finding: delivered != failed must survive verifier death).
meta = verify_meta if isinstance(verify_meta, dict) else {}
if "all_passed" not in v:
    all_passed = False
    err = str(meta.get("error") or "verify child run died or returned no verdict")
    fails.append("verify: verdict missing - " + err + " (#FALLBACK)")
# ENVIRONMENT failures are not fixable by the builder: fail-soft to
# "delivered, not verifiable" (coding-agent 0.2.2 precedent).
env_fails = v.get("environment_failures") if isinstance(v.get("environment_failures"), list) else []
env_fails = [str(x) for x in env_fails]
moved = []
for f in fails:
    low = str(f).lower()
    if ("missing" in low and "executor" in low) or ("execution not available" in low) or ("not available in this environment" in low):
        moved.append(f)
for f in moved:
    fails.remove(f)
    env_fails.append(f)
lint_res = lint_out if isinstance(lint_out, list) else []
for x in lint_res:
    fails.append("lint: " + str(x))
if lint_res:
    all_passed = False
# normalized failure signature: drop volatile evidence tail (first " - "),
# lowercase, strip STANDALONE digit runs (digits fused to identifiers kept).
ident = "abcdefghijklmnopqrstuvwxyz_."
norm = []
for f in fails:
    t = str(f).strip().lower()
    d = t.find(" - ")
    if d >= 0:
        t = t[:d]
    out = ""
    i = 0
    n = len(t)
    while i < n:
        ch = t[i]
        if "0" <= ch <= "9":
            j = i
            while j < n and "0" <= t[j] <= "9":
                j = j + 1
            before = t[i-1] if i > 0 else ""
            after = t[j] if j < n else ""
            if (before in ident) or (after in ident):
                out = out + t[i:j]
            i = j
        else:
            out = out + ch
            i = i + 1
    norm.append(out.strip())
sig = "|".join(sorted(set(norm)))
prev_sig = str(failure_signature or "")
same = int(same_signature_count or 0)
if sig and prev_sig and sig == prev_sig:
    same = same + 1
else:
    same = 0
this_cycle = int(fix_cycles or 0) + 1
# `updates` is the exact set of run vars this cycle moves. Keys NOT listed keep
# their current value (set_vars writes only what it is given), which is how the
# three conditional writes below stay conditional without carrying the whole
# container forward.
updates = {
    "failure_signature": sig,
    "same_signature_count": same,
    "fix_cycles": this_cycle,
    "build_feedback": "\n".join(fails),
    "all_passed": all_passed,
    # ADR-0026: the verdict carries EVERY failure. A 30/15 slice sat here and
    # dropped exactly the failures a stuck repair cycle had not yet seen.
    "last_verdict": {"all_passed": all_passed, "failures": fails,
                     "environment_failures": env_fails},
}
# environment-blocked: nothing fixable remains and the environment cannot
# verify - stop the loop honestly instead of burning the remaining budget
if env_fails and not fails and not all_passed:
    updates["environment_blocked"] = True
br = str(builder_response or "").strip()
# repair history: append one entry per FAILED cycle (cycle number, a short
# summary of what the builder said it did, and the failure that remained), so
# the next repair prompt shows the whole trail and the builder does not repeat
# an approach that already failed. Append-only, UNBOUNDED (ADR-0026): a 400-char
# clip on the builder's account, a 3-failure slice, a 300-char clip on the
# failure line and a 24-entry ring all sat here — together they erased the
# "what I already tried" detail the next repair round exists to read.
if not all_passed:
    hist = list(repair_history) if isinstance(repair_history, list) else []
    changed = br if br else "(builder gave no summary)"
    failed_short = sig if sig else "; ".join(fails)
    hist.append({"cycle": this_cycle, "changed": changed, "failed": failed_short})
    updates["repair_history"] = hist
# auto mode: green means approved (no human gate by explicit operator choice).
# `wait_gating` is the normalized gating fact the seed wrote once.
if all_passed and not bool(wait_gating):
    updates["approved"] = True
return {"updates": updates}
""".strip()

# Doc drift check: ONE parse, TWO consequences (route + state write) at two
# different execution points. guard_text arrives pre-extracted (the pin
# expression `text_of(value)` unwraps the tool envelope on the wire).
DOC_DRIFT_CODE = r"""
txt = str(guard_text or "")
drifted = []
for ln in txt.split("\n"):
    t = ln.strip()
    if t.startswith("DOC_DRIFT "):
        drifted.append(t[10:])
ok = ("DOC_GUARD_OK" in txt) or ("NO_SELFCHECK_TO_GUARD" in txt and not drifted)
# ZERO run-var reads. On a clean pass `updates` is EMPTY — and set_vars treats
# an empty updates as a deterministic no-op — so the red write happens only on
# the drift branch, exactly as before, without carrying a container.
if drifted:
    return {"ok": False, "updates": {
        "all_passed": False,
        # ADR-0026: name EVERY drifted file — a [:10] slice left the builder
        # restoring a subset and failing the same gate again.
        "build_feedback": ("doc: the documentation pass modified verified source files: " +
                           ", ".join(drifted) +
                           " - restore or re-verify them and refresh SELFCHECK.md hashes"),
    }}
return {"ok": ok, "updates": {}}
""".strip()

# Final report: one fold of terminal state into FOUR results (report, success,
# stopped_reason, branch), each a labeled pin wired to the end node.
FINAL_REPORT_CODE = r"""
accepted = bool(accepted)
approved = bool(approved)
merged = bool(merged)
passed = bool(all_passed)
stopped = bool(user_stopped)
last_g2 = str(last_gate2 or "")
branch = str(branch or "")
warns = warnings if isinstance(warnings, list) else []
fails = failures if isinstance(failures, list) else []
bf = str(build_feedback or "").strip()
stalled = int(same_signature_count or 0) >= 3
env_blocked = bool(environment_blocked)
if not accepted:
    reason = "plan-not-accepted (plan revisions exhausted without approval)"
elif merged:
    reason = "approved-and-merged"
elif approved:
    reason = "approved-merge-failed"
elif env_blocked:
    reason = "delivered-not-verifiable (environment cannot run the verification steps)"
elif stopped:
    reason = "stopped-by-reviewer (run ended unmerged at the review gate)"
elif (last_g2 in ("rejected", "escalated")
      and int(review_rounds or 0) > int(max_review_rounds or 2)):
    reason = "review-rounds-exhausted (last reviewer change requests unaddressed)"
elif passed:
    reason = "green-pending-approval"
elif stalled:
    reason = "stalled (same failures repeated; needs a different approach or human help)"
else:
    reason = "stopped-open-failures (budgets exhausted)"
lines = ["# Multi-agent coding workflow result", ""]
lines.append("Outcome: " + reason)
lines.append("Branch: " + (branch if branch else "(none)"))
lines.append("Gates: " + ("green" if passed else "not green"))
lines.append("Merged: " + ("yes" if merged else "no"))
lines.append("Plan revisions: " + str(int(plan_revisions or 0)) +
             " | fix cycles: " + str(int(fix_cycles or 0)) +
             " | review rounds: " + str(int(review_rounds or 0)))
if bool(greenfield):
    lines.append("scouts skipped: empty workspace (greenfield fast-path — "
                 "the request was the plan)")
if not accepted:
    pf = str(plan_feedback or "").strip()
    lines.append("")
    lines.append("Last plan title: " + (str(title or "").strip() or "(none)"))
    if pf:
        lines.append("Last reviewer comments on the plan:")
        # ADR-0026: the report is READ ONWARD (operator + orchestrating agents).
        # 8/10/15/10-line slices sat on these four blocks and quietly turned a
        # long failure list into a short one.
        for ln in pf.split("\n"):
            lines.append("  " + ln)
if reason.startswith("review-rounds-exhausted") and bf:
    lines.append("")
    lines.append("Unaddressed reviewer change requests:")
    for ln in bf.split("\n"):
        lines.append("  " + ln)
if fails:
    lines.append("")
    lines.append("Open failures:")
    for f in fails:
        lines.append("- " + str(f))
envf = env_failures if isinstance(env_failures, list) else []
if envf:
    lines.append("")
    lines.append("Environment (not fixable by the builder; artifacts delivered unverified):")
    for f in envf:
        lines.append("- " + str(f))
if warns:
    lines.append("")
    lines.append("Advisories:")
    for w in warns:
        lines.append("- " + str(w))
report = "\n".join(lines)
# `merged_ok`, NOT `success`: this node sits on the EXECUTION lane, and the
# executor rewrites `success` on a code node's output record with its own
# handler flag. A key named `success` here would be silently replaced by True
# on every run, including refusals. See wf_common._EXEC_RESERVED_OUTPUT_PINS.
return {"report": report, "merged_ok": merged or (passed and approved),
        "stopped_reason": reason, "branch": branch}
""".strip()


# ===========================================================================
# BUILDER PROMPT — text in PIN DEFAULTS, selection in a code node.
#
# Operator ruling 2026-07-30: "system and prompt texts should be very easily
# editable directly by users and agents." The 65-line `builder_prompt` library
# function was the worst offender in the corpus: four blocks of prose glued
# with `+` inside Python, in a drawer, off-canvas.
#
# `string_template` alone cannot hold this: the prompt SELECTS between a
# first-build body and a repair body, and between two probe protocols, and
# there is no pure `select{cond, a, b}` node (0155 open item 6 — and a new
# node type is fail-closed on an older runtime, so one cannot be minted here).
# So the split is: every literal block becomes a PIN DEFAULT the properties
# panel edits as plain text with visible {{slots}}; the code node keeps only
# the branch + the slot fill. Python shrinks from 65 lines to the selection.
# ===========================================================================

BUILDER_FIRST_TEXT = (
    "FIRST BUILD on a fresh branch: implement this plan fully.\n\n"
    "Request:\n{{request}}\n\n"
    "Plan:\n{{plan}}\n\n"
    "{{probe_rules}}"
)

BUILDER_REPAIR_TEXT = (
    "REPAIR MODE on the existing branch. Two failure classes, two charters "
    "(workflow-bench forensics 2026-08-01 — the old smallest-change-only charter "
    "structurally locked every run at prototype scale: a MATCHES failure saying "
    "'far short of vast maps' cannot be fixed by a smallest change, so six repair "
    "cycles produced six appeasement edits):\n"
    "- For EXECUTES/BUILDS failures: make the smallest change that fixes the "
    "named defect; do NOT rewrite whole files with write_file.\n"
    "- For MATCHES failures naming missing content, features, or scale: ADD the "
    "missing content or behavior. Additions are expected and may be large; create "
    "new files freely; never shrink or regress scope that is already covered.\n"
    "Read before editing; re-probe after fixing. {{probe_rules}}\n\n"
    "The request the delivery must satisfy:\n{{request}}\n\n"
    "Failures to fix:\n{{failures}}{{repair_history}}\n\n"
    "After your FINAL edit, refresh SELFCHECK.md evidence and its ARTIFACT-SHA256 lines."
)

# Probe protocol (code-tui c5871, the 8-hour-hang lesson): the bounded
# browser_probe tool over hand-rolled server+headless scripts; port OWNERSHIP
# proven by a nonce round-trip (the incident's port WAS bound - by another
# process); explicit timeouts in SECONDS; failed checks exit nonzero. The tool
# is named ONLY when the host mounts it (probe_ok) - telling the builder to
# call an unmounted tool is a trap (wave-B P2-2).
BUILDER_PROBE_ON_TEXT = (
    "Probe protocol: use the browser_probe tool to check web artifacts (bounded, ~90s) - never "
    "hand-roll 'start a server then drive a headless browser' scripts. If you serve something on "
    "a port, prove the port is YOURS before testing against it: put a nonce in the page and fetch "
    "it back (a plain bind or 200 check is NOT enough - the port may be owned by another "
    "process). Bound EVERY long-running command with an explicit timeout in SECONDS, and make "
    "every check exit nonzero on failure."
)

BUILDER_PROBE_OFF_TEXT = (
    "Probe protocol: browser_probe is NOT available on this host - keep artifact checks static "
    "and bounded. If you must check a served artifact, prove the port is YOURS first: put a nonce "
    "in the page and fetch it back (a plain bind or 200 check is NOT enough - the port may be "
    "owned by another process), bound EVERY long-running command with an explicit timeout in "
    "SECONDS, make every check exit nonzero on failure, and never leave a server running in the "
    "background."
)

BUILDER_PROMPT_CODE = r"""
# SELECTION ONLY. Every sentence the builder reads lives in a pin default
# above this node's inputs; edit the text there, not here. The SEVEN run vars
# it needs each arrive on their own named pin from their own Get Variable chip
# — the canvas lists them, so nobody has to read this body to learn what a
# builder prompt depends on.
req = str(request or "").strip()
plan_txt = str(plan_goal or "").strip()
steps = plan_steps if isinstance(plan_steps, list) else []
i = 1
for st in steps:
    plan_txt = plan_txt + "\n" + str(i) + ". " + str(st)
    i = i + 1
bf = str(build_feedback or "").strip()
fix = int(fix_cycles or 0)
# Repair history: every past failed cycle, in order, so the builder can see
# what it already tried.
hist = repair_history if isinstance(repair_history, list) else []
trail = ""
if hist:
    # ADR-0026: the WHOLE trail. A `hist[-8:]` window sat here and hid the
    # early cycles — the ones a long repair loop most needs not to repeat.
    trail = "\n\nRepair history so far (do not repeat an approach that already failed):\n"
    for h in hist:
        hc = h if isinstance(h, dict) else {}
        trail = (trail + "- cycle " + str(hc.get("cycle")) + ": tried: "
                 + str(hc.get("changed") or "(no summary)")
                 + " | still failed: " + str(hc.get("failed") or "(unknown)") + "\n")
probe = probe_available_text if bool(probe_ok) else probe_absent_text
if fix == 0 and not bf:
    text = str(first_build_text or "")
    text = text.replace("{{request}}", req)
    text = text.replace("{{plan}}", plan_txt)
    text = text.replace("{{probe_rules}}", str(probe or ""))
else:
    text = str(repair_text or "")
    text = text.replace("{{probe_rules}}", str(probe or ""))
    # The additive charter re-anchors repair on the REQUEST: a MATCHES failure
    # names what is missing relative to it, and without the request in view six
    # repair cycles shipped six minimal appeasement edits.
    text = text.replace("{{request}}", req)
    text = text.replace("{{failures}}", bf if bf else "(none recorded - re-verify your artifacts)")
    text = text.replace("{{repair_history}}", trail)
return {"prompt": text}
""".strip()


# ===========================================================================
# GATE-2 PROMPT — same split as the builder prompt: prose in pin defaults,
# selection in the node. Gate 2 serves TWO cases (green = merge approval,
# red = escalation of a stuck build), which is again a selection no
# `string_template` can make on its own.
# ===========================================================================

GATE2_GREEN_TEXT = (
    "REVIEW GATE: the build is green on branch '{{branch}}' and PR.md summarizes it.\n"
    "Test the artifact yourself now (the gates are static checks; runtime behavior is yours to "
    "judge)."
)

GATE2_GREEN_FOOTER_TEXT = (
    "Reply 'approve' to merge into main, or anything else as CHANGE REQUESTS sent back to the "
    "builder."
)

# Say WHICH stop reason fired: the same failure repeating means more cycles
# alone will not help (the approach must change); running out of cycles just
# means it needs more room or a hint.
GATE2_STALLED_TEXT = (
    "BUILD STUCK on branch '{{branch}}': the SAME failure repeated {{repeats}} times in a row. "
    "More cycles alone will not help - the approach needs to change."
)

GATE2_BUDGET_TEXT = (
    "BUILD STUCK on branch '{{branch}}': used up the fix budget ({{fix_cycles}} of "
    "{{max_fix_cycles}} cycles) without going green."
)

GATE2_RED_FOOTER_TEXT = (
    "Comment to guide further repairs (this resets the fix budget), or reply 'stop' to end the "
    "run unmerged."
)

GATE2_FINAL_ROUND_TEXT = (
    "NOTE: this is the FINAL review round - a rejection ends the run unmerged."
)

GATE2_PROMPT_CODE = r"""
# SELECTION ONLY. Every sentence the reviewer reads lives in a pin default,
# and every run var it weighs arrives on its own named pin from its own Get
# Variable chip (nine of them — this gate genuinely reads nine variables, and
# now says so on the canvas instead of hiding them behind `loop_state`).
branch = str(branch or "work")
green = bool(all_passed)
fails = failures if isinstance(failures, list) else []
warns = warnings if isinstance(warnings, list) else []
rev = int(review_rounds or 0)
maxrev = int(max_review_rounds or 2)
repeats = int(same_signature_count or 0)
stalled = repeats >= 3
lines = []
if green:
    lines.append(str(green_text or "").replace("{{branch}}", branch))
else:
    if stalled:
        head = str(stalled_text or "").replace("{{repeats}}", str(repeats + 1))
    else:
        head = str(budget_text or "")
        head = head.replace("{{fix_cycles}}", str(int(fix_cycles or 0)))
        head = head.replace("{{max_fix_cycles}}", str(int(max_fix_cycles or 6)))
    lines.append(head.replace("{{branch}}", branch))
    lines.append("Open failures:")
    # ADR-0026: the human/agent reviewer at this gate sees EVERY open failure.
    # A [:12] slice sat here and hid the tail of a long red list.
    for f in fails:
        lines.append("- " + str(f))
    lines.append(str(red_footer_text or ""))
for w in warns:
    lines.append("- advisory: " + str(w))
if rev >= maxrev:
    lines.append("")
    lines.append(str(final_round_text or ""))
lines.append("")
if green:
    lines.append(str(green_footer_text or ""))
# The gate's ANSWER VOCABULARY is composed here too, on the same `green` flag
# that already picks the prompt's wording: the words a reviewer is offered and
# the words asking for them must never drift apart, and both lists are editable
# pin defaults right next to the sentences that introduce them.
return {"prompt": "\n".join(lines),
        "choices": list(green_choices if green else escalation_choices)}
""".strip()


def build_root() -> dict:
    f = base_flow(ROOT_FLOW_ID, "Multi-agent coding — main pipeline (edit on canvas)",
                  "Scouts (code+web) -> planner -> plan gate -> backlog -> git branch -> "
                  "[build -> lint -> selfcheck -> verify -> doc -> PR -> review gate]xN -> merge. "
                  "Deterministic git/lint/PR/merge via the flow FUNCTION LIBRARY (see the "
                  "Functions panel); two user gates (gating_mode=auto skips both; auto mode "
                  "needs input_data._runtime.tool_policy auto-approving execute_command "
                  "or an approving driver, else tool approvals park the run).",
                  interfaces=[CODING_INTERFACE],
                  functions=FUNCTIONS)
    N = f["nodes"]
    E = f["edges"]

    # ---------------- nodes ----------------
    N.append(node("start", "on_flow_start", "Coding request", -2280, 0,
                  outputs=[EXEC_OUT,
                           pin("request", "request", "string"),
                           pin("workspace_root", "workspace_root", "string"),
                           pin("gating_mode", "gating_mode", "string"),
                           pin("max_plan_revisions", "max_plan_revisions", "number"),
                           pin("max_fix_cycles", "max_fix_cycles", "number"),
                           pin("max_review_rounds", "max_review_rounds", "number"),
                           pin("skills", "skills", "array"),
                           pin("browser_probe_available", "browser_probe_available", "boolean"),
                           pin("build_command", "build_command", "string"),
                           pin("run_command", "run_command", "string"),
                           pin("provider", "provider", "provider_text"),
                           pin("model", "model", "model")],
                  # These defaults are the ONE source for every budget and
                  # flag. MEASURED (not assumed): a start pin the caller omits
                  # does NOT land in run.vars — only pins the caller actually
                  # sent do — so a pin default alone cannot satisfy an
                  # expression that reads `vars.<name>` (attribute access fails
                  # LOUDLY on a missing var, by design). The three BUDGETS the
                  # loop laws read by name are therefore typed and written back
                  # by the door, from these same defaults (see preflight).
                  pin_defaults={"request": "", "workspace_root": "",
                                "gating_mode": "wait", "max_plan_revisions": 3,
                                "max_fix_cycles": 6, "max_review_rounds": 2,
                                "skills": ["coredoc"],
                                "browser_probe_available": False,
                                "build_command": "", "run_command": ""}))
    # PREFLIGHT — the door, and the only place run vars are born. 0.0.15 cut
    # the SEVEN config wires it used to fold into the blob for nobody's
    # benefit (max_plan_revisions, max_fix_cycles, max_review_rounds,
    # build_command, run_command, provider, model): those are `start` pins, so
    # they are already run vars, and their readers name them directly. What is
    # left is exactly what the door INSPECTS: the request, the workspace, the
    # gating mode, the requested skills, the probe posture — plus the
    # gateway-written skills resolution on a Get Variable chip (never a
    # caller-attested pin, adversary F2) and five editable prose defaults.
    pf = code_node("preflight", "Preflight", PREFLIGHT_CODE, -2000, 0,
                   [pin("request", "request", "string"),
                    pin("workspace_root", "workspace_root", "string"),
                    pin("gating_mode", "gating_mode", "string"),
                    pin("max_plan_revisions", "max_plan_revisions", "number"),
                    pin("max_fix_cycles", "max_fix_cycles", "number"),
                    pin("max_review_rounds", "max_review_rounds", "number"),
                    pin("skills", "skills", "array"),
                    pin("browser_probe_available", "browser_probe_available", "boolean"),
                    pin("skills_resolution", "skills_resolution", "object"),
                    pin("skills_missing_text", "skills_missing_text", "string"),
                    pin("probe_absent_text", "probe_absent_text", "string"),
                    pin("empty_request_text", "empty_request_text", "string"),
                    pin("no_workspace_text", "no_workspace_text", "string"),
                    pin("refusal_header_text", "refusal_header_text", "string")],
                   outputs=[pin("updates", "updates", "object"),
                            pin("report", "report", "string")], exec_pins=True)
    pf["data"]["pinDefaults"].update({
        "skills_missing_text": PREFLIGHT_SKILLS_TEXT,
        "probe_absent_text": PREFLIGHT_PROBE_TEXT,
        "empty_request_text": PREFLIGHT_EMPTY_REQUEST_TEXT,
        "no_workspace_text": PREFLIGHT_NO_WORKSPACE_TEXT,
        "refusal_header_text": PREFLIGHT_REFUSAL_HEADER_TEXT,
    })
    N.append(pf)
    # The gateway writes skills_resolution after resolving input_data.skills;
    # it is never a caller-attested pin (adversary F2). A Get Variable node
    # reads it — dotted path, `{}` default (operator ruling: a variable read
    # is a node the canvas draws).
    read_pin(N, E, "preflight", "skills_resolution", "_runtime.skills_resolution", {},
             -2000, -420)
    # THE SEED. One `set_vars` where a `set_var{name:"state"}` used to be: each
    # key of `updates` lands as its OWN top-level run var. The `updates` pin
    # DEFAULT carries the whole SEED_VARS inventory, so the flow's run-var
    # vocabulary is readable and editable on this one node (and
    # `collectDeclaredVarNames` picks the names up for the variable picker and
    # the unknown-var preflight check) — and if the wire ever went missing the
    # default is fail-closed: preflight_ok False refuses the run at the door.
    N.append(W.set_vars("seed_vars", "Seed run variables", -1860, 0, seed=SEED_VARS))
    N.append(if_node("if_preflight", "Preflight ok?", -1720, 0))
    read_pin(N, E, "if_preflight", "condition", "preflight_ok", False, -1720, -320)
    N.append(node("end_pre", "on_flow_end", "Refused (preflight)", -1720, 260,
                  inputs=[EXEC_IN, pin("report", "report", "string"),
                          pin("success", "success", "boolean"),
                          pin("stopped_reason", "stopped_reason", "string"),
                          CODING_V1_PASSED_PIN],
                  pin_defaults={"success": False, "passed": False,
                                "stopped_reason": "preflight-failed"}))

    # Run-start gating line (code-tui c5871): the FIRST user-visible line of
    # every run names the mode — "gating: wait" or "gating: auto" — so any
    # client renders it without knowing this workflow's shape. Stable prefix,
    # same contract as the "build cycle N of M" line.
    #
    # SMELL 1 (operator, 2026-07-30): "why don't you use a variable enum and do
    # a switch on gating_mode instead of again, a pure function?"
    #
    # THE SWITCH IS REFUSED, and the reason is worth stating plainly because it
    # is not "too much work". `switch` is an EXEC-LANE node: it costs a switch,
    # one Answer User per case, and a re-join — three nodes and a fork to emit
    # ONE line. Each case then carries its OWN copy of the "gating: " prefix,
    # which is a drift surface in the one node whose entire job is to state a
    # fact consistently. And a switch fails OPEN on a value nobody enumerated:
    # an unmatched case emits nothing, so the run-start line silently vanishes
    # exactly when something unexpected happened. Worse on every axis.
    #
    # WHAT THE ASK IS RIGHT ABOUT is that the two cases should be VISIBLE and
    # EDITABLE, not fused into a Python conditional hidden on a pin. So the line
    # takes this flow's own prose-composer shape — the one `gate2_prompt`,
    # `builder_prompt` and `pr_body` already use: a code node whose sentence and
    # whose two case words are editable pin defaults with a {{slot}}, fed by ONE
    # Get Variable chip. That is the switch's real benefit (per-case text a
    # human can read and change, side by side on one node) without the fork,
    # the duplicated prefix, or the silent fall-through.
    #
    # It reads `wait_gating` — the boolean the door normalized ONCE from
    # `gating_mode` — rather than the raw start-pin string, so a caller sending
    # "banana" (gated in WAIT mode, bounded) reads "gating: wait" instead of the
    # line announcing a mode the run is not in. Reading the CANONICAL enum word
    # instead would be marginally nicer still, and was built and reverted: it
    # requires the door to write `gating_mode` back, which puts one name in both
    # the config and seed halves of the run-var inventory — an invariant the
    # anti-blob work owns (`config-and-progress-overlap-is-the-typed-budgets`,
    # whose three exceptions exist for a forcing reason this one lacks).
    gline = code_node("gating_line", "Compose gating line", GATING_LINE_CODE, -1580, -520,
                      [pin("wait_gating", "wait_gating", "boolean"),
                       pin("line_text", "line_text", "string"),
                       pin("wait_word", "wait_word", "string"),
                       pin("auto_word", "auto_word", "string")],
                      outputs=[pin("message", "message", "string")], exec_pins=True)
    gline["data"]["pinDefaults"].update({
        "line_text": GATING_LINE_TEXT,
        "wait_word": GATING_WAIT_WORD,
        "auto_word": GATING_AUTO_WORD,
    })
    N.append(gline)
    read_pin(N, E, "gating_line", "wait_gating", "wait_gating", True, -1580, -860)
    N.append(node("gating_status", "answer_user", "Gating mode", -1580, -200,
                  inputs=[EXEC_IN, pin("message", "message", "string"),
                          pin("level", "level", "string")],
                  outputs=[EXEC_OUT, pin("message", "message", "string")],
                  pin_defaults={"level": "message"},
                  extra={"icon": "&#x1F4AC;", "headerColor": "#9B59B6"}))

    # ---- GREENFIELD FAST-PATH (0.0.18): deterministic probe before L1 ----
    # An empty (or dotfiles-only) workspace has nothing to scout and nothing
    # for a planner to weigh beyond the request itself — measured as pure
    # overhead on the bench. COMPOSE -> EXECUTE -> FOLD, same shape as every
    # shell step; the fold pre-accepts the request-as-plan so the plan loop's
    # own law skips scouts, planner and gate 1 without a new branch node.
    gcmd = code_node("green_cmd", "Compose greenfield probe", GREEN_CMD_CODE, -1520, 140,
                     [pin("workspace_root", "workspace_root", "string")],
                     outputs=[pin("tool_call", "tool_call", "object")], exec_pins=True)
    N.append(gcmd)
    read_pin(N, E, "green_cmd", "workspace_root", "workspace_root", "", -1520, -40)
    N.append(call_tool("green_call", "Probe workspace (ls -A)",
                       ["execute_command"], -1500, 140))
    gfold = code_node("green_fold", "Decide greenfield fast-path", GREEN_FOLD_CODE,
                      -1480, 140,
                      [pin("probe_text", "probe_text", "string"),
                       pin("request", "request", "string"),
                       pin("title_text", "title_text", "string"),
                       pin("risk_text", "risk_text", "string"),
                       pin("skip_context_text", "skip_context_text", "string"),
                       pin("skip_line_text", "skip_line_text", "string"),
                       pin("full_line_text", "full_line_text", "string")],
                      outputs=[pin("updates", "updates", "object"),
                               pin("message", "message", "string")], exec_pins=True)
    gfold["data"]["pinDefaults"].update({
        "title_text": GREEN_TITLE_TEXT,
        "risk_text": GREEN_RISK_TEXT,
        "skip_context_text": GREEN_CONTEXT_TEXT,
        "skip_line_text": GREEN_SKIP_LINE_TEXT,
        "full_line_text": GREEN_FULL_LINE_TEXT,
    })
    W.with_expressions(gfold, {"probe_text": "text_of(value)"})
    N.append(gfold)
    read_vars(N, E, "green_fold", [("request", "request", "")], -1480, -40)
    N.append(W.set_vars("set_green", "Record greenfield decision", -1460, 140))
    N.append(node("green_status", "answer_user", "Scouting decision", -1440, 140,
                  inputs=[EXEC_IN, pin("message", "message", "string"),
                          pin("level", "level", "string")],
                  outputs=[EXEC_OUT, pin("message", "message", "string")],
                  pin_defaults={"level": "message"},
                  extra={"icon": "&#x1F4AC;", "headerColor": "#9B59B6"}))

    # ---- L1: plan loop ----
    # Loop conditions carry the expression AND a FALSE pin default: on a
    # pre-expression runtime the expression is unread and the pin falls to
    # its default — False exits immediately (bounded refusal), while the
    # wf_common while_node default of True would spin the loop to its cap
    # executing agent calls. The min_runtime gate already refuses the bundle
    # on old gateways; this is defense-in-depth behind it.
    plan_while = while_node("plan_while", "Plan loop", -1440, 0)
    plan_while["data"]["pinDefaults"]["condition"] = False
    # A `while` condition has to stay an EXPRESSION (one pure pin, re-read per
    # iteration) — but it now NAMES its three variables instead of hiding them
    # behind `vars.state`.
    N.append(W.with_expressions(
        plan_while,
        {"condition": "not vars.accepted and "
                      "int(vars.plan_revisions or 0) < int(vars.max_plan_revisions or 3)"}))
    # scouts run on the first pass and again only on an explicit "research"
    # choice; cached scout context feeds plain plan revisions for free
    N.append(W.with_expressions(
        if_node("if_scout", "Need scouting?", -1440, -280),
        {"condition": 'not str(vars.scout_context or "").strip() or bool(vars.rescout)'}))
    # ONE node composes BOTH scout briefs (two labeled outputs, two wires):
    # they share the request + reviewer-feedback header, and side by side is
    # how a reader compares the two mandates. Both briefs are editable pin
    # defaults; the body only fills {{request}} / {{feedback}}.
    sp = code_node("scout_prompts", "Compose scout briefs", SCOUT_PROMPTS_CODE, -1300, -420,
                   [pin("request", "request", "string"),
                    pin("plan_feedback", "plan_feedback", "string"),
                    pin("code_brief_text", "code_brief_text", "string"),
                    pin("web_brief_text", "web_brief_text", "string"),
                    pin("feedback_text", "feedback_text", "string")],
                   outputs=[pin("code_prompt", "code_prompt", "string"),
                            pin("web_prompt", "web_prompt", "string")], exec_pins=True)
    sp["data"]["pinDefaults"].update({
        "code_brief_text": SCOUT_CODE_BRIEF_TEXT,
        "web_brief_text": SCOUT_WEB_BRIEF_TEXT,
        "feedback_text": SCOUT_FEEDBACK_TEXT,
    })
    N.append(sp)
    read_vars(N, E, "scout_prompts",
              [("request", "request", ""), ("plan_feedback", "plan_feedback", "")],
              -1300, -760)
    N.append(agent_node("scout_code", "Scout: code+docs", -1160, -420,
                        pin_defaults={"system": SCOUT_CODE_SYSTEM_TEXT,
                                      "tools": ["read_file", "list_files", "search_files",
                                                "skim_files", "skim_folders", "analyze_code"],
                                      "max_iterations": 12, "temperature": 0.2}))
    N.append(agent_node("scout_web", "Scout: internet", -860, -420,
                        pin_defaults={"system": SCOUT_WEB_SYSTEM_TEXT,
                                      "tools": ["web_search", "fetch_url",
                                                "skim_websearch", "skim_url"],
                                      "max_iterations": 12, "temperature": 0.2}))
    # ONE pair for the scouting neighbourhood: the two scouts are adjacent
    # columns, so the shared chips land in scout_code's column and the fan-out
    # wire to scout_web crosses a single column gap.
    model_pins(N, E, "scouts", ("scout_code", "scout_web"), -1160, -760)
    # EXEC LANE (scout_web -> scout_merge -> set_state_scout): sequenced work
    # with ONE consumer, inside the plan loop. The exec token passes it on
    # every scouting iteration, so freshness is identical to the pure pull it
    # replaces; what changes is that it runs once per iteration instead of
    # once per resolution of set_state_scout.value.
    # ZERO run-var reads (it used to pull the whole blob just to put one key
    # back): two findings wires in, one named variable out.
    N.append(
        code_node("scout_merge", "Merge scout context", SCOUT_MERGE_CODE, -560, -480,
                  [pin("code_findings", "code_findings", "string"),
                   pin("web_findings", "web_findings", "string")],
                  outputs=[pin("updates", "updates", "object")], exec_pins=True))
    N.append(W.set_vars("set_scout_context", "Cache scout context", -560, -280))
    pp = code_node("planner_prompt", "Compose planner brief", PLANNER_PROMPT_CODE, -420, -420,
                   [pin("request", "request", "string"),
                    pin("scout_context", "scout_context", "string"),
                    pin("plan_feedback", "plan_feedback", "string"),
                    pin("brief_text", "brief_text", "string"),
                    pin("feedback_text", "feedback_text", "string")],
                   outputs=[pin("prompt", "prompt", "string")], exec_pins=True)
    pp["data"]["pinDefaults"].update({
        "brief_text": PLANNER_BRIEF_TEXT,
        "feedback_text": PLANNER_FEEDBACK_TEXT,
    })
    N.append(pp)
    read_vars(N, E, "planner_prompt",
              [("request", "request", ""), ("scout_context", "scout_context", ""),
               ("plan_feedback", "plan_feedback", "")], -420, -760)
    N.append(agent_node("planner", "Planner", -280, -420,
                        pin_defaults={"system": PLANNER_SYSTEM_TEXT,
                                      "tools": [], "max_iterations": 6, "temperature": 0.2,
                                      # the structured-output schema is a constant,
                                      # not a computed value
                                      "resp_schema": PLANNER_SCHEMA}))
    model_pins(N, E, "authors", ("planner", "builder"), -280, -760)
    N.append(if_node("if_g1", "Wait mode?", 0, -420))
    read_pin(N, E, "if_g1", "condition", "wait_gating", True, 0, -1040)
    # Gate 1's prompt is composed BY A NODE from the planner's data on a wire
    # (see GATE1_PROMPT_CODE for why ask_user cannot take planner.data raw).
    # The choices are a constant pin default.
    g1p = code_node("gate1_prompt", "Compose gate-1 prompt", GATE1_PROMPT_CODE, 140, -520,
                    [pin("planner_data", "planner_data", "object"),
                     pin("head_text", "head_text", "string"),
                     pin("untitled_text", "untitled_text", "string"),
                     pin("footer_text", "footer_text", "string")],
                    outputs=[pin("prompt", "prompt", "string")], exec_pins=True)
    g1p["data"]["pinDefaults"].update({
        "head_text": GATE1_HEAD_TEXT,
        "untitled_text": GATE1_UNTITLED_TEXT,
        "footer_text": GATE1_FOOTER_TEXT,
    })
    N.append(g1p)
    gate1 = ask_user("gate1", "GATE 1: approve plan?", 280, -520)
    # The prompt is ALWAYS composed upstream (a dead planner still yields a
    # non-empty prompt), so a literal prompt default is unreachable.
    gate1["data"]["pinDefaults"].pop("prompt", None)
    gate1["data"]["pinDefaults"]["choices"] = ["approve", "revise", "research"]
    N.append(gate1)
    # EXEC LANE (gate1 -> gate1_parse -> set_state_plan): one consumer, and
    # the parse is genuinely sequenced — it reads the answer the human just
    # gave. Wait-mode branch only; auto mode never reaches it.
    # ONE run-var read (`plan_revisions`, the counter it bumps) where the blob
    # made it look like the parse depended on everything.
    N.append(
        code_node("gate1_parse", "Parse gate-1", GATE1_PARSE_CODE, 560, -640,
                  [pin("response", "response", "string"),
                   pin("planner_data", "planner_data", "object"),
                   pin("plan_revisions", "plan_revisions", "number")],
                  outputs=[pin("updates", "updates", "object")], exec_pins=True))
    read_vars(N, E, "gate1_parse", [("plan_revisions", "plan_revisions", 0)], 560, -980)
    N.append(W.set_vars("set_plan_decision", "Record plan decision", 560, -420))
    # auto mode: deterministic accept. Same node+set_vars shape as the wait-mode
    # lane above it, so both gate-1 outcomes read identically on the canvas.
    pa = code_node("plan_auto", "Auto-accept plan", PLAN_AUTO_CODE, 140, -220,
                   [pin("planner_data", "planner_data", "object"),
                    pin("plan_revisions", "plan_revisions", "number"),
                    pin("no_plan_text", "no_plan_text", "string")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    pa["data"]["pinDefaults"]["no_plan_text"] = PLAN_AUTO_NO_PLAN_TEXT
    N.append(pa)
    read_vars(N, E, "plan_auto", [("plan_revisions", "plan_revisions", 0)], 140, -60)
    N.append(W.set_vars("set_plan_auto", "Record auto-accept", 280, -220))

    # ---- accepted? -> backlog + git ----
    N.append(if_node("if_accepted", "Accepted?", -1160, 260))
    read_pin(N, E, "if_accepted", "condition", "accepted", False, -1160, -60)
    # The backlog markdown is a TEMPLATE pin default with five slots; the body
    # only bullets the plan's lists, which arrive on FOUR dotted chips
    # (`plan.goal`, `plan.steps`, `plan.files`, `plan.risks`) — the canvas now
    # shows exactly which parts of the plan a backlog item is made of. `slug`
    # rides the shared branch_slug transform over `vars.title`.
    bb = code_node("backlog_body", "Compose backlog item", BACKLOG_BODY_CODE, -1020, 260,
                   [pin("plan_goal", "plan_goal", "string"),
                    pin("plan_steps", "plan_steps", "array"),
                    pin("plan_files", "plan_files", "array"),
                    pin("plan_risks", "plan_risks", "array"),
                    pin("slug", "slug", "string"),
                    pin("template_text", "template_text", "string"),
                    pin("empty_goal_text", "empty_goal_text", "string"),
                    pin("no_items_text", "no_items_text", "string")],
                   outputs=[pin("content", "content", "string")], exec_pins=True)
    bb["data"]["pinDefaults"].update({
        "template_text": BACKLOG_TEMPLATE_TEXT,
        "empty_goal_text": BACKLOG_EMPTY_GOAL_TEXT,
        "no_items_text": BACKLOG_NO_ITEMS_TEXT,
    })
    W.with_expressions(bb, {"slug": "branch_slug(vars.title)"})
    N.append(bb)
    read_vars(N, E, "backlog_body",
              [("plan_goal", "plan.goal", ""), ("plan_steps", "plan.steps", []),
               ("plan_files", "plan.files", []), ("plan_risks", "plan.risks", [])],
              -1020, -60)
    N.append(W.with_expressions(
        write_file_node("backlog_write", "Write planned item", -880, 260),
        {"file_path": '"docs/backlog/planned/" + branch_slug(vars.title) + ".md"'}))
    # COMPOSE -> EXECUTE, on two nodes and a wire (0.0.15, smell 3): the
    # command is built by a code node whose body the properties panel shows,
    # and Call Tool only runs it. Same shape for all seven shell steps.
    gbc = code_node("git_branch_cmd", "Compose branch command", GIT_BRANCH_CMD_CODE,
                    -740, 260,
                    [pin("workspace_root", "workspace_root", "string"),
                     pin("slug", "slug", "string")],
                    outputs=[pin("tool_call", "tool_call", "object")], exec_pins=True)
    W.with_expressions(gbc, {"slug": "branch_slug(vars.title)"})
    N.append(gbc)
    read_pin(N, E, "git_branch_cmd", "workspace_root", "workspace_root", "", -740, -80)
    N.append(call_tool("git_call", "Git init+branch", ["execute_command"], -600, 260))
    # git_text arrives pre-extracted via the shared text_of transform on the
    # wire; slug via the shared branch_slug transform. ZERO run-var reads: two
    # wires in, two named variables out.
    bf = code_node("branch_fold", "Fold branch name", BRANCH_FOLD_CODE, -460, 260,
                   [pin("git_text", "git_text", "string"),
                    pin("slug", "slug", "string")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    W.with_expressions(bf, {"git_text": "text_of(value)",
                            "slug": "branch_slug(vars.title)"})
    N.append(bf)
    N.append(W.set_vars("set_branch", "Record branch", -320, 260))

    # ---- L2: build loop ----
    build_while = while_node("build_while", "Build loop", -40, 260)
    build_while["data"]["pinDefaults"]["condition"] = False  # skew belt (see plan_while)
    # EIGHT NAMED ARGUMENTS on the loop law — the pin now says which variables
    # decide whether another build cycle runs, instead of `build_again(state)`.
    N.append(W.with_expressions(
        build_while,
        {"condition": ("build_again(vars.approved, vars.user_stopped, "
                       "vars.environment_blocked, vars.same_signature_count, "
                       "vars.fix_cycles, vars.max_fix_cycles, "
                       "vars.review_rounds, vars.max_review_rounds)")}))
    # Progress line at the TOP of each build cycle (operator "never a surprise"
    # request, relayed by code-tui c5833). A plain "build cycle N of M" status
    # with a STABLE leading token so a client strip renders it without guessing
    # the loop shape. N = cycles already done + 1 (the one about to run); M =
    # the fix budget for this review round. This is a fresh number each
    # iteration because the message rides the user-visible answer channel.
    # SMELL 1, the second site. A switch is meaningless here — this is numeric
    # interpolation over an unbounded pair, not an enum — and building it out
    # of `concat`/`add` nodes would take six boxes to say one sentence. What it
    # SHARES with the gating line is the real defect: the sentence a user reads
    # was Python on an invisible pin. Same fix, same shape as every other
    # composer in this flow: an editable {{slot}} default and named chips.
    cline = code_node("cycle_line", "Compose cycle line", CYCLE_LINE_CODE, -40, 20,
                      [pin("fix_cycles", "fix_cycles", "number"),
                       pin("max_fix_cycles", "max_fix_cycles", "number"),
                       pin("line_text", "line_text", "string")],
                      outputs=[pin("message", "message", "string")], exec_pins=True)
    cline["data"]["pinDefaults"]["line_text"] = CYCLE_LINE_TEXT
    N.append(cline)
    read_vars(N, E, "cycle_line",
              [("fix_cycles", "fix_cycles", 0),
               ("max_fix_cycles", "max_fix_cycles", 6)], -40, -280)
    N.append(node("cycle_status", "answer_user", "Build cycle progress", 100, 20,
                  inputs=[EXEC_IN, pin("message", "message", "string"),
                          pin("level", "level", "string")],
                  outputs=[EXEC_OUT, pin("message", "message", "string")],
                  pin_defaults={"level": "message"},
                  extra={"icon": "&#x1F4AC;", "headerColor": "#9B59B6"}))
    # browser_probe (code-tui c5871): the bounded registered probe replaces
    # hand-rolled server+headless scripts that hung a live run for 8 hours.
    # Granted ONLY when the host mounts it (probe_ok) — the tools pin carries
    # the conditional; the pin DEFAULT stays the probe-less base list (skew
    # belt: a pre-expression runtime grants the safe set).
    builder_base_tools = ["read_file", "write_file", "edit_file",
                          "list_files", "search_files", "analyze_code",
                          "execute_command"]
    # The builder's prompt is COMPOSED BY A NODE on the exec lane, with every
    # literal block sitting in an editable pin default (see BUILDER_*_TEXT).
    bp = code_node("builder_prompt", "Compose builder prompt", BUILDER_PROMPT_CODE, 100, 140,
                   [pin("request", "request", "string"),
                    pin("plan_goal", "plan_goal", "string"),
                    pin("plan_steps", "plan_steps", "array"),
                    pin("build_feedback", "build_feedback", "string"),
                    pin("fix_cycles", "fix_cycles", "number"),
                    pin("repair_history", "repair_history", "array"),
                    pin("probe_ok", "probe_ok", "boolean"),
                    pin("first_build_text", "first_build_text", "string"),
                    pin("repair_text", "repair_text", "string"),
                    pin("probe_available_text", "probe_available_text", "string"),
                    pin("probe_absent_text", "probe_absent_text", "string")],
                   outputs=[pin("prompt", "prompt", "string")], exec_pins=True)
    bp["data"]["pinDefaults"].update({
        "first_build_text": BUILDER_FIRST_TEXT,
        "repair_text": BUILDER_REPAIR_TEXT,
        "probe_available_text": BUILDER_PROBE_ON_TEXT,
        "probe_absent_text": BUILDER_PROBE_OFF_TEXT,
    })
    N.append(bp)
    read_vars(N, E, "builder_prompt",
              [("request", "request", ""), ("plan_goal", "plan.goal", ""),
               ("plan_steps", "plan.steps", []), ("build_feedback", "build_feedback", ""),
               ("fix_cycles", "fix_cycles", 0), ("repair_history", "repair_history", []),
               ("probe_ok", "probe_ok", False)], 100, -100)
    N.append(W.with_expressions(
        agent_node("builder", "Builder", 240, 140,
                   pin_defaults={"system": BUILDER_SYSTEM_TEXT,
                                 "tools": builder_base_tools,
                                 "max_iterations": 40, "temperature": 0.2}),
        {"tools": 'value + (["browser_probe"] if vars.probe_ok else [])'}))
    # THE BUILD-LOOP SHELL CLUSTER: three compose->execute pairs in a row, all
    # three reading the SAME variable. One shared `workspace_root` chip fans
    # out to all three composers (same neighbourhood rule as model_pins — they
    # sit in consecutive columns, so the fan-out wires stay short) instead of
    # three chips saying the same word three times.
    N.append(code_node("lint_cmd", "Compose lint command", LINT_CMD_CODE, 400, 140,
                       [pin("workspace_root", "workspace_root", "string")],
                       outputs=[pin("tool_call", "tool_call", "object")], exec_pins=True))
    read_pin(N, E, "lint_cmd", "workspace_root", "workspace_root", "", 400, -200,
             chip="build_ws")
    N.append(call_tool("lint_call", "Lint + format (fix)", ["execute_command"], 540, 140))
    # The residual-diagnostic filter is a NODE between the linter and the fold
    # (was the `parse_lint_residuals(value)` expression hidden on
    # next_state.lint_out). lint_text arrives pre-extracted via text_of.
    N.append(W.with_expressions(
        code_node("lint_parse", "Parse lint residuals", LINT_PARSE_CODE, 680, 140,
                  [pin("lint_text", "lint_text", "string")],
                  outputs=[pin("residuals", "residuals", "array")], exec_pins=True),
        {"lint_text": "text_of(value)"}))
    N.append(code_node("selfcheck_cmd", "Compose SELFCHECK refresh", SELFCHECK_CMD_CODE,
                       780, 140,
                       [pin("workspace_root", "workspace_root", "string")],
                       outputs=[pin("tool_call", "tool_call", "object")], exec_pins=True))
    E.append(edge("build_ws", "value", "selfcheck_cmd", "workspace_root"))
    N.append(call_tool("selfcheck_call", "Refresh SELFCHECK hashes", ["execute_command"], 820, 140))
    N.append(code_node("commit_cmd", "Compose commit command", COMMIT_CMD_CODE, 1060, 140,
                       [pin("workspace_root", "workspace_root", "string")],
                       outputs=[pin("tool_call", "tool_call", "object")], exec_pins=True))
    E.append(edge("build_ws", "value", "commit_cmd", "workspace_root"))
    N.append(call_tool("commit_call", "Commit cycle", ["execute_command"], 1100, 140))
    # THE SUBFLOW CALL, SET THROUGH ITS PINS (0.0.16). `verify` runs the
    # mounted gates child; its on_flow_start declares SEVEN fields, so this
    # node declares those seven as INPUT PINS and each Get Variable chip wires
    # straight into the pin it feeds. The `make_object "Build JSON"` meta node
    # that used to assemble them into one `input:object` is DELETED — it had
    # no logic in it, it only hid which seven values the call sets (operator
    # ruling 2026-07-30: "whenever you are NOT using the pins, it means you are
    # HIDING something"). Chips -> node, one hop, nothing between.
    #
    # `verdict` is a DECLARED output pin (the child's on_flow_end field), so
    # the fold WIRES it back.
    N.append(subflow_node("verify", "Test: mounted gates", VERIFY_FLOW_ID, 1380, 140,
                          child_inputs=[("request", "string"),
                                        ("workspace_root", "string"),
                                        ("build_command", "string"),
                                        ("run_command", "string"),
                                        ("round_index", "number"),
                                        ("provider", "provider_text"),
                                        ("model", "model")],
                          child_outputs=[("verdict", "object")]))
    read_vars(N, E, "verify",
              [("request", "request", ""), ("workspace_root", "workspace_root", ""),
               ("build_command", "build_command", ""), ("run_command", "run_command", ""),
               # the child's `round_index` IS this run's fix_cycles counter
               ("round_index", "fix_cycles", 0),
               ("provider", "provider", None), ("model", "model", None)], 1380, -300)
    # Fold verdict is a genuinely multi-wire node: verify verdict + child meta
    # + builder response + parsed lint residuals. EXEC LANE (verify ->
    # next_state -> set_state_build): one consumer, and the fold is the step
    # that turns a verify result into the next loop state. Inside the build
    # loop, so it re-runs every iteration.
    # ZERO pin expressions now: `verify_verdict` arrives on a wire from the
    # subflow's declared `verdict` pin, `lint_out` on a wire from the
    # `lint_parse` node. Both used to be field-extract / parser expressions.
    N.append(
        code_node("next_state", "Fold verdict", NEXT_STATE_CODE, 1660, 320,
                  [pin("verify_verdict", "verify_verdict", "object"),
                   pin("verify_meta", "verify_meta", "object"),
                   pin("builder_response", "builder_response", "string"),
                   pin("lint_out", "lint_out", "array"),
                   pin("failure_signature", "failure_signature", "string"),
                   pin("same_signature_count", "same_signature_count", "number"),
                   pin("fix_cycles", "fix_cycles", "number"),
                   pin("repair_history", "repair_history", "array"),
                   pin("wait_gating", "wait_gating", "boolean")],
                  outputs=[pin("updates", "updates", "object")], exec_pins=True))
    read_vars(N, E, "next_state",
              [("failure_signature", "failure_signature", ""),
               ("same_signature_count", "same_signature_count", 0),
               ("fix_cycles", "fix_cycles", 0),
               ("repair_history", "repair_history", []),
               ("wait_gating", "wait_gating", True)], 1360, -540)
    N.append(W.set_vars("set_cycle_result", "Record cycle result", 1660, 140))

    # ---- loop tail: green -> doc -> guard -> PR -> gate2 / escalate / red ----
    N.append(if_node("if_green", "Gates green?", 1940, 140))
    read_pin(N, E, "if_green", "condition", "all_passed", False, 1940, -180)
    # if_escalate's FALSE branch is deliberately unwired: a red iteration with
    # no escalation simply ends (an unwired branch inside an active while
    # completes the iteration cleanly — same mechanism the dangling exec-outs
    # of the set_state nodes rely on). The old identity-write set_var here
    # was a no-op node.
    N.append(W.with_expressions(
        if_node("if_escalate", "Stuck: ask human?", 1940, 420),
        {"condition": ("tail_escalate(vars.wait_gating, vars.all_passed, "
                       "vars.environment_blocked, vars.same_signature_count, "
                       "vars.fix_cycles, vars.max_fix_cycles)")}))
    dp = code_node("doc_prompt", "Compose documenter brief", DOC_PROMPT_CODE, 2080, 20,
                   [pin("plan_goal", "plan_goal", "string"),
                    pin("request", "request", "string"),
                    pin("skills_degraded", "skills_degraded", "boolean"),
                    pin("brief_text", "brief_text", "string"),
                    pin("degraded_text", "degraded_text", "string")],
                   outputs=[pin("prompt", "prompt", "string")], exec_pins=True)
    dp["data"]["pinDefaults"].update({
        "brief_text": DOC_BRIEF_TEXT,
        "degraded_text": DOC_DEGRADED_TEXT,
    })
    N.append(dp)
    read_vars(N, E, "doc_prompt",
              [("plan_goal", "plan.goal", ""), ("request", "request", ""),
               ("skills_degraded", "skills_degraded", False)], 2080, -320)
    N.append(agent_node("doc", "Documenter", 2220, 20,
                        pin_defaults={"system": DOC_SYSTEM_TEXT,
                                      "tools": ["read_file", "write_file", "edit_file",
                                                "list_files", "search_files"],
                                      "max_iterations": 15, "temperature": 0.2}))
    model_pins(N, E, "doc", ("doc",), 2220, -320)
    N.append(code_node("docguard_cmd", "Compose doc-guard command", DOC_GUARD_CMD_CODE,
                       2380, 20,
                       [pin("workspace_root", "workspace_root", "string")],
                       outputs=[pin("tool_call", "tool_call", "object")], exec_pins=True))
    read_pin(N, E, "docguard_cmd", "workspace_root", "workspace_root", "", 2380, -320,
             chip="tail_ws")
    N.append(call_tool("docguard_call", "Doc guard (hash check)", ["execute_command"], 2520, 20))
    # Doc drift check: one parse, two labeled outputs at two execution points
    # (ok -> route, state -> red write). A code node so the fan-out is VISIBLE
    # wiring, not a function re-read behind two pins.
    # EXEC LANE (docguard_call -> doc_drift -> if_docok). This is the case
    # where the exec lane is strictly BETTER: two consumers pulled the pure
    # node twice per iteration, parsing the same guard output twice. Both
    # consumers are reached strictly after it on the only path that reads it
    # (if_docok immediately, set_state_docred on if_docok's false branch).
    N.append(W.with_expressions(
        code_node("doc_drift", "Doc drift check", DOC_DRIFT_CODE, 2660, -200,
                  [pin("guard_text", "guard_text", "string")],
                  outputs=[pin("ok", "ok", "boolean"),
                           pin("updates", "updates", "object")], exec_pins=True),
        {"guard_text": "text_of(value)"}))
    N.append(if_node("if_docok", "Source untouched?", 2800, 20))
    N.append(W.set_vars("set_doc_red", "Doc broke it (red)", 2800, -400))
    prb = code_node("pr_body", "Compose PR.md", PR_BODY_CODE, 2940, 20,
                    [pin("title", "title", "string"),
                     pin("branch", "branch", "string"),
                     pin("plan_goal", "plan_goal", "string"),
                     pin("all_passed", "all_passed", "boolean"),
                     pin("warnings", "warnings", "array"),
                     pin("template_text", "template_text", "string"),
                     pin("gates_green_text", "gates_green_text", "string"),
                     pin("gates_red_text", "gates_red_text", "string"),
                     pin("advisory_text", "advisory_text", "string")],
                    outputs=[pin("content", "content", "string")], exec_pins=True)
    prb["data"]["pinDefaults"].update({
        "template_text": PR_TEMPLATE_TEXT,
        "gates_green_text": PR_GATES_GREEN_TEXT,
        "gates_red_text": PR_GATES_RED_TEXT,
        "advisory_text": PR_ADVISORY_TEXT,
    })
    N.append(prb)
    read_vars(N, E, "pr_body",
              [("title", "title", ""), ("branch", "branch", ""),
               ("plan_goal", "plan.goal", ""), ("all_passed", "all_passed", False),
               ("warnings", "warnings", [])], 2940, -320)
    pr_write = write_file_node("pr_write", "Write PR.md", 3080, 20)
    pr_write["data"].setdefault("pinDefaults", {})["file_path"] = "PR.md"
    N.append(pr_write)
    N.append(code_node("pr_push_cmd", "Compose push+PR command", PR_PUSH_CMD_CODE, 3220, 20,
                       [pin("workspace_root", "workspace_root", "string"),
                        pin("branch", "branch", "string")],
                       outputs=[pin("tool_call", "tool_call", "object")], exec_pins=True))
    E.append(edge("tail_ws", "value", "pr_push_cmd", "workspace_root"))
    read_pin(N, E, "pr_push_cmd", "branch", "branch", "work", 3220, -320, chip="tail_branch")
    N.append(call_tool("pr_call", "Push + PR (if remote)", ["execute_command"], 3360, 20))
    N.append(if_node("if_g2", "Wait mode?", 3640, 20))
    read_pin(N, E, "if_g2", "condition", "wait_gating", True, 3640, -300)
    # Gate-2's prompt is a NODE on the exec lane, funnelling BOTH exec paths
    # into gate2 (green review from if_g2.true, escalation from
    # if_escalate.true) so the composer runs once, in order, on either route.
    g2p = code_node("gate2_prompt", "Compose gate-2 prompt", GATE2_PROMPT_CODE, 3780, 100,
                    [pin("branch", "branch", "string"),
                     pin("all_passed", "all_passed", "boolean"),
                     pin("failures", "failures", "array"),
                     pin("warnings", "warnings", "array"),
                     pin("review_rounds", "review_rounds", "number"),
                     pin("max_review_rounds", "max_review_rounds", "number"),
                     pin("same_signature_count", "same_signature_count", "number"),
                     pin("fix_cycles", "fix_cycles", "number"),
                     pin("max_fix_cycles", "max_fix_cycles", "number"),
                     pin("green_text", "green_text", "string"),
                     pin("green_footer_text", "green_footer_text", "string"),
                     pin("stalled_text", "stalled_text", "string"),
                     pin("budget_text", "budget_text", "string"),
                     pin("red_footer_text", "red_footer_text", "string"),
                     pin("final_round_text", "final_round_text", "string"),
                     pin("green_choices", "green_choices", "array"),
                     pin("escalation_choices", "escalation_choices", "array")],
                    outputs=[pin("prompt", "prompt", "string"),
                             pin("choices", "choices", "array")], exec_pins=True)
    g2p["data"]["pinDefaults"].update({
        "green_text": GATE2_GREEN_TEXT,
        "green_footer_text": GATE2_GREEN_FOOTER_TEXT,
        "stalled_text": GATE2_STALLED_TEXT,
        "budget_text": GATE2_BUDGET_TEXT,
        "red_footer_text": GATE2_RED_FOOTER_TEXT,
        "final_round_text": GATE2_FINAL_ROUND_TEXT,
        # The two answer vocabularies, editable like every other gate word.
        # gate1's choices are a plain list default because gate1 offers ONE
        # list; gate2 offers one of two, so the pick moves into the node that
        # already branches on `all_passed` to word the prompt (0.0.15).
        "green_choices": ["approve", "request changes"],
        "escalation_choices": ["stop", "guide repairs"],
    })
    N.append(g2p)
    # NINE chips: this gate genuinely weighs nine run vars, and the canvas now
    # says so. `failures` is a DOTTED read of the last verdict's failure list —
    # `get_var` walks the path and defaults to [] when there is no verdict yet.
    read_vars(N, E, "gate2_prompt",
              [("branch", "branch", "work"), ("all_passed", "all_passed", False),
               ("failures", "last_verdict.failures", []), ("warnings", "warnings", []),
               ("review_rounds", "review_rounds", 0),
               ("max_review_rounds", "max_review_rounds", 2),
               ("same_signature_count", "same_signature_count", 0),
               ("fix_cycles", "fix_cycles", 0),
               ("max_fix_cycles", "max_fix_cycles", 6)], 3780, -240)
    gate2 = ask_user("gate2", "GATE 2: approve merge?", 3920, 100)
    gate2["data"]["pinDefaults"].pop("prompt", None)  # always composed (see gate1)
    # `choices` arrives on a WIRE from gate2_prompt (0.0.15) — it used to be a
    # conditional-literal expression on this pin. Two wins beyond the words
    # becoming editable: the branch now lives ONCE, in the composer that
    # already tests `all_passed` for the wording, and the pin works on
    # PRE-EXPRESSION runtimes (a wire is read by every compiler; the
    # expression was not, and this pin had no default to fall back to).
    gate2["data"]["pinDefaults"].pop("choices", None)
    N.append(gate2)
    # if_g2's FALSE branch (auto mode) is deliberately unwired: green in auto
    # mode was already auto-approved by the verdict fold, so the iteration
    # just ends and the loop condition exits. The old identity-write set_var
    # here was a no-op node.
    g2f = code_node("gate2_fold", "Fold gate-2 answer", GATE2_FOLD_CODE, 4060, 100,
                    [pin("response", "response", "string"),
                     pin("all_passed", "all_passed", "boolean"),
                     pin("review_rounds", "review_rounds", "number"),
                     pin("change_request_text", "change_request_text", "string"),
                     pin("no_comment_text", "no_comment_text", "string")],
                    outputs=[pin("updates", "updates", "object")], exec_pins=True)
    g2f["data"]["pinDefaults"].update({
        "change_request_text": GATE2_CHANGE_REQUEST_TEXT,
        "no_comment_text": GATE2_NO_COMMENT_TEXT,
    })
    N.append(g2f)
    read_vars(N, E, "gate2_fold",
              [("all_passed", "all_passed", False), ("review_rounds", "review_rounds", 0)],
              4060, -240)
    N.append(W.set_vars("set_review", "Record review", 4200, 100))

    # ---- post-loop: merge + report ----
    N.append(W.with_expressions(
        if_node("if_approved", "Merge?", -40, 640),
        {"condition": "bool(vars.approved) and bool(vars.all_passed)"}))
    # The merge composer sits AFTER the build loop, columns away from the
    # tail cluster, so it reads its own two chips (the neighbourhood rule cuts
    # both ways: a distant consumer gets a local getter, not a long wire).
    N.append(code_node("merge_cmd", "Compose merge command", MERGE_CMD_CODE, 100, 640,
                       [pin("workspace_root", "workspace_root", "string"),
                        pin("branch", "branch", "string")],
                       outputs=[pin("tool_call", "tool_call", "object")], exec_pins=True))
    read_vars(N, E, "merge_cmd",
              [("workspace_root", "workspace_root", ""), ("branch", "branch", "work")],
              100, 340)
    N.append(call_tool("merge_call", "Merge --no-ff to main", ["execute_command"], 240, 640))
    mf = code_node("merge_fold", "Fold merge result", MERGE_FOLD_CODE, 380, 640,
                   [pin("merge_text", "merge_text", "string"),
                    pin("approved", "approved", "boolean"),
                    pin("warnings", "warnings", "array"),
                    pin("conflict_text", "conflict_text", "string"),
                    pin("no_mainline_text", "no_mainline_text", "string"),
                    pin("no_confirm_text", "no_confirm_text", "string")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    mf["data"]["pinDefaults"].update({
        "conflict_text": MERGE_CONFLICT_TEXT,
        "no_mainline_text": MERGE_NO_MAINLINE_TEXT,
        "no_confirm_text": MERGE_NO_CONFIRM_TEXT,
    })
    W.with_expressions(mf, {"merge_text": "text_of(value)"})
    N.append(mf)
    read_vars(N, E, "merge_fold",
              [("approved", "approved", False), ("warnings", "warnings", [])], 380, 380)
    N.append(W.set_vars("set_merge_result", "Record merge result", 520, 640))
    # Final report: ONE fold, FOUR labeled outputs wired to the end node —
    # the fan-out is visible graph structure (multi-output helpers are nodes).
    # EXEC LANE, as the single funnel in front of `end`: all three exec paths
    # that reach `end` (plan refused, merged, merge declined) now pass through
    # it, so the fold runs exactly ONCE instead of four times (once per pulled
    # output pin).
    # The `success` output pin is deliberately named `merged_ok`: on the exec
    # lane the executor OVERWRITES `success` on a code node's output record
    # with its own handler flag (True unless the body raised), so a pin called
    # `success` would have reported every refused run as successful. Proven by
    # execution, both lanes, before this change was made. `code_node` now
    # refuses the collision at BUILD time so it cannot come back.
    # NINETEEN chips, and that is the honest number: the terminal report is the
    # one node that genuinely reads most of the run's state. Under the blob it
    # looked like it read ONE thing (`loop_state`) — which is exactly the lie
    # the operator objected to. `failures` / `env_failures` are dotted reads of
    # the last verdict's two lists.
    N.append(
        code_node("final_report", "Final report", FINAL_REPORT_CODE, 520, 860,
                  [pin("accepted", "accepted", "boolean"),
                   pin("approved", "approved", "boolean"),
                   pin("merged", "merged", "boolean"),
                   pin("all_passed", "all_passed", "boolean"),
                   pin("user_stopped", "user_stopped", "boolean"),
                   pin("environment_blocked", "environment_blocked", "boolean"),
                   pin("last_gate2", "last_gate2", "string"),
                   pin("branch", "branch", "string"),
                   pin("title", "title", "string"),
                   pin("plan_feedback", "plan_feedback", "string"),
                   pin("build_feedback", "build_feedback", "string"),
                   pin("warnings", "warnings", "array"),
                   pin("failures", "failures", "array"),
                   pin("env_failures", "env_failures", "array"),
                   pin("plan_revisions", "plan_revisions", "number"),
                   pin("fix_cycles", "fix_cycles", "number"),
                   pin("review_rounds", "review_rounds", "number"),
                   pin("max_review_rounds", "max_review_rounds", "number"),
                   pin("same_signature_count", "same_signature_count", "number"),
                   pin("greenfield", "greenfield", "boolean")],
                  outputs=[pin("report", "report", "string"),
                           pin("merged_ok", "merged_ok", "boolean"),
                           pin("stopped_reason", "stopped_reason", "string"),
                           pin("branch", "branch", "string")], exec_pins=True))
    read_vars(N, E, "final_report",
              [("accepted", "accepted", False), ("approved", "approved", False),
               ("merged", "merged", False), ("all_passed", "all_passed", False),
               ("user_stopped", "user_stopped", False),
               ("environment_blocked", "environment_blocked", False),
               ("last_gate2", "last_gate2", ""), ("branch", "branch", ""),
               ("title", "title", ""), ("plan_feedback", "plan_feedback", ""),
               ("build_feedback", "build_feedback", ""), ("warnings", "warnings", []),
               ("failures", "last_verdict.failures", []),
               ("env_failures", "last_verdict.environment_failures", []),
               ("plan_revisions", "plan_revisions", 0), ("fix_cycles", "fix_cycles", 0),
               ("review_rounds", "review_rounds", 0),
               ("max_review_rounds", "max_review_rounds", 2),
               ("same_signature_count", "same_signature_count", 0),
               ("greenfield", "greenfield", False)], 520, 520)
    N.append(node("end", "on_flow_end", "Result", 800, 640,
                  inputs=[EXEC_IN, pin("report", "report", "string"),
                          pin("success", "success", "boolean"),
                          pin("branch", "branch", "string"),
                          pin("stopped_reason", "stopped_reason", "string"),
                          CODING_V1_PASSED_PIN]))

    # ---------------- edges ----------------
    def ex(a, b, *, src="exec-out", dst="exec-in"):
        E.append(edge(a, src, b, dst))

    def data(a, ah, b, bh):
        E.append(edge(a, ah, b, bh))

    # start -> preflight -> seed vars -> preflight door. Only the FIVE inputs
    # the door inspects cross here; the other seven start pins are already run
    # vars and are read where they are used (0.0.15 — the blob's config copies
    # are gone).
    ex("start", "preflight")
    for run_input in ("request", "workspace_root", "gating_mode",
                      "max_plan_revisions", "max_fix_cycles", "max_review_rounds",
                      "skills", "browser_probe_available"):
        data("start", run_input, "preflight", run_input)
    ex("preflight", "seed_vars")
    data("preflight", "updates", "seed_vars", "updates")
    ex("seed_vars", "if_preflight")
    ex("if_preflight", "end_pre", src="false")
    data("preflight", "report", "end_pre", "report")

    # L1 plan loop (through the run-start gating line)
    ex("if_preflight", "gating_line", src="true")
    ex("gating_line", "gating_status")
    data("gating_line", "message", "gating_status", "message")
    # greenfield probe (0.0.18): deterministic ls -A between the gating line
    # and the plan loop; on an empty workspace the fold pre-accepts the
    # request-as-plan so plan_while's law skips scouts+planner+gate1 entirely.
    ex("gating_status", "green_cmd")
    ex("green_cmd", "green_call")
    data("green_cmd", "tool_call", "green_call", "tool_call")
    ex("green_call", "green_fold")
    data("green_call", "raw", "green_fold", "probe_text")
    ex("green_fold", "set_green")
    data("green_fold", "updates", "set_green", "updates")
    ex("set_green", "green_status")
    data("green_fold", "message", "green_status", "message")
    ex("green_status", "plan_while")
    ex("plan_while", "if_scout", src="loop")
    ex("if_scout", "scout_prompts", src="true")
    ex("if_scout", "planner_prompt", src="false")
    ex("scout_prompts", "scout_code")
    data("scout_prompts", "code_prompt", "scout_code", "prompt")
    data("scout_prompts", "web_prompt", "scout_web", "prompt")
    ex("scout_code", "scout_web")
    ex("scout_web", "scout_merge")
    ex("scout_merge", "set_scout_context")
    data("scout_code", "response", "scout_merge", "code_findings")
    data("scout_web", "response", "scout_merge", "web_findings")
    data("scout_merge", "updates", "set_scout_context", "updates")
    ex("set_scout_context", "planner_prompt")
    ex("planner_prompt", "planner")
    data("planner_prompt", "prompt", "planner", "prompt")
    ex("planner", "if_g1")
    # wait mode: human gate, prompt composed by gate1_prompt from planner.data
    ex("if_g1", "gate1_prompt", src="true")
    data("planner", "data", "gate1_prompt", "planner_data")
    ex("gate1_prompt", "gate1")
    data("gate1_prompt", "prompt", "gate1", "prompt")
    ex("gate1", "gate1_parse")
    ex("gate1_parse", "set_plan_decision")
    data("gate1", "response", "gate1_parse", "response")
    data("planner", "data", "gate1_parse", "planner_data")
    data("gate1_parse", "updates", "set_plan_decision", "updates")
    # auto mode: deterministic accept
    ex("if_g1", "plan_auto", src="false")
    data("planner", "data", "plan_auto", "planner_data")
    ex("plan_auto", "set_plan_auto")
    data("plan_auto", "updates", "set_plan_auto", "updates")

    # plan done -> accepted?
    ex("plan_while", "if_accepted", src="done")
    # plan refused -> straight to the terminal fold (see the funnel below)
    # backlog + git
    ex("if_accepted", "backlog_body", src="true")
    ex("backlog_body", "backlog_write")
    data("backlog_body", "content", "backlog_write", "content")
    ex("backlog_write", "git_branch_cmd")
    ex("git_branch_cmd", "git_call")
    data("git_branch_cmd", "tool_call", "git_call", "tool_call")
    ex("git_call", "branch_fold")
    data("git_call", "raw", "branch_fold", "git_text")
    ex("branch_fold", "set_branch")
    data("branch_fold", "updates", "set_branch", "updates")

    # L2 build loop
    ex("set_branch", "build_while")
    ex("build_while", "cycle_line", src="loop")
    ex("cycle_line", "cycle_status")
    data("cycle_line", "message", "cycle_status", "message")
    ex("cycle_status", "builder_prompt")
    ex("builder_prompt", "builder")
    data("builder_prompt", "prompt", "builder", "prompt")
    ex("builder", "lint_cmd")
    ex("lint_cmd", "lint_call")
    data("lint_cmd", "tool_call", "lint_call", "tool_call")
    ex("lint_call", "lint_parse")
    data("lint_call", "raw", "lint_parse", "lint_text")
    ex("lint_parse", "selfcheck_cmd")
    ex("selfcheck_cmd", "selfcheck_call")
    data("selfcheck_cmd", "tool_call", "selfcheck_call", "tool_call")
    ex("selfcheck_call", "commit_cmd")
    ex("commit_cmd", "commit_call")
    data("commit_cmd", "tool_call", "commit_call", "tool_call")
    ex("commit_call", "verify")
    ex("verify", "next_state")
    ex("next_state", "set_cycle_result")
    # `verdict` is a DECLARED output pin on the subflow node (the child's
    # on_flow_end field), so the fold takes it on a wire. It used to arrive as
    # the whole child blob plus a `(value or {}).get("verdict", {})` expression.
    data("verify", "verdict", "next_state", "verify_verdict")
    # The verifier-death REASON rides `output`, not `child_output`. The fold
    # reads `verify_meta.error` only when the verdict is missing (a dead child),
    # and on that exact run `output` holds `{success:false, error}` while
    # `child_output` has been nulled by the runtime's own output_pins spread
    # (`_sync_effect_results_to_node_outputs` overwrites every declared
    # non-`output` pin from the child's result dict, and `child_output` is a
    # declared pin). So the wire that was supposed to carry the cause could
    # never carry it; this one can. On a healthy child `output` is the child's
    # result dict and this pin is not read at all.
    data("verify", "output", "next_state", "verify_meta")
    data("builder", "response", "next_state", "builder_response")
    data("lint_parse", "residuals", "next_state", "lint_out")
    data("next_state", "updates", "set_cycle_result", "updates")

    # tail-in-loop
    ex("set_cycle_result", "if_green")
    ex("if_green", "if_escalate", src="false")
    ex("if_escalate", "gate2_prompt", src="true")
    # if_escalate false: unwired — red iteration ends, loop re-evaluates
    ex("if_green", "doc_prompt", src="true")
    ex("doc_prompt", "doc")
    data("doc_prompt", "prompt", "doc", "prompt")
    ex("doc", "docguard_cmd")
    ex("docguard_cmd", "docguard_call")
    data("docguard_cmd", "tool_call", "docguard_call", "tool_call")
    ex("docguard_call", "doc_drift")
    ex("doc_drift", "if_docok")
    # one parse, two labeled consequences: ok routes, updates carries the red write
    data("docguard_call", "raw", "doc_drift", "guard_text")
    data("doc_drift", "ok", "if_docok", "condition")
    ex("if_docok", "set_doc_red", src="false")
    data("doc_drift", "updates", "set_doc_red", "updates")
    ex("if_docok", "pr_body", src="true")
    ex("pr_body", "pr_write")
    data("pr_body", "content", "pr_write", "content")
    ex("pr_write", "pr_push_cmd")
    ex("pr_push_cmd", "pr_call")
    data("pr_push_cmd", "tool_call", "pr_call", "tool_call")
    ex("pr_call", "if_g2")
    ex("if_g2", "gate2_prompt", src="true")
    ex("gate2_prompt", "gate2")
    data("gate2_prompt", "prompt", "gate2", "prompt")
    data("gate2_prompt", "choices", "gate2", "choices")
    ex("gate2", "gate2_fold")
    data("gate2", "response", "gate2_fold", "response")
    ex("gate2_fold", "set_review")
    data("gate2_fold", "updates", "set_review", "updates")
    # if_g2 false (auto mode): unwired — iteration ends, loop exits on approval

    # post-loop: merge decision
    ex("build_while", "if_approved", src="done")
    ex("if_approved", "merge_cmd", src="true")
    ex("merge_cmd", "merge_call")
    data("merge_cmd", "tool_call", "merge_call", "tool_call")
    ex("merge_call", "merge_fold")
    data("merge_call", "raw", "merge_fold", "merge_text")
    ex("merge_fold", "set_merge_result")
    data("merge_fold", "updates", "set_merge_result", "updates")
    # final_report is the SINGLE FUNNEL in front of `end`: every exec path that
    # used to reach `end` directly now reaches it through the fold, so the fold
    # runs exactly once per run. `end` accepting several exec predecessors is
    # unchanged (it already had three) — only data pins are one-wire-only.
    ex("set_merge_result", "final_report")
    ex("if_approved", "final_report", src="false")
    ex("if_accepted", "final_report", src="false")
    ex("final_report", "end")
    # terminal fold: four labeled results, four visible wires
    data("final_report", "report", "end", "report")
    data("final_report", "merged_ok", "end", "success")
    data("final_report", "branch", "end", "branch")
    data("final_report", "stopped_reason", "end", "stopped_reason")
    # coding.v1 `passed`: the same all_passed chip the final report reads.
    data("final_report_all_passed", "value", "end", "passed")

    W.apply_flow_layout(f)
    write_json(FLOWS_DIR / f"{ROOT_FLOW_ID}.json", f)
    return f


def _assert_verdict_getter_intact(flow: dict) -> None:
    """The verdict read must stay a GET VARIABLE NODE in the pinned copy.

    History (0.0.14 reversal): a tier-1 wave DELETED this node from the copy and
    replaced it with the pin expression `(vars.get("vg") or {}).get("verdict",
    {})` on its sole consumer, end.verdict. That is precisely the move the
    operator ruled out — "why can't we use a simple get variable node for this?
    ... I am ok for pure functions as HELPER functions, but not for ACCESS,
    since we already have the get variable" — and it survived the P1 audit only
    because the auditor's trivial-read pattern matches `vars.x.get(...)`, not
    the `vars.get("x")` method form. The collapse is undone; the copy is now a
    pure rename of the source, and this function is the drift pin.

    Every expectation is HARD-asserted: if the source drifts (node renamed, var
    renamed, a second consumer added, or the getter collapsed on the
    coding-agent side), the build fails LOUDLY instead of emitting a silently
    wrong copy — the copy is drift-pinned, never drift-tolerant."""
    by_id = {n["id"]: n for n in flow["nodes"]}
    rv = by_id.get("read_verdict")
    if rv is None or rv["data"].get("nodeType") != "get_var":
        raise AssertionError("verify copy drifted: get_var node 'read_verdict' not found")
    pd = rv["data"].get("pinDefaults") or {}
    if pd.get("name") != "vg.verdict" or pd.get("default") != {}:
        raise AssertionError(f"verify copy drifted: read_verdict pinDefaults changed: {pd}")
    outs = [e for e in flow["edges"] if e["source"] == "read_verdict"]
    ins = [e for e in flow["edges"] if e["target"] == "read_verdict"]
    if ins or len(outs) != 1:
        raise AssertionError(
            f"verify copy drifted: read_verdict edges changed (in={len(ins)}, out={len(outs)})")
    only = outs[0]
    if (only["sourceHandle"], only["target"], only["targetHandle"]) != ("value", "end", "verdict"):
        raise AssertionError(f"verify copy drifted: read_verdict consumer changed: {only}")
    end = by_id.get("end") or {}
    if "verdict" not in {p.get("id") for p in (end.get("data", {}).get("inputs") or [])}:
        raise AssertionError("verify copy drifted: end node has no 'verdict' input pin")
    if "verdict" in (end["data"].get("pinExpressions") or {}):
        raise AssertionError(
            "verify copy drifted: end.verdict carries an expression — the verdict read is a "
            "Get Variable NODE (operator ruling 2026-07-30), not invisible text on a pin")
    exprs = [f"{n['id']}.{p}" for n in flow["nodes"]
             for p in ((n["data"].get("pinExpressions") or {}))]
    if exprs:
        raise AssertionError(f"verify copy drifted: unexpected pin expressions {exprs}")


def build_verify_copy() -> dict:
    """Drift-pinned copy of coding-verify-gates as multiagent-verify-gates.

    A PURE rename now: id + name only. Nothing in the graph is transformed, so
    the copy cannot diverge in behaviour from the flow the coding-agent bundle
    ships."""
    src = json.loads((FLOWS_DIR / "coding-verify-gates.json").read_text())
    src["id"] = VERIFY_FLOW_ID
    src["name"] = "Multi-agent verify gates — embedded subflow (auto-managed)"
    _assert_verdict_getter_intact(src)
    write_json(FLOWS_DIR / f"{VERIFY_FLOW_ID}.json", src)
    return src


# 0.0.16 DELETED `map_input` ("Map prompt -> request"), the code node that used
# to build the child's whole input as ONE object. Operator ruling 2026-07-30:
#
#   "I do not understand how you can call a subflow without setting the input.
#    The whole point of VISUAL authoring is to have no code, except for experts.
#    Whenever you are NOT using the pins, it means you are HIDING something and
#    that's very bad."
#   "Code and pure functions are here to couple/harness DETERMINISTIC or tedious
#    processes ... It is absolutely not meant as a replacement for the existing
#    nodes and abstractions that MUST always be favored."
#
# The node's six start pins now land on SIX DECLARED INPUT PINS of the `build`
# subflow node, each on its own wire, and every coercion it performed was
# checked line-by-line against the child's REAL door body (PREFLIGHT_CODE, this
# file) — not assumed:
#
#   map_input                                     multiagent-coding preflight
#   -------------------------------------------   ----------------------------------
#   p  = str(prompt or "").strip()                req = str(request or "").strip()
#   ws = str(workspace_root or "").strip()        ws  = str(workspace_root or "").strip()
#   g  = str(gating_mode or "wait").strip()       gating = str(gating_mode or "wait")
#        .lower(); allowlist -> "wait"                 .strip().lower(); same allowlist
#   provider / model: passed through verbatim     start pins, read by name
#   probe = True if ... is None else bool(...)    probe_ok = bool(browser_probe_available)
#
# Five of six coercions are the child door's own job and are done there
# already; passing them through a caller-side copy could only ever produce a
# DIFFERENT normalization from the one the run actually uses. The sixth (the
# None -> True probe reading) is now the child's `bool()` reading, reachable
# only when a caller sends an EXPLICIT null (the wrapper start pin defaults
# TRUE, and an omitted pin resolves to that default). That is the fail-safe
# direction and it matches the child's own pin default: an unknown probe
# posture certifies STATIC gates only rather than teaching the builder to call
# a tool that may not be mounted. Nothing else moves.
#
# What is NOT lost: `prompt` -> `request` is a RENAME across a run boundary,
# and the wire from `start.prompt` into `build.request` states it on the canvas
# far more plainly than a dict literal buried in a code body ever did.

# The wrapper's answer floor. See the `answer` node comment in build_wrapper()
# for why this is a node and not a pin default.
WRAPPER_DIED_TEXT = (
    "The multi-agent coding run did not finish: {{error}}\n\n"
    "Nothing was merged. The run's own trace holds the failing step; re-run once the cause "
    "is addressed."
)
WRAPPER_UNKNOWN_ERROR_TEXT = "the child run ended without producing a report"

WRAPPER_ANSWER_CODE = r"""
# A declared subflow pin only carries a field the child RETURNED. A child that
# dies never reaches an on_flow_end, so report/branch/stopped_reason arrive as
# None. Floor them here, and say what happened instead of answering "".
rep = report if isinstance(report, str) else ""
ok = bool(child_success)
died = child_result if isinstance(child_result, dict) else {}
if not rep.strip():
    err = str(died.get("error") or "").strip()
    rep = str(died_text or "").replace(
        "{{error}}", err if err else str(unknown_error_text or ""))
    ok = False
return {
    "response": rep,
    "ok": ok,
    "meta": {"branch": branch if isinstance(branch, str) else "",
             "stopped_reason": stopped_reason if isinstance(stopped_reason, str) else ""},
}
""".strip()


def build_wrapper() -> dict:
    """agent.v1 wrapper (mirrors `coder`): {prompt} -> multiagent-coding root
    -> {response, success, meta}. This is the entrypoint that appears in the
    app agent-workflow picker; the strict coding.v1 root does not (by design)."""
    f = base_flow(WRAPPER_FLOW_ID, "Multi-agent coder — chat entry (runs pipeline)",
                  "Chat-agent entrypoint for the multi-agent coding pipeline (scouts -> "
                  "plan -> gates -> build/verify loop -> docs -> PR -> merge). Defaults "
                  "to gating_mode=wait: interactive clients answer TWO ask_user gates "
                  "(plan approval, merge approval). Unattended clients must send "
                  "gating_mode=auto and input_data._runtime.tool_policy = "
                  "{\"auto_approve_max_risk_rank\": 2, \"auto_approve_tools\": "
                  "[\"execute_command\", \"list_files\", \"read_file\", "
                  "\"browser_probe\"]} (or drive approvals externally): the rank "
                  "ceiling auto-approves the agents' read/skim tools, the names cover "
                  "the pipeline's call_tool steps. workspace_root resolves from the session workspace var "
                  "or input_data; an empty workspace is refused at preflight (this "
                  "workflow writes files and runs git).",
                  interfaces=[AGENT_INTERFACE])
    N, E = f["nodes"], f["edges"]
    N.append(node("start", "on_flow_start", "Prompt", -900, 0,
                  outputs=[EXEC_OUT, pin("prompt", "prompt", "string"),
                           pin("provider", "provider", "provider_text"),
                           pin("model", "model", "model"),
                           pin("tools", "tools", "array"),
                           # extra pins (legal: agent.v1 validates a SUBSET) -
                           # input-first resolution picks these up from run
                           # vars/input_data; defaults keep the contract honest
                           pin("workspace_root", "workspace_root", "string"),
                           pin("gating_mode", "gating_mode", "string"),
                           pin("browser_probe_available", "browser_probe_available", "boolean")],
                  pin_defaults={"prompt": "", "workspace_root": "",
                                "gating_mode": WRAPPER_GATING,
                                "browser_probe_available": True}))
    # THE SUBFLOW CALL, WITH ITS CONTRACT ON THE CANVAS IN BOTH DIRECTIONS.
    #
    # IN (0.0.16): six of the child's twelve on_flow_start fields are DECLARED
    # input pins here, each fed by its own wire from `start`. The
    # `input:object` blob and the `map_input` code node that built it are gone
    # (see the block above for the coercion-by-coercion audit against the
    # child's door). A reader now sees, without opening anything, exactly which
    # six values this call sets and where each comes from — including that
    # `prompt` becomes the child's `request`.
    #
    # The OTHER SIX child pins (max_plan_revisions, max_fix_cycles,
    # max_review_rounds, skills, build_command, run_command) are deliberately
    # NOT declared here: the wrapper has no opinion on them, and an UNWIRED,
    # UNDEFAULTED declared pin is not written into the child vars at all
    # (measured — see wf_common.subflow_node), so the child's own start-pin
    # defaults apply. Declaring them just to leave them empty would push None
    # across the boundary, and None DOES shadow a child default. Absent means
    # absent; that is the whole reason this shape is safe.
    #
    # OUT: the child's four on_flow_end fields are DECLARED output pins, so
    # each leaves on its own wire. This replaced the four
    # `(value or {}).get("<field>", <default>)` pin expressions the tier-1
    # migration had put on the consumers.
    N.append(subflow_node("build", "Run multi-agent coding", ROOT_FLOW_ID, -220, 0,
                          child_inputs=[("request", "string"),
                                        ("workspace_root", "string"),
                                        ("gating_mode", "string"),
                                        ("provider", "provider_text"),
                                        ("model", "model"),
                                        ("browser_probe_available", "boolean")],
                          child_outputs=[("report", "string"),
                                         ("success", "boolean"),
                                         ("branch", "string"),
                                         ("stopped_reason", "string")]))
    # THE DEAD-CHILD FLOOR, and why this node exists.
    #
    # A declared pin can only carry a field the child actually returned. When
    # the child run DIES it never reaches an on_flow_end, so report/branch/
    # stopped_reason arrive as None where the old `(value or {}).get(k, "")`
    # expressions returned "". Proven live on the gateway: a provider failure
    # inside the child left this wrapper answering `{"response": null,
    # "success": null, "meta": {}}` — a null where an agent.v1 client expects a
    # string, and no word about what happened.
    #
    # So the floor is a NODE, not a hidden default: it types the answer, and it
    # SAYS the run died instead of handing back an empty string (which is what
    # BOTH the old expressions and the bare wires did). This also absorbs the
    # old `make_object` meta node, so the wrapper keeps five nodes.
    #
    # The death REASON rides `output`, not `child_output`. `child_output` is the
    # documented death channel, but the runtime destroys it on exactly the run
    # it describes: every declared non-`output` pin is overwritten from the
    # child's result dict (compiler `_sync_effect_results_to_node_outputs`,
    # `start_subworkflow`), and `child_output` is a declared pin, so it becomes
    # `result.get("child_output")` -> None. `output` is the one pin the spread
    # SKIPS by name, and on a dead child it holds the `{success:false, error}`
    # blob verbatim. Verified both ways in the smoke's layer-9 wrapper runs.
    ans = code_node("answer", "Compose answer", WRAPPER_ANSWER_CODE, 500, 0,
                    [pin("report", "report", "string"),
                     pin("child_success", "child_success", "boolean"),
                     pin("branch", "branch", "string"),
                     pin("stopped_reason", "stopped_reason", "string"),
                     pin("child_result", "child_result", "object"),
                     pin("died_text", "died_text", "string"),
                     pin("unknown_error_text", "unknown_error_text", "string")],
                    outputs=[pin("response", "response", "string"),
                             pin("ok", "ok", "boolean"),
                             pin("meta", "meta", "object")], exec_pins=True)
    ans["data"]["pinDefaults"].update({
        "died_text": WRAPPER_DIED_TEXT,
        "unknown_error_text": WRAPPER_UNKNOWN_ERROR_TEXT,
    })
    N.append(ans)
    N.append(node("end", "on_flow_end", "Answer", 860, 0,
                  inputs=[EXEC_IN, pin("response", "response", "string"),
                          pin("success", "success", "boolean"),
                          pin("meta", "meta", "object")],
                  pin_defaults={"response": "", "success": False, "meta": {}}))

    E.append(edge("start", "exec-out", "build", "exec-in"))
    E.append(edge("build", "exec-out", "answer", "exec-in"))
    E.append(edge("answer", "exec-out", "end", "exec-in"))
    # SIX declared child input pins, six wires, zero code: the whole call
    # contract, drawn. `prompt -> request` is the one rename, and it is visible.
    E.append(edge("start", "prompt", "build", "request"))
    E.append(edge("start", "workspace_root", "build", "workspace_root"))
    E.append(edge("start", "gating_mode", "build", "gating_mode"))
    E.append(edge("start", "provider", "build", "provider"))
    E.append(edge("start", "model", "build", "model"))
    E.append(edge("start", "browser_probe_available", "build", "browser_probe_available"))
    # four declared child fields + the runtime death channel: five short wires,
    # zero expressions
    E.append(edge("build", "report", "answer", "report"))
    E.append(edge("build", "success", "answer", "child_success"))
    E.append(edge("build", "branch", "answer", "branch"))
    E.append(edge("build", "stopped_reason", "answer", "stopped_reason"))
    E.append(edge("build", "output", "answer", "child_result"))
    E.append(edge("answer", "response", "end", "response"))
    E.append(edge("answer", "ok", "end", "success"))
    E.append(edge("answer", "meta", "end", "meta"))

    W.apply_flow_layout(f)
    write_json(FLOWS_DIR / f"{WRAPPER_FLOW_ID}.json", f)
    return f


def _assert_seed_precedes_var_reads(flow: dict) -> None:
    """Structural pin: every SEEDED run var is read strictly AFTER the seed.

    Attribute access in an expression (`vars.accepted`) fails LOUDLY on a
    missing var — deliberately — so a read that resolves before `seed_vars`
    ran would be a hard runtime error. Enforced by shape: the exec spine into
    the seed is the fixed chain start -> preflight -> seed_vars, so every
    downstream node passes through it. A future exec-reorder fails the BUILD,
    not a live run.

    Generalized from the blob-era version, which only had to watch ONE name
    (`state`): with flat vars it checks all 28 SEED_VARS names, on both lanes
    (expressions and Get Variable chips)."""
    spine = [("start", "preflight"), ("preflight", "seed_vars")]
    for source, expected in spine:
        outs = [e for e in flow["edges"]
                if e["source"] == source and e.get("sourceHandle") == "exec-out"]
        if len(outs) != 1 or outs[0]["target"] != expected:
            raise AssertionError(
                f"seed-before-reads broken: {source} exec edges "
                f"{[e['target'] for e in outs]} (must be exactly [{expected}] — every "
                "run-var read assumes the seed ran)")
    pre_seed = {"start", "preflight", "seed_vars"}
    seeded = set(SEED_VARS)
    for n in flow["nodes"]:
        if n["id"] not in pre_seed:
            continue
        for pin_id, expr in (n["data"].get("pinExpressions") or {}).items():
            hit = sorted(v for v in seeded if f"vars.{v}" in str(expr))
            if hit:
                raise AssertionError(
                    f"seed-before-reads broken: {n['id']}.{pin_id} reads {hit} "
                    "before/at the seed node")
    # A Get Variable chip feeding a pre-seed node would read a seeded var just
    # as early as an expression would; the chip lane obeys the same law.
    chips = {n["id"]: (n["data"].get("pinDefaults") or {}).get("name")
             for n in flow["nodes"] if n["data"].get("nodeType") == "get_var"}
    for e in flow["edges"]:
        if e["target"] in pre_seed and e["source"] in chips:
            name = str(chips[e["source"]] or "")
            if name.split(".", 1)[0] in seeded:
                raise AssertionError(
                    f"seed-before-reads broken: chip {e['source']} reads '{name}' into "
                    f"{e['target']}, at or before the seed node")


def _assert_no_state_blob(flow: dict, *, ban_set_var: bool = False) -> None:
    """THE ANTI-BLOB GATE (operator ruling). Fails the BUILD if a `state`
    container comes back in any shape:
      - a `set_var`/`get_var` chip named `state` (or `state.<field>`),
      - any pin expression mentioning `vars.state` / `vars["state"]`,
      - any function body reading `vars.state`,
      - (root only, `ban_set_var`) ANY `set_var`: on the coding root every
        write is a multi-variable fold, so `set_vars` is the only legal writer
        and a lone `set_var` is a container waiting to happen. The mounted
        verify copy is exempt — it is a drift-pinned copy of the coding-agent
        bundle's `coding-verify-gates` and its `set_var`s write ONE named
        value (`vg.verdict`) that its consumer reads through a Get Variable
        chip, so the canvas already names it."""
    findings: list[str] = []
    for n in flow["nodes"]:
        nid, d = n["id"], n["data"]
        kind = d.get("nodeType")
        if kind in ("set_var", "get_var"):
            name = str((d.get("pinDefaults") or {}).get("name") or "")
            if name == "state" or name.startswith("state."):
                findings.append(f"{kind} node '{nid}' names the blob: {name!r}")
        if kind == "set_var" and ban_set_var:
            findings.append(
                f"set_var node '{nid}' — flat run vars are written with set_vars "
                "(one node, N named variables); a set_var is a container waiting to happen")
        for pin_id, expr in (d.get("pinExpressions") or {}).items():
            text = str(expr)
            if "vars.state" in text or 'vars["state"]' in text or "vars['state']" in text:
                findings.append(f"expression {nid}.{pin_id} reads the blob: {text[:80]}")
    for entry in flow.get("functions") or []:
        code = str(entry.get("code") or "")
        if "vars.state" in code:
            findings.append(f"function '{entry.get('name')}' reads the blob")
    if findings:
        raise AssertionError("STATE BLOB DETECTED:\n  " + "\n  ".join(findings))


def main() -> int:
    verify = build_verify_copy()
    root = build_root()
    wrapper = build_wrapper()
    _assert_seed_precedes_var_reads(root)
    _assert_no_state_blob(root, ban_set_var=True)
    for flow in (verify, wrapper):
        _assert_no_state_blob(flow)
    ok = True
    for fid, flow in ((ROOT_FLOW_ID, root), (VERIFY_FLOW_ID, verify), (WRAPPER_FLOW_ID, wrapper)):
        problems = validate_edges(flow)
        if problems:
            ok = False
            print(f"EDGE PROBLEMS ({fid}):")
            for p in problems:
                print("  " + p)
    if not ok:
        return 1
    for fid, flow in ((ROOT_FLOW_ID, root), (VERIFY_FLOW_ID, verify), (WRAPPER_FLOW_ID, wrapper)):
        overlaps = W.layout_overlap_findings(flow)
        if overlaps:
            ok = False
            print(f"LAYOUT OVERLAPS ({fid}): {len(overlaps)}")
            for finding in overlaps[:10]:
                print("  " + finding)
            if len(overlaps) > 10:
                print(f"  ... and {len(overlaps) - 10} more")
    if not ok:
        return 1
    pure = [n for n in root["nodes"]
            if n["data"].get("nodeType") == "code"
            and "exec-in" not in {p["id"] for p in (n["data"].get("inputs") or [])}]
    print(f"Wrote {ROOT_FLOW_ID}.json ({len(root['nodes'])} nodes, {len(root['edges'])} edges, "
          f"{len(pure)} pure code nodes, {len(root.get('functions') or [])} library functions)"
          f" + {VERIFY_FLOW_ID}.json ({len(verify['nodes'])} nodes)"
          f" + {WRAPPER_FLOW_ID}.json ({len(wrapper['nodes'])} nodes, agent.v1 entrypoint)")
    if "--pack" in sys.argv:
        from wf_common import compile_check, pack_bundle
        # compile the whole tree reachable from BOTH entrypoints
        compile_check(WRAPPER_FLOW_ID, [ROOT_FLOW_ID, VERIFY_FLOW_ID, WRAPPER_FLOW_ID])
        out = pack_bundle(
            # WALK ROOT = the wrapper: the packer collects flows reachable FROM
            # the walk root, and the wrapper references the coding root (which
            # references the verify copy), so starting here collects all three.
            root_flow_id=WRAPPER_FLOW_ID, bundle_id=BUNDLE_ID,
            bundle_version=BUNDLE_VERSION,
            # TWO entrypoints (coding-agent precedent): strict coding.v1 root
            # (default) + agent.v1 wrapper (picker-visible).
            entrypoints=[ROOT_FLOW_ID, WRAPPER_FLOW_ID],
            metadata={
                "family": "multiagent-coding",
                # This bundle uses PIN EXPRESSIONS + the flow FUNCTION LIBRARY
                # (0.0.5 migration): it REQUIRES a runtime that evaluates
                # node.data.pinExpressions and compiles flow.functions. An
                # older runtime ignores both; expression-only pins fall to
                # their defaults (falsy -> bounded refusal), wired+expression
                # pins pass raw objects. The min_runtime gate makes an old
                # gateway refuse LOUDLY instead of degrading at all.
                "min_runtime": "0.4.30",
                "requires_pin_expressions": True,
                "requires_flow_functions": True,
                "purpose": ("14-step multi-agent coding pipeline: greenfield probe (0.0.18: a "
                            "deterministic ls -A skips scouts+planner+gate1 on an empty/dotfiles-"
                            "only workspace — the request becomes the plan verbatim, recorded in "
                            "vars + report) -> scouts(code+web) -> planner -> "
                            "plan gate -> backlog -> git branch -> [build -> lint -> selfcheck -> "
                            "mounted verify -> doc guard -> PR -> review gate]xN -> deterministic merge. "
                            "Dual-interface: coding.v1 strict root (request/workspace_root in) + "
                            "agent.v1 wrapper 'multiagent-coder' (prompt in, picker-visible). Both "
                            "default to gating_mode=wait (two human gates); send gating_mode=auto "
                            "for unattended runs."),
                # Catalog-level gating discoverability (code-tui c5871): a
                # client detects that this workflow is gating-capable from the
                # catalog entry instead of matching the bundle id by name.
                "gating": {"pin": "gating_mode", "values": ["wait", "auto"],
                           "default": WRAPPER_GATING},
                "outputs": ["report", "success", "branch", "stopped_reason"],
                # The list must cover EVERY call_tool node in the family, not
                # just the shell: the verify subflow calls list_files and
                # read_file directly, and a live auto run parked forever on
                # list_files when this metadata named execute_command alone
                # (gateway run 02eb7ba9, 2026-07-31).
                "auto_mode_requirement": ("unattended runs must auto-approve gated tools: send "
                                          "input_data._runtime.tool_policy = "
                                          "{\"auto_approve_max_risk_rank\": 2, \"auto_approve_tools\": "
                                          "[\"execute_command\", \"list_files\", \"read_file\", \"browser_probe\"]} "
                                          "or drive approvals externally, else the run parks on the "
                                          "first uncovered tool (the rank ceiling covers the agents' "
                                          "read/skim tools; the names cover call_tool steps and the shell)"),
            })
        print(f"Packed {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
