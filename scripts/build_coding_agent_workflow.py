#!/usr/bin/env python3
"""Generate the `coding-agent` workflow bundle (operator ask c2119).

An advanced basic-agent with a recursive verify->reprompt loop. Each round:
  1. BUILDER agent writes/edits code in the workspace (full file + shell tools).
  2. VERIFIER agent INDEPENDENTLY runs three gates and returns a structured
     verdict — never the builder's self-report:
       - builds:  execute_command runs the build/compile step.
       - executes: execute_command runs the program (or a smoke command).
       - matches:  analyze_code structure + an LLM judgment vs the request.
  3. A code node decides continue/stop from the verdict + round budget.
  4. On failure, the NEXT round reprompts the builder with the SPECIFIC
     failure text (compiler error / traceback / structural mismatch), never a
     generic "try again" — the specific-failure-as-reprompt principle
     (code's R-Type post-mortem, agora c2121).

The three gates are authored as one VERIFIER subflow so the machinery is
reusable and the composition lane (shipped 2026-07-14) is dogfooded.

Design idioms mirror build_deep_research_workflows.py (node/edge/pin helpers,
while-loop + get_var/set_var loop state, code nodes returning transform()).
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
FLOWS_DIR = ROOT / "abstractflow" / "examples" / "flows"
BUNDLES_DIR = ROOT / "abstractgateway" / "flows" / "bundles"
# 0.2.8, not 0.2.7: an unregistered dev artifact coding-agent@0.2.7.flow
# (2026-08-04) sits in the gateway checkout's bundles dir and a gateway that
# loaded it refuses a different 0.2.7 (bundle versions are immutable by sha).
BUNDLE_VERSION = "0.2.8"
BUNDLE_FILENAME = f"coding-agent@{BUNDLE_VERSION}.flow"

AGENT_INTERFACE = "abstractcode.agent.v1"

# Tools the BUILDER may use — full file + shell + structure surface, plus the
# browser probe for SELF-verification mid-build: the R-Type memact arm picked
# up browser_probe unprompted and probed its own game before finishing — the
# fastest honest arm of the experiment (code seat, agora c2790). Availability
# is enough; the independent gate below stays authoritative regardless. The
# allowlist filters the host registry, so a host without the tool is a no-op.
BUILDER_TOOLS = [
    "read_file", "write_file", "edit_file", "list_files", "search_files",
    "skim_files", "skim_folders", "analyze_code", "execute_command",
    "browser_probe",
]
# Tools the VERIFIER may use — read + run + structure only (never edits code).
VERIFIER_TOOLS = ["read_file", "list_files", "analyze_code", "execute_command"]

EXEC_IN = {"id": "exec-in", "label": "", "type": "execution"}
EXEC_OUT = {"id": "exec-out", "label": "", "type": "execution"}


def _pin(pin_id: str, label: str, pin_type: str) -> dict[str, Any]:
    return {"id": pin_id, "label": label, "type": pin_type}


_HEADER = {
    "on_flow_start": "#C0392B", "on_flow_end": "#C0392B", "subflow": "#00CCCC",
    "agent": "#4488FF", "make_object": "#3498DB", "get": "#3498DB",
    "get_var": "#16A085", "set_var": "#16A085", "while": "#F39C12",
    "code": "#9B59B6", "string_template": "#E74C3C",
}
_ICON = {
    "on_flow_start": "&#x1F3C1;", "on_flow_end": "&#x23F9;", "subflow": "&#x1F4E6;",
    "agent": "&#x1F916;", "make_object": "{}", "get": "&#x1F4E5;",
    "get_var": "&#x1F4E5;", "set_var": "&#x1F4E4;", "while": "&#x1F501;",
    "code": "&#x1F9E9;", "string_template": "&#x1F9FE;",
}


def _node(node_id, node_type, label, x, y, *, inputs=None, outputs=None,
          pin_defaults=None, extra=None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "nodeType": node_type, "label": label,
        "icon": _ICON.get(node_type, "&#x25A1;"),
        "headerColor": _HEADER.get(node_type, "#3498DB"),
        "inputs": inputs or [], "outputs": outputs or [],
    }
    if pin_defaults:
        data["pinDefaults"] = pin_defaults
    if extra:
        data.update(extra)
    return {"id": node_id, "type": node_type, "position": {"x": x, "y": y},
            "data": data, "label": None, "icon": None, "headerColor": None,
            "inputs": [], "outputs": []}


def _edge(source, source_handle, target, target_handle, *, animated=False):
    return {
        "id": f"e-{source}-{source_handle}-{target}-{target_handle}".replace(":", "-"),
        "source": source, "sourceHandle": source_handle,
        "target": target, "targetHandle": target_handle, "animated": animated,
    }


def _base_flow(flow_id, name, description, interfaces=None):
    now = datetime.now(timezone.utc).isoformat()
    return {"id": flow_id, "name": name, "description": description,
            "interfaces": interfaces or [], "nodes": [], "edges": [],
            "entryNode": "start", "created_at": now, "updated_at": now}


def _agent_node(node_id, label, x, y, *, extra_inputs=None, pin_defaults=None):
    inputs = [
        EXEC_IN,
        _pin("provider", "provider", "provider_text"),
        _pin("model", "model", "model"),
        _pin("system", "system", "string"),
        _pin("prompt", "prompt", "string"),
        _pin("tools", "tools", "array"),
        _pin("max_iterations", "max_iterations", "number"),
        _pin("temperature", "temperature", "number"),
        _pin("resp_schema", "resp_schema", "json_schema"),
        *(extra_inputs or []),
    ]
    outputs = [
        EXEC_OUT,
        _pin("response", "response", "string"),
        _pin("data", "data", "object"),
        _pin("success", "success", "boolean"),
        _pin("meta", "meta", "object"),
        _pin("scratchpad", "scratchpad", "object"),
    ]
    return _node(node_id, "agent", label, x, y, inputs=inputs, outputs=outputs,
                 pin_defaults=pin_defaults or {})


def _code_node(node_id, label, code_body, x, y, inputs, output_type="object"):
    return _node(
        node_id, "code", label, x, y,
        inputs=[*inputs, _pin("permissions", "permissions", "string")],
        outputs=[_pin("output", "output", output_type),
                 _pin("success", "success", "boolean"),
                 _pin("execution", "execution", "object")],
        pin_defaults={"permissions": "sandbox"},
        extra={"functionName": "transform", "codeBody": code_body},
    )


def _get_var(node_id, name, default, x, y):
    return _node(node_id, "get_var", f"Get {name}", x, y,
                 inputs=[_pin("name", "name", "string"), _pin("default", "default", "any")],
                 outputs=[_pin("value", "value", "any")],
                 pin_defaults={"name": name, "default": default})


def _set_var(node_id, label, name, x, y):
    return _node(node_id, "set_var", label, x, y,
                 inputs=[EXEC_IN, _pin("name", "name", "string"), _pin("value", "value", "any")],
                 outputs=[EXEC_OUT, _pin("value", "value", "any")],
                 pin_defaults={"name": name})


def _while(node_id, label, x, y):
    return _node(node_id, "while", label, x, y,
                 inputs=[EXEC_IN, _pin("condition", "condition", "boolean")],
                 outputs=[_pin("loop", "loop", "execution"),
                          _pin("done", "done", "execution"),
                          _pin("index", "index", "number"),
                          _pin("item", "item", "any")],
                 pin_defaults={"condition": True})


def _make_object(node_id, fields, x, y):
    return _node(node_id, "make_object", "Build JSON", x, y,
                 inputs=[_pin(f, f, t) for f, t in fields],
                 outputs=[_pin("result", "result", "object")])


def _get(node_id, key, default, x, y):
    return _node(node_id, "get", f"Get {key}", x, y,
                 inputs=[_pin("object", "object", "object"),
                         _pin("key", "key", "string"),
                         _pin("default", "default", "any")],
                 outputs=[_pin("value", "value", "any")],
                 pin_defaults={"key": key, "default": default})


def _subflow_node(node_id, label, flow_id, x, y):
    # deep-research convention: one `input` object in, one `output` object out;
    # the runtime maps the input object's keys to the child's on_flow_start
    # fields by name and collects the child's on_flow_end fields into output.
    return _node(node_id, "subflow", label, x, y,
                 inputs=[EXEC_IN, _pin("inherit_context", "inherit_context", "boolean"),
                         _pin("input", "input", "object")],
                 outputs=[EXEC_OUT, _pin("output", "output", "object")],
                 pin_defaults={"inherit_context": False},
                 extra={"subflowId": flow_id})


def _call_tool(node_id, label, allowed, x, y):
    """Deterministic single-tool invocation (agora-react-agent precedent).

    The tool_call object ({name, arguments, call_id}) is wired from an
    upstream code node so arguments can derive from run inputs; allowed_tools
    pins the node to exactly the intended tool. Read-only tools ride the
    runtime's safe auto-approve default.
    """
    # `raw` exposes the unmapped effect outcome ({mode, results:[{output,...}]}).
    # Needed because the tool-executor's error heuristic treats structured
    # {ok: false} tool RESULTS as tool-level failures and the (result, success)
    # pins then carry only the error STRING — gates that must read a probe's
    # structured failure payload (page_errors etc.) read the raw channel.
    return _node(node_id, "call_tool", label, x, y,
                 inputs=[EXEC_IN,
                         _pin("tool_call", "tool_call", "object"),
                         _pin("allowed_tools", "allowed_tools", "array")],
                 outputs=[EXEC_OUT,
                          _pin("result", "result", "any"),
                          _pin("success", "success", "boolean"),
                          _pin("raw", "raw", "object")],
                 pin_defaults={"allowed_tools": allowed},
                 extra={"icon": "&#x1F527;", "headerColor": "#16A085"})


def _if(node_id, label, x, y):
    return _node(node_id, "if", label, x, y,
                 inputs=[EXEC_IN, _pin("condition", "condition", "boolean")],
                 outputs=[_pin("true", "true", "execution"),
                          _pin("false", "false", "execution")],
                 extra={"icon": "&#x2753;", "headerColor": "#F39C12"})


# --- the STEERING + PROGRESS lane (0.2.5, 2026-07-31) ----------------------
# Added so this family meets the same interactive bar as the new hand-wired
# loop coders (react-coder / ralph-coder): a run must be steerable while it
# runs, and it must SAY where it is. Deliberately additive — the round loop,
# the gates and the report band are untouched.


def _exec_code_node(node_id, label, code_body, x, y, inputs, outputs, pin_defaults=None):
    """Code node ON the exec lane with NAMED outputs.

    The exec wrapper rewrites `success`/`output`/`result`/`error`/`execution`
    on the node's record, so named result pins must avoid those five (the
    wf_common rule, restated here because this generator predates it)."""
    defaults = {"permissions": "sandbox"}
    defaults.update(pin_defaults or {})
    return _node(node_id, "code", label, x, y,
                 inputs=[EXEC_IN, *inputs, _pin("permissions", "permissions", "string")],
                 outputs=[EXEC_OUT, *outputs],
                 pin_defaults=defaults,
                 extra={"functionName": "transform", "codeBody": code_body})


def _answer_user(node_id, label, x, y):
    return _node(node_id, "answer_user", label, x, y,
                 inputs=[EXEC_IN, _pin("message", "message", "string"),
                         _pin("level", "level", "string")],
                 outputs=[EXEC_OUT, _pin("message", "message", "string")],
                 pin_defaults={"level": "message"},
                 extra={"icon": "&#x1F4AC;", "headerColor": "#9B59B6"})


# --------------------------------------------------------------------------
# Code bodies (transform snippets: inputs bound as locals, return the output).
# --------------------------------------------------------------------------

# Strict-expressible (agent precision 3, c2847 — the airelay 422 class):
# OpenAI-strict validators require EVERY property in `required` when
# additionalProperties is false, so all fields are required and the model
# emits empty strings/arrays where a field does not apply.
VERIFIER_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "builds", "build_error", "executes", "run_error", "matches", "mismatch",
        "all_passed", "failures", "environment_failures", "summary", "artifacts",
        "feature_checks",
    ],
    "properties": {
        "builds": {"type": "boolean"},
        "build_error": {"type": "string"},
        "executes": {"type": "boolean"},
        "run_error": {"type": "string"},
        "matches": {"type": "boolean"},
        "mismatch": {"type": "string"},
        "all_passed": {"type": "boolean"},
        "failures": {"type": "array", "items": {"type": "string"}},
        # Failures the BUILDER cannot fix by changing code (missing executor or
        # runtime on the verification host). Kept separate so the round loop
        # can stop early instead of burning repair rounds on the environment
        # (R-Type post-mortem, agora c2725/c2736: fail closed, but never
        # reprompt a builder over a host gap).
        "environment_failures": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": "string"},
        # The produced files the verifier actually OBSERVED (workspace-relative
        # paths). Sourced from the verifier — never the builder's self-report —
        # so the final report can name where the artifact lives on every host
        # (operator incident 2026-07-16: "no link / path to test it").
        "artifacts": {"type": "array", "items": {"type": "string"}},
        # R4 (memgraph forensics 2026-07-21, ARCHITECTURE.md §4/§5): schema-
        # forced per-feature input-dependence enumeration. The old C3 prose
        # produced no artifact, so the verifier sampled 1-2 salient features
        # and silently skipped the rest (dead playback / missing ranking
        # passed matches). REQUIRED here: coverage becomes visible in the
        # verdict, and the merge fails any depends_on_input=false entry.
        "feature_checks": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["feature", "input", "expected_change", "evidence", "depends_on_input"],
                "properties": {
                    "feature": {"type": "string"},
                    "input": {"type": "string"},
                    "expected_change": {"type": "string"},
                    "evidence": {"type": "string"},
                    "depends_on_input": {"type": "boolean"},
                },
            },
        },
    },
}

# ---------------------------------------------------------------------------
# Deterministic gates (v2). Ground truth comes from call_tool list_files /
# read_file results — never from an LLM's willingness to run them. Code nodes
# run in the RestrictedPython sandbox: no imports, plain string work only.
# ---------------------------------------------------------------------------

# Compose the list_files tool call for the run workspace.
LISTING_ARGS_CODE = """
ws = str(workspace_root or "").strip()
return {
    "name": "list_files",
    "arguments": {
        "directory_path": ws if ws else ".",
        "recursive": True,
        "include_hidden": False,
        "head_limit": None,
    },
    "call_id": "gate-workspace-listing",
}
""".strip()

# G0 DELIVERY: parse the listing into workspace-relative file paths, classify
# the artifact (web vs other), and detect the entrypoint. list_files returns a
# formatted string: one header line, then two-space-indented entries; dirs end
# with '/', files carry a ' (N bytes)' suffix. Error strings are single lines
# with no indented entries, so they parse to zero files and fail the gate.
GATE0_CODE = """
text = str(listing or "")
ok = bool(listing_ok)
files = []
lines = text.split("\\n")
for ln in lines[1:]:
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

html = [f for f in files if f.lower().endswith(".html") or f.lower().endswith(".htm")]
web_class = len(html) > 0
entrypoint = ""
if web_class:
    roots = [f for f in html if "/" not in f]
    cands = roots if roots else html
    named_index = [f for f in cands if f.lower().rsplit("/", 1)[-1] in ("index.html", "index.htm")]
    pool = named_index if named_index else sorted(cands)
    entrypoint = pool[0]

failures = []
if not ok:
    failures.append("delivery: could not list the workspace: " + text)
elif not files:
    if text.startswith("Error"):
        failures.append("delivery: workspace listing failed: " + text)
    else:
        failures.append("delivery: the workspace contains no files — nothing was delivered where the task expects it")

return {
    "files": files,
    "web_class": web_class,
    "entrypoint": entrypoint,
    "delivery_ok": len(failures) == 0,
    "failures": failures,
}
""".strip()

# Compose the read_file call for the integration check. Non-web workspaces
# read the first delivered file instead (cheap, keeps the exec spine linear —
# gate 1 ignores the content when web_class is false).
ENTRY_ARGS_CODE = """
g = gate0_out or {}
files = g.get("files") or []
target = str(g.get("entrypoint") or (files[0] if files else ""))
ws = str(workspace_root or "").strip()
path = target
if ws and target and not target.startswith("/"):
    path = ws.rstrip("/") + "/" + target
return {
    "name": "read_file",
    "arguments": {"file_path": path, "should_read_entire_file": True},
    "call_id": "gate-entrypoint-read",
}
""".strip()

# G1 INTEGRATION (web class only): every local FILE reference in the
# entrypoint's markup must resolve to a delivered file, and .js siblings must
# actually be loaded by the entrypoint. Catches both R-Type coding-agent
# failures deterministically (split-brain dead game.js, dangling refs) — no
# browser, no LLM judgment involved. Red-team-hardened (2026-07-17): the
# attribute scan runs on MARKUP ONLY (script/style bodies stripped, so
# `img.src = "x.png"` inside inline JS never counts), attribute matches
# require a token boundary (`data-src=` is not `src=`), only RELATIVE refs
# with a file extension count as dependencies (`href="/about"` routes are the
# probe's territory, not G1's), and orphan flagging skips files mentioned
# anywhere in the entrypoint text (inline `import "./game.js"`) plus
# well-known non-browser names (server.js, *.config.js, tests).
GATE1_CODE = """
g = gate0_out or {}
web = bool(g.get("web_class"))
files = [str(f) for f in (g.get("files") or [])]
entry = str(g.get("entrypoint") or "")
failures = []
# Defined here so the main_script pass below is safe when the entrypoint
# read failed (the reference list stays empty on that branch).
local = []
if web and entry:
    if not bool(entry_ok):
        failures.append("integration: could not read entrypoint " + entry + " for the reference check: " + str(entry_content or ""))
    else:
        text = str(entry_content or "")
        low_text = text.lower()
        # Markup-only scan text: keep <script>/<style> OPENING TAGS (their
        # src= attributes are real references) but drop their BODIES.
        scan_parts = []
        i = 0
        while i < len(text):
            s_script = low_text.find("<script", i)
            s_style = low_text.find("<style", i)
            starts = [x for x in (s_script, s_style) if x >= 0]
            if not starts:
                scan_parts.append(text[i:])
                break
            s = min(starts)
            tag_end = text.find(">", s)
            if tag_end < 0:
                scan_parts.append(text[i:])
                break
            scan_parts.append(text[i:tag_end + 1])
            closer = "</script" if s == s_script else "</style"
            close = low_text.find(closer, tag_end)
            if close < 0:
                break
            i = close
        scan_text = "".join(scan_parts)
        low_scan = scan_text.lower()
        # Attribute names are case-insensitive and values may be unquoted:
        # scan the lowercased markup for positions, slice values from the
        # original; require a token boundary before the attribute name.
        refs = []
        for attr in ("src", "href"):
            pos = 0
            needle = attr + "="
            while True:
                i2 = low_scan.find(needle, pos)
                if i2 < 0:
                    break
                j = i2 + len(needle)
                before = low_scan[i2 - 1] if i2 > 0 else " "
                if before.isalnum() or before in "-_.:":
                    pos = j
                    continue
                if j >= len(scan_text):
                    break
                if scan_text[j] == '"' or scan_text[j] == "'":
                    q = scan_text[j]
                    k = scan_text.find(q, j + 1)
                    if k > j:
                        refs.append(scan_text[j + 1:k])
                        pos = k + 1
                        continue
                    pos = j + 1
                else:
                    k = j
                    while k < len(scan_text) and scan_text[k] not in " \\t\\r\\n>":
                        k = k + 1
                    if k > j:
                        refs.append(scan_text[j:k])
                    pos = k
        # Keep only refs that name a local FILE dependency: relative path
        # with an extension-bearing basename. Root-absolute and extensionless
        # refs (routes, anchors) are runtime concerns the probe observes as
        # failed_requests — never deterministic G1 failures.
        local = []
        for r in refs:
            r2 = str(r).strip()
            if not r2 or r2.startswith("#"):
                continue
            low = r2.lower()
            skip = False
            for pref in ("http://", "https://", "data:", "//", "mailto:", "javascript:", "tel:", "blob:", "about:"):
                if low.startswith(pref):
                    skip = True
                    break
            if skip:
                continue
            r2 = r2.split("?")[0].split("#")[0]
            if r2.startswith("./"):
                r2 = r2[2:]
            if not r2 or r2.startswith("/"):
                continue
            base = r2.rsplit("/", 1)[-1]
            if "." not in base:
                continue
            local.append(r2)
        fileset = set(files)
        lower_files = {}
        for f in files:
            lower_files[f.lower()] = f
        entry_dir = entry.rsplit("/", 1)[0] + "/" if "/" in entry else ""
        for r in local:
            if r in fileset:
                continue
            if entry_dir and (entry_dir + r) in fileset:
                continue
            case_hit = lower_files.get(r.lower()) or (lower_files.get((entry_dir + r).lower()) if entry_dir else None)
            if case_hit:
                failures.append("integration: entrypoint " + entry + " references '" + r + "' but the file is named '" + case_hit + "' — case mismatch breaks on case-sensitive hosts")
            else:
                failures.append("integration: entrypoint " + entry + " references '" + r + "' which does not exist in the workspace")
        # Split-brain orphans: only when the entrypoint loads NO local script,
        # and only for files that are browser-lane candidates — never named
        # anywhere in the entrypoint (an inline `import "./x.js"` counts as a
        # mention; the probe still owns runtime truth) and not a well-known
        # non-browser sibling.
        js_files = [f for f in files if f.lower().endswith(".js")]
        js_refs = [r for r in local if r.lower().endswith(".js")]
        if js_files and not js_refs:
            for f in js_files:
                base = f.rsplit("/", 1)[-1].lower()
                if base in ("server.js", "karma.conf.js", "gulpfile.js", "gruntfile.js"):
                    continue
                if base.endswith(".config.js") or ".test." in base or ".spec." in base or base.endswith(".min.js"):
                    continue
                if base and base in low_text:
                    continue
                failures.append("integration: '" + f + "' exists but the entrypoint never loads or mentions it — split-brain risk (add <script src=\\"" + f + "\\"></script> to " + entry + " or fold its code inline and delete the file)")
