#!/usr/bin/env python3
"""Audit VisualFlow JSON documents for dead nodes and layout defects.

Checks (operator directive 2026-07-20: "there should be no dead node. make
sure each workflow also has a clean layout of nodes"):

1. DEAD EXEC NODE: a node declaring execution pins that is not reachable from
   any trigger node over exec edges — the compiler skips it entirely, so any
   downstream data edge from it resolves to nothing.
2. DEAD PURE NODE: a node without execution pins (pure, lazily evaluated)
   whose outputs never reach an exec-reached node through data edges — dead
   weight that misleads readers.
3. ORPHAN EDGE: an edge naming a missing node or pin (build-time defect).
4. NODE OVERLAP: two node boxes intersecting (approximate box model aligned
   with Canvas.tsx and wf_common: width 320, min height 220).
5. UNDECLARED TARGET PIN / UNDECLARED SOURCE PIN: an edge endpoint naming a
   pin the node does not declare. `code` nodes are exempt on the SOURCE side —
   they expose every key of their returned dict as a pullable handle
   (wf_common.py "any source handle on a code node is legal"), and so are
   subflow nodes, whose child output keys are spread onto them at run time.
   Everywhere else — notably `agent` and `llm_call` — there is no such escape
   hatch, so the edge silently resolves to nothing.

POLICY checks (opt-in, `--policy`) enforce the expression/function doctrine
recorded in docs/backlog/proposed/0154 and docs/visualflow.md. They are OFF by
default so the gate stays green while flows migrate; `--policy-strict` makes
them affect the exit code.

  P1 TRIVIAL READ    a pin expression that is only a run-var read
                     (`vars.state.get("provider")`) — use a Get Variable node,
                     which resolves dotted paths and honours a default.
  P2 FIELD EXTRACT   a pin expression that is only a field read off the pin's
                     own wire (`(value or {}).get("report", "")`) — declare the
                     output pin upstream, or use Break Object.
  P3 THIN WRAPPER    a pin expression that is only a call to a flow function
                     which itself fails P4/P5 — the function is a node in
                     disguise; make it a pure code node.
  P4 SINGLE USE      a flow function with fewer than 2 call sites. The adopted
                     rule is "promote at the SECOND call site, never at a line
                     count" (0154). One-off logic belongs in a code node.
  P5 OVERSIZED FN    a flow function longer than 25 lines — a code node body,
                     not a library entry.
  P6 HIDDEN CONTRACT a subflow node whose only data input is one object pin
                     (`input`/`vars`) while the child declares several start
                     pins — the boundary is real but undrawn. Declare a pin per
                     field: the runtime spreads declared input pins into the
                     child's run vars (executor.py `_create_subflow_handler`),
                     so per-field pins cost nothing and the canvas shows what
                     crosses. When the child resolves in the same directory the
                     finding NAMES the smuggled fields.
  P7 CODE-FOR-ORCHESTRATION
                     a code node whose body is mostly PROSE — the "prompt
                     composer in Python" smell. Prompt and system text must be
                     editable by users and agents without opening a code body:
                     it belongs in a pin default or a String Template. A code
                     node may still SELECT between texts that live on pins.

Usage:
  python3 scripts/audit_flow_graph.py examples/flows/co-scientist.json [...]
  python3 scripts/audit_flow_graph.py --all          # every bundled flow
  python3 scripts/audit_flow_graph.py --all --policy # + visual-primacy doctrine
  python3 scripts/audit_flow_graph.py --selftest     # predicate self-test

Exit code 0 = clean, 1 = findings.
"""
from __future__ import annotations

import functools
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
# One fold predicate and ONE node box model, never two of either: the box the
# audit enforces has to be the box the layout places against, or the gate
# reports overlaps the canvas does not have (and misses the ones it does).
from wf_common import (  # noqa: E402
    boxes_overlap,
    folded_getter_ids,
    has_exec_pin,
    node_box,
)

TRIGGERS = {"on_flow_start", "on_user_request", "on_agent_message", "on_event"}

# Node types whose SOURCE handles may legally be undeclared: a code node exposes
# every key of its returned dict, and a subflow node has the child's output keys
# spread onto it at run time.
UNDECLARED_SOURCE_OK = {"code", "subflow"}
# Handles the resolver always understands, whatever the node declares.
ALWAYS_RESOLVABLE_SOURCE = {"result", "output"}

