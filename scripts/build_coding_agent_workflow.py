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

Design idioms mirror build_dp_research_workflows.py (node/edge/pin helpers,
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
BUNDLE_PATH = BUNDLES_DIR / "coding-agent@0.1.0.flow"

AGENT_INTERFACE = "abstractcode.agent.v1"

# Tools the BUILDER may use — full file + shell + structure surface.
BUILDER_TOOLS = [
    "read_file", "write_file", "edit_file", "list_files", "search_files",
    "skim_files", "skim_folders", "analyze_code", "execute_command",
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
    # dp-research convention: one `input` object in, one `output` object out;
    # the runtime maps the input object's keys to the child's on_flow_start
    # fields by name and collects the child's on_flow_end fields into output.
    return _node(node_id, "subflow", label, x, y,
                 inputs=[EXEC_IN, _pin("inherit_context", "inherit_context", "boolean"),
                         _pin("input", "input", "object")],
                 outputs=[EXEC_OUT, _pin("output", "output", "object")],
                 pin_defaults={"inherit_context": False},
                 extra={"subflowId": flow_id})


def _template(node_id, template_text, x, y, var_pins):
    return _node(node_id, "string_template", "Compose", x, y,
                 inputs=[_pin("template", "template", "string"),
                         _pin("vars", "vars", "object")],
                 outputs=[_pin("result", "result", "string")],
                 pin_defaults={"template": template_text})


# --------------------------------------------------------------------------
# Code bodies (transform snippets: inputs bound as locals, return the output).
# --------------------------------------------------------------------------

VERIFIER_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["builds", "executes", "matches", "all_passed", "failures", "summary"],
    "properties": {
        "builds": {"type": "boolean"},
        "build_error": {"type": "string"},
        "executes": {"type": "boolean"},
        "run_error": {"type": "string"},
        "matches": {"type": "boolean"},
        "mismatch": {"type": "string"},
        "all_passed": {"type": "boolean"},
        "failures": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": "string"},
    },
}

LOOP_CONDITION_CODE = """
state = loop_state or {}
completed = int(state.get("rounds_completed", 0) or 0)
max_rounds_value = max(1, int(max_rounds or 1))
passed = bool(state.get("all_passed"))
# Continue while the last round did NOT fully pass and we still have budget.
condition = (not passed) and completed < max_rounds_value
return {
    "condition": condition,
    "rounds_completed": completed,
    "max_rounds": max_rounds_value,
    "all_passed": passed,
}
""".strip()

# Build the builder's reprompt from the request + the last verifier verdict.
BUILDER_PROMPT_CODE = """
req = str(request or "").strip()
state = loop_state or {}
completed = int(state.get("rounds_completed", 0) or 0)
failures = state.get("failures") or []
ws = str(workspace_root or "").strip()

parts = []
parts.append("# Coding task")
parts.append(req)
if ws:
    parts.append("")
    parts.append("Work inside the workspace root: " + ws)
if completed > 0 and failures:
    parts.append("")
    parts.append("# Previous attempt FAILED these checks — fix EXACTLY these, do not start over:")
    for i, f in enumerate(failures, 1):
        parts.append(str(i) + ". " + str(f))
    parts.append("")
    parts.append("Make the minimal changes that resolve the specific failures above, then stop.")
else:
    parts.append("")
    parts.append("Write the code to satisfy the task. Create/edit files in the workspace. Keep it minimal and runnable.")
return "\\n".join(parts)
""".strip()

# Compose the verifier's task from the request + build/run command hints.
VERIFIER_PROMPT_CODE = """
req = str(request or "").strip()
ws = str(workspace_root or "").strip()
build_cmd = str(build_command or "").strip()
run_cmd = str(run_command or "").strip()

parts = []
parts.append("You are an INDEPENDENT code verifier. Do NOT edit any code. Run the checks and report a structured verdict.")
parts.append("")
parts.append("## The task the code was meant to satisfy")
parts.append(req)
if ws:
    parts.append("")
    parts.append("Workspace root: " + ws)
parts.append("")
parts.append("## Gate 1 - BUILDS")
if build_cmd:
    parts.append("Run this build command with execute_command and record whether it succeeds: " + build_cmd)
else:
    parts.append("Detect the stack (list_files) and run the appropriate build/compile/syntax-check command with execute_command. For interpreted languages with no build step, treat import/syntax check as the build (e.g. python -m py_compile).")
parts.append("On failure, capture the exact error output in build_error.")
parts.append("")
parts.append("## Gate 2 - EXECUTES")
if run_cmd:
    parts.append("Run this command with execute_command and record whether it runs without error: " + run_cmd)
else:
    parts.append("Run the program (or its tests / a smoke invocation) with execute_command. Capture any traceback/runtime error in run_error. For web/browser artifacts you cannot fully run, say so honestly in run_error and set executes=false only if there is a real error, true if the entrypoint loads.")
parts.append("")
parts.append("## Gate 3 - MATCHES THE ASK")
parts.append("Use analyze_code on the produced source files to get the structure (functions/classes) and diagnostics, then judge whether the code STRUCTURE plausibly satisfies the task above. Put concrete gaps in mismatch (e.g. 'task asked for function X, not present').")
parts.append("")
parts.append("## Verdict")
parts.append("Set all_passed=true ONLY if builds AND executes AND matches are all true. Put one specific, actionable failure line per failed gate into failures[] (the exact error, not 'it failed'). summary: one sentence.")
return "\\n".join(parts)
""".strip()

# Fold the verifier verdict into the next loop state (specific failures ride).
NEXT_STATE_CODE = """
verdict = verifier or {}
next_round = int(round_index or 0) + 1
all_passed = bool(verdict.get("all_passed"))
failures = verdict.get("failures") or []
if not isinstance(failures, list):
    failures = [str(failures)]
# Belt: if the verdict claims pass but a gate is false, do not trust the pass.
if all_passed and not (verdict.get("builds") and verdict.get("executes") and verdict.get("matches")):
    all_passed = False
    failures = failures + ["verifier marked all_passed but a gate was false"]
return {
    "rounds_completed": next_round,
    "all_passed": all_passed,
    "failures": [str(f) for f in failures],
    "last_verdict": verdict,
}
""".strip()

# Final report assembly from the last verdict + loop state.
FINAL_REPORT_CODE = """
state = loop_state or {}
verdict = state.get("last_verdict") or {}
rounds = int(state.get("rounds_completed", 0) or 0)
passed = bool(state.get("all_passed"))
lines = []
lines.append("# Coding agent result")
lines.append("")
lines.append("Status: " + ("PASSED all gates" if passed else "STOPPED with open gate failures"))
lines.append("Rounds used: " + str(rounds))
lines.append("")
lines.append("Gate verdict (last round):")
lines.append("- builds: " + str(bool(verdict.get("builds"))))
lines.append("- executes: " + str(bool(verdict.get("executes"))))
lines.append("- matches: " + str(bool(verdict.get("matches"))))
if not passed:
    lines.append("")
    lines.append("Open failures:")
    for f in (state.get("failures") or []):
        lines.append("- " + str(f))
if verdict.get("summary"):
    lines.append("")
    lines.append("Summary: " + str(verdict.get("summary")))
return {
    "report_markdown": "\\n".join(lines),
    "passed": passed,
    "rounds_used": rounds,
    "gate_verdict": verdict,
    "open_failures": state.get("failures") or [],
}
""".strip()


def build_verifier_subflow() -> dict[str, Any]:
    """A reusable gate subflow: given request + workspace + commands, returns a
    structured build/execute/match verdict via an independent verifier agent."""
    flow = _base_flow(
        "coding-verify-gates", "coding-verify-gates",
        "Independent verifier: runs build/execute gates (execute_command) and a structure/match check (analyze_code) against the coding task, returning a structured pass/fail verdict with specific failure lines. Reusable as a subflow.",
    )
    flow["nodes"] = [
        _node("start", "on_flow_start", "Verify request", -600, 0,
              outputs=[EXEC_OUT,
                       _pin("request", "request", "string"),
                       _pin("workspace_root", "workspace_root", "string"),
                       _pin("build_command", "build_command", "string"),
                       _pin("run_command", "run_command", "string"),
                       _pin("provider", "provider", "provider_text"),
                       _pin("model", "model", "model")],
              pin_defaults={"build_command": "", "run_command": ""}),
        _code_node("verifier_prompt", "Compose verifier task", VERIFIER_PROMPT_CODE, -240, 40,
                   [_pin("request", "request", "string"),
                    _pin("workspace_root", "workspace_root", "string"),
                    _pin("build_command", "build_command", "string"),
                    _pin("run_command", "run_command", "string")],
                   output_type="string"),
        _agent_node("verifier", "Independent verifier", 120, 0,
                    pin_defaults={
                        "system": "You are a rigorous, independent code verifier. You never edit code. You run commands and inspect structure, then report a strict structured verdict. A gate is only PASS if you actually observed success; when a command fails, capture the real error text.",
                        "tools": VERIFIER_TOOLS,
                        "max_iterations": 12,
                        "temperature": 0.0,
                        "resp_schema": VERIFIER_SCHEMA,
                    }),
        _node("end", "on_flow_end", "Verdict", 600, 0,
              inputs=[EXEC_IN, _pin("verdict", "verdict", "object")]),
    ]
    flow["edges"] = [
        _edge("start", "exec-out", "verifier", "exec-in", animated=True),
        _edge("verifier", "exec-out", "end", "exec-in", animated=True),
        _edge("start", "request", "verifier_prompt", "request"),
        _edge("start", "workspace_root", "verifier_prompt", "workspace_root"),
        _edge("start", "build_command", "verifier_prompt", "build_command"),
        _edge("start", "run_command", "verifier_prompt", "run_command"),
        _edge("verifier_prompt", "output", "verifier", "prompt"),
        _edge("start", "provider", "verifier", "provider"),
        _edge("start", "model", "verifier", "model"),
        _edge("verifier", "data", "end", "verdict"),
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
    flow["nodes"] = [
        _node("start", "on_flow_start", "Coding request", -900, 0,
              outputs=[EXEC_OUT,
                       _pin("request", "request", "string"),
                       _pin("workspace_root", "workspace_root", "string"),
                       _pin("build_command", "build_command", "string"),
                       _pin("run_command", "run_command", "string"),
                       _pin("max_rounds", "max_rounds", "number"),
                       _pin("provider", "provider", "provider_text"),
                       _pin("model", "model", "model")],
              pin_defaults={"request": "", "workspace_root": "",
                            "build_command": "", "run_command": "", "max_rounds": 3}),
        # Loop state var (rounds_completed / all_passed / failures / last_verdict).
        _get_var("get_loop_state", "cg.loop_state",
                 {"rounds_completed": 0, "all_passed": False, "failures": []}, -560, 200),
        _code_node("loop_condition", "Should keep building?", LOOP_CONDITION_CODE, -560, 340,
                   [_pin("loop_state", "loop_state", "object"),
                    _pin("max_rounds", "max_rounds", "number")]),
        _while("rounds", "Verify-gated build rounds", -560, 500),
        # --- loop body ---
        _get_var("get_state_body", "cg.loop_state",
                 {"rounds_completed": 0, "all_passed": False, "failures": []}, -220, -120),
        _code_node("builder_prompt", "Compose builder prompt", BUILDER_PROMPT_CODE, -220, 60,
                   [_pin("request", "request", "string"),
                    _pin("workspace_root", "workspace_root", "string"),
                    _pin("loop_state", "loop_state", "object")],
                   output_type="string"),
        _agent_node("builder", "Builder agent", 140, -40,
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
                      ("provider", "provider_text"), ("model", "model")], 500, 160),
        _subflow_node("verify", "Run gates", "coding-verify-gates", 500, -40),
        _get("get_verdict", "verdict", {}, 860, 120),
        _code_node("next_state", "Record verdict", NEXT_STATE_CODE, 860, 280,
                   [_pin("verifier", "verifier", "object"),
                    _pin("round_index", "round_index", "number")]),
        _set_var("set_state", "Persist loop state", "cg.loop_state", 860, 460),
        # --- after loop ---
        _get_var("get_final_state", "cg.loop_state",
                 {"rounds_completed": 0, "all_passed": False, "failures": []}, -200, 640),
        _code_node("final_report", "Assemble result", FINAL_REPORT_CODE, 160, 640,
                   [_pin("loop_state", "loop_state", "object")]),
        _get("get_report_md", "report_markdown", "", 520, 560),
        _get("get_passed", "passed", False, 520, 660),
        _get("get_rounds", "rounds_used", 0, 520, 760),
        _get("get_open_failures", "open_failures", [], 520, 860),
        _node("end", "on_flow_end", "Finish", 900, 640,
              inputs=[EXEC_IN,
                      _pin("report", "report", "string"),
                      _pin("passed", "passed", "boolean"),
                      _pin("rounds_used", "rounds_used", "number"),
                      _pin("open_failures", "open_failures", "array")]),
    ]
    flow["edges"] = [
        # exec spine
        _edge("start", "exec-out", "rounds", "exec-in", animated=True),
        _edge("rounds", "loop", "builder", "exec-in", animated=True),
        _edge("builder", "exec-out", "verify", "exec-in", animated=True),
        _edge("verify", "exec-out", "set_state", "exec-in", animated=True),
        _edge("rounds", "done", "end", "exec-in", animated=True),
        # loop condition (re-evaluated each iteration from the var)
        _edge("get_loop_state", "value", "loop_condition", "loop_state"),
        _edge("start", "max_rounds", "loop_condition", "max_rounds"),
        # boolean SUB-KEY of the code node's dict (dp-research idiom); a whole
        # dict on while.condition is always truthy -> infinite loop.
        _edge("loop_condition", "condition", "rounds", "condition"),
        # builder prompt
        _edge("get_state_body", "value", "builder_prompt", "loop_state"),
        _edge("start", "request", "builder_prompt", "request"),
        _edge("start", "workspace_root", "builder_prompt", "workspace_root"),
        _edge("builder_prompt", "output", "builder", "prompt"),
        _edge("start", "provider", "builder", "provider"),
        _edge("start", "model", "builder", "model"),
        _edge("start", "workspace_root", "builder", "workspace_root"),
        # verify subflow input: one object mapped by key to the child's
        # on_flow_start fields (the dp-research subflow convention).
        _edge("start", "request", "verify_input", "request"),
        _edge("start", "workspace_root", "verify_input", "workspace_root"),
        _edge("start", "build_command", "verify_input", "build_command"),
        _edge("start", "run_command", "verify_input", "run_command"),
        _edge("start", "provider", "verify_input", "provider"),
        _edge("start", "model", "verify_input", "model"),
        _edge("verify_input", "result", "verify", "input"),
        # verdict -> next state -> persist (output object carries {verdict})
        _edge("verify", "output", "get_verdict", "object"),
        _edge("get_verdict", "value", "next_state", "verifier"),
        _edge("rounds", "index", "next_state", "round_index"),
        _edge("next_state", "output", "set_state", "value"),
        # final report
        _edge("get_final_state", "value", "final_report", "loop_state"),
        _edge("final_report", "output", "get_report_md", "object"),
        _edge("final_report", "output", "get_passed", "object"),
        _edge("final_report", "output", "get_rounds", "object"),
        _edge("final_report", "output", "get_open_failures", "object"),
        _edge("get_report_md", "value", "end", "report"),
        _edge("get_passed", "value", "end", "passed"),
        _edge("get_rounds", "value", "end", "rounds_used"),
        _edge("get_open_failures", "value", "end", "open_failures"),
    ]
    return flow


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _validate_edges(flow: dict[str, Any]) -> list[str]:
    """Every edge endpoint must resolve to a node + declared pin — except a
    `code` node's source handles, which are runtime-resolved dict keys (the
    dp-research idiom, e.g. loop_condition.condition -> while.condition)."""
    ids = {n["id"] for n in flow["nodes"]}
    code_ids = {n["id"] for n in flow["nodes"] if n["data"].get("nodeType") == "code"}
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
        if e["source"] not in code_ids and e["sourceHandle"] not in pinmap[e["source"]][1]:
            problems.append(f"{e['id']}: no out-pin {e['source']}.{e['sourceHandle']}")
        if e["targetHandle"] not in pinmap[e["target"]][0]:
            problems.append(f"{e['id']}: no in-pin {e['target']}.{e['targetHandle']}")
    return problems


def main() -> int:
    flows = [build_verifier_subflow(), build_root_flow()]
    for flow in flows:
        problems = _validate_edges(flow)
        if problems:
            raise SystemExit(f"edge validation failed for {flow['id']}: {problems}")
        write_json(FLOWS_DIR / f"{flow['id']}.json", flow)

    sys.path.insert(0, str(ROOT / "abstractruntime" / "src"))
    from abstractruntime.workflow_bundle import pack_workflow_bundle
    from abstractruntime.visualflow_compiler import compiler as _compiler

    # Self-check: compile the tree through the real runtime compiler so a
    # broken graph fails the build, not a live run (adversary P1).
    _compiler.compile_visualflow_tree(
        root_id="coding-agent",
        flows_by_id={f["id"]: json.loads((FLOWS_DIR / f"{f['id']}.json").read_text()) for f in flows},
    )

    BUNDLES_DIR.mkdir(parents=True, exist_ok=True)
    pack_workflow_bundle(
        root_flow_json=FLOWS_DIR / "coding-agent.json",
        out_path=BUNDLE_PATH,
        bundle_id="coding-agent",
        bundle_version="0.1.0",
        flows_dir=FLOWS_DIR,
        entrypoints=["coding-agent"],
        default_entrypoint="coding-agent",
        metadata={
            "family": "coding-agent",
            "purpose": "recursive coding agent with independent build/execute/match verification and specific-failure reprompting",
            "outputs": ["report", "passed", "rounds_used", "open_failures"],
        },
    )
    print(f"Wrote {len(flows)} flows to {FLOWS_DIR}")
    print(f"Packed {BUNDLE_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