# First referenced local script (workspace-relative) — read by the orphan
# gate (G4) so split builds get their main script analyzed too.
main_script = ""
if web and entry:
    fileset2 = set(files)
    entry_dir2 = entry.rsplit("/", 1)[0] + "/" if "/" in entry else ""
    for r in local:
        if not r.lower().endswith(".js"):
            continue
        if r in fileset2:
            main_script = r
        elif entry_dir2 and (entry_dir2 + r) in fileset2:
            main_script = entry_dir2 + r
        if main_script:
            break
return {
    "integration_ok": len(failures) == 0,
    "failures": failures,
    "main_script": main_script,
}
""".strip()

# Compose the read_file call for the main referenced script (G4 input).
# No script (single-file build) composes an empty path — the tool errors,
# G4 sees script_ok=false and analyzes the entrypoint alone.
SCRIPT_ARGS_CODE = """
g1 = gate1_out or {}
target = str(g1.get("main_script") or "")
ws = str(workspace_root or "").strip()
path = target
if ws and target and not target.startswith("/"):
    path = ws.rstrip("/") + "/" + target
return {
    "name": "read_file",
    "arguments": {"file_path": path, "should_read_entire_file": True},
    "call_id": "gate-main-script-read",
}
""".strip()

# G4 ORPHAN FUNCTIONS (class 4 of the R-Type taxonomy, code's c2958 ask 2):
# a function DECLARED in the delivered code whose identifier appears exactly
# ONCE (the declaration itself) is dead code or a missing call — the
# spawnBoss progression-deadlock class (defined-never-invoked, zero errors
# thrown). Deliberately conservative: any second reference (call, handler
# assignment, string mention, recursion) passes; declarations only (arrow
# consts out of v1 scope); count runs over entrypoint + main script combined
# so cross-file calls resolve.
GATE4_CODE = """
g0 = gate0_out or {}
web = bool(g0.get("web_class"))
failures = []
if web:
    ident_chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$"
    text = str(entry_content or "")
    if bool(script_ok) and script_content:
        text = text + "\\n" + str(script_content)
    # Collect declared function names: 'function NAME('.
    decls = []
    pos = 0
    while True:
        i = text.find("function", pos)
        if i < 0:
            break
        before = text[i - 1] if i > 0 else " "
        j = i + len("function")
        if before in ident_chars or (j < len(text) and text[j] in ident_chars):
            pos = j
            continue
        while j < len(text) and text[j] in " \\t":
            j = j + 1
        name = ""
        k = j
        while k < len(text) and text[k] in ident_chars:
            name = name + text[k]
            k = k + 1
        while k < len(text) and text[k] in " \\t":
            k = k + 1
        if name and k < len(text) and text[k] == "(":
            decls.append(name)
        pos = k if k > pos else pos + 1
    # Count boundary-checked occurrences of each declared name.
    seen = set()
    for name in decls:
        if name in seen or len(name) < 2:
            continue
        seen.add(name)
        count = 0
        pos = 0
        while True:
            i = text.find(name, pos)
            if i < 0:
                break
            before = text[i - 1] if i > 0 else " "
            after_idx = i + len(name)
            after = text[after_idx] if after_idx < len(text) else " "
            if before not in ident_chars and after not in ident_chars:
                count = count + 1
            pos = i + len(name)
        if count <= 1:
            failures.append("orphan-function: '" + name + "' is declared but never referenced anywhere in the delivered code — dead code or a missing call (logic depending on it will never run). Call it where the game flow needs it, or delete it")
return {
    "orphans_ok": len(failures) == 0,
    "failures": failures,
}
""".strip()

# Compose the read_file call for SELFCHECK.md (G5 input). A missing file
# returns an error string with success=false — gate5 treats that as the
# advisory "unattested" case, never a failure.
SELFCHECK_ARGS_CODE = """
ws = str(workspace_root or "").strip()
path = (ws.rstrip("/") + "/" + "SELFCHECK.md") if ws else "SELFCHECK.md"
return {
    "name": "read_file",
    "arguments": {"file_path": path, "should_read_entire_file": True},
    "call_id": "gate-selfcheck-read",
}
""".strip()

# Compose the hash-recompute call for the files SELFCHECK.md attests
# (R3, memgraph forensics 2026-07-21). Claimed paths are parsed from the
# ARTIFACT-SHA256 lines, sanitized (single-quoted in the command; paths
# carrying quote/control characters are skipped and will surface through
# gate5 as unbound claims), and hashed workspace-relative via `cd <ws>` so
# gate5 can compare shasum's output paths against the claims verbatim.
# No claims (or no SELFCHECK) composes a harmless `true` no-op — the exec
# spine stays linear and gate5 keys on the SELFCHECK content, not on this
# call's output.
SELFCHECK_HASH_ARGS_CODE = """
content = str(selfcheck_content or "")
have = bool(selfcheck_ok) and len(content.strip()) > 0 and not content.startswith("Error")
ws = str(workspace_root or "").strip()
bad_chars = "'" + '"' + "\\\\" + "\\n" + "\\r" + "`"
paths = []
if have:
    for ln in content.split("\\n"):
        s = ln.strip()
        if not s.startswith("ARTIFACT-SHA256:"):
            i = 0
            while i < len(s) and s[i].isdigit():
                i = i + 1
            if i > 0 and i < len(s) and s[i] == ":":
                s = s[i + 1:].lstrip()
        if not s.startswith("ARTIFACT-SHA256:"):
            continue
        rest = s[len("ARTIFACT-SHA256:"):].strip()
        bits = [b for b in rest.split(" ") if b]
        if len(bits) < 2:
            continue
        p = " ".join(bits[:-1]).strip()
        if p.startswith("./"):
            p = p[2:]
        if not p or p.startswith("/") or p.startswith("-"):
            continue
        bad = False
        for c in p:
            if c in bad_chars:
                bad = True
                break
        if bad:
            continue
        if p.rsplit("/", 1)[-1].lower() == "selfcheck.md":
            continue
        if p not in paths:
            paths.append(p)
# ADR-0026: hash EVERY declared artifact; a [:16] slice left artifacts
# 17+ unbound to their SELFCHECK.md hashes, i.e. silently unverified.
if not paths:
    return {
        "name": "execute_command",
        "arguments": {"command": "true"},
        "call_id": "gate-selfcheck-hash-noop",
    }
quoted = []
for p in paths:
    quoted.append("'" + p + "'")
# ws is operator/gateway config (not builder-authored), but a workspace path
# carrying a single quote would break the cd quoting and leave shasum running
# in the wrong directory (self-review 2026-07-21). Escape embedded quotes with
# the POSIX close/quote/reopen idiom so the cd is always well-formed; the paths
# themselves already refuse embedded quotes via bad_chars above.
ws_q = ws.replace("'", "'" + "\\\\" + "''") if ws else ""
prefix = ("cd '" + ws_q + "' && ") if ws else ""
cmd = prefix + "shasum -a 256 -- " + " ".join(quoted)
return {
    "name": "execute_command",
    "arguments": {"command": cmd},
    "call_id": "gate-selfcheck-hash",
}
""".strip()

# G5 HASH-BOUND SELFCHECK (R3, memgraph forensics 2026-07-21 — root-cause
# classes 1+5, and the F2 intra-round tripwire): SELFCHECK.md must END with
# `ARTIFACT-SHA256: <path> <sha256>` lines computed AFTER the final edit.
# This gate recomputes the hashes against the delivered bytes:
#   - SELFCHECK missing entirely      -> advisory WARNING (never a failure).
#   - present but no binding lines    -> failures[] (unbound self-report).
#   - hash mismatch                   -> failures[] naming the mechanism
#     ("artifact modified after last self-verification") — the r3 timeline
#     (SELFCHECK written 15:32, artifact rewritten 15:35) becomes a caught,
#     repairable gate failure instead of a shipped stale all-green report.
#   - host cannot hash (no shasum)    -> #FALLBACK warning, never a failure.
# Recomputed hashes are parsed from the shasum output text regardless of the
# call's success flag: shasum exits non-zero when ONE claimed file is missing
# yet still prints hashes for the rest — parse-what-ran, warn only when
# nothing parsed.
GATE5_CODE = """
content = str(selfcheck_content or "")
have = bool(selfcheck_ok) and len(content.strip()) > 0 and not content.startswith("Error")
failures = []
warnings = []
claims = []
hexchars = "0123456789abcdef"
if not have:
    warnings.append("selfcheck: SELFCHECK.md not found in the workspace - the builder's self-verification is unattested (advisory only, not a failure)")
else:
    for ln in content.split("\\n"):
        s = ln.strip()
        if not s.startswith("ARTIFACT-SHA256:"):
            i = 0
            while i < len(s) and s[i].isdigit():
                i = i + 1
            if i > 0 and i < len(s) and s[i] == ":":
                s = s[i + 1:].lstrip()
        if not s.startswith("ARTIFACT-SHA256:"):
            continue
        rest = s[len("ARTIFACT-SHA256:"):].strip()
        bits = [b for b in rest.split(" ") if b]
        if len(bits) < 2:
            failures.append("self-report unbound: malformed ARTIFACT-SHA256 line in SELFCHECK.md ('" + s + "') - required format: 'ARTIFACT-SHA256: <workspace-relative-path> <sha256>'")
            continue
        p = " ".join(bits[:-1]).strip()
        if p.startswith("./"):
            p = p[2:]
        h = bits[-1].strip().lower()
        ok_hex = len(h) == 64
        if ok_hex:
            for c in h:
                if c not in hexchars:
                    ok_hex = False
                    break
        if not ok_hex:
            failures.append("self-report unbound: ARTIFACT-SHA256 line for '" + p + "' does not carry a valid sha256 (64 hex chars) - recompute it with: shasum -a 256 " + p)
            continue
        if p.rsplit("/", 1)[-1].lower() == "selfcheck.md":
            continue
        claims.append([p, h])
    if not claims and not failures:
        failures.append("self-report unbound: SELFCHECK.md carries no ARTIFACT-SHA256 binding lines - after your FINAL edit, append one line per claimed file: 'ARTIFACT-SHA256: <workspace-relative-path> <sha256>' (compute with execute_command: shasum -a 256 <path>)")
if claims:
    recomputed = {}
    # Shape-robust text extraction (live-found, first 0.2.4 gateway run):
    # the approval-resume lane delivers call_tool results as the
    # {mode, results:[{output:{stdout,...}}]} ENVELOPE while the direct
    # lane delivers the output dict, and older shapes are plain strings.
    # Fold stdout/stderr strings out of any of those (gate3's raw-unwrap
    # pattern, generalized).
    parts = []
    stack = [hash_output]
    guard = 0
    while stack and guard < 64:
        guard = guard + 1
        x = stack.pop()
        if x is None:
            continue
        if isinstance(x, str):
            if x:
                parts.append(x)
        elif isinstance(x, dict):
            # stdout/stderr direct, else the *_preview twins: the runtime
            # COMPACTS persisted tool results (durable result_key copies keep
            # only stdout_preview/stderr_preview — live-found, third 0.2.4
            # gateway run). Hash listings are tiny (<=16 lines), so an
            # untruncated preview is the full text; a truncated one surfaces
            # through gate5 as an unbound claim rather than a silent pass.
            got_out = False
            for k in ["stdout", "stderr"]:
                v = x.get(k)
                if isinstance(v, str) and v:
                    parts.append(v)
                    got_out = True
            if not got_out:
                for k in ["stdout_preview", "stderr_preview"]:
                    v = x.get(k)
                    if isinstance(v, str) and v:
                        parts.append(v)
            for k in ["output", "results", "result", "payload"]:
                v = x.get(k)
                if isinstance(v, str):
                    if k == "output" and v:
                        parts.append(v)
                elif v is not None:
                    stack.append(v)
        elif isinstance(x, list):
            for v in x:
                stack.append(v)
    hash_text = "\\n".join(parts)
    for ln in hash_text.split("\\n"):
        s = ln.strip()
        if not s:
            continue
        sp = s.find(" ")
        if sp <= 0:
            continue
        h2 = s[:sp].strip().lower()
        p2 = s[sp:].strip()
        if p2.startswith("*"):
            p2 = p2[1:]
        if p2.startswith("./"):
            p2 = p2[2:]
        if len(h2) == 64:
            recomputed[p2] = h2
    # Distinguish HOST-can't-hash (tooling absent → honest #FALLBACK, never a
    # failure) from FILES-can't-be-hashed (the builder attested a file that is
    # not there → a real binding failure). The old blanket "recomputed empty
    # -> #FALLBACK" wrongly blamed the host when the true cause was a claim
    # for a nonexistent file (self-review 2026-07-21): an all-phantom claim
    # slipped through as advisory while a mixed real+phantom claim failed —
    # inconsistent, and the warning misattributed the cause. Now the per-claim
    # loop always runs; only a genuine tooling signal (no output at all, or a
    # "command not found"-class message from a broken cd / missing shasum)
    # degrades to #FALLBACK.
    low = hash_text.lower()
    host_cant_hash = (not hash_text.strip()) or ("command not found" in low) or ("not recognized" in low)
    if host_cant_hash:
        warnings.append("selfcheck: could not recompute artifact hashes on this host (" + hash_text.strip() + ") - hash binding unchecked (#FALLBACK)" if hash_text.strip() else "selfcheck: could not recompute artifact hashes on this host (no output) - hash binding unchecked (#FALLBACK)")
    else:
        for pair in claims:
            p = pair[0]
            h = pair[1]
            rh = recomputed.get(p)
            if not rh:
                failures.append("self-report unbound: SELFCHECK.md attests '" + p + "' but that file could not be hashed (missing or unreadable in the workspace) - the attestation does not bind to a delivered file")
            elif rh != h:
                failures.append("self-report stale: SELFCHECK.md attests different bytes than the delivered " + p + " - the artifact was modified after the last self-verification; re-verify and regenerate SELFCHECK.md (with fresh ARTIFACT-SHA256 lines) after your final edit")