# --- POLICY predicates -------------------------------------------------------
# A literal permitted as the second argument of `.get(key, default)`.
_LIT = r"""(True|False|None|-?\d+(\.\d+)?|"[^"]*"|'[^']*'|\[\]|\{\})"""
# P1: the whole expression is a read of a run var, optionally dotted, optionally
# with a default. `get_var{name:"<dotted.path>", default:<d>}` is an exact match:
# the handler walks dotted paths and returns `default` when the path is missing.
#
# TWO SPELLINGS, one defect. The ATTRIBUTE form is `vars.state.get("provider")`.
# The METHOD form is `(vars.get("vg") or {}).get("verdict", {})` — which is how
# a collapsed Get Variable node reads when the author was defending against a
# missing key. `multiagent_coding_smoke.py` had to carry its own copy of the
# method pattern because this one only matched the attribute form; the gap is
# closed here so there is ONE definition of "a trivial read".
_VAR_HEAD = r"""(vars(\.[A-Za-z_]\w*|\[\s*["'][^"']+["']\s*\])+
                 |\(?\s*vars\s*\.\s*get\(\s*["'][^"']+["']\s*(,\s*""" + _LIT + r"""\s*)?\)
                    (\s*or\s*(\{\}|\[\]|""|None)\s*\))?)"""
TRIVIAL_VAR_READ = re.compile(
    rf"""^\s*{_VAR_HEAD}
          (\s*\.\s*get\(\s*["'][^"']*["']\s*(,\s*{_LIT}\s*)?\)
           |\s*or\s*(\{{\}}|\[\]|""|None)\s*\))*\s*$""",
    re.X,
)
# P2: the whole expression is a field read off the pin's own wired value.
TRIVIAL_FIELD_EXTRACT = re.compile(
    rf"""^\s*(
        \(\s*value\s+or\s+(\{{\}}|\[\]|"")\s*\)\s*\.\s*get\(\s*["'][^"']*["']\s*(,\s*{_LIT}\s*)?\)
      | value(\[\s*["'][^"']+["']\s*\]|\s*\.\s*get\(\s*["'][^"']*["']\s*(,\s*{_LIT}\s*)?\))+
    )\s*$""",
    re.X,
)
_CALL_HEAD = re.compile(r"^\s*([A-Za-z_]\w*)\s*\(")

MAX_FUNCTION_LINES = 25
MIN_FUNCTION_CALL_SITES = 2


def sole_call_callee(expression: str) -> str | None:
    """The function name if `expression` is exactly one call spanning the whole
    text (`f(vars.state)`), else None. `f(x) or y` is NOT a sole call."""
    text = " ".join(expression.split())
    head = _CALL_HEAD.match(text)
    if not head:
        return None
    depth = 0
    for i, ch in enumerate(text):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return head.group(1) if i == len(text) - 1 else None
    return None


def pin_expressions(node: dict) -> dict[str, str]:
    raw = (node.get("data") or {}).get("pinExpressions")
    if not isinstance(raw, dict):
        return {}
    return {k: v for k, v in raw.items() if isinstance(k, str) and isinstance(v, str) and v.strip()}


def function_call_sites(flow: dict) -> dict[str, int]:
    """Call sites per flow function: pin expressions plus OTHER function bodies."""
    functions = [f for f in (flow.get("functions") or []) if isinstance(f, dict) and f.get("name")]
    names = [str(f["name"]) for f in functions]
    haystack: list[tuple[str, str]] = []
    for node in flow.get("nodes") or []:
        for pin, expr in pin_expressions(node).items():
            haystack.append((f"{node.get('id')}.{pin}", expr))
    haystack += [(f"fn:{f['name']}", str(f.get("code") or "")) for f in functions]

    counts = {name: 0 for name in names}
    for where, text in haystack:
        for name in names:
            if where == f"fn:{name}":
                continue  # recursion is not reuse
            if re.search(r"\b" + re.escape(name) + r"\s*\(", text):
                counts[name] += 1
    return counts


# --- P6: hidden subflow contract --------------------------------------------
# The runtime spreads DECLARED subflow input pins into the child's run vars and
# only falls back to the whole-object `input`/`vars` pin when nothing else is
# declared (`executor.py` `_create_subflow_handler`). So per-field pins are free
# at run time and the only thing an `input` blob buys is invisibility.
SUBFLOW_BLOB_PINS = {"input", "vars"}
SUBFLOW_CONTROL_PINS = {"inherit_context", "inheritContext"}


def data_pin_ids(node: dict, key: str) -> list[str]:
    pins = (node.get("data") or {}).get(key)
    if not isinstance(pins, list):
        return []
    return [
        p["id"]
        for p in pins
        if isinstance(p, dict) and isinstance(p.get("id"), str) and p.get("type") != "execution"
    ]


@functools.lru_cache(maxsize=None)
def sibling_flow_index(directory: str) -> dict:
    """`{flow id or file stem: flow document}` for every JSON file beside the
    audited one. P6 is advisory precisely because this may not find the child —
    a flow saved in the Gateway library is not on disk here."""
    index: dict[str, dict] = {}
    for path in sorted(Path(directory).glob("*.json")):
        try:
            flow = json.loads(path.read_text())
        except Exception:
            continue
        if not isinstance(flow, dict) or not isinstance(flow.get("nodes"), list):
            continue
        index.setdefault(path.stem, flow)
        fid = flow.get("id")
        if isinstance(fid, str) and fid:
            index[fid] = flow
    return index


def child_start_pins(child: dict) -> list[str]:
    """The child's declared inputs: its On Flow Start data outputs."""
    for node in child.get("nodes") or []:
        if node_type(node) == "on_flow_start":
            return data_pin_ids(node, "outputs")
    return []


def audit_hidden_contracts(flow: dict, siblings: dict) -> list[str]:
    """P6 HIDDEN CONTRACT (advisory)."""
    findings: list[str] = []
    for node in flow.get("nodes") or []:
        if node_type(node) != "subflow":
            continue
        data = node.get("data") or {}
        declared = [p for p in data_pin_ids(node, "inputs") if p not in SUBFLOW_CONTROL_PINS]
        if len(declared) != 1 or declared[0] not in SUBFLOW_BLOB_PINS:
            continue
        ref = data.get("subflowId") or data.get("flowId") or data.get("workflowId") or data.get("workflow_id")
        child = siblings.get(str(ref)) if ref else None
        if child is None:
            findings.append(
                f"POLICY P6 HIDDEN CONTRACT {node.get('id')}: subflow '{ref}' takes ONE "
                f"'{declared[0]}' object pin -- declare an input pin per child field "
                f"(the child is not resolvable here; open it and mirror its start pins)"
            )
            continue
        fields = [p for p in child_start_pins(child) if p not in SUBFLOW_BLOB_PINS]
        if len(fields) < 2:
            continue  # a child whose contract really is one value: nothing hidden
        findings.append(
            f"POLICY P6 HIDDEN CONTRACT {node.get('id')}: subflow '{ref}' takes ONE "
            f"'{declared[0]}' object pin, smuggling {len(fields)} fields "
            f"({', '.join(fields)}) -- declare one input pin per field; the runtime "
            f"spreads declared pins into the child's vars"
        )
    return findings


# --- P7: prose living in a code body ----------------------------------------
# Dominance is measured in CHARACTERS, not lines: a prompt is one 2,000-char
# string literal on ONE line, so a line ratio scores it at 1/14 and misses the
# only case that matters. Character share reads the same body as "88% prose".
_STRING_LITERAL = re.compile(
    r'("""(?:.|\n)*?"""|\'\'\'(?:.|\n)*?\'\'\'|"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\')'
)
# Shell/command text is DETERMINISTIC GLUE, the legitimate use of a code node —
# a command composer is prose-shaped but is not a prompt. Never count it.
_SHELL_MARKERS = ("&&", "||", "2>&1", ">/dev/null", "$(", "`", "|| true")
PROSE_MIN_WORDS = 8
PROSE_CHAR_SHARE = 0.5
# Consumers whose text must stay editable by a user or an agent.
PROMPT_PINS = {"prompt", "system", "system_prompt", "instructions", "brief", "task", "question"}


def prose_literal_length(literal: str) -> int:
    """Characters of NATURAL LANGUAGE in a string literal, else 0."""
    body = literal.strip("\"'")
    if any(marker in body for marker in _SHELL_MARKERS):
        return 0
    words = body.split()
    if len(words) < PROSE_MIN_WORDS:
        return 0
    wordy = sum(1 for w in words if re.match(r"^[A-Za-z][A-Za-z'\-,.;:()]*$", w))
    if wordy < len(words) * 0.5:
        return 0  # identifiers, paths, JSON keys — not a sentence
    return len(body)