return {
    "selfcheck_ok": len(failures) == 0,
    "present": have,
    "claims": len(claims),
    "failures": failures,
    "warnings": warnings,
}
""".strip()

# G6 DOM ID CONTRACT (memgraph forensics 2026-07-21, root-cause class 4 —
# the exact r3 defect): every element id the script references
# (getElementById('x'), querySelector('#x'), $('#x'), ...) must exist in the
# delivered markup. The r3 wreck was ONE dangling '#timeRange' selector after
# a markup-side rename; across all 12 benchmark artifacts this check flags
# exactly that one violation. Pure text scan, no browser, no LLM.
# Design: the DEFINED-id collection deliberately over-collects (id=...
# attributes anywhere including JS template strings, el.id assignments,
# setAttribute('id', ...)) — extra defined ids only reduce sensitivity and
# can never create a false dangling-ref report. The REFERENCE collection is
# conservative: quoted '#ident' literals passed to a call (char before the
# opening quote must be '(' or ','), hex-color-shaped tokens skipped.
GATE_DOM_CODE = """
g0 = gate0_out or {}
web = bool(g0.get("web_class"))
failures = []
defined = set()
refs = []
if web:
    idset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-$"
    text = str(entry_content or "")
    if bool(script_ok) and script_content:
        text = text + "\\n" + str(script_content)
    low = text.lower()
    n = len(text)
    # Defined ids: id=... (markup attributes, JS-built markup strings, and
    # el.id = '...' assignments — '.' before is accepted as a definition).
    pos = 0
    while True:
        i = low.find("id", pos)
        if i < 0:
            break
        pos = i + 2
        before = low[i - 1] if i > 0 else " "
        if before.isalnum() or before in "-_":
            continue
        k = i + 2
        while k < n and text[k] in " \\t":
            k = k + 1
        if k >= n or text[k] != "=":
            continue
        k = k + 1
        while k < n and text[k] in " \\t":
            k = k + 1
        if k >= n:
            break
        q = text[k]
        name = ""
        if q == "\\"" or q == "'":
            j = k + 1
            while j < n and text[j] != q:
                name = name + text[j]
                j = j + 1
        else:
            j = k
            while j < n and text[j] in idset:
                name = name + text[j]
                j = j + 1
        name = name.strip()
        if name:
            ok_id = True
            for c in name:
                if c not in idset:
                    ok_id = False
                    break
            if ok_id:
                defined.add(name)
    # Defined ids: setAttribute('id', 'x').
    pos = 0
    while True:
        i = text.find("setAttribute", pos)
        if i < 0:
            break
        pos = i + 12
        k = i + 12
        while k < n and text[k] in " \\t":
            k = k + 1
        if k >= n or text[k] != "(":
            continue
        k = k + 1
        while k < n and text[k] in " \\t":
            k = k + 1
        if k + 3 < n and (text[k] == "'" or text[k] == "\\"") and text[k + 1:k + 3] == "id" and text[k + 3] == text[k]:
            k = k + 4
            while k < n and text[k] in " \\t,":
                k = k + 1
            if k < n and (text[k] == "'" or text[k] == "\\""):
                q = text[k]
                j = k + 1
                name = ""
                while j < n and text[j] != q:
                    name = name + text[j]
                    j = j + 1
                if name:
                    defined.add(name)
    # Referenced ids, lane 1: getElementById('x') with a string literal.
    pos = 0
    while True:
        i = text.find("getElementById", pos)
        if i < 0:
            break
        pos = i + 14
        k = i + 14
        while k < n and text[k] in " \\t":
            k = k + 1
        if k >= n or text[k] != "(":
            continue
        k = k + 1
        while k < n and text[k] in " \\t":
            k = k + 1
        if k >= n or (text[k] != "'" and text[k] != "\\""):
            continue
        q = text[k]
        j = k + 1
        name = ""
        while j < n and text[j] != q:
            name = name + text[j]
            j = j + 1
        if not name or j >= n:
            continue
        ok_id = True
        for c in name:
            if c not in idset:
                ok_id = False
                break
        if ok_id and name not in refs:
            refs.append(name)
    # Referenced ids, lane 2: a quoted '#ident' selector literal passed as the
    # FIRST argument to a SELECTOR call. The receiving call must be
    # selector-shaped (querySelector/querySelectorAll/matches/closest or a
    # $-family jQuery call) — this is what makes '#x' a DOM lookup rather than
    # a URL fragment / route name / color string (F3, self-review 2026-07-21:
    # history.pushState(null,'','#level2'), ['#home','#about'], url.split('#s')
    # all matched the old any-"("/","-context rule and falsely failed correct
    # SPA hash-routing code, which — repeating identically every round — could
    # trip the stall guard and ship a STOPPED verdict for a working artifact).
    # Restricting to the selector callee also SUBSUMES the old hex-color
    # suppression: a color literal reaches a color function, never a selector,
    # so a genuinely-named id like '#fade' is no longer silently dropped (F5).
    # Backtick template literals with no ${...} are static selectors too (F4).
    # A COMMA in a selector is OR (querySelector('#a, #b') matches if EITHER
    # exists) — a missing alternative does NOT null the result, so only the
    # LEADING id is contract-bound; post-comma ids are deliberately not flagged.
    sel_suffixes = ["queryselector", "queryselectorall", "matches", "closest"]
    pos = 0
    while True:
        i = text.find("#", pos)
        if i < 0:
            break
        pos = i + 1
        if i == 0 or i + 1 >= n:
            continue
        q = text[i - 1]
        if q != "'" and q != "\\"" and q != "`":
            continue
        j = i - 2
        while j >= 0 and text[j] in " \\t":
            j = j - 1
        if j < 0 or text[j] != "(":
            continue
        # Collect the callee identifier immediately before the "(".
        c = j - 1
        while c >= 0 and text[c] in " \\t":
            c = c - 1
        callee = ""
        while c >= 0 and text[c] in idset:
            callee = text[c] + callee
            c = c - 1
        callee_low = callee.lower()
        is_selector = callee.endswith("$")
        if not is_selector:
            for suf in sel_suffixes:
                if callee_low.endswith(suf):
                    is_selector = True
                    break
        if not is_selector:
            continue
        k = i + 1
        name = ""
        while k < n and text[k] in idset:
            name = name + text[k]
            k = k + 1
        if not name or k >= n:
            continue
        nxt = text[k]
        if nxt != q and nxt not in " >.[:,+~":
            continue
        if name not in refs:
            refs.append(name)
    for name in refs:
        if len(failures) >= 8:
            break
        if name not in defined:
            failures.append("dom-contract: the script references element id '#" + name + "' (getElementById/selector) but no element with id=\\"" + name + "\\" exists in the delivered markup - the reference resolves to null at runtime (a rename applied to one side of the markup<->script contract). Add the element id or update every reference")
return {
    "dom_ok": len(failures) == 0,
    "failures": failures,
    "referenced_ids": len(refs),
    "defined_ids": len(defined),
}
""".strip()

# Compose the browser_probe tool call for web entrypoints (code's registered
# tool, agora c2769). require_nonblank stays false: canvas liveness is read
# from diag by GATE3 itself — a blank canvas always FAILS (red-team fix
# 2026-07-17); round_index only shapes the failure wording (round 0 explains
# the dark-background caveat, repeats say "still blank").
PROBE_ARGS_CODE = """
g = gate0_out or {}
entry = str(g.get("entrypoint") or "")
ws = str(workspace_root or "").strip()
path = entry
if ws and entry and not entry.startswith("/"):
    path = ws.rstrip("/") + "/" + entry
return {
    "name": "browser_probe",
    "arguments": {"target": path, "require_nonblank": False},
    "call_id": "gate-browser-probe",
}
""".strip()

# G3 EXECUTES (web): interpret the probe result. World-side signal only —
# page errors are fixable failures; a missing executor is an ENVIRONMENT
# failure (the builder cannot fix the host, the loop must stop early); a
# probe that never ran (tool absent from the registry) is the same class.
# Reads the call_tool RAW channel: the tool executor's error heuristic
# classifies a structured {ok: false} probe result as a tool failure and the
# (result, success) pins then carry only an error string — the structured
# payload (page_errors, diag, stage) survives at raw.results[0].output.
#
# TWO ACCEPTED SHAPES (drift fix 2026-07-30, operator-reported): the gate used
# to understand ONLY a structured dict at results[0].output, so a host whose
# abstractcore returns browser_probe's PASS/FAIL REPORT STRING (the shipped
# shape for every version before the {rendered, ok, stage, ...} contract)
# looked identical to "the tool is not mounted" — a real, successful, page-
# rendering probe was reported as `web execution gate unavailable ... :
# executed` (the trailing token being `mode`, since results[0].error was
# empty). The gate now reads the TEXT shape too, and every remaining
# unavailable message names WHICH branch fired.
GATE3_CODE = """
g0 = gate0_out or {}
web = bool(g0.get("web_class"))
raw = probe_raw if isinstance(probe_raw, dict) else {}
mode = str(raw.get("mode") or "")
results = raw.get("results")
first = results[0] if isinstance(results, list) and results else None
first = first if isinstance(first, dict) else {}
output = first.get("output")
r = output if isinstance(output, dict) else {}
# TEXT shape: the probe's own report, either as the whole output (older
# abstractcore) or under `rendered` beside the structured fields (current).
# The ❌-prefixed refusals/install hints never reach `output` at all - the
# executor's error heuristic moves them to results[0].error - so the error
# string is part of the text channel.
report = output if isinstance(output, str) else str(r.get("rendered") or "")
if not r and not report.strip():
    report = str(first.get("error") or "")
if not r and report.strip():
    lines = [ln.strip() for ln in report.splitlines() if ln.strip()]
    head = lines[0] if lines else ""
    p_errs = [ln[10:].strip() for ln in lines if ln.startswith("[uncaught]")]
    c_errs = [ln[7:].strip() for ln in lines if ln.startswith("[error]")]
    if head.startswith("Browser probe: PASS"):
        r = {"ok": True, "stage": "report", "page_errors": p_errs, "console_errors": c_errs}
    elif head.startswith("Browser probe: FAIL"):
        r = {"ok": False, "stage": "report", "error": head, "page_errors": p_errs, "console_errors": c_errs}
    elif "Missing dependency" in head or "Browser binary missing" in head or "could not run" in head:
        # playwright/chromium absent, or the worker never launched: the
        # builder cannot fix the host - environment, not a code defect.
        r = {"ok": False, "stage": "no-executor", "error": head}
ran = mode == "executed" and len(r) > 0
stage = str(r.get("stage") or "")
diag = r.get("diag") or {}
failures = []
env_failures = []
warnings = []
rnd = int(round_index or 0)
if web and stage == "report":
    warnings.append("probe: this host's browser_probe returns its text report only - the gate read the PASS/FAIL verdict and the page/console errors, but canvas-liveness diag (blank/partial render detection) is unavailable (#FALLBACK)")
if web:
    entry = str(g0.get("entrypoint") or "the web entrypoint")
    if not ran:
        # Name the branch. "tool missing, refused, or returned no structured
        # result" cost the operator a debugging cycle precisely because it
        # named all three at once.
        err = str(first.get("error") or "").strip()
        low = err.lower()
        if mode != "executed":
            env_failures.append("web execution gate REFUSED: the browser_probe call never executed (tool-call mode '" + (mode or "none") + "'). An unattended run must send input_data._runtime.tool_policy.auto_approve_tools including \\"browser_probe\\"; the auto_approve_max_risk_rank ceiling cannot cover it (browser_probe is model_controlled_destination, which always asks by name)")
        elif not isinstance(results, list) or not results:
            env_failures.append("web execution gate UNAVAILABLE: the probe node returned no tool result at all (mode=executed, results=[]) - either the tool_call object was never composed (flow wiring) or the executor dropped the call. Check GET /api/gateway/discovery/tools for browser_probe")
        elif "not found" in low or "unknown tool" in low or "not registered" in low:
            env_failures.append("web execution gate UNAVAILABLE: browser_probe is NOT MOUNTED in this host's tool registry (\\"" + err + "\\"). Enable abstractcore's `web` toolset; verify with GET /api/gateway/discovery/tools")
        elif "not allowed" in low or "denied" in low or "blocked" in low or "approval" in low:
            env_failures.append("web execution gate REFUSED: the browser_probe call was blocked by tool policy (\\"" + err + "\\"). Grant it via input_data._runtime.tool_policy.auto_approve_tools, or answer the approval wait")
        elif err:
            env_failures.append("web execution gate FAILED: browser_probe returned an error instead of a result: " + err)
        else:
            env_failures.append("web execution gate UNREADABLE: browser_probe RAN but returned a result this gate cannot parse - neither a structured payload nor a 'Browser probe: PASS/FAIL' report. The result, whole: " + report)
    elif stage == "no-executor":
        env_failures.append("no browser executor available on this host to run " + entry + ": " + str(r.get("error") or "no engine"))
    else:
        # Page-level errors are DEFECTS whether or not the probe's own verdict
        # passed (fix 2026-07-30): the gate calls the probe with
        # require_nonblank=false, so a page whose script dies on a syntax error
        # still navigates and still reports "Browser probe: PASS". Harvesting
        # these only under `not ok` let exactly that class through as
        # "executes".
        # ADR-0026: EVERY page error is a defect the repair round must see —
        # 8/4/6 slices sat on these three and hid the tail of a broken page.
        for e in (r.get("page_errors") or []):
            failures.append("execute(web): uncaught exception in " + entry + ": " + str(e))
        for e in (r.get("console_errors") or []):
            failures.append("execute(web): console error in " + entry + ": " + str(e))
        # World-side dangling-asset catch (closes what G1's parser deliberately
        # skips: css url(), srcset, dynamic imports): a failed LOCAL load is a
        # real defect even when the page survives it. Cross-origin blocks are
        # reported separately by the probe (blocked_requests) and stay quiet.
        for e in (r.get("failed_requests") or []):
            failures.append("execute(web): failed resource load: " + str(e) + " — a referenced asset is missing or misnamed")
        if not bool(r.get("ok")) and not failures:
            failures.append("execute(web): browser probe failed at stage " + (stage or "?") + ": " + str(r.get("error") or "unknown"))
    if web and ran and stage != "no-executor" and bool(r.get("ok")) and not failures:
        has_canvas = bool(diag.get("has_canvas"))
        nb = int(diag.get("non_blank_samples") or 0)
        sampled = int(diag.get("sampled_pixels") or 0)
        if has_canvas and nb == 0:
            # Red-team fix (2026-07-17): blank canvas ALWAYS blocks the pass —
            # a game that renders nothing must never report PASSED (the v1
            # escape-hatch class reborn). The dark-background bias (c2736
            # caveat) is answered with actionable wording, not a free pass:
            # a legitimately dark game makes liveness visible in one cheap
            # repair (draw any HUD element), a dead one gets caught.
            msg = "execute(web): the canvas renders blank under input drive (probe diag: 0 non-blank samples)"
            if rnd > 0:
                failures.append(msg + " — still blank on round " + str(rnd + 1) + "; draw the game state onto the canvas")
            else:
                failures.append(msg + " — if the scene is legitimately dark, draw at least one visible element (score text, sprite, border) so liveness is observable; otherwise fix the render loop")
        elif has_canvas and sampled >= 100 and nb * 50 < sampled:
            # cav2 escape (code's series close, c2945): run1 slipped the
            # zero-check with literally 1 non-blank sample out of 369 — a
            # corner-ninth render (draw coordinates sized for a smaller
            # canvas), not a visible game. Demand a minimum non-blank
            # FRACTION (>=2% of a real sampling pass); genuinely sparse dark
            # games clear it with one HUD element, partial renders do not.
            # (code's grid-sampler fix, c2970, makes this fraction mean AREA.)
            failures.append("execute(web): only " + str(nb) + " of " + str(sampled) + " sampled pixels ever lit under input drive — the canvas is essentially blank (likely a corner/partial render: draw coordinates sized for a smaller canvas than " + str(diag.get("canvas_w")) + "x" + str(diag.get("canvas_h")) + "). Scale the draw code to the real canvas size and keep visible game state on screen")
        else:
            # Viewport-vs-draw-extent (class 5's second half, c2970's
            # painted_bbox: extent of non-blank samples, null when nothing
            # painted). A render confined to LESS THAN HALF the canvas in
            # BOTH dimensions is the scale-bug class (draw coordinates sized
            # for a smaller canvas — v1/run1's 160x144-into-480x432 corner
            # ninth); letterboxed/pillarboxed games keep one full dimension
            # and pass. Only fires on an otherwise-clean, painted canvas.
            bbox = diag.get("painted_bbox")
            cw = int(diag.get("canvas_w") or 0)
            ch = int(diag.get("canvas_h") or 0)
            if isinstance(bbox, dict) and cw > 0 and ch > 0:
                bw = int(bbox.get("w") or 0)
                bh = int(bbox.get("h") or 0)
                if bw > 0 and bh > 0 and bw * 2 < cw and bh * 2 < ch:
                    pw = str(int(bw * 100 / cw))
                    ph = str(int(bh * 100 / ch))
                    failures.append("execute(web): the painted area covers only " + pw + "% x " + ph + "% of the " + str(cw) + "x" + str(ch) + " canvas (painted extent " + str(bw) + "x" + str(bh) + ") — the draw code is sized for a smaller canvas; scale positions and sprite sizes to the real canvas dimensions")
executes_web = web and ran and stage != "no-executor" and bool(r.get("ok")) and len(failures) == 0
return {
    "web": web,
    "ran": ran,
    "stage": stage,
    "probe_ok": bool(r.get("ok")),
    "executes_web": executes_web,
    # Branch flag: only FIXABLE probe failures short-circuit to the fail-fast
    # verdict; environment-only outcomes still run the verifier for the
    # builds/matches gates (the merge folds the env failures in regardless).
    "fixable_failed": len(failures) > 0,
    "failures": failures,
    "environment_failures": env_failures,
    "warnings": warnings,
    "engine": str(r.get("engine") or ""),
    "diag": diag,
}
""".strip()

# Fail-fast verdict for real probe failures (page/console errors): specific,
# fixable, no LLM needed — skip the verifier and reprompt the builder.
PROBE_VERDICT_CODE = """
g0 = gate0_out or {}
g3 = gate3_out or {}
failures = [str(f) for f in (g3.get("failures") or [])]
entry = str(g0.get("entrypoint") or "")
return {
    "failed": len(failures) > 0,
    "verdict": {
        "builds": False,
        "executes": False,
        "matches": False,
        "all_passed": False,
        "failures": failures,
        "environment_failures": [],
        "warnings": [str(w) for w in (g3.get("warnings") or [])],
        "summary": "web execution gate failed: " + "; ".join(failures),
        "artifacts": [entry] if entry else [],
        "gate_source": "deterministic+probe",
        "probe": {"engine": str(g3.get("engine") or ""), "stage": str(g3.get("stage") or ""), "diag": g3.get("diag") or {}},
        "deterministic": {
            "delivery_ok": bool(g0.get("delivery_ok")),
            "web_class": True,
            "entrypoint": entry,
            "files_count": len(g0.get("files") or []),
        },
    },
}
""".strip()

# Fold the deterministic gates into a fail verdict + branch flag. When any
# deterministic gate fails, the round fails HERE — the LLM verifier never
# runs (pay-per-failure: c2736's cost shape expressed inside the workflow).
DET_VERDICT_CODE = """
g0 = gate0_out or {}
g1 = gate1_out or {}
g4 = gate4_out or {}
g5 = gate5_out or {}
gdom = gate_dom_out or {}
failures = (
    [str(f) for f in (g0.get("failures") or [])]
    + [str(f) for f in (g1.get("failures") or [])]
    + [str(f) for f in (g4.get("failures") or [])]
    + [str(f) for f in (gdom.get("failures") or [])]
    + [str(f) for f in (g5.get("failures") or [])]
)
warnings = [str(w) for w in (g5.get("warnings") or [])]
failed = len(failures) > 0
entry = str(g0.get("entrypoint") or "")
arts = [entry] if entry else [str(f) for f in (g0.get("files") or [])]  # ADR-0026: no [:5]
summary = "deterministic gates failed before verification: " + "; ".join(failures) if failed else "deterministic gates passed"
return {
    "failed": failed,
    "verdict": {
        "builds": False,
        "executes": False,
        "matches": False,
        "all_passed": False,
        "failures": failures,
        "environment_failures": [],
        "warnings": warnings,
        "summary": summary,
        "artifacts": arts if failed else [],
        "gate_source": "deterministic",
        "deterministic": {
            "delivery_ok": bool(g0.get("delivery_ok")),
            "integration_ok": bool(g1.get("integration_ok")),
            "orphans_ok": bool(g4.get("orphans_ok", True)),
            "dom_ok": bool(gdom.get("dom_ok", True)),
            "selfcheck_bound": bool(g5.get("selfcheck_ok", True)),
            "web_class": bool(g0.get("web_class")),
            "entrypoint": entry,
            "files_count": len(g0.get("files") or []),
        },
    },
}
""".strip()

# Merge the LLM verifier's verdict with the deterministic + probe context.
# The belt (all_passed only if every gate is true) lives HERE, outside the
# LLM. For web artifacts the EXECUTES gate is decided by the probe's
# world-side result — the LLM's opinion of executability never overrides the
# browser (the v1 defect inverted). Missing artifacts fall back to the
# deterministic listing so the report always names the delivered files.
#
# VERIFIER-DEATH FOLD (memgraph hackathon post-mortem 2026-07-20): a verifier
# whose agent subrun DIED (LLM effect failure after retries) resumes this run
# with success=false and NO data — indistinguishable, before this fold, from
# a verifier that REPORTED failure, except that every gate reads false with
# an EMPTY failures list. That empty-failures non-verdict burned repair
# rounds reprompting the builder over nothing and ended runs "failed" over
# delivered, gate-passing artifacts. A dead verifier is the "cannot verify
# here" class, not a code defect: fold it into environment_failures (the
# loop's early-stop lane) carrying the deterministic PASS evidence, and never
# fabricate either a pass (nothing was verified) or a fixable failure
# (nothing failed).
MERGE_VERDICT_CODE = """
v = verifier_data if isinstance(verifier_data, dict) else {}
g0 = gate0_out or {}
g1 = gate1_out or {}
g3 = gate3_out or {}
g5 = gate5_out or {}
web = bool(g0.get("web_class"))
# A verifier that RAN always returns the strict-schema keys (all fields are
# required); a verdict carrying neither gate key is a verifier that DIED or
# returned nothing parseable — "delivered, not verifiable", never "failed".
verdict_missing = ("builds" not in v) and ("all_passed" not in v)
if verdict_missing:
    env_failures = [str(f) for f in (g3.get("environment_failures") or [])]
    note = str(verifier_response or "").strip()
    if verifier_ok is False:
        cause = "the verifier agent failed before returning a verdict"
    else:
        cause = "the verifier returned no parseable verdict"
    passed_gates = "delivery, integration"
    if web and bool(g3.get("executes_web")):
        passed_gates = passed_gates + ", browser probe"
    env_failures.append(
        "verification unavailable: " + cause
        + ((": " + note) if note else "")
        + " — deterministic gates (" + passed_gates + ") passed; the artifact is delivered but could not be independently verified here"
    )
    entry = str(g0.get("entrypoint") or "")
    arts = [entry] if entry else [str(f) for f in (g0.get("files") or [])]  # ADR-0026: no [:5]
    return {
        "builds": False,
        "executes": bool(g3.get("executes_web")) if web else False,
        "matches": False,
        "all_passed": False,
        "failures": [],
        "environment_failures": env_failures,
        "warnings": [str(w) for w in (g3.get("warnings") or [])] + [str(w) for w in (g5.get("warnings") or [])],
        "build_error": "",
        "run_error": "",
        "mismatch": "",
        "summary": "delivered, verification incomplete: the deterministic gates passed but the LLM verifier died before reporting",
        "artifacts": arts,
        "verifier_died": True,
        "delivered": bool(g0.get("delivery_ok")),
        "gate_source": ("deterministic+probe" if web else "deterministic") + " (verifier unavailable)",
        "probe": {"engine": str(g3.get("engine") or ""), "stage": str(g3.get("stage") or ""), "diag": g3.get("diag") or {}} if web else {},
        "deterministic": {
            "delivery_ok": bool(g0.get("delivery_ok")),
            "integration_ok": bool(g1.get("integration_ok")),
            "web_class": web,
            "entrypoint": entry,
            "files_count": len(g0.get("files") or []),
        },
    }
builds = bool(v.get("builds"))
matches = bool(v.get("matches"))
failures = v.get("failures") or []
if not isinstance(failures, list):
    failures = [str(failures)]
failures = [str(f) for f in failures]
env_failures = v.get("environment_failures") or []
if not isinstance(env_failures, list):
    env_failures = [str(env_failures)]
env_failures = [str(f) for f in env_failures]
# R4 fold (memgraph forensics 2026-07-21): the verifier's own per-feature
# enumeration is BINDING — any entry it marked depends_on_input=false becomes
# a failures[] line naming the mechanism and belts matches=false. A feature
# that is present but vacuous can never ride a matches=true verdict. String
# "false"/"no"/0 all coerce to false (tool-arg coercion class, 2026-02-20
# note; F6 self-review 2026-07-21). A MISSING/unrecognized depends_on_input
# does not fail the verdict (the verifier that judged a feature vacuous also
# sets matches=false itself), but it IS surfaced as a coverage warning so the
# gap is visible rather than silently passing.
fchecks = v.get("feature_checks") or []
if not isinstance(fchecks, list):
    fchecks = []
warnings = [str(w) for w in (g3.get("warnings") or [])]
for w in (g5.get("warnings") or []):
    if str(w) not in warnings:
        warnings.append(str(w))
falsey = ["false", "no", "0"]
truthy = ["true", "yes", "1"]
for fc in fchecks:
    if not isinstance(fc, dict):
        continue
    dep = fc.get("depends_on_input")
    # str() normalization covers every JSON shape uniformly: bool False ->
    # "false", int 0 -> "0", the string forms directly; True/1/yes -> pass.
    # A MISSING field (None) or an unrecognized token is neither -> a coverage
    # warning, not a verdict failure.
    dep_norm = "(missing)" if dep is None else str(dep).strip().lower()
    dep_false = dep_norm in falsey
    dep_known = dep_false or (dep_norm in truthy)
    if dep_false:
        feat = str(fc.get("feature") or "unnamed feature").strip()
        ev = str(fc.get("evidence") or fc.get("expected_change") or "").strip()
        line = "matches: task-named feature '" + feat + "' does not depend on its input" + ((" - " + ev) if ev else "") + " - a feature that is present but vacuous is a FAILURE, not a pass"
        if line not in failures:
            failures.append(line)
        matches = False
    elif not dep_known:
        feat = str(fc.get("feature") or "unnamed feature").strip()
        w = "feature-checks: '" + feat + "' reported depends_on_input=" + (str(dep) if dep is not None else "(missing)") + " - not a clear true/false; input-dependence for this feature is UNVERIFIED (#FALLBACK)"
        if w not in warnings:
            warnings.append(w)
if web:
    # World-side truth: the probe decided executes; its environment failures
    # ride regardless of what the LLM reported.
    executes = bool(g3.get("executes_web"))
    for f in (g3.get("environment_failures") or []):
        if str(f) not in env_failures:
            env_failures.append(str(f))
else:
    executes = bool(v.get("executes"))
all_passed = builds and executes and matches and len(env_failures) == 0
arts = [str(a).strip() for a in (v.get("artifacts") or []) if str(a).strip()]
if not arts:
    entry = str(g0.get("entrypoint") or "")
    arts = [entry] if entry else [str(f) for f in (g0.get("files") or [])]  # ADR-0026: no [:5]
return {
    "builds": builds,
    "executes": executes,
    "matches": matches,
    "all_passed": all_passed,
    "failures": failures,
    "environment_failures": env_failures,
    "warnings": warnings,
    "build_error": str(v.get("build_error") or ""),
    "run_error": str(v.get("run_error") or ""),
    "mismatch": str(v.get("mismatch") or ""),
    "summary": str(v.get("summary") or ""),
    "artifacts": arts,
    "feature_checks": fchecks,
    "gate_source": "verifier+deterministic+probe" if web else "verifier+deterministic",
    "probe": {"engine": str(g3.get("engine") or ""), "stage": str(g3.get("stage") or ""), "diag": g3.get("diag") or {}} if web else {},
    "deterministic": {
        "delivery_ok": bool(g0.get("delivery_ok")),
        "integration_ok": bool(g1.get("integration_ok")),
        "web_class": web,
        "entrypoint": str(g0.get("entrypoint") or ""),
        "files_count": len(g0.get("files") or []),
    },
}
""".strip()

LOOP_CONDITION_CODE = """
state = loop_state or {}
completed = int(state.get("rounds_completed", 0) or 0)
max_rounds_value = max(1, int(max_rounds or 1))
passed = bool(state.get("all_passed"))
# Environment failures (no executor on the host) are not fixable by the
# builder: reprompting over them burns rounds for nothing. Stop early when
# the ONLY failures left are environmental; keep going while any fixable
# failure remains.
fixable = state.get("failures") or []
environmental = state.get("environment_failures") or []
environment_blocked = completed > 0 and len(environmental) > 0 and len(fixable) == 0
# R1 stall guard (memgraph forensics 2026-07-21): two consecutive identical
# normalized failure sets = the loop is not converging; a third identical
# round cannot help — with R2 the best snapshot is delivered instead of
# burning it. next_state RESETS the counter when it escalates to the one
# bounded rebuild (R5), so this guard only ends the run once that escape is
# spent. Sibling of the environment-blocked early stop.
same_sig = int(state.get("same_signature_count", 0) or 0)
stalled = same_sig >= 2
# Continue while the last round did NOT fully pass and we still have budget.
condition = (not passed) and (not environment_blocked) and (not stalled) and completed < max_rounds_value
return {
    "condition": condition,
    "rounds_completed": completed,
    "max_rounds": max_rounds_value,
    "all_passed": passed,
    "stalled": stalled,
}
""".strip()

# --- 0.2.5: the steer drain + the per-round progress line -------------------
# THE STEER HOOK. `Runtime.steer()` (the gateway's `inject_guidance` command)
# appends to the steer sidecar; the run's own tick drains pending messages
# into `_runtime.inbox` at the next iteration boundary. This node reads that
# inbox at the TOP OF EVERY ROUND and folds unseen messages into `cg.steering`,
# which the builder prompt carries into the round it is about to run.
#
# Dedup is a run-owned WATERMARK (`cg.steer_seen` = how many inbox entries
# this loop has consumed) — the loop NEVER mutates `_runtime.inbox`, so the
# runtime stays its single writer. The shrink guard covers a host that resets
# the inbox itself (the abstractagent loops clear theirs): a smaller inbox
# than the watermark means a fresh list, not messages to skip forever.
STEER_FOLD_CODE = """
items = inbox if isinstance(inbox, list) else []
seen = int(steer_seen or 0)
if seen > len(items):
    seen = 0
notes = str(steering or "")
added = 0
for m in items[seen:]:
    text = ""
    if isinstance(m, dict):
        c = m.get("content")
        text = str(c) if c is not None else ""
    else:
        text = str(m or "")
    text = text.strip()
    if text:
        notes = notes + ("\\n" if notes else "") + "- " + text
        added = added + 1
return {"steering": notes, "seen": len(items), "fresh": added}
""".strip()

# One run-visible line per round, same contract shape as the multiagent
# pipeline's "build cycle N of M" (a stable prefix any client can render
# without knowing this workflow). The sentence and both case words are
# editable pin defaults with {{slots}}.
ROUND_LINE_CODE = """
state = loop_state or {}
n = int(state.get("rounds_completed", 0) or 0) + 1
mx = max(1, int(max_rounds or 1))
mode = str(state.get("mode") or "")
if not mode:
    mode = "build" if n == 1 else "repair"
note = mode
if int(fresh_steers or 0) > 0:
    note = str(steer_word or "") + note
msg = str(line_text or "")
msg = msg.replace("{{n}}", str(n)).replace("{{max}}", str(mx)).replace("{{note}}", note)
return {"message": msg}
""".strip()

ROUND_LINE_TEXT = "coding round {{n}} of {{max}}: {{note}}"
ROUND_STEER_WORD = "steering applied — "

# Build the builder's prompt from the request + loop state. 0.2.4 (memgraph
# forensics, ARCHITECTURE.md §5 R1/R5): the prompt now BRANCHES on
# loop_state.mode —
#   build   (round 0)          — full delivery+engineering rules + profiling.
#   repair  (fixable failures) — mechanically DIFFERENT from a build round:
#                                consumes last_verdict (artifact name, verbatim
#                                error fields, probe diag), scopes the work to
#                                grep-able tokens extracted from the failure
#                                text, FORBIDS write_file rewrites, and carries
#                                cross-round memory (last_attempt_summary).
#   rebuild (one escalation)   — build branch + "do not reproduce the failed
#                                design" (design-level failures only, R5).
# C8's SELFCHECK instruction now demands ARTIFACT-SHA256 binding lines (R3):
# the verify subflow's G5 recomputes them, so a post-verification rewrite is
# a caught gate failure instead of a shipped stale all-green self-report.
BUILDER_PROMPT_CODE = """
req = str(request or "").strip()
state = loop_state or {}
completed = int(state.get("rounds_completed", 0) or 0)
failures = [str(f) for f in (state.get("failures") or [])]
ws = str(workspace_root or "").strip()
verdict = state.get("last_verdict") or {}
if not isinstance(verdict, dict):
    verdict = {}
mode = str(state.get("mode") or "")
if not mode:
    mode = "build" if completed == 0 else "repair"
same = int(state.get("same_signature_count", 0) or 0)
summary = str(state.get("last_attempt_summary") or "").strip()
repair = completed > 0 and len(failures) > 0 and mode != "rebuild"
rebuild = completed > 0 and mode == "rebuild"

parts = []
parts.append("# Coding task")
parts.append(req)
# LIVE OPERATOR STEERING (0.2.5): messages the host queued through
# `inject_guidance` / `Runtime.steer()` while this run was already going.
# Placed immediately under the task because that is what they amend, and
# BEFORE the repair/rebuild blocks so a steer can redirect a repair round.
steer = str(steering or "").strip()
if steer:
    parts.append("")
    parts.append("# OPERATOR STEERING (live — arrived while this run was working; it amends the task above)")
    parts.append(steer)
    parts.append("Apply it before continuing with the round's own instructions.")
if ws:
    parts.append("")
    parts.append("Work inside the workspace root: " + ws)
if repair:
    # R1 REPAIR REFLEX: anti-repeat block first when the same failure set
    # already persisted through a previous attempt.
    if same >= 1:
        parts.append("")
        parts.append("You (or a previous round) already attempted this exact failure set and it PERSISTED. The previous approach was: " + (summary if summary else "(no account of the previous attempt survived)"))
        parts.append("Do something different in the same region; do not repeat the previous approach.")
    arts = verdict.get("artifacts") or []
    artifact = str(arts[0]).strip() if arts else ""
    probe = verdict.get("probe") or {}
    if not isinstance(probe, dict):
        probe = {}
    engine = str(probe.get("engine") or "")
    diag = probe.get("diag") or {}
    parts.append("")
    parts.append("# REPAIR ROUND - the artifact already exists. Fix it IN PLACE; do not start over.")
    if artifact:
        line = "Artifact under repair: " + artifact
        if engine:
            line = line + " (world-side probe engine: " + engine + ")"
        parts.append(line)
    if diag:
        parts.append("Probe diagnostics from the failing run: " + str(diag))
    parts.append("")
    parts.append("# Previous attempt FAILED these checks - fix EXACTLY these, do not start over:")
    for i, f in enumerate(failures, 1):
        parts.append(str(i) + ". " + f)
    build_error = str(verdict.get("build_error") or "").strip()
    run_error = str(verdict.get("run_error") or "").strip()
    mismatch = str(verdict.get("mismatch") or "").strip()
    if build_error:
        parts.append("Build error (verbatim): " + build_error)
    if run_error and run_error != "decided by browser probe":
        parts.append("Run error (verbatim): " + run_error)
    if mismatch:
        parts.append("Mismatch (verbatim): " + mismatch)
    # General-purpose region scoping: quoted strings + identifier-like tokens
    # from the failure text, minus a small stopword list of gate/English
    # vocabulary. Error text always carries identifiers - page errors,
    # tracebacks and compiler errors alike - so the tokens point at the
    # failing region for every artifact class. Noise is harmless: it only
    # orders a search.
    stop = {"the", "a", "an", "and", "or", "not", "of", "to", "in", "on", "at", "by", "for", "with", "from", "into", "is", "are", "was", "were", "be", "been", "being", "it", "its", "this", "that", "these", "those", "does", "do", "did", "done", "but", "as", "if", "then", "than", "when", "while", "no", "none", "null", "undefined", "cannot", "can", "could", "must", "never", "only", "error", "errors", "page", "console", "failed", "failure", "failures", "file", "files", "exist", "exists", "existing", "missing", "load", "loads", "loaded", "resource", "request", "requests", "web", "execute", "executes", "executed", "execution", "integration", "delivery", "orphan", "function", "functions", "declared", "referenced", "references", "reference", "workspace", "entrypoint", "code", "script", "markup", "element", "browser", "probe", "canvas", "render", "renders", "rendered", "round", "still", "blank", "under", "input", "drive", "samples", "sampled", "pixels", "area", "covers", "because", "which", "where", "your", "you", "set", "setting", "get", "getting", "properties", "property", "value", "values", "html", "htm", "http", "https", "line", "lines", "after", "before", "self", "report", "verification", "verified", "modified", "artifact", "artifacts", "delivered", "bytes", "different", "attests", "regenerate", "task", "named", "feature", "depend", "depends", "dom", "contract", "runtime", "resolves", "rename", "applied", "side", "add", "update", "intended", "gate", "gates", "check", "checks", "split", "brain", "sibling", "inline", "delete", "call", "every"}
    tokens = []
    sources = failures + [build_error, run_error, mismatch]
    for src in sources:
        text = str(src)
        for q in ("'", "\\""):
            pos = 0
            while True:
                i = text.find(q, pos)
                if i < 0:
                    break
                j = text.find(q, i + 1)
                if j < 0:
                    break
                tok = text[i + 1:j].strip()
                pos = j + 1
                if tok and len(tok) <= 60 and " " not in tok and "\\n" not in tok:
                    if tok.lower() not in stop and tok not in tokens:
                        tokens.append(tok)
        k = 0
        n = len(text)
        while k < n:
            c = text[k]
            if c.isalpha() or c == "_" or c == "$":
                t = c
                k = k + 1
                while k < n and (text[k].isalnum() or text[k] == "_" or text[k] == "$"):
                    t = t + text[k]
                    k = k + 1
                if len(t) >= 3 and t.lower() not in stop and t not in tokens:
                    tokens.append(t)
            else:
                k = k + 1
    # ADR-0026: every token from the failure text; a [:12] slice dropped the
    # ones naming the actual defect site.
    parts.append("")
    parts.append("Repair protocol (follow IN ORDER):")
    parts.append("Step 1: read " + (artifact if artifact else "the failing artifact") + " with read_file before changing anything.")
    if tokens:
        parts.append("Step 2: search_files for these tokens from the failure text: " + ", ".join(tokens) + " - the failure lives where they are used.")
    else:
        parts.append("Step 2: search_files for the identifiers named in the failure text - the failure lives where they are used.")
    parts.append("Step 3: make the SMALLEST edit_file change that fixes the named failure. Do NOT rewrite the file with write_file - a rewrite discards working code and re-rolls its bugs.")
    parts.append("Step 4: re-run your self-probe and confirm THE NAMED FAILURE no longer reproduces, then stop.")
else:
    parts.append("")
    parts.append("Delivery rules (verified mechanically after every round):")
    parts.append("- Every produced file must live in the run workspace — never /tmp or another directory.")
    parts.append("- For small web builds (games, pages, demos): prefer ONE self-contained entrypoint (index.html with inline script/styles) unless the task explicitly requires multiple files.")
    parts.append("- If you do split files, the entrypoint must actually load every sibling (script src / link href) — an unreferenced file is a delivery failure, not a bonus.")
    parts.append("- The hidden .cg_rounds/ directory is loop bookkeeping (round snapshots) — never modify it, reference it, or deliver anything from it.")
    # C1 (plan improving-code, 2026-07-21): codex-grade engineering rules. The
    # dead-temporal-ripple defect (0,0,0 samples across all three 0.2.2 runs)
    # came from code that ran WITHOUT error yet computed a constant — the class
    # these rules target. Phrased general-purpose (every coding task), not
    # graph-specific.
    parts.append("")
    parts.append("Engineering rules (a clean run is not enough — the output must be CORRECT):")
    parts.append("- Bound every traversal, recursion, and iteration with an explicit limit (max depth/hops, a per-step cap, a visited set) — an unbounded or accidentally-empty loop is a bug even when it does not crash.")
    parts.append("- Before writing logic over any data structure, VERIFY its actual shape and the DIRECTION of its references (which field points at which; source vs target; parent vs child) by inspecting a real sample — do not assume the direction from the name.")
    parts.append("- Same output for every input is BROKEN even without an error: if a feature is meant to react to its input, its result MUST change when the input changes. Never ship a function whose output is provably constant across the inputs it is supposed to respond to.")
    parts.append("- Self-probe before you finish: actually exercise the code on representative input (run it, or for a web build load it and observe) and confirm the task-named behavior is VISIBLE and VARIES — do not declare done on 'it compiles' or 'it loads'.")
    if rebuild:
        # R5 escalation: exactly one rebuild, entered when repairs did not
        # converge (same_signature_count >= 2) or the failure is design-level
        # (matches-only gap). The failed design is named so it is not
        # reproduced verbatim by a fresh agent with no memory.
        parts.append("")
        parts.append("# REBUILD ROUND (one-time escalation) - repairs did not converge; the previous DESIGN is the problem, not a single line.")
        parts.append("The previous design failed for these reasons; do NOT reproduce the same design:")
        for i, f in enumerate(failures, 1):
            parts.append(str(i) + ". " + f)
        if summary:
            parts.append("The last attempt was: " + summary)
        parts.append("Rebuild from a DIFFERENT design that avoids these failure mechanisms.")
    parts.append("")
    # C2 (plan improving-code, 2026-07-21): round-0 data profiling. Findings
    # ride as a source comment block so the verifier (and the next round) can
    # see what the input actually looked like — the antidote to logic built
    # on an assumed data shape/direction.
    parts.append("First, PROFILE the inputs before writing logic: inspect the real data/assets/parameters the task operates on (shape, ranges, reference direction, edge cases, whether fields are populated), and record what you found as a short comment block at the top of your main source file (a `PROFILE:`/`DATA NOTES:` header). Build the logic to match what you OBSERVED, not what the names suggest.")
    parts.append("Then write the code to satisfy the task. Create/edit files in the workspace. Keep it minimal and runnable.")
# C8 (plan improving-code, 2026-07-21): SELFCHECK.md evidence file. Ranked
# below the mechanical gates deliberately (a self-report is confabulation-
# aware, not proof) — it makes the builder's own verification claims
# auditable against the deterministic gates + probe.
# R3 amendment (memgraph forensics): the self-report must BIND to the bytes
# it verified via ARTIFACT-SHA256 lines — emitted in EVERY round, repair
# included: a repair MUST touch SELFCHECK with fresh hashes or G5 fails the
# round, resolving the old minimal-change-vs-regenerate-report tension
# mechanically.
parts.append("")
parts.append("Before finishing, write a SELFCHECK.md in the workspace: for EACH behavior the task named, one line stating how you verified it and the CONCRETE evidence you observed (the command you ran and its output, or the on-screen result and how it VARIED with input) — not 'looks correct'. If you could not verify something, say so plainly. This file is evidence for an independent verifier, so claims without observed evidence are worse than an honest 'unverified'.")
parts.append("MANDATORY HASH BINDING (a deterministic gate recomputes this): AFTER your FINAL edit, compute the sha256 of every file you claim (execute_command: shasum -a 256 <path>) and END SELFCHECK.md with one line per claimed file, exactly this format:")
parts.append("ARTIFACT-SHA256: <workspace-relative-path> <sha256>")
parts.append("Example: ARTIFACT-SHA256: index.html 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae")
parts.append("If ANY byte of a claimed file changes after its hash line was computed, the round FAILS ('artifact modified after last self-verification'). So: once your self-probe passes, STOP — any further edit requires re-probing AND regenerating SELFCHECK.md with fresh hash lines.")
return "\\n".join(parts)
""".strip()

# Compose the verifier's task from the request + build/run command hints +
# the deterministic gates' ground truth (files/entrypoint/class).
VERIFIER_PROMPT_CODE = """
req = str(request or "").strip()
ws = str(workspace_root or "").strip()
build_cmd = str(build_command or "").strip()
run_cmd = str(run_command or "").strip()
g0 = gate0_out or {}
g3 = gate3_out or {}
files = [str(f) for f in (g0.get("files") or [])]
web = bool(g0.get("web_class"))
entry = str(g0.get("entrypoint") or "")

parts = []
parts.append("You are an INDEPENDENT code verifier. Do NOT edit any code. Run the checks and report a structured verdict.")
parts.append("")
parts.append("## The task the code was meant to satisfy")
parts.append(req)
if ws:
    parts.append("")
    parts.append("Workspace root: " + ws)
parts.append("")
parts.append("## Ground truth already verified mechanically (do not re-derive)")
# ADR-0026: name every delivered file (a [:40] slice sat here).
parts.append("Delivered files (" + str(len(files)) + "): " + ", ".join(files))
if web:
    parts.append("Artifact class: web. Entrypoint: " + entry + ". Reference integrity already checked.")
    if bool(g3.get("ran")):
        diag = g3.get("diag") or {}
        # THREE-STATE, never fabricated (workflow-bench forensics 2026-08-01):
        # on hosts where browser_probe returns a text report, GATE3 ships NO
        # diag — and bool(diag.get("has_canvas")) minted "canvas present:
        # False" as world-side truth. multi-1 cycles 3/5/6 and multi-3 cycles
        # 4/5/6 burned their round budgets repairing that nonexistent defect
        # while the probe's own text said "Visual elements (canvas/svg): 1".
        # Missing evidence is UNKNOWN; unknown never decides a gate.
        if diag:
            probe_line = "A browser probe already EXECUTED the entrypoint world-side (engine: " + str(g3.get("engine") or "?") + "; loaded ok: " + str(bool(g3.get("probe_ok"))) + "; canvas present: " + str(bool(diag.get("has_canvas"))) + "; non-blank samples: " + str(diag.get("non_blank_samples")) + "). Its result decides the executes gate and will override whatever you report there. Do not try to execute the page yourself."
        else:
            probe_line = "A browser probe already EXECUTED the entrypoint world-side (engine: " + str(g3.get("engine") or "?") + "; loaded ok: " + str(bool(g3.get("probe_ok"))) + "; canvas liveness: UNKNOWN (text-only probe — no pixel diagnostics on this host; do NOT treat canvas absence as a fact; judge presence from file contents and the probe text). The load result decides the executes gate. Do not try to execute the page yourself."
        parts.append(probe_line)
else:
    parts.append("Artifact class: non-web (no .html entrypoint detected).")
# Agent-lane discipline line (c2847 precision 1): judgments must anchor on
# the gate outputs above, or the LLM re-derives executes-shaped opinions.
parts.append("Be strict: only count claims supported by the gate outputs above and by what your own tool calls actually observed.")
parts.append("")
parts.append("## Gate 1 - BUILDS")
if build_cmd:
    parts.append("Run this build command with execute_command and record whether it succeeds: " + build_cmd)
else:
    parts.append("Run the appropriate build/compile/syntax-check command with execute_command for the delivered files listed above. For interpreted languages with no build step, treat import/syntax check as the build (e.g. python -m py_compile). For plain static web files with no build step, builds=true.")
parts.append("On failure, capture the exact error output in build_error.")
parts.append("")
parts.append("## Gate 2 - EXECUTES")
if web:
    parts.append("Already executed world-side by the browser probe (see ground truth above): set executes=false with run_error='decided by browser probe' — the merge substitutes the probe's result. Do NOT attempt to run browser code with execute_command.")
else:
    if run_cmd:
        parts.append("Run this command with execute_command and record whether it runs without error: " + run_cmd)
    else:
        parts.append("Run the program (or its tests / a smoke invocation) with execute_command and capture any traceback/runtime error in run_error.")
    # Fail-closed applies to BOTH non-web branches: an explicit run_command
    # that cannot run on this host is exactly the missing-executor class.
    parts.append("FAIL CLOSED: a gate you could not actually execute is NOT a pass. If no executor exists for the artifact class on this host, set executes=false AND add one line to environment_failures[] naming the missing executor. NEVER claim executes=true because a file merely exists or 'loads'.")
    parts.append("environment_failures[] is ONLY for missing executors/runtimes on this host — real crashes, tracebacks and errors from code you DID run go in failures[].")
parts.append("")
parts.append("## Gate 3 - MATCHES THE ASK")
parts.append("Use analyze_code on the produced source files to get the structure (functions/classes) and diagnostics, then judge whether the code STRUCTURE plausibly satisfies the task above. Put concrete gaps in mismatch (e.g. 'task asked for function X, not present').")
# R4 (memgraph forensics 2026-07-21, replaces the 0.2.3 C3 prose): forced
# per-feature enumeration. The C3 paragraph produced no artifact, so the
# verifier sampled 1-2 salient features and set matches=true — dead playback
# and a missing ranking passed invisibly (F4). The schema now REQUIRES a
# feature_checks[] entry per task-named behavior and the merge fails any
# depends_on_input=false entry, so coverage is auditable in the verdict.
parts.append("FEATURE ENUMERATION (required — the response schema enforces it): Step 1: extract EVERY user-observable behavior the task names, each as a verbatim quote from the task text. Step 2: for EACH one, emit a feature_checks[] entry: feature (the verbatim quote), input (the concrete input/interaction that should drive it), expected_change (the observable output that must change), evidence (what you actually inspected that proves the output DERIVES from the input), depends_on_input (true/false). For web artifacts the evidence must name the FULL chain — event listener -> state mutation -> render read; 'a handler exists' is NOT evidence. Read SELFCHECK.md if present for the builder's claimed evidence, but do not trust it: check the code path yourself (does the output derive from the input, or is it hard-coded / a constant / an always-empty result?). depends_on_input means 'this feature is ALIVE, not vacuous' — for STATIC features the task names with no interaction of their own (a visible label, fixed text, layout), the check is correct PRESENCE: set depends_on_input=true when the static feature is correctly present, and say so in the evidence. Reserve depends_on_input=false STRICTLY for defects: a feature whose output SHOULD respond to its input but is provably constant / always-empty / disconnected, or a named feature that is missing outright. If ANY feature is vacuous, set its depends_on_input=false AND matches=false with a failures[] line NAMING the mechanism (e.g. 'ripple effect computes the same 0 for every cell because it never reads neighbor state'). A feature that is present but vacuous is a FAILURE, not a pass. Do not skip features: one entry per named behavior — the merge fails any depends_on_input=false entry.")
parts.append("")
parts.append("## Verdict")
parts.append("Set all_passed=true ONLY if builds AND executes AND matches are all true AND environment_failures is empty. Put one specific, actionable failure line per failed gate into failures[] (the exact error, not 'it failed'). summary: one sentence.")
parts.append("In artifacts[], list the produced file paths you actually observed, WORKSPACE-RELATIVE like ./pong.html — use an absolute path only for a file outside the workspace root. Entrypoint first (the file a user opens/runs). Never list files you did not see.")
return "\\n".join(parts)
""".strip()

# Fold the verifier verdict into the next loop state (specific failures ride;
# environment failures ride SEPARATELY so the loop can stop early on them).
#
# VERIFY-SUBFLOW-DEATH FOLD (memgraph hackathon post-mortem 2026-07-20): the
# gates run itself can DIE mid-verification (its structured-verdict LLM_CALL
# is a direct effect of that run — three failed attempts terminal-fail it).
# A host that resumes this parent then delivers {success: false, error} with
# NO verdict key. Before this fold, that empty verdict read as all-gates-
# false with an EMPTY failures list: the builder was reprompted over nothing
# and the final report claimed gate failures no gate ever reported. Missing
# verdict = verification-lane outage — fold it into environment_failures so
# the loop stops honestly. Never all_passed=true (nothing was verified);
# never a fixable failure (nothing failed); the final report's terminal
# workspace listing supplies the delivered/artifact evidence this run-level
# fold cannot see.
# 0.2.4 additions (memgraph forensics, ARCHITECTURE.md §5):
#   R1 — attempt_history / failure_signature (normalized per-line, digits
#        stripped, compared as SETS so gate-vocabulary shifts and round
#        numbers in failure wording do not defeat repetition detection) /
#        same_signature_count / last_attempt_summary (the builder's own
#        account, previously DISCARDED — the only way round N+2 can know what
#        round N+1 already tried).
#   R2 — gate_score ordered tuple (all_passed, builds+executes+matches count,
#        delivery_ok) tracked as best_round/best_score/best_snapshot/
#        best_verdict, monotone max; a failed snapshot degrades to a
#        #FALLBACK warning and never blocks the round or claims a snapshot
#        that does not exist.
#   R5 — mode economics: build -> repair -> ONE rebuild (entered on
#        same_signature_count >= 2, resetting the counter so the stall guard
#        fires only once the escape is spent, or on a matches-only gap =
#        design-level failure) -> stop.
NEXT_STATE_CODE = """
verdict = verifier if isinstance(verifier, dict) else {}
prev = prev_state if isinstance(prev_state, dict) else {}
rnd = int(round_index or 0)
next_round = rnd + 1
verdict_missing = ("builds" not in verdict) and ("all_passed" not in verdict)
if verdict_missing:
    meta = verify_meta if isinstance(verify_meta, dict) else {}
    err = str(meta.get("error") or "the verification subflow returned no verdict")
    env_line = "verification unavailable: the verification subflow failed before returning a verdict: " + err
    verdict = {
        "builds": False,
        "executes": False,
        "matches": False,
        "all_passed": False,
        "failures": [],
        "environment_failures": [env_line],
        "summary": "the verification subflow failed before returning a verdict; the build round finished but is unverified",
        "artifacts": [],
        "verifier_died": True,
        "gate_source": "none (verification subflow failed)",
    }
all_passed = bool(verdict.get("all_passed"))
failures = verdict.get("failures") or []
if not isinstance(failures, list):
    failures = [str(failures)]
failures = [str(f) for f in failures]
env_failures = verdict.get("environment_failures") or []
if not isinstance(env_failures, list):
    env_failures = [str(env_failures)]
env_failures = [str(f) for f in env_failures]
# Belt: if the verdict claims pass but a gate is false, do not trust the pass.
belted = False
if all_passed and not (verdict.get("builds") and verdict.get("executes") and verdict.get("matches")):
    all_passed = False
    failures = failures + ["verifier marked all_passed but a gate was false"]
    belted = True
if all_passed and env_failures:
    all_passed = False
    failures = failures + ["verifier marked all_passed despite environment_failures"]
    belted = True
# F7 (self-review 2026-07-21): write the belted decision BACK into the verdict
# dict before it is stored as last_verdict/best_verdict. Otherwise the stored
# verdict keeps the verifier's raw failures:[]/all_passed:True, and the
# restore-path FINAL_REPORT (which reads best_verdict.failures) would omit the
# belt findings for the delivered round even though the status line stayed
# honest. Plain subscript writes only (RestrictedPython forbids augmented
# assignment on subscripts).
if belted:
    verdict["all_passed"] = all_passed
    verdict["failures"] = failures
# R1: normalized failure signature (per-line, compared as a SET) — the KEY is
# the stable failure MECHANISM, not its volatile phrasing.
#   (F2, self-review 2026-07-21) truncate each line at the first " - ": failure
#   lines are "<class>: <specific> - <reason/evidence>" and the reason half is
#   LLM-authored prose (verifier failures[], the R4 vacuous-feature fold's
#   evidence) that drifts every round — keeping it meant the same unfixed
#   defect never matched itself and the stall guard never fired, burning the
#   whole budget. The discriminating specifics (filenames, ids, feature names)
#   always sit in the prefix before the first " - ".
#   (F1, self-review 2026-07-21) strip only STANDALONE digit runs (round
#   counters like "round 2", "3 errors"); KEEP digits fused to an identifier
#   (level2.js vs level3.js, sprite1.png) — collapsing those made a builder
#   fixing one distinct file per round look stalled and wrongly spent its one
#   rebuild. A digit run is standalone iff neither boundary char is a letter,
#   "_" or "." (so "gate3" keeps its 3 — a stable gate name — while the
#   counter after "round " drops).
ident = "abcdefghijklmnopqrstuvwxyz_."
norm = []
for f in failures:
    t = str(f).strip().lower()
    dash = t.find(" - ")
    if dash >= 0:
        t = t[:dash]
    s = ""
    i = 0
    n = len(t)
    while i < n:
        c = t[i]
        if c in "0123456789":
            j = i
            while j < n and t[j] in "0123456789":
                j = j + 1
            before = t[i - 1] if i > 0 else ""
            after = t[j] if j < n else ""
            if (before in ident) or (after in ident):
                s = s + t[i:j]
            i = j
        else:
            s = s + c
            i = i + 1
    norm.append(s)
sig = "|".join(sorted(set(norm)))
prev_sig = str(prev.get("failure_signature") or "")
same = int(prev.get("same_signature_count", 0) or 0)
if sig and prev_sig and sig == prev_sig:
    same = same + 1
else:
    same = 0
# R1: the builder's own account of what it did (truncated ~800 chars); an
# empty report keeps the previous summary rather than erasing the memory.
# ADR-0026: the builder's own account flows whole — clipping it at 800 chars
# erased exactly the "what I tried" detail the next round needed.
summary_txt = str(builder_report or "").strip()
if not summary_txt:
    summary_txt = str(prev.get("last_attempt_summary") or "")
# R2: gate score + best-round tracking (monotone max; ties keep the earlier
# round — first-best wins).
det = verdict.get("deterministic") or {}
if not isinstance(det, dict):
    det = {}
gate_count = 0
if verdict.get("builds"):
    gate_count = gate_count + 1
if verdict.get("executes"):
    gate_count = gate_count + 1
if verdict.get("matches"):
    gate_count = gate_count + 1
gate_score = [1 if all_passed else 0, gate_count, 1 if det.get("delivery_ok") else 0]
warnings_state = [str(w) for w in (prev.get("warnings") or [])]
best_score = prev.get("best_score")
best_round = prev.get("best_round")
best_snapshot = str(prev.get("best_snapshot") or "")
best_verdict = prev.get("best_verdict") or {}
if bool(snapshot_ok):
    better = True
    if isinstance(best_score, list) and len(best_score) == 3:
        cur = (gate_score[0], gate_score[1], gate_score[2])
        old = (int(best_score[0] or 0), int(best_score[1] or 0), int(best_score[2] or 0))
        better = cur > old
    if better:
        best_score = gate_score
        best_round = rnd
        best_snapshot = ".cg_rounds/round_" + str(rnd)
        best_verdict = verdict
else:
    w = "snapshot: round " + str(rnd) + " snapshot failed - best-artifact restore cannot cover this round (#FALLBACK: delivery falls back to the last write for it)"
    if w not in warnings_state:
        warnings_state.append(w)
# R1: attempt history (bounded by max_rounds).
history = prev.get("attempt_history") or []
if not isinstance(history, list):
    history = []
history = history + [{"round": rnd, "failures": failures, "gate_score": gate_score}]
# R5: mode economics.
rebuilds_used = int(prev.get("rebuilds_used", 0) or 0)
repair_attempts = int(prev.get("repair_attempts", 0) or 0)
if str(prev.get("mode") or "") == "repair":
    repair_attempts = repair_attempts + 1
matches_gap = bool(verdict.get("builds")) and bool(verdict.get("executes")) and not bool(verdict.get("matches")) and len(env_failures) == 0
next_mode = "repair"
if (not all_passed) and len(failures) > 0 and (same >= 2 or matches_gap) and rebuilds_used == 0:
    next_mode = "rebuild"
    rebuilds_used = 1
    same = 0
return {
    "rounds_completed": next_round,
    "all_passed": all_passed,
    "failures": failures,
    "environment_failures": env_failures,
    "last_verdict": verdict,
    "attempt_history": history,
    "failure_signature": sig,
    "same_signature_count": same,
    "last_attempt_summary": summary_txt,
    "mode": next_mode,
    "rebuilds_used": rebuilds_used,
    "repair_attempts": repair_attempts,
    "best_round": best_round,
    "best_score": best_score,
    "best_snapshot": best_snapshot,
    "best_verdict": best_verdict,
    "warnings": warnings_state,
}
""".strip()

# R2 snapshot (memgraph forensics, ARCHITECTURE.md §2): copy the workspace
# into the hidden .cg_rounds/round_<N> directory right after the round's
# verify, so the verdict just produced describes exactly the snapshotted
# bytes. .cg_rounds is a dot-directory: G0's listing and the final delivery
# listing both run with include_hidden:false, so snapshots are invisible to
# every gate. Exclusion is by name inside the copy loop (never recurse into
# .cg_rounds). A copy failure exits 1 -> call success=false -> next_state
# degrades it to a #FALLBACK warning; the round itself never fails on it.
SNAPSHOT_ARGS_CODE = """
ws = str(workspace_root or "").strip()
rnd = int(round_index or 0)
snap = ".cg_rounds/round_" + str(rnd)
prefix = ("cd '" + ws + "' && ") if ws else ""
cmd = (
    prefix
    + "mkdir -p '" + snap + "' && for f in * .[!.]* ..?*; do "
    + "if [ -e \\"$f\\" ] && [ \\"$f\\" != \\".cg_rounds\\" ]; then cp -R \\"$f\\" '" + snap + "/' || exit 1; fi; done"
)
return {
    "name": "execute_command",
    "arguments": {"command": cmd},
    "call_id": "cg-snapshot-round-" + str(rnd),
}
""".strip()

# R5 budget shaping (pure): repair rounds are targeted minimal edits and get
# a smaller agent budget (12 iterations); build and the one escalation
# rebuild keep the full 30. mode falls back honestly when the state predates
# the key (round 0 = build, later = repair).
ROUND_MODE_PINS_CODE = """
state = loop_state or {}
completed = int(state.get("rounds_completed", 0) or 0)
mode = str(state.get("mode") or "")
if not mode:
    mode = "build" if completed == 0 else "repair"
iters = 30
if mode == "repair":
    iters = 12
return {"mode": mode, "max_iterations": iters}
""".strip()

# R2 restore decision (pure): compare the FINAL round's gate score against
# the best snapshotted round's; when the last write is strictly worse than a
# snapshotted earlier round, compose the copy-back command. Guards: never on
# all_passed (final == best by construction: a passing round exits the loop
# immediately), never without a recorded snapshot, and the snapshot path must
# live under .cg_rounds/ (the only path next_state ever mints).
RESTORE_DECIDE_CODE = """
state = loop_state or {}
ws = str(workspace_root or "").strip()
passed = bool(state.get("all_passed"))
best_score = state.get("best_score")
best_snapshot = str(state.get("best_snapshot") or "")
best_round = state.get("best_round")
history = state.get("attempt_history") or []
final_score = None
if isinstance(history, list) and len(history) > 0:
    last = history[-1]
    if isinstance(last, dict):
        final_score = last.get("gate_score")
restore = False
if (not passed) and best_snapshot.startswith(".cg_rounds/") and isinstance(best_score, list) and len(best_score) == 3:
    f0 = 0
    f1 = 0
    f2 = 0
    if isinstance(final_score, list) and len(final_score) == 3:
        f0 = int(final_score[0] or 0)
        f1 = int(final_score[1] or 0)
        f2 = int(final_score[2] or 0)
    best = (int(best_score[0] or 0), int(best_score[1] or 0), int(best_score[2] or 0))
    restore = best > (f0, f1, f2)
# F8 (self-review 2026-07-21): emit the copy-back command ONLY when a restore
# is actually decided. The if_restore node gates execution on `restore` today,
# so a false branch never ran the command — but composing `cp -R '<snap>/.' .`
# unconditionally left a live command riding an unexecuted pin (degenerate
# `cp -R '/.' .` when best_snapshot is empty). A no-op keeps the pin honest and
# defends against any future wiring that consumes tool_call directly.
if restore:
    prefix = ("cd '" + ws + "' && ") if ws else ""
    cmd = prefix + "cp -R '" + best_snapshot + "/.' ."
else:
    cmd = "true"
return {
    "restore": restore,
    "tool_call": {
        "name": "execute_command",
        "arguments": {"command": cmd},
        "call_id": "cg-restore-best-round",
    },
    "restored_round": best_round,
    "best_score": best_score,
    "final_score": final_score,
}
""".strip()

# Compose the terminal workspace listing call: delivery ground truth for the
# final report, INDEPENDENT of the verifier lane (post-mortem 2026-07-20: a
# dead verifier must not erase the fact that the artifact exists — the
# listing either shows files or it does not).
FINAL_LISTING_ARGS_CODE = """
ws = str(workspace_root or "").strip()
return {
    "name": "list_files",
    "arguments": {
        "directory_path": ws if ws else ".",
        "recursive": True,
        "include_hidden": False,
        "head_limit": None,
    },
    "call_id": "final-delivery-listing",
}
""".strip()

# Final report assembly from the last verdict + loop state + the terminal
# workspace listing. Three honest terminal states, strictly separated
# (delivered != verified != passed):
#   PASSED    — every gate verified true (all_passed).
#   DELIVERED, NOT VERIFIABLE — artifact present, no fixable failure was ever
#               reported, but verification could not complete here (missing
#               executor OR a verifier that died — the same "cannot verify
#               here" class). success=true, passed stays false.
#   STOPPED   — fixable gate failures remain (or nothing was delivered).
# R2 addition (memgraph forensics): when the terminal workspace was RESTORED
# from the best round's snapshot, the report says so up front and reports the
# DELIVERED round's verdict (best_verdict), with the final round's verdict as
# a discarded appendix — the report must describe the bytes the user gets.
FINAL_REPORT_CODE = """
state = loop_state or {}
verdict = state.get("last_verdict") or {}
if not isinstance(verdict, dict):
    verdict = {}
restore = restore_out if isinstance(restore_out, dict) else {}
restored = bool(restore.get("restore"))
final_round_verdict = verdict
if restored:
    bv = state.get("best_verdict") or {}
    if isinstance(bv, dict) and len(bv) > 0:
        verdict = bv
rounds = int(state.get("rounds_completed", 0) or 0)
passed = bool(state.get("all_passed"))
if restored:
    fixable = [str(f) for f in (verdict.get("failures") or [])]
    env_failures = [str(f) for f in (verdict.get("environment_failures") or [])]
else:
    fixable = [str(f) for f in (state.get("failures") or [])]
    env_failures = [str(f) for f in (state.get("environment_failures") or [])]
verifier_died = bool(verdict.get("verifier_died"))
# Terminal delivery ground truth: parse the final listing the way G0 does.
text = str(final_listing or "")
files = []
if bool(final_listing_ok):
    for ln in text.split("\\n")[1:]:
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
delivered = len(files) > 0 or bool(det.get("delivery_ok"))
unverified_only = (not passed) and delivered and len(fixable) == 0 and (len(env_failures) > 0 or verifier_died)
success = passed or unverified_only
lines = []
lines.append("# Coding agent result")
lines.append("")
if passed:
    lines.append("Status: PASSED all gates")
elif unverified_only:
    lines.append("Status: DELIVERED — NOT VERIFIABLE HERE (the artifact is present and no gate reported a code failure, but independent verification could not complete in this environment)")
else:
    lines.append("Status: STOPPED with open gate failures")
lines.append("Rounds used: " + str(rounds))
if restored:
    lines.append("")
    lines.append("Delivered artifact: RESTORED from the round " + str(restore.get("restored_round")) + " snapshot (best gate score " + str(restore.get("best_score")) + " vs final round " + str(restore.get("final_score")) + ") — the final round's changes regressed the artifact and were discarded (best-verified delivery, not last-write).")
    if restore_ok is not True:
        lines.append("#FALLBACK: the restore command did not confirm success — the workspace may still hold the final round's bytes; treat the delivered files with suspicion.")
lines.append("")
if restored:
    lines.append("Gate verdict (delivered round " + str(restore.get("restored_round")) + "):")
else:
    lines.append("Gate verdict (last round):")
lines.append("- builds: " + str(bool(verdict.get("builds"))))
lines.append("- executes: " + str(bool(verdict.get("executes"))))
lines.append("- matches: " + str(bool(verdict.get("matches"))))
if verifier_died:
    lines.append("- verifier: DIED before reporting (builds/matches above are UNVERIFIED, not failed)")
# Name WHERE the produced files live (verifier-observed, workspace-relative)
# so the report is self-sufficient on every host — the operator should never
# need a second agent to FIND the artifact (code seat ask, 2026-07-16). When
# the verifier died the terminal listing supplies the paths instead.
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
    lines.append("Artifacts: none observed (#FALLBACK: report cannot name the produced file paths)")
warnings = [str(w) for w in (verdict.get("warnings") or [])]
for w in (state.get("warnings") or []):
    if str(w) not in warnings:
        warnings.append(str(w))
if warnings:
    lines.append("")
    lines.append("Advisory (did not fail the run):")
    for w in warnings:
        lines.append("- " + w)
if not passed:
    if fixable:
        lines.append("")
        lines.append("Open failures:")
        for f in fixable:
            lines.append("- " + f)
    if env_failures:
        lines.append("")
        lines.append("Not verifiable in this environment (missing executor or dead verifier — not a code defect; the loop stops instead of burning repair rounds):")
        for f in env_failures:
            lines.append("- " + f)
if restored:
    lines.append("")
    lines.append("Final round verdict (discarded after restore):")
    lines.append("- builds/executes/matches: " + str(bool(final_round_verdict.get("builds"))) + "/" + str(bool(final_round_verdict.get("executes"))) + "/" + str(bool(final_round_verdict.get("matches"))))
    for f in [str(x) for x in (final_round_verdict.get("failures") or [])]:
        lines.append("- " + f)
if verdict.get("summary"):
    lines.append("")
    lines.append("Summary: " + str(verdict.get("summary")))
return {
    "report_markdown": "\\n".join(lines),
    "passed": passed,
    "delivered": delivered,
    "success": success,
    "restored": restored,
    "rounds_used": rounds,
    "gate_verdict": verdict,
    "artifacts": arts,
    "open_failures": fixable + env_failures,
}
""".strip()


def build_verifier_subflow() -> dict[str, Any]:
    """The v2 gate subflow: deterministic gates first, world-side execution
    second, LLM only for what neither can do.

    Order (pay-per-failure, agora c2736): G0 DELIVERY + G1 INTEGRATION run as
    call_tool + sandboxed code nodes on ground-truth listings — zero LLM cost.
    If either fails, the round fails HERE with specific fixable failures and
    nothing else runs. Web workspaces then pay one browser_probe call (G3,
    code's registered tool, c2769): page/console errors fail the round
    immediately with the exact error text; a missing executor records an
    ENVIRONMENT failure (fail closed — the v1 'true if it loads' defect
    inverted, owned at c2753). Only then does the LLM verifier run, for the
    gates only it can do (builds / matches; executes for non-web artifacts) —
    and the merge overrides its executes with the probe's world-side result
    for web artifacts.

    All three branches persist their verdict through the vg.verdict run var
    so the single end node reads one merge point (no multi-entry pin
    overrides).
    """
    flow = _base_flow(
        "coding-verify-gates", "coding-verify-gates",
        "Verification gates for coding runs: deterministic delivery + web-integration checks over list_files/read_file ground truth run first (no LLM), then a browser_probe execution gate for web entrypoints (fail-closed: missing executors are environment failures, never passes), then the independent verifier agent for builds/matches. Returns a structured verdict with fixable failures separated from environment failures. Reusable as a subflow.",
    )
    # Layout (operator directive 2026-07-20): exec spine left-to-right in one
    # lane at y=0 on a 380px column pitch; fail-fast verdict set_vars ride an
    # upper lane (y=-220); pure gate/compose helpers sit in rows below their
    # consumers (y=400, overflow y=700). Box model: 300 wide,
    # 90 + 26*max(data-ins, data-outs) tall, >=60px gaps (audited).
    flow["nodes"] = [
        _node("start", "on_flow_start", "Verify request", -2000, 0,
              outputs=[EXEC_OUT,
                       _pin("request", "request", "string"),
                       _pin("workspace_root", "workspace_root", "string"),
                       _pin("build_command", "build_command", "string"),
                       _pin("run_command", "run_command", "string"),
                       _pin("round_index", "round_index", "number"),
                       _pin("provider", "provider", "provider_text"),
                       _pin("model", "model", "model")],
              pin_defaults={"build_command": "", "run_command": "", "round_index": 0}),
        # --- G0/G1: deterministic gates (no LLM) ---
        _code_node("listing_args", "Compose listing call", LISTING_ARGS_CODE, -2000, 400,
                   [_pin("workspace_root", "workspace_root", "string")]),
        _call_tool("list_call", "G0: list workspace", ["list_files"], -1620, 0),
        _code_node("gate0", "G0: delivery + classify", GATE0_CODE, -1620, 400,
                   [_pin("listing", "listing", "any"),
                    _pin("listing_ok", "listing_ok", "boolean")]),
        _code_node("entry_args", "Compose entrypoint read", ENTRY_ARGS_CODE, -1240, 400,
                   [_pin("gate0_out", "gate0_out", "object"),
                    _pin("workspace_root", "workspace_root", "string")]),
        _call_tool("entry_read", "G1: read entrypoint", ["read_file"], -1240, 0),
        _code_node("gate1", "G1: integration check", GATE1_CODE, -860, 400,
                   [_pin("gate0_out", "gate0_out", "object"),
                    _pin("entry_content", "entry_content", "any"),
                    _pin("entry_ok", "entry_ok", "boolean")]),
        _code_node("script_args", "Compose script read", SCRIPT_ARGS_CODE, -480, 400,
                   [_pin("gate1_out", "gate1_out", "object"),
                    _pin("workspace_root", "workspace_root", "string")]),
        _call_tool("script_read", "G4: read main script", ["read_file"], -860, 0),
        _code_node("gate4", "G4: orphan functions", GATE4_CODE, -480, 700,
                   [_pin("gate0_out", "gate0_out", "object"),
                    _pin("entry_content", "entry_content", "any"),
                    _pin("script_content", "script_content", "any"),
                    _pin("script_ok", "script_ok", "boolean")]),
        # --- G5 (R3): hash-bound SELFCHECK; G6: DOM id contract (0.2.4) ---
        _code_node("selfcheck_args", "Compose SELFCHECK read", SELFCHECK_ARGS_CODE, -100, 400,
                   [_pin("workspace_root", "workspace_root", "string")]),
        _call_tool("selfcheck_read", "G5: read SELFCHECK.md", ["read_file"], -480, 0),
        _code_node("selfcheck_hash_args", "Compose hash recompute", SELFCHECK_HASH_ARGS_CODE, 280, 400,
                   [_pin("selfcheck_content", "selfcheck_content", "any"),
                    _pin("selfcheck_ok", "selfcheck_ok", "boolean"),
                    _pin("workspace_root", "workspace_root", "string")]),
        _call_tool("selfcheck_hash_call", "G5: recompute hashes", ["execute_command"], -100, 0),
        _code_node("gate5", "G5: SELFCHECK hash binding", GATE5_CODE, -100, 700,
                   [_pin("selfcheck_content", "selfcheck_content", "any"),
                    _pin("selfcheck_ok", "selfcheck_ok", "boolean"),
                    _pin("hash_output", "hash_output", "any")]),
        _code_node("gate_dom", "G6: DOM id contract", GATE_DOM_CODE, 280, 700,
                   [_pin("gate0_out", "gate0_out", "object"),
                    _pin("entry_content", "entry_content", "any"),
                    _pin("script_content", "script_content", "any"),
                    _pin("script_ok", "script_ok", "boolean")]),
        _code_node("det", "Deterministic verdict", DET_VERDICT_CODE, 660, 400,
                   [_pin("gate0_out", "gate0_out", "object"),
                    _pin("gate1_out", "gate1_out", "object"),
                    _pin("gate4_out", "gate4_out", "object"),
                    _pin("gate5_out", "gate5_out", "object"),
                    _pin("gate_dom_out", "gate_dom_out", "object")]),
        _if("if_det", "Deterministic gates failed?", 280, 0),
        _set_var("set_verdict_det", "Record deterministic verdict", "vg.verdict", 660, -220),
        # --- G3 (web): world-side execution via browser_probe ---
        _if("if_web", "Web entrypoint?", 660, 0),
        _code_node("probe_args", "Compose probe call", PROBE_ARGS_CODE, 1040, 400,
                   [_pin("gate0_out", "gate0_out", "object"),
                    _pin("workspace_root", "workspace_root", "string")]),
        _call_tool("probe_call", "G3: browser probe", ["browser_probe"], 1040, 0),
        _code_node("gate3", "G3: read probe result", GATE3_CODE, 1420, 400,
                   [_pin("gate0_out", "gate0_out", "object"),
                    _pin("probe_raw", "probe_raw", "object"),
                    _pin("round_index", "round_index", "number")]),
        _if("if_probe", "Probe found errors?", 1420, 0),
        _code_node("probe_verdict", "Probe-failure verdict", PROBE_VERDICT_CODE, 1800, 400,
                   [_pin("gate0_out", "gate0_out", "object"),
                    _pin("gate3_out", "gate3_out", "object")]),
        _set_var("set_verdict_probe", "Record probe verdict", "vg.verdict", 1800, -220),
        # --- LLM verifier: builds / matches (executes only for non-web) ---
        _code_node("verifier_prompt", "Compose verifier task", VERIFIER_PROMPT_CODE, 1800, 700,
                   [_pin("request", "request", "string"),
                    _pin("workspace_root", "workspace_root", "string"),
                    _pin("build_command", "build_command", "string"),
                    _pin("run_command", "run_command", "string"),
                    _pin("gate0_out", "gate0_out", "object"),
                    _pin("gate3_out", "gate3_out", "object")],
                   output_type="string"),
        _agent_node("verifier", "Independent verifier", 1800, 0,
                    # No output-token cap (ADR-0026 §2: the verdict is a
                    # structured-output call, a critical path). A 2000-token
                    # cap was added to bound the one unbounded call type (agent
                    # precision 4, c2847) and had to be raised to 4000 in R4
                    # because it silently truncated the multi-feature verdicts;
                    # the model default now applies. The pin stays so an author
                    # can still wire an explicit budget.
                    extra_inputs=[_pin("max_output_tokens", "max_output_tokens", "number")],
                    pin_defaults={
                        "system": "You are a rigorous, independent code verifier. You never edit code. You run commands and inspect structure, then report a strict structured verdict. A gate is only PASS if you actually observed success; when a command fails, capture the real error text. A gate you could not execute is a FAIL with the reason recorded — never a pass.",
                        "tools": VERIFIER_TOOLS,
                        "max_iterations": 16,
                        "temperature": 0.0,
                        "resp_schema": VERIFIER_SCHEMA,
                    }),
        _code_node("merge", "Merge verdict", MERGE_VERDICT_CODE, 2180, 400,
                   [_pin("verifier_data", "verifier_data", "object"),
                    # Death detection inputs: the agent node's success pin goes
                    # false (and data stays empty) when the verifier subrun DIED
                    # instead of reporting; response then carries the runtime's
                    # synthesized human-readable failure line.
                    _pin("verifier_ok", "verifier_ok", "boolean"),
                    _pin("verifier_response", "verifier_response", "string"),
                    _pin("gate0_out", "gate0_out", "object"),
                    _pin("gate1_out", "gate1_out", "object"),
                    _pin("gate3_out", "gate3_out", "object"),
                    _pin("gate5_out", "gate5_out", "object")]),
        _set_var("set_verdict_llm", "Record merged verdict", "vg.verdict", 2180, 0),
        # --- shared tail ---
        _get_var("read_verdict", "vg.verdict", {}, 2560, 400),
        _node("end", "on_flow_end", "Verdict", 2560, 0,
              inputs=[EXEC_IN, _pin("verdict", "verdict", "object")]),
    ]
    flow["edges"] = [
        # exec spine (0.2.4: SELFCHECK read + hash recompute ride the spine
        # between script_read and if_det so G5 folds into `det` with G0/G1/G4)
        _edge("start", "exec-out", "list_call", "exec-in", animated=True),
        _edge("list_call", "exec-out", "entry_read", "exec-in", animated=True),
        _edge("entry_read", "exec-out", "script_read", "exec-in", animated=True),
        _edge("script_read", "exec-out", "selfcheck_read", "exec-in", animated=True),
        _edge("selfcheck_read", "exec-out", "selfcheck_hash_call", "exec-in", animated=True),
        _edge("selfcheck_hash_call", "exec-out", "if_det", "exec-in", animated=True),
        _edge("if_det", "true", "set_verdict_det", "exec-in", animated=True),
        _edge("set_verdict_det", "exec-out", "end", "exec-in", animated=True),
        _edge("if_det", "false", "if_web", "exec-in", animated=True),
        _edge("if_web", "true", "probe_call", "exec-in", animated=True),
        _edge("probe_call", "exec-out", "if_probe", "exec-in", animated=True),
        _edge("if_probe", "true", "set_verdict_probe", "exec-in", animated=True),
        _edge("set_verdict_probe", "exec-out", "end", "exec-in", animated=True),
        # multi-entry on the verifier: reached from if_web.false (non-web) and
        # if_probe.false (probe clean or environment-only) — exec edges only,
        # every data pin below stays single-source.
        _edge("if_web", "false", "verifier", "exec-in", animated=True),
        _edge("if_probe", "false", "verifier", "exec-in", animated=True),
        _edge("verifier", "exec-out", "set_verdict_llm", "exec-in", animated=True),
        _edge("set_verdict_llm", "exec-out", "end", "exec-in", animated=True),
        # G0/G1 data
        _edge("start", "workspace_root", "listing_args", "workspace_root"),
        _edge("listing_args", "output", "list_call", "tool_call"),
        _edge("list_call", "result", "gate0", "listing"),
        _edge("list_call", "success", "gate0", "listing_ok"),
        _edge("gate0", "output", "entry_args", "gate0_out"),
        _edge("start", "workspace_root", "entry_args", "workspace_root"),
        _edge("entry_args", "output", "entry_read", "tool_call"),
        _edge("gate0", "output", "gate1", "gate0_out"),
        _edge("entry_read", "result", "gate1", "entry_content"),
        _edge("entry_read", "success", "gate1", "entry_ok"),
        # G4 data (orphan functions over entrypoint + main script)
        _edge("gate1", "output", "script_args", "gate1_out"),
        _edge("start", "workspace_root", "script_args", "workspace_root"),
        _edge("script_args", "output", "script_read", "tool_call"),
        _edge("gate0", "output", "gate4", "gate0_out"),
        _edge("entry_read", "result", "gate4", "entry_content"),
        _edge("script_read", "result", "gate4", "script_content"),
        _edge("script_read", "success", "gate4", "script_ok"),
        # G5 data (hash-bound SELFCHECK)
        _edge("start", "workspace_root", "selfcheck_args", "workspace_root"),
        _edge("selfcheck_args", "output", "selfcheck_read", "tool_call"),
        _edge("selfcheck_read", "result", "selfcheck_hash_args", "selfcheck_content"),
        _edge("selfcheck_read", "success", "selfcheck_hash_args", "selfcheck_ok"),
        _edge("start", "workspace_root", "selfcheck_hash_args", "workspace_root"),
        _edge("selfcheck_hash_args", "output", "selfcheck_hash_call", "tool_call"),
        _edge("selfcheck_read", "result", "gate5", "selfcheck_content"),
        _edge("selfcheck_read", "success", "gate5", "selfcheck_ok"),
        _edge("selfcheck_hash_call", "result", "gate5", "hash_output"),
        # G6 data (DOM id contract — pure scan over the reads already paid for)
        _edge("gate0", "output", "gate_dom", "gate0_out"),
        _edge("entry_read", "result", "gate_dom", "entry_content"),
        _edge("script_read", "result", "gate_dom", "script_content"),
        _edge("script_read", "success", "gate_dom", "script_ok"),
        _edge("gate0", "output", "det", "gate0_out"),
        _edge("gate1", "output", "det", "gate1_out"),
        _edge("gate4", "output", "det", "gate4_out"),
        _edge("gate5", "output", "det", "gate5_out"),
        _edge("gate_dom", "output", "det", "gate_dom_out"),
        # branch conditions + fail-fast verdicts (code-node dict keys as
        # source handles — the deep-research idiom the validator exempts)
        _edge("det", "failed", "if_det", "condition"),
        _edge("det", "verdict", "set_verdict_det", "value"),
        _edge("gate0", "web_class", "if_web", "condition"),
        # G3 data
        _edge("gate0", "output", "probe_args", "gate0_out"),
        _edge("start", "workspace_root", "probe_args", "workspace_root"),
        _edge("probe_args", "output", "probe_call", "tool_call"),
        _edge("gate0", "output", "gate3", "gate0_out"),
        _edge("probe_call", "raw", "gate3", "probe_raw"),
        _edge("start", "round_index", "gate3", "round_index"),
        _edge("gate3", "fixable_failed", "if_probe", "condition"),
        _edge("gate0", "output", "probe_verdict", "gate0_out"),
        _edge("gate3", "output", "probe_verdict", "gate3_out"),
        _edge("probe_verdict", "verdict", "set_verdict_probe", "value"),
        # verifier branch data
        _edge("start", "request", "verifier_prompt", "request"),
        _edge("start", "workspace_root", "verifier_prompt", "workspace_root"),
        _edge("start", "build_command", "verifier_prompt", "build_command"),
        _edge("start", "run_command", "verifier_prompt", "run_command"),
        _edge("gate0", "output", "verifier_prompt", "gate0_out"),
        _edge("gate3", "output", "verifier_prompt", "gate3_out"),
        _edge("verifier_prompt", "output", "verifier", "prompt"),
        _edge("start", "provider", "verifier", "provider"),
        _edge("start", "model", "verifier", "model"),
        _edge("verifier", "data", "merge", "verifier_data"),
        _edge("verifier", "success", "merge", "verifier_ok"),
        _edge("verifier", "response", "merge", "verifier_response"),
        _edge("gate0", "output", "merge", "gate0_out"),
        _edge("gate1", "output", "merge", "gate1_out"),
        _edge("gate3", "output", "merge", "gate3_out"),
        # G5 advisory warnings ride the merged verdict on the pass path too.
        _edge("gate5", "output", "merge", "gate5_out"),
        _edge("merge", "output", "set_verdict_llm", "value"),
        # shared tail: the var is the merge point
        _edge("read_verdict", "value", "end", "verdict"),
    ]
    return flow


def build_root_flow() -> dict[str, Any]:
    flow = _base_flow(
        "coding-agent", "coding-agent",
        "Advanced coding agent with recursive verification: a builder agent writes code, an independent verifier runs build/execute/match gates each round, and failures are fed back as specific reprompts until all gates pass or the round budget is spent.",
        # Own coding interface only — the boundary is request -> report/passed,
        # not the chat-agent prompt/response contract of abstractcode.agent.v1.
        ["abstractcode.coding.v1"],
    )
    # Layout: the loop spine runs left-to-right at y=0 (start -> rounds ->
    # builder -> verify -> set_state); prompt helpers ride above the lane
    # (y=-300), loop-condition + verdict helpers below it (y=420); the
    # after-loop report band is its own lane at y=900 ending in the flow end.
    flow["nodes"] = [
        _node("start", "on_flow_start", "Coding request", -1500, 0,
              outputs=[EXEC_OUT,
                       _pin("request", "request", "string"),
                       _pin("workspace_root", "workspace_root", "string"),
                       _pin("build_command", "build_command", "string"),
                       _pin("run_command", "run_command", "string"),
                       _pin("max_rounds", "max_rounds", "number"),
                       _pin("provider", "provider", "provider_text"),
                       _pin("model", "model", "model")],
              # max_rounds 3->4 (R5): repairs run at max_iterations=12, so a
              # fourth round fits roughly the old token budget.
              pin_defaults={"request": "", "workspace_root": "",
                            "build_command": "", "run_command": "", "max_rounds": 4}),
        # Loop state var (rounds_completed / all_passed / failures / last_verdict).
        _get_var("get_loop_state", "cg.loop_state",
                 {"rounds_completed": 0, "all_passed": False, "failures": []}, -1500, 420),
        _code_node("loop_condition", "Should keep building?", LOOP_CONDITION_CODE, -1120, 420,
                   [_pin("loop_state", "loop_state", "object"),
                    _pin("max_rounds", "max_rounds", "number")]),
        _while("rounds", "Verify-gated build rounds", -1120, 0),
        # --- loop body ---
        # 0.2.5 STEERING + PROGRESS (the interactive bar the loop coders set):
        # every round starts by draining the steer inbox and saying where it
        # is, then builds. Nothing below this block changed.
        # Laid out on their OWN lane (y=1220, below the report band): this
        # generator places nodes by hand, so a new block gets a free row
        # rather than the auto-layout the newer families use.
        _get_var("get_inbox", "_runtime.inbox", [], -2260, 1220),
        _get_var("get_steer_seen", "cg.steer_seen", 0, -2260, 1500),
        _get_var("get_steering", "cg.steering", "", -1880, 1220),
        _exec_code_node("steer_fold", "Drain steer inbox", STEER_FOLD_CODE, -1500, 1220,
                        [_pin("inbox", "inbox", "array"),
                         _pin("steer_seen", "steer_seen", "number"),
                         _pin("steering", "steering", "string")],
                        [_pin("steering", "steering", "string"),
                         _pin("seen", "seen", "number"),
                         _pin("fresh", "fresh", "number")]),
        _set_var("set_steering", "Persist steering notes", "cg.steering", -1120, 1220),
        _set_var("set_steer_seen", "Persist steer watermark", "cg.steer_seen", -740, 1220),
        _exec_code_node("round_line", "Compose round line", ROUND_LINE_CODE, -360, 1220,
                        [_pin("loop_state", "loop_state", "object"),
                         _pin("max_rounds", "max_rounds", "number"),
                         _pin("fresh_steers", "fresh_steers", "number"),
                         _pin("line_text", "line_text", "string"),
                         _pin("steer_word", "steer_word", "string")],
                        [_pin("message", "message", "string")],
                        pin_defaults={"line_text": ROUND_LINE_TEXT,
                                      "steer_word": ROUND_STEER_WORD}),
        _answer_user("round_status", "Round progress", 20, 1220),
        _get_var("get_state_body", "cg.loop_state",
                 {"rounds_completed": 0, "all_passed": False, "failures": []}, -1120, -300),
        _code_node("builder_prompt", "Compose builder prompt", BUILDER_PROMPT_CODE, -740, -300,
                   [_pin("request", "request", "string"),
                    _pin("workspace_root", "workspace_root", "string"),
                    _pin("loop_state", "loop_state", "object"),
                    # 0.2.5: the live steering the round must honour. Read
                    # from the var the fold above just wrote, so it is fresh
                    # for THIS round (get_var is volatile, re-pulled at the
                    # builder's resolution — strictly after set_steering).
                    _pin("steering", "steering", "string")],
                   output_type="string"),
        # R5: mode-shaped agent budget (build/rebuild=30, repair=12), wired
        # into builder.max_iterations from a code output; the pin default
        # stays as the unconnected fallback.
        _code_node("round_mode_pins", "Round mode -> budget", ROUND_MODE_PINS_CODE, -360, -300,
                   [_pin("loop_state", "loop_state", "object")]),
        _agent_node("builder", "Builder agent", -740, 0,
                    extra_inputs=[_pin("workspace_root", "workspace_root", "string")],
                    pin_defaults={
                        "system": "You are a senior coding agent. You create and edit real files in the workspace to satisfy the task, using the file and shell tools. Prefer minimal, runnable code. When given specific prior failures, fix exactly those.",
                        "tools": BUILDER_TOOLS,
                        "max_iterations": 30,
                        "temperature": 0.1,
                    }),
        _make_object("verify_input",
                     [("request", "string"), ("workspace_root", "string"),
                      ("build_command", "string"), ("run_command", "string"),
                      ("round_index", "number"),
                      ("provider", "provider_text"), ("model", "model")], -360, 420),
        _subflow_node("verify", "Run gates", "coding-verify-gates", -360, 0),
        _get("get_verdict", "verdict", {}, 20, 420),
        # R2: snapshot the just-verified workspace bytes into the hidden
        # .cg_rounds/round_<N> before the state write — the verdict and the
        # snapshot describe the same bytes.
        _code_node("snapshot_args", "Compose snapshot copy", SNAPSHOT_ARGS_CODE, 20, -300,
                   [_pin("workspace_root", "workspace_root", "string"),
                    _pin("round_index", "round_index", "number")]),
        _call_tool("snapshot_call", "Snapshot round", ["execute_command"], 20, 0),
        _code_node("next_state", "Record verdict", NEXT_STATE_CODE, 400, 420,
                   [_pin("verifier", "verifier", "object"),
                    # Death-detection input: on a dead gates run the subflow's
                    # `output` pin is None while the runtime-provided
                    # `child_output` key carries {success: false, error} —
                    # the honest cause for the environment fold.
                    _pin("verify_meta", "verify_meta", "object"),
                    _pin("round_index", "round_index", "number"),
                    # R1: the builder's own account of the round (previously
                    # DISCARDED — builder.response had no outgoing edge).
                    _pin("builder_report", "builder_report", "string"),
                    # R1/R2/R5: the previous round's state (volatile get_var
                    # read BEFORE set_state persists the new value).
                    _pin("prev_state", "prev_state", "object"),
                    _pin("snapshot_ok", "snapshot_ok", "boolean")]),
        _set_var("set_state", "Persist loop state", "cg.loop_state", 400, 0),
        # --- after loop (report band) ---
        # R2 restore: when the final round's gate score is strictly worse than
        # the best snapshotted round's, copy the best snapshot back over the
        # workspace BEFORE the terminal listing, so delivery and the report
        # describe the restored bytes.
        _code_node("restore_decide", "Best-over-final decision", RESTORE_DECIDE_CODE, -2640, 900,
                   [_pin("loop_state", "loop_state", "object"),
                    _pin("workspace_root", "workspace_root", "string")]),
        _if("if_restore", "Restore best snapshot?", -2260, 620),
        _call_tool("restore_call", "Restore best round", ["execute_command"], -2260, 900),
        # Terminal delivery listing: verifier-independent ground truth for the
        # report's delivered/artifact claims (list_files is read-only safe).
        _code_node("final_args", "Compose final listing call", FINAL_LISTING_ARGS_CODE, -1880, 900,
                   [_pin("workspace_root", "workspace_root", "string")]),
        _call_tool("final_list", "Final delivery listing", ["list_files"], -1880, 620),
        _get_var("get_final_state", "cg.loop_state",
                 {"rounds_completed": 0, "all_passed": False, "failures": []}, -1500, 900),
        _code_node("final_report", "Assemble result", FINAL_REPORT_CODE, -1120, 900,
                   [_pin("loop_state", "loop_state", "object"),
                    _pin("final_listing", "final_listing", "any"),
                    _pin("final_listing_ok", "final_listing_ok", "boolean"),
                    _pin("restore_out", "restore_out", "object"),
                    _pin("restore_ok", "restore_ok", "boolean")]),
        _get("get_report_md", "report_markdown", "", -740, 900),
        _get("get_passed", "passed", False, -360, 900),
        _get("get_rounds", "rounds_used", 0, 20, 900),
        _get("get_open_failures", "open_failures", [], 400, 900),
        _get("get_artifacts", "artifacts", [], 780, 900),
        _get("get_delivered", "delivered", False, 1160, 420),
        # y 620 -> 660: the two boxes overlapped by 20px (a get node is 220
        # tall), the one layout defect the audit had always reported here.
        _get("get_success", "success", False, 1160, 660),
        _node("end", "on_flow_end", "Finish", 1160, 900,
              inputs=[EXEC_IN,
                      _pin("report", "report", "string"),
                      # Strict verification result: true only when every gate
                      # was verified true by a real verdict.
                      _pin("passed", "passed", "boolean"),
                      # Artifact presence at terminal time (delivered !=
                      # verified != passed — post-mortem 2026-07-20).
                      _pin("delivered", "delivered", "boolean"),
                      # Delivered-aware terminal success: passed, OR delivered
                      # with nothing fixable left and only a verification-lane
                      # outage (env/verifier) standing.
                      _pin("success", "success", "boolean"),
                      _pin("rounds_used", "rounds_used", "number"),
                      _pin("open_failures", "open_failures", "array"),
                      _pin("artifacts", "artifacts", "array")]),
    ]
    flow["edges"] = [
        # exec spine (loop body 0.2.4: verify -> snapshot -> state write; the
        # after-loop lane routes through the R2 restore decision, multi-entry
        # on final_list — exec edges only, data pins stay single-source)
        _edge("start", "exec-out", "rounds", "exec-in", animated=True),
        # 0.2.5: the round opens with the steer drain + the progress line, then
        # the builder runs exactly as before.
        _edge("rounds", "loop", "steer_fold", "exec-in", animated=True),
        _edge("steer_fold", "exec-out", "set_steering", "exec-in", animated=True),
        _edge("set_steering", "exec-out", "set_steer_seen", "exec-in", animated=True),
        _edge("set_steer_seen", "exec-out", "round_line", "exec-in", animated=True),
        _edge("round_line", "exec-out", "round_status", "exec-in", animated=True),
        _edge("round_status", "exec-out", "builder", "exec-in", animated=True),
        # steer drain wiring
        _edge("get_inbox", "value", "steer_fold", "inbox"),
        _edge("get_steer_seen", "value", "steer_fold", "steer_seen"),
        _edge("get_steering", "value", "steer_fold", "steering"),
        _edge("steer_fold", "steering", "set_steering", "value"),
        _edge("steer_fold", "seen", "set_steer_seen", "value"),
        # progress line wiring
        _edge("get_state_body", "value", "round_line", "loop_state"),
        _edge("start", "max_rounds", "round_line", "max_rounds"),
        _edge("steer_fold", "fresh", "round_line", "fresh_steers"),
        _edge("round_line", "message", "round_status", "message"),
        # the round's live steering reaches the builder's prompt
        _edge("get_steering", "value", "builder_prompt", "steering"),
        _edge("builder", "exec-out", "verify", "exec-in", animated=True),
        _edge("verify", "exec-out", "snapshot_call", "exec-in", animated=True),
        _edge("snapshot_call", "exec-out", "set_state", "exec-in", animated=True),
        _edge("rounds", "done", "if_restore", "exec-in", animated=True),
        _edge("if_restore", "true", "restore_call", "exec-in", animated=True),
        _edge("restore_call", "exec-out", "final_list", "exec-in", animated=True),
        _edge("if_restore", "false", "final_list", "exec-in", animated=True),
        _edge("final_list", "exec-out", "end", "exec-in", animated=True),
        # loop condition (re-evaluated each iteration from the var)
        _edge("get_loop_state", "value", "loop_condition", "loop_state"),
        _edge("start", "max_rounds", "loop_condition", "max_rounds"),
        # boolean SUB-KEY of the code node's dict (deep-research idiom); a whole
        # dict on while.condition is always truthy -> infinite loop.
        _edge("loop_condition", "condition", "rounds", "condition"),
        # builder prompt + R5 mode-shaped budget
        _edge("get_state_body", "value", "builder_prompt", "loop_state"),
        _edge("start", "request", "builder_prompt", "request"),
        _edge("start", "workspace_root", "builder_prompt", "workspace_root"),
        _edge("builder_prompt", "output", "builder", "prompt"),
        _edge("get_state_body", "value", "round_mode_pins", "loop_state"),
        _edge("round_mode_pins", "max_iterations", "builder", "max_iterations"),
        _edge("start", "provider", "builder", "provider"),
        _edge("start", "model", "builder", "model"),
        _edge("start", "workspace_root", "builder", "workspace_root"),
        # verify subflow input: one object mapped by key to the child's
        # on_flow_start fields (the deep-research subflow convention).
        _edge("start", "request", "verify_input", "request"),
        _edge("start", "workspace_root", "verify_input", "workspace_root"),
        _edge("start", "build_command", "verify_input", "build_command"),
        _edge("start", "run_command", "verify_input", "run_command"),
        # GATE3's blank-canvas failure wording needs the round number (round 0
        # explains the dark-background caveat, repeats say "still blank").
        _edge("rounds", "index", "verify_input", "round_index"),
        _edge("start", "provider", "verify_input", "provider"),
        _edge("start", "model", "verify_input", "model"),
        _edge("verify_input", "result", "verify", "input"),
        # verdict -> next state -> persist (output object carries {verdict})
        _edge("verify", "output", "get_verdict", "object"),
        _edge("get_verdict", "value", "next_state", "verifier"),
        # `child_output` is a RUNTIME-PROVIDED subflow output key (the whole
        # child terminal payload, {success:false, error} on a dead child). It
        # is deliberately NOT declared as a pin: declared extra output pins
        # enter the compiler's output_pins remap, which would overwrite the
        # runtime-set value with result.get("child_output") = None.
        _edge("verify", "child_output", "next_state", "verify_meta"),
        _edge("rounds", "index", "next_state", "round_index"),
        # R1: the builder's own account of the round (was discarded entirely).
        _edge("builder", "response", "next_state", "builder_report"),
        # R1/R2/R5: previous state read via the volatile get_var — evaluated
        # at set_state time, BEFORE the new value is written.
        _edge("get_state_body", "value", "next_state", "prev_state"),
        # R2: snapshot success/failure (failure degrades to a warning).
        _edge("snapshot_call", "success", "next_state", "snapshot_ok"),
        _edge("start", "workspace_root", "snapshot_args", "workspace_root"),
        _edge("rounds", "index", "snapshot_args", "round_index"),
        _edge("snapshot_args", "output", "snapshot_call", "tool_call"),
        _edge("next_state", "output", "set_state", "value"),
        # R2 restore lane (after the loop, before the terminal listing)
        _edge("get_final_state", "value", "restore_decide", "loop_state"),
        _edge("start", "workspace_root", "restore_decide", "workspace_root"),
        _edge("restore_decide", "restore", "if_restore", "condition"),
        _edge("restore_decide", "tool_call", "restore_call", "tool_call"),
        # final report
        _edge("start", "workspace_root", "final_args", "workspace_root"),
        _edge("final_args", "output", "final_list", "tool_call"),
        _edge("final_list", "result", "final_report", "final_listing"),
        _edge("final_list", "success", "final_report", "final_listing_ok"),
        _edge("get_final_state", "value", "final_report", "loop_state"),
        _edge("restore_decide", "output", "final_report", "restore_out"),
        # On the no-restore branch restore_call never executes and its success
        # pin reads None — final_report treats anything but True as
        # "unconfirmed" only when a restore was actually requested.
        _edge("restore_call", "success", "final_report", "restore_ok"),
        _edge("final_report", "output", "get_report_md", "object"),
        _edge("final_report", "output", "get_passed", "object"),
        _edge("final_report", "output", "get_rounds", "object"),
        _edge("final_report", "output", "get_open_failures", "object"),
        _edge("final_report", "output", "get_artifacts", "object"),
        _edge("final_report", "output", "get_delivered", "object"),
        _edge("final_report", "output", "get_success", "object"),
        _edge("get_report_md", "value", "end", "report"),
        _edge("get_passed", "value", "end", "passed"),
        _edge("get_delivered", "value", "end", "delivered"),
        _edge("get_success", "value", "end", "success"),
        _edge("get_rounds", "value", "end", "rounds_used"),
        _edge("get_open_failures", "value", "end", "open_failures"),
        _edge("get_artifacts", "value", "end", "artifacts"),
    ]
    return flow


def build_chat_entrypoint_flow() -> dict[str, Any]:
    """`coder` — the abstractcode.agent.v1-conformant SECOND entrypoint (dual-interface
    pattern, deep-research precedent; code's c2412 ask 2).

    History: coding-agent originally declared agent.v1 on its PRIMARY flow and
    an adversarial review flagged it as a false contract (agent.v1 callers
    never send build_command/run_command, so selector-started runs stalled on
    missing pins). This wrapper is the honest fix: it conforms to the chat
    contract (prompt/provider/model/tools in; response/success/meta out), maps
    prompt -> request, and OMITS the gate commands so the child's pin defaults
    apply — the verifier degrades to what it can execute and the degradation
    is visible in the report/open_failures (never silent).

    The `tools` start pin is declared per the contract; the coding pipeline's
    tool allowlists are fixed by design (builder/verifier sets). A caller's
    allowed_tools still binds through the runtime's _runtime.allowed_tools
    enforcement regardless of this flow's wiring.
    """
    flow = _base_flow(
        "coder", "coder",
        "Chat-agent entrypoint for the coding-agent pipeline: takes a plain prompt (abstractcode.agent.v1), runs the verify-gated build loop in the session workspace with inferred gates (no explicit build/run commands — the verifier executes what it can and reports honestly), and returns the build report as the response.",
        ["abstractcode.agent.v1"],
    )
    # Layout: three-node exec spine at y=0 (start -> build -> end); the input
    # mapper and the result accessors sit in a helper row below (y=320), with
    # the meta fold one row further down (y=640) under its four sources.
    flow["nodes"] = [
        _node("start", "on_flow_start", "Chat request", -1140, 0,
              outputs=[EXEC_OUT,
                       _pin("prompt", "prompt", "string"),
                       _pin("provider", "provider", "provider_text"),
                       _pin("model", "model", "model"),
                       _pin("tools", "tools", "array")],
              pin_defaults={"prompt": ""}),
        # request <- prompt; workspace_root/build_command/run_command are
        # deliberately OMITTED so the child's pin defaults ("" / "" / "" / 3)
        # apply: session workspace, inferred gates, 3 rounds.
        _make_object("map_input",
                     [("request", "string"),
                      ("provider", "provider_text"), ("model", "model")], -1140, 320),
        _subflow_node("build", "Verify-gated coding run", "coding-agent", -760, 0),
        _get("get_report", "report", "", -380, 320),
        _get("get_passed", "passed", False, 0, 320),
        _get("get_rounds", "rounds_used", 0, 380, 320),
        _get("get_failures", "open_failures", [], 760, 320),
        _get("get_artifacts", "artifacts", [], 1140, 320),
        # Delivered-aware terminal success (post-mortem 2026-07-20): the chat
        # contract's `success` reflects "the run did its job as far as this
        # environment allows" — passed, OR delivered with only a verification-
        # lane outage standing. Strict verification stays visible as
        # meta.passed; delivered != verified != passed.
        _get("get_delivered", "delivered", False, -380, 640),
        _get("get_success", "success", False, 0, 640),
        _make_object("meta_obj",
                     [("passed", "boolean"), ("delivered", "boolean"),
                      ("rounds_used", "number"),
                      ("open_failures", "array"), ("artifacts", "array")], 380, 640),
        _node("end", "on_flow_end", "Finish", 760, 0,
              inputs=[EXEC_IN,
                      _pin("response", "response", "string"),
                      _pin("success", "success", "boolean"),
                      _pin("meta", "meta", "object")]),
    ]
    flow["edges"] = [
        _edge("start", "exec-out", "build", "exec-in", animated=True),
        _edge("build", "exec-out", "end", "exec-in", animated=True),
        # input mapping
        _edge("start", "prompt", "map_input", "request"),
        _edge("start", "provider", "map_input", "provider"),
        _edge("start", "model", "map_input", "model"),
        _edge("map_input", "result", "build", "input"),
        # outputs
        _edge("build", "output", "get_report", "object"),
        _edge("build", "output", "get_passed", "object"),
        _edge("build", "output", "get_rounds", "object"),
        _edge("build", "output", "get_failures", "object"),
        _edge("build", "output", "get_artifacts", "object"),
        _edge("build", "output", "get_delivered", "object"),
        _edge("build", "output", "get_success", "object"),
        _edge("get_passed", "value", "meta_obj", "passed"),
        _edge("get_delivered", "value", "meta_obj", "delivered"),
        _edge("get_rounds", "value", "meta_obj", "rounds_used"),
        _edge("get_failures", "value", "meta_obj", "open_failures"),
        _edge("get_artifacts", "value", "meta_obj", "artifacts"),
        _edge("get_report", "value", "end", "response"),
        _edge("get_success", "value", "end", "success"),
        _edge("meta_obj", "result", "end", "meta"),
    ]
    return flow


def write_json(path: Path, data: dict[str, Any]) -> None:
    # A regenerated flow keeps its original created_at (only updated_at moves,
    # and only when the content changed).
    if path.is_file() and "created_at" in data:
        try:
            prior = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            prior = {}
        if isinstance(prior, dict) and prior.get("created_at"):
            data = {**data, "created_at": prior["created_at"]}
            # An unchanged graph keeps its updated_at too: a rebuild then
            # rewrites only the flows whose content actually changed.
            if {**data, "updated_at": None} == {**prior, "updated_at": None}:
                data = {**data, "updated_at": prior.get("updated_at")}
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _validate_edges(flow: dict[str, Any]) -> list[str]:
    """Every edge endpoint must resolve to a node + declared pin — except a
    `code` node's source handles, which are runtime-resolved dict keys (the
    deep-research idiom, e.g. loop_condition.condition -> while.condition),
    and a `subflow` node's `child_output` handle, which the runtime always
    writes into node outputs (the child's whole terminal payload) but which
    must NOT be declared as a pin: declared extra output pins enter the
    compiler's output_pins remap and would be overwritten with
    result.get("child_output") = None."""
    ids = {n["id"] for n in flow["nodes"]}
    code_ids = {n["id"] for n in flow["nodes"] if n["data"].get("nodeType") == "code"}
    subflow_ids = {n["id"] for n in flow["nodes"] if n["data"].get("nodeType") == "subflow"}
    pinmap = {
        n["id"]: (
            {p["id"] for p in (n["data"].get("inputs") or [])},
            {p["id"] for p in (n["data"].get("outputs") or [])},
        )
        for n in flow["nodes"]
    }
    problems: list[str] = []
    for e in flow["edges"]:
        if e["source"] not in ids or e["target"] not in ids:
            problems.append(f"{e['id']}: unknown endpoint")
            continue
        if (
            e["source"] not in code_ids
            and not (e["source"] in subflow_ids and e["sourceHandle"] == "child_output")
            and e["sourceHandle"] not in pinmap[e["source"]][1]
        ):
            problems.append(f"{e['id']}: no out-pin {e['source']}.{e['sourceHandle']}")
        if e["targetHandle"] not in pinmap[e["target"]][0]:
            problems.append(f"{e['id']}: no in-pin {e['target']}.{e['targetHandle']}")
    return problems


def main() -> int:
    flows = [build_verifier_subflow(), build_root_flow(), build_chat_entrypoint_flow()]
    for flow in flows:
        problems = _validate_edges(flow)
        if problems:
            raise SystemExit(f"edge validation failed for {flow['id']}: {problems}")
        write_json(FLOWS_DIR / f"{flow['id']}.json", flow)

    sys.path.insert(0, str(ROOT / "abstractruntime" / "src"))
    from abstractruntime.workflow_bundle import pack_workflow_bundle
    from abstractruntime.visualflow_compiler import compiler as _compiler
    from wf_common import bundles_dir_from_argv

    # `--bundles-dir DIR` stages the artifact elsewhere (a release staging
    # folder); the default stays the sibling gateway checkout.
    bundles_dir = bundles_dir_from_argv(default=BUNDLES_DIR)
    bundle_path = bundles_dir / BUNDLE_FILENAME

    # Self-check: compile the tree through the real runtime compiler so a
    # broken graph fails the build, not a live run (adversary P1). Both
    # entrypoints compile: the chat wrapper references coding-agent as its
    # subflow, which references coding-verify-gates.
    flows_by_id = {f["id"]: json.loads((FLOWS_DIR / f"{f['id']}.json").read_text()) for f in flows}
    _compiler.compile_visualflow_tree(root_id="coding-agent", flows_by_id=flows_by_id)
    _compiler.compile_visualflow_tree(root_id="coder", flows_by_id=flows_by_id)

    bundles_dir.mkdir(parents=True, exist_ok=True)
    pack_workflow_bundle(
        # The chat wrapper is the packing root so its subflow tree (coding-agent
        # -> coding-verify-gates) rides along; both entrypoints are declared.
        root_flow_json=FLOWS_DIR / "coder.json",
        out_path=bundle_path,
        bundle_id="coding-agent",
        # 0.2.0 = deterministic-gates redesign (R-Type post-mortem, agora
        # c2725/c2735/c2736): delivery + integration gates before the LLM,
        # fail-closed executes, environment-vs-fixable failure split.
        # 0.2.1 = adversary wave (operator directive 2026-07-20): fail-closed
        # + environment_failures verifier guidance now also emitted when an
        # explicit run_command is set (was no-run-command-only); readable
        # left-to-right layout, zero node overlaps. VERSION BUMP is
        # load-bearing: bundle versions are immutable by sha, a gateway that
        # loaded 0.2.0 refuses a same-version re-publish.
        # 0.2.2 = verifier-death fail-soft (operator order 2026-07-21, laurent
        # dm#96): a DIED LLM verifier (infra failure) after the deterministic
        # gates all PASSED no longer fabricates a failure — it folds into the
        # environment_failures "delivered, not verifiable" terminal, the run
        # reports delivered≠verified≠passed, and terminal success reflects a
        # present artifact instead of lying rc=1. delivered/success end pins
        # added. (Fully effective under the gateway runner; abstractcode exec
        # needs the parent-resume half — filed to the code seat.)
        # 0.2.3 = semantic prompt wave (operator order 2026-07-21, laurent
        # dm#111-112; plan/improving-code.md C1/C2/C3/C8), targeting the
        # dead-temporal-ripple defect (0,0,0 samples across all three 0.2.2
        # runs — code that ran cleanly yet computed a constant): C1 builder
        # engineering rules (bound traversals; verify reference DIRECTION
        # before logic; same-output-for-every-input=broken; self-probe before
        # finishing), C2 round-0 data profiling (findings as a source comment
        # block), C3 verifier NON-VACUITY (task-named output must DEPEND on
        # input; provably-constant ⇒ matches:false naming the mechanism),
        # C8 SELFCHECK.md evidence file. Prompt-only; 0.2.2 stays in the
        # catalog for 1:1 A/B (dm#101 rule).
        # 0.2.4 = process wave (operator order 2026-07-21, laurent dm#122;
        # forensics ARCHITECTURE.md §5). 0.2.3's semantics WORKED (ripple
        # alive); the new failure was PROCESS — a verified-green artifact
        # existed, a post-verification rewrite broke one DOM id contract, and
        # delivery took the last write over a stale all-green SELFCHECK.
        # R1 repair reflex (builder.response→next_state edge, last_verdict
        # scoping, failure-signature stall guard); R2 best-artifact
        # .cg_rounds snapshot/restore (dot-dir invisible to G0/final_list);
        # R3 hash-bound SELFCHECK gate G5 (post-verify edit = caught, next
        # round told); R4 schema-forced per-feature feature_checks[] +
        # merge belt; R5 mode-driven budget (build→repair→one rebuild);
        # + deterministic DOM-contract gate G6 (JS-referenced ids must exist
        # in markup — flags exactly the broken r3 run). Gates issue
        # execute_command via call_tool (snapshot/restore/hash) — same
        # approve posture the builder/verifier already need; graceful
        # #FALLBACK degradation, never a round failure.
        # 0.2.5 = INTERACTIVE BAR (operator directive 2026-07-31, the loop-
        # coder wave). Additive only — the round loop, the gates and the
        # report band are untouched. Two hooks the family lacked while the
        # new hand-wired loop coders (react-coder/ralph-coder) shipped with
        # them: (a) STEERING — every round drains `_runtime.inbox` (the
        # gateway's inject_guidance / Runtime.steer channel) into `cg.steering`
        # behind a run-owned watermark (`cg.steer_seen`, never mutating the
        # runtime's inbox) and the builder prompt carries it directly under
        # the task; (b) PROGRESS — one `answer_user` line per round
        # ("coding round N of M: <mode>"), the stable-prefix contract the
        # multiagent pipeline's "build cycle N of M" already gives clients.
        # 0.2.8 = ADR-0026 (operator ruling 2026-09-28): every failure line the
        # builder is reprompted with carries the WHOLE tool/error text (no
        # snippet cuts in GATE0/1/3/5, MERGE, NEXT_STATE) and the verifier has
        # no max_output_tokens default (the model default applies; 4000 had
        # truncated multi-feature verdicts). 0.2.7 is skipped (see
        # BUNDLE_VERSION).
        bundle_version=BUNDLE_VERSION,
        flows_dir=FLOWS_DIR,
        entrypoints=["coding-agent", "coder"],
        default_entrypoint="coding-agent",
        metadata={
            "family": "coding-agent",
            "purpose": "recursive coding agent with deterministic delivery/integration gates + independent build/execute/match verification (fail-closed executes) and specific-failure reprompting; dual-interface (coding.v1 strict entrypoint + agent.v1 chat entrypoint with inferred gates)",
            "outputs": ["report", "passed", "delivered", "success", "rounds_used", "open_failures", "artifacts"],
            # Steering + progress discoverability at catalog level (0.2.5),
            # same shape the react/ralph bundles declare.
            "steering": {"channel": "inject_guidance", "var": "_runtime.inbox",
                         "applied": "at every round boundary, deduped by the run-owned "
                                    "cg.steer_seen watermark, folded into the builder prompt"},
            "progress_line": "coding round N of M",
        },
    )
    print(f"Wrote {len(flows)} flows to {FLOWS_DIR}")
    print(f"Packed {bundle_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