def code_body(node: dict) -> str:
    data = node.get("data") or {}
    return str(data.get("codeBody") or data.get("code") or "")


def prose_share(body: str) -> tuple[float, int, int]:
    """(share, prose chars, code chars) over non-comment, non-blank lines."""
    code = "\n".join(
        line for line in body.splitlines() if line.strip() and not line.strip().startswith("#")
    )
    if len(code) < 80:
        return (0.0, 0, len(code))
    prose = sum(prose_literal_length(m.group(0)) for m in _STRING_LITERAL.finditer(code))
    return (prose / len(code), prose, len(code))


def audit_code_for_orchestration(flow: dict) -> list[str]:
    """P7 CODE-FOR-ORCHESTRATION (advisory, best-effort)."""
    findings: list[str] = []
    edges = flow.get("edges") or []
    for node in flow.get("nodes") or []:
        if node_type(node) != "code":
            continue
        share, prose, total = prose_share(code_body(node))
        if share <= PROSE_CHAR_SHARE:
            continue
        nid = node.get("id")
        feeds = sorted(
            {
                str(e.get("targetHandle"))
                for e in edges
                if e.get("source") == nid and str(e.get("targetHandle") or "") in PROMPT_PINS
            }
        )
        destination = f" feeding {'/'.join(feeds)}" if feeds else ""
        findings.append(
            f"POLICY P7 CODE-FOR-ORCHESTRATION {nid}: {round(share * 100)}% of the body "
            f"({prose}/{total} chars) is prose text{destination} -- prompt and system text "
            f"belongs in an editable pin default or a String Template; keep the code node "
            f"for SELECTING between texts that live on pins"
        )
    return findings


# The bundled/shipped catalog (mirrors src/utils/bundledFlows.ts globs).
BUNDLED = [
    "deep-research.json", "deep-investigate.json", "deep-plan.json",
    "deep-render.json", "deep-review.json", "81795ea9.json", "15f19f7f.json",
    "coding-agent.json", "coder.json", "coding-verify-gates.json",
    "multiagent-coding.json", "multiagent-coder.json", "multiagent-verify-gates.json",
    "adversarial-review.json", "structured-extract.json", "map-reduce.json",
    "co-scientist.json", "diagram-render.json",
    "meta-consensus.json", "meta-debate.json", "meta-reflect.json",
    "meta-perspectives.json", "meta-deliberate.json", "meta-baseline.json",
]


def node_type(node: dict) -> str:
    return (node.get("data") or {}).get("nodeType") or node.get("type") or ""


def declared_pins(node: dict, key: str) -> set[str]:
    pins = (node.get("data") or {}).get(key)
    if not isinstance(pins, list):
        return set()
    return {p["id"] for p in pins if isinstance(p, dict) and isinstance(p.get("id"), str) and p["id"]}


def audit_pin_endpoints(nodes: dict, edges: list) -> list[str]:
    """5. Edge endpoints naming a pin the node does not declare.

    Only meaningful for non-exec data edges: exec handles (`true`/`false`/`loop`/
    `done`/case ids) are synthesised per node type and are not all declared.
    """
    findings: list[str] = []
    for edge in edges:
        source, target = nodes.get(edge.get("source")), nodes.get(edge.get("target"))
        if not source or not target:
            continue  # already reported as ORPHAN EDGE
        s_handle = str(edge.get("sourceHandle") or "")
        t_handle = str(edge.get("targetHandle") or "")
        if s_handle.startswith("exec") or t_handle.startswith("exec"):
            continue

        if t_handle and t_handle not in declared_pins(target, "inputs"):
            findings.append(
                f"UNDECLARED TARGET PIN {edge.get('id')}: "
                f"{edge.get('target')}.{t_handle} ({node_type(target)}) is not an input pin"
            )

        if not s_handle or s_handle in ALWAYS_RESOLVABLE_SOURCE:
            continue
        if node_type(source) in UNDECLARED_SOURCE_OK:
            continue  # returned-dict keys / spread child outputs are legal handles
        if s_handle not in declared_pins(source, "outputs"):
            findings.append(
                f"UNDECLARED SOURCE PIN {edge.get('id')}: "
                f"{edge.get('source')}.{s_handle} ({node_type(source)}) is not an output pin"
            )
    return findings


def audit_policy(flow: dict, siblings: dict | None = None) -> list[str]:
    """Expression/function doctrine (0154/0155). Advisory unless --policy-strict."""
    findings: list[str] = []
    functions = {
        str(f["name"]): f
        for f in (flow.get("functions") or [])
        if isinstance(f, dict) and f.get("name")
    }
    sites = function_call_sites(flow)

    def illegal_function_reason(name: str) -> str | None:
        """Why `name` is not library material, or None if it is legal.

        The two failure modes want different fixes, so P3 names which one it hit:
        a single-use helper should become a code node, while a genuinely reused
        but oversized one (text_of: 4 sites, 30 lines) wants shrinking or
        promoting to a runtime builtin — not inlining into four code nodes.
        """
        fn = functions.get(name)
        if fn is None:
            return None
        lines = len(str(fn.get("code") or "").splitlines())
        n_sites = sites.get(name, 0)
        if n_sites < MIN_FUNCTION_CALL_SITES:
            return f"'{name}' has {n_sites} call site; make it a pure code node"
        if lines > MAX_FUNCTION_LINES:
            return f"'{name}' is reused ({n_sites} sites) but {lines} lines; shrink it or make it a runtime builtin"
        return None

    for node in flow.get("nodes") or []:
        nid = node.get("id")
        for pin, expr in pin_expressions(node).items():
            one = " ".join(expr.split())
            if TRIVIAL_VAR_READ.match(one):
                findings.append(
                    f"POLICY P1 TRIVIAL READ {nid}.{pin}: {one} "
                    f"-- use a Get Variable node (dotted path + default)"
                )
                continue
            if TRIVIAL_FIELD_EXTRACT.match(one):
                findings.append(
                    f"POLICY P2 FIELD EXTRACT {nid}.{pin}: {one} "
                    f"-- declare the output pin upstream, or use Break Object"
                )
                continue
            callee = sole_call_callee(one)
            reason = illegal_function_reason(callee) if callee else None
            if reason:
                findings.append(f"POLICY P3 THIN WRAPPER {nid}.{pin}: {one} -- {reason}")

    for name, fn in functions.items():
        lines = len(str(fn.get("code") or "").splitlines())
        n_sites = sites.get(name, 0)
        if n_sites < MIN_FUNCTION_CALL_SITES:
            findings.append(
                f"POLICY P4 SINGLE USE function '{name}' ({lines} lines, {n_sites} call site) "
                f"-- promote at the SECOND call site; one-off logic is a code node"
            )
        if lines > MAX_FUNCTION_LINES:
            findings.append(
                f"POLICY P5 OVERSIZED FN '{name}' ({lines} lines > {MAX_FUNCTION_LINES}) "
                f"-- a code node body, not a library entry"
            )

    # P6/P7 are about VISUAL PRIMACY rather than the expression tiers: what the
    # canvas fails to show (a subflow's real inputs) and what a code node has
    # taken over that a pin default should own (prompt text).
    findings.extend(audit_hidden_contracts(flow, siblings or {}))
    findings.extend(audit_code_for_orchestration(flow))
    return findings


def audit(path: Path, *, policy: bool = False) -> list[str]:
    flow = json.loads(path.read_text())
    nodes = {n["id"]: n for n in flow.get("nodes") or []}
    edges = flow.get("edges") or []
    findings: list[str] = []

    # 3. Orphan edges (endpoint existence).
    for edge in edges:
        for end in ("source", "target"):
            if edge.get(end) not in nodes:
                findings.append(f"ORPHAN EDGE {edge.get('id')}: {end} '{edge.get(end)}' missing")

    # 5. Pin-level endpoint existence.
    findings.extend(audit_pin_endpoints(nodes, edges))

    # Exec reachability.
    exec_edges = [e for e in edges if str(e.get("targetHandle") or "").startswith("exec")]
    adjacency: dict[str, list[str]] = {}
    for edge in exec_edges:
        adjacency.setdefault(edge["source"], []).append(edge["target"])
    reached: set[str] = set()
    stack = [nid for nid, n in nodes.items() if node_type(n) in TRIGGERS]
    while stack:
        current = stack.pop()
        if current in reached:
            continue
        reached.add(current)
        stack.extend(adjacency.get(current, []))

    # 1. Dead exec nodes.
    for nid, node in nodes.items():
        if node_type(node) in TRIGGERS:
            continue
        if has_exec_pin(node) and nid not in reached:
            findings.append(f"DEAD EXEC NODE {nid} ({node_type(node)}: {(node.get('data') or {}).get('label', '')})")

    # 2. Dead pure nodes (no data path into the exec spine).
    data_out: dict[str, list[str]] = {}
    for edge in edges:
        if str(edge.get("targetHandle") or "").startswith("exec"):
            continue
        data_out.setdefault(edge["source"], []).append(edge["target"])

    @functools.lru_cache(maxsize=None)
    def feeds_exec(nid: str) -> bool:
        for target in data_out.get(nid, []):
            if target in reached:
                return True
        return any(feeds_exec(t) for t in data_out.get(nid, []) if t not in reached)

    for nid, node in nodes.items():
        if nid in reached or has_exec_pin(node):
            continue
        try:
            alive = feeds_exec(nid)
        except RecursionError:
            alive = True
        if not alive:
            findings.append(f"DEAD PURE NODE {nid} ({node_type(node)}: {(node.get('data') or {}).get('label', '')})")

    # 4. Overlaps. Folded getters (0156) render as pin-row pills, not cards —
    # no box, so they neither collide nor count toward the drawn graph.
    folded = folded_getter_ids(flow)
    entries = [(nid, node_box(node)) for nid, node in nodes.items() if nid not in folded]
    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            if boxes_overlap(entries[i][1], entries[j][1]):
                findings.append(f"OVERLAP {entries[i][0]} <-> {entries[j][0]}")

    if policy:
        # Sibling files are the only child flows P6 can resolve; the index is
        # built lazily (and cached per directory) so non-policy runs pay nothing.
        findings.extend(audit_policy(flow, sibling_flow_index(str(path.resolve().parent))))

    return findings


# --- self-test ---------------------------------------------------------------
# `python3 scripts/audit_flow_graph.py --selftest`. Plain asserts, no test
# runner: the script is a standalone gate and its predicates must be checkable
# wherever it runs. Each case is a defect the predicate exists to catch, paired
# with the legitimate shape it must NOT flag (a policy advisory that cries wolf
# gets switched off, which is how doctrine dies).
def _selftest() -> int:
    def subflow(pins: list[str], ref: str = "child") -> dict:
        return {
            "id": "call",
            "data": {
                "nodeType": "subflow",
                "subflowId": ref,
                "inputs": [{"id": "exec-in", "type": "execution"}]
                + [{"id": p, "type": "object"} for p in pins],
            },
        }

    def child_with(pins: list[str]) -> dict:
        return {
            "nodes": [
                {
                    "id": "start",
                    "data": {
                        "nodeType": "on_flow_start",
                        "outputs": [{"id": "exec-out", "type": "execution"}]
                        + [{"id": p, "type": "string"} for p in pins],
                    },
                }
            ]
        }

    siblings = {"child": child_with(["topic", "depth", "provider"]), "one": child_with(["input"])}

    # P6 fires on a blob pin and NAMES the smuggled fields.
    out = audit_hidden_contracts({"nodes": [subflow(["inherit_context", "input"])]}, siblings)
    assert len(out) == 1 and "P6 HIDDEN CONTRACT" in out[0], out
    assert "topic, depth, provider" in out[0], out
    # Per-field pins are the target shape: silent.
    assert audit_hidden_contracts({"nodes": [subflow(["topic", "depth", "provider"])]}, siblings) == []
    # A blob pin BESIDE declared fields is already legible: silent.
    assert audit_hidden_contracts({"nodes": [subflow(["input", "topic", "depth"])]}, siblings) == []
    # A child whose contract really is one value: nothing is hidden.
    assert audit_hidden_contracts({"nodes": [subflow(["input"], ref="one")]}, siblings) == []
    # Unresolvable child: still advises, without inventing field names.
    out = audit_hidden_contracts({"nodes": [subflow(["input"], ref="elsewhere")]}, siblings)
    assert len(out) == 1 and "not resolvable" in out[0], out

    def code(body: str, edges: list | None = None) -> dict:
        return {
            "nodes": [{"id": "compose", "data": {"nodeType": "code", "codeBody": body}}],
            "edges": edges or [],
        }

    prompt_body = (
        'parts = []\n'
        'parts.append("You are an independent reviewer. Judge the answer strictly on the '
        'evidence it shows, and name every unsupported claim you find.")\n'
        'parts.append("Return a short verdict, then the reasons that decided it, in order '
        'of how much they mattered to your judgement.")\n'
        'return "\\n".join(parts)\n'
    )
    out = audit_code_for_orchestration(code(prompt_body))
    assert len(out) == 1 and "P7 CODE-FOR-ORCHESTRATION" in out[0], out
    # Naming the destination pin makes the fix obvious.
    out = audit_code_for_orchestration(
        code(prompt_body, [{"source": "compose", "targetHandle": "prompt", "target": "llm"}])
    )
    assert "feeding prompt" in out[0], out

    # SELECTION between texts that live on pins — the doctrine-compliant shape.
    selection_body = (
        'text = str(first_build_text or "")\n'
        'text = text.replace("{{request}}", str(request or "").strip())\n'
        'if int(fix_cycles or 0) > 0:\n'
        '    text = str(repair_text or "").replace("{{failures}}", str(build_feedback or ""))\n'
        'return {"prompt": text}\n'
    )
    assert audit_code_for_orchestration(code(selection_body)) == []

    # Deterministic glue: a shell-command composer is prose-shaped and legal.
    shell_body = (
        'ws = shq(str(workspace_root or "").strip())\n'
        'cmd = ("cd \'" + ws + "\' && (command -v ruff >/dev/null 2>&1 && ruff check --fix . '
        '2>&1 | tail -5 || true); echo LINT_DONE")\n'
        'return {"tool_call": {"name": "execute_command", "arguments": {"command": cmd}}}\n'
    )
    assert audit_code_for_orchestration(code(shell_body)) == []

    # P1 covers BOTH spellings of a collapsed getter (attribute and method).
    for expr in (
        'vars.state.get("provider")',
        'vars.count',
        '(vars.get("vg") or {}).get("verdict", {})',
        'vars.get("x")',
    ):
        assert TRIVIAL_VAR_READ.match(expr), expr
    for expr in ('vars.fix_cycles < 3', 'not vars.accepted', 'len(vars.items)'):
        assert not TRIVIAL_VAR_READ.match(expr), expr

    print("audit_flow_graph selftest: OK")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if "--selftest" in args:
        return _selftest()
    policy = "--policy" in args or "--policy-strict" in args
    policy_strict = "--policy-strict" in args
    args = [a for a in args if a not in ("--policy", "--policy-strict")]

    root = Path(__file__).resolve().parent.parent
    if args and args[0] == "--all":
        paths = [root / "examples" / "flows" / name for name in BUNDLED]
    else:
        paths = [Path(a) for a in args]
    if not paths:
        print(__doc__)
        return 2
    bad = 0
    for path in paths:
        if not path.exists():
            print(f"{path.name}: MISSING FILE")
            bad += 1
            continue
        findings = audit(path, policy=policy)
        hard = [f for f in findings if not f.startswith("POLICY ")]
        soft = [f for f in findings if f.startswith("POLICY ")]
        # POLICY findings are advisory by default: the doctrine lands before the
        # flows finish migrating, and a gate that fails on day one just gets
        # switched off. --policy-strict is the enforcement switch.
        if hard or (soft and policy_strict):
            bad += 1
        # rendered_nodes = what the canvas actually draws with the fold on
        # (0156): total minus folded single-consumer getters. Reported so
        # tooling and success criteria speak about what the author sees.
        flow = json.loads(path.read_text(encoding="utf-8"))
        total_nodes = len(flow.get("nodes") or [])
        rendered = total_nodes - len(folded_getter_ids(flow))
        size_note = (
            f" [nodes={total_nodes}, rendered_nodes={rendered}]" if rendered != total_nodes else ""
        )
        if findings:
            print(
                f"{path.name}: {len(hard)} finding(s)"
                + (f", {len(soft)} policy" if soft else "")
                + size_note
            )
            for f in hard + soft:
                print(f"  {f}")
        else:
            print(f"{path.name}: clean{size_note}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
