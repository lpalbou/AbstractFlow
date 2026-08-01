#!/usr/bin/env python3
"""Shared VisualFlow node/edge builders for the framework workflow generators.

One source of the node-shape conventions so every generated workflow
(coding-agent, adversarial-review, structured-extract, map-reduce,
co-scientist) emits byte-consistent, runtime-compilable JSON. Mirrors the
idioms proven in build_deep_research_workflows.py.
"""
from __future__ import annotations

import json
import sys
import textwrap
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
FLOWS_DIR = ROOT / "abstractflow" / "examples" / "flows"
BUNDLES_DIR = ROOT / "abstractgateway" / "flows" / "bundles"

AGENT_INTERFACE = "abstractcode.agent.v1"

EXEC_IN = {"id": "exec-in", "label": "", "type": "execution"}
EXEC_OUT = {"id": "exec-out", "label": "", "type": "execution"}

_HEADER = {
    "on_flow_start": "#C0392B", "on_flow_end": "#C0392B", "subflow": "#00CCCC",
    "agent": "#4488FF", "llm_call": "#3498DB", "make_object": "#3498DB",
    "get": "#3498DB", "get_var": "#16A085", "set_var": "#16A085",
    "set_vars": "#16A085",
    "while": "#F39C12", "for": "#F39C12", "loop": "#F39C12",
    "code": "#9B59B6", "string_template": "#E74C3C", "stringify_json": "#3498DB",
}
_ICON = {
    "on_flow_start": "&#x1F3C1;", "on_flow_end": "&#x23F9;", "subflow": "&#x1F4E6;",
    "agent": "&#x1F916;", "llm_call": "&#x1F4AD;", "make_object": "{}",
    "get": "&#x1F4E5;", "get_var": "&#x1F4E5;", "set_var": "&#x1F4E4;",
    "set_vars": "&#x1F4E4;&#xFE0F;",
    "while": "&#x1F501;", "for": "&#x1F522;", "loop": "&#x1F501;",
    "code": "&#x1F9E9;", "string_template": "&#x1F9FE;", "stringify_json": "&#x1F4DD;",
}


def pin(pin_id: str, label: str, pin_type: str) -> dict[str, Any]:
    return {"id": pin_id, "label": label, "type": pin_type}


def node(node_id, node_type, label, x, y, *, inputs=None, outputs=None,
         pin_defaults=None, pin_expressions=None, extra=None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "nodeType": node_type, "label": label,
        "icon": _ICON.get(node_type, "&#x25A1;"),
        "headerColor": _HEADER.get(node_type, "#3498DB"),
        "inputs": inputs or [], "outputs": outputs or [],
    }
    if pin_defaults:
        data["pinDefaults"] = pin_defaults
    if pin_expressions:
        # Inline pin expressions (tier 1, 2026-07-25): {pin_id: "vars.x < 3"}.
        # Sandboxed Python evaluated at input resolution; reads vars.* and
        # `value` (the pin's wire/default). Own field — NEVER a pinDefaults
        # sentinel — so pre-expression runtimes skew safe (unread key -> pin
        # falls back to default -> falsy conditions keep loops bounded).
        data["pinExpressions"] = pin_expressions
    if extra:
        data.update(extra)
    return {"id": node_id, "type": node_type, "position": {"x": x, "y": y},
            "data": data, "label": None, "icon": None, "headerColor": None,
            "inputs": [], "outputs": []}


def with_expressions(node_dict: dict[str, Any], exprs: dict[str, str]) -> dict[str, Any]:
    """Attach pin expressions to an already-built node (for the typed helper
    builders like while_node/code_node that don't expose the kwarg)."""
    node_dict["data"]["pinExpressions"] = {
        **node_dict["data"].get("pinExpressions", {}), **exprs}
    return node_dict


def edge(source, source_handle, target, target_handle, *, animated=False):
    return {
        "id": f"e-{source}-{source_handle}-{target}-{target_handle}".replace(":", "-"),
        "source": source, "sourceHandle": source_handle,
        "target": target, "targetHandle": target_handle, "animated": animated,
    }


def base_flow(flow_id, name, description, interfaces=None, functions=None):
    now = datetime.now(timezone.utc).isoformat()
    flow = {"id": flow_id, "name": name, "description": description,
            "interfaces": interfaces or [], "nodes": [], "edges": [],
            "entryNode": "start", "created_at": now, "updated_at": now}
    if functions:
        # Flow-level named helper functions (tier 2, 2026-07-26): entries from
        # fn(...). Compiled runtime-side into the code-node sandbox; pin
        # expressions call them by name. Skew-safe: old runtimes read neither
        # this field nor pinExpressions.
        flow["functions"] = functions
    return flow


# The editor truncates a function description on load
# (useFlow.ts FUNCTION_DESCRIPTION_MAX). A longer one at rest is NOT inert: the
# normalized form differs from the JSON, so every load emits a spurious
# `set_function` authoring command and the document is dirty before the user
# touches it. Caught by the authoring round-trip adversary; refused at BUILD
# time here so it cannot ship again.
FUNCTION_DESCRIPTION_MAX = 300


def fn(name: str, code: str, *, kind: str = "", description: str = "") -> dict[str, Any]:
    """One flow-level function entry. `code` is the FULL `def name(...)` source
    (dedented); the def name must match `name` (runtime + editor both refuse a
    mismatch)."""
    if len(description) > FUNCTION_DESCRIPTION_MAX:
        raise AssertionError(
            f"function '{name}': description is {len(description)} chars, over the editor's "
            f"{FUNCTION_DESCRIPTION_MAX}-char cap — it would be truncated on load and make "
            "every open emit a set_function command. Put the long rationale in a comment "
            "in the generator instead.")
    entry: dict[str, Any] = {"name": name, "code": textwrap.dedent(code).strip() + "\n"}
    if kind:
        entry["kind"] = kind
    if description:
        entry["description"] = description
    return entry


def start_node(label, outputs, x, y, *, pin_defaults=None):
    return node("start", "on_flow_start", label, x, y,
                outputs=[EXEC_OUT, *outputs], pin_defaults=pin_defaults or {})


def end_node(label, inputs, x, y):
    return node("end", "on_flow_end", label, x, y, inputs=[EXEC_IN, *inputs])


def agent_node(node_id, label, x, y, *, extra_inputs=None, pin_defaults=None):
    inputs = [
        EXEC_IN,
        pin("provider", "provider", "provider_text"),
        pin("model", "model", "model"),
        pin("system", "system", "string"),
        pin("prompt", "prompt", "string"),
        pin("tools", "tools", "array"),
        pin("max_iterations", "max_iterations", "number"),
        pin("temperature", "temperature", "number"),
        pin("resp_schema", "resp_schema", "json_schema"),
        *(extra_inputs or []),
    ]
    outputs = [
        EXEC_OUT, pin("response", "response", "string"),
        pin("data", "data", "object"), pin("success", "success", "boolean"),
        pin("meta", "meta", "object"), pin("scratchpad", "scratchpad", "object"),
    ]
    return node(node_id, "agent", label, x, y, inputs=inputs, outputs=outputs,
                pin_defaults=pin_defaults or {})


def llm_node(node_id, label, x, y, *, pin_defaults=None):
    inputs = [
        EXEC_IN,
        pin("provider", "provider", "provider_text"),
        pin("model", "model", "model"),
        pin("system", "system", "string"),
        pin("prompt", "prompt", "string"),
        pin("tools", "tools", "array"),
        pin("temperature", "temperature", "number"),
        pin("resp_schema", "resp_schema", "json_schema"),
    ]
    outputs = [
        EXEC_OUT, pin("response", "response", "string"),
        pin("data", "data", "object"), pin("success", "success", "boolean"),
        pin("meta", "meta", "object"), pin("tool_calls", "tool_calls", "array"),
    ]
    # tools defaults to [] as a DECLARED pin default: declared defaults beat
    # ambient exec payload, so a host-injected `tools` key (abstractcode's
    # agent.v1 scaffold sets vars.tools to the session allowlist) can never
    # leak native tool declarations into a tool-free llm_call stage. Same
    # class as the import_workspace_file content_type lesson (2026-07-15;
    # adversary finding 2026-07-16). Callers may still override explicitly.
    defaults = {"tools": []}
    defaults.update(pin_defaults or {})
    return node(node_id, "llm_call", label, x, y, inputs=inputs, outputs=outputs,
                pin_defaults=defaults)


# The executor's exec-lane wrapper for `code` nodes REWRITES these keys on the
# node's output record after the body returns (`_create_data_aware_handler` ->
# `output_record_for_pins`): `success` becomes the HANDLER's success flag (True
# unless the body raised), and `output`/`result` become the whole returned dict.
# A pure code node stores its raw return instead, so a body that returns
# {"success": ...} means one thing pure and the OPPOSITE on the exec lane —
# a failing run would report success=True. Named output pins on an exec code
# node may therefore never use these names; `code_node` refuses at BUILD time.
_EXEC_RESERVED_OUTPUT_PINS = frozenset({"success", "output", "result", "error", "execution"})


def code_node(node_id, label, code_body, x, y, inputs, output_type="object",
              outputs=None, *, exec_pins=False):
    """Code node. By default it exposes the generic output/success/execution
    trio; pass `outputs` to declare NAMED result pins instead (the runtime maps
    a dict return onto edges by key, and declared pins make that fan-out
    VISIBLE on the canvas — multi-output folds are graph structure).

    `exec_pins=True` puts the node ON THE EXECUTION PATH (operator ruling
    2026-07-30: "code nodes have execution pins, otherwise it's a pure function
    OR a variable access"). It then runs ONCE, in exec order, instead of being
    re-pulled per consumer per resolution — which is both the point and the
    risk: only place a node on the exec lane where every consumer is reached
    strictly after it on EVERY path that reads it.
    """
    named = list(outputs) if outputs else None
    if exec_pins and named:
        clash = sorted(p["id"] for p in named if p["id"] in _EXEC_RESERVED_OUTPUT_PINS)
        if clash:
            raise AssertionError(
                f"code node '{node_id}': exec-lane output pin(s) {clash} collide with the "
                "executor's own record keys (output_record_for_pins overwrites them) — "
                "rename the pin and the returned key")
    return node(
        node_id, "code", label, x, y,
        inputs=([EXEC_IN] if exec_pins else []) + [*inputs, pin("permissions", "permissions", "string")],
        outputs=([EXEC_OUT] if exec_pins else []) + (named or [
            pin("output", "output", output_type),
            pin("success", "success", "boolean"),
            pin("execution", "execution", "object")]),
        pin_defaults={"permissions": "sandbox"},
        extra={"functionName": "transform", "codeBody": code_body},
    )


def get_var(node_id, name, default, x, y):
    return node(node_id, "get_var", f"Get {name}", x, y,
                inputs=[pin("name", "name", "string"), pin("default", "default", "any")],
                outputs=[pin("value", "value", "any")],
                pin_defaults={"name": name, "default": default})


def set_var(node_id, label, name, x, y):
    return node(node_id, "set_var", label, x, y,
                inputs=[EXEC_IN, pin("name", "name", "string"), pin("value", "value", "any")],
                outputs=[EXEC_OUT, pin("value", "value", "any")],
                pin_defaults={"name": name})


def set_vars(node_id, label, x, y, *, seed=None):
    """Write SEVERAL TOP-LEVEL run vars in one step (`updates` = {name: value}).

    THE ANTI-BLOB PRIMITIVE (operator ruling, standing since 2026-07-29: "the
    state blob ... is opaque and then we never see on the visual authoring
    which variable is actually used ... I would completely break / remove the
    state blob"). A `set_var{name:"state"}` writes ONE variable holding
    everything, so every reader downstream is `get_var{name:"state"}` plus a
    `.get()` buried in a body — the canvas can never say which variable a node
    uses. `set_vars` writes each key as its OWN top-level run var, so every
    reader becomes `get_var{name:"<that var>"}`: a chip the canvas draws, a
    name the variable picker offers, and a name `collectDeclaredVarNames`,
    typed-output inference and the preflight unknown-var check all understand.

    Runtime contract (`adapters/variable_adapter.create_set_vars_node_handler`):
    every key is validated BEFORE anything is applied (no partial writes),
    `_`-prefixed names are refused, dotted paths are honoured, and the node is
    pass-through (it never clobbers `_last_output`). No new node type is minted
    here — `set_vars` is in the shipped catalog (`src/types/nodes.ts`), so an
    older runtime is not fail-closed on it.

    `seed` (optional) is a pin DEFAULT for `updates`: the flow's whole run-var
    inventory, visible and editable on ONE node, and the fail-closed value if
    the wire ever goes missing. A wire always wins over a default, so this
    changes no behaviour on a healthy run.
    """
    return node(node_id, "set_vars", label, x, y,
                inputs=[EXEC_IN, pin("updates", "updates", "object")],
                outputs=[EXEC_OUT, pin("updates", "updates", "object")],
                pin_defaults=({"updates": seed} if seed is not None else None))


def while_node(node_id, label, x, y):
    return node(node_id, "while", label, x, y,
                inputs=[EXEC_IN, pin("condition", "condition", "boolean")],
                outputs=[pin("loop", "loop", "execution"),
                         pin("done", "done", "execution"),
                         pin("index", "index", "number"),
                         pin("item", "item", "any")],
                pin_defaults={"condition": True})


def foreach_node(node_id, label, x, y):
    # ForEach is node type `loop` in the catalog.
    return node(node_id, "loop", label, x, y,
                inputs=[EXEC_IN, pin("items", "items", "array")],
                outputs=[pin("loop", "loop", "execution"),
                         pin("done", "done", "execution"),
                         pin("item", "item", "any"),
                         pin("index", "index", "number")])


def make_object(node_id, fields, x, y):
    return node(node_id, "make_object", "Build JSON", x, y,
                inputs=[pin(f, f, t) for f, t in fields],
                outputs=[pin("result", "result", "object")])


def get_node(node_id, key, default, x, y):
    return node(node_id, "get", f"Get {key}", x, y,
                inputs=[pin("object", "object", "object"),
                        pin("key", "key", "string"),
                        pin("default", "default", "any")],
                outputs=[pin("value", "value", "any")],
                pin_defaults={"key": key, "default": default})


def subflow_node(node_id, label, flow_id, x, y, *, child_inputs=None, child_outputs=None):
    """A subflow call whose CONTRACT IS ON THE CANVAS, in both directions.

    `child_inputs` DECLARES the child's on_flow_start fields as input pins on
    THIS node, so the caller wires each one — instead of feeding a single
    opaque `input:object` pin built by an off-canvas code/make_object node.
    Operator ruling 2026-07-30:

    > "I do not understand how you can call a subflow without setting the
    > input. ... Whenever you are NOT using the pins, it means you are HIDING
    > something and that's very bad."

    MECHANISM (measured, not assumed — `probe_pins.py`, real scheduler):
    `executor._create_subflow_effect_builder` collects every declared non-exec
    input pin id (minus the `inherit_context`/session control pins) and does
    `if pid in input_data: base[pid] = input_data.get(pid)` — so each declared
    pin lands in the child's run vars UNDER ITS OWN NAME. This mirrors the
    output side (`child_outputs`) exactly.

    ABSENT MEANS ABSENT (measured): a declared pin with no wire AND no pin
    default never reaches `input_data` at all (`_create_data_aware_handler`
    only seeds resolved_input from wires + pinDefaults), so it is NOT written
    into the child vars and the CHILD's own on_flow_start default applies. An
    unwired optional therefore cannot shadow a child-side default. (A pin that
    IS wired and carries None does write None, and None DOES shadow the child's
    start-pin default — so wire a pin only when the parent really owns the
    value.)

    `child_outputs` DECLARES the child's on_flow_end fields as output pins on
    THIS node, so each is a plain source handle a wire can leave from. The
    executor turns every declared non-exec output pin (except `output`) into
    the effect's `output_pins` list, and the compiler then spreads the child's
    result dict onto them by key (`compiler._sync_effect_results_to_node_outputs`,
    `elif effect_type == "start_subworkflow"`). That is what makes
    `sub.report` resolvable — and what lets a consumer WIRE the field instead
    of carrying `(value or {}).get("report", "")` as an invisible pin
    expression.

    `output` / `child_output` stay declared on every node: `output` is the raw
    child result dict and is the ONE pin the declared-pin spread skips by name,
    so it is the only surviving death channel when a child run dies before its
    on_flow_end. `child_output` is runtime-provided and declared so wires from
    it survive the editor's load-time pin-existence check.

    Skew note: on a runtime that ignores `output_pins`, the extra handles
    resolve to nothing and the consumer pin falls to its default — the same
    fail-closed direction the expression lane already had, and the bundle's
    `metadata.min_runtime` refuses old gateways outright. A runtime that
    ignores declared INPUT pins would send the child an empty var set; the same
    `min_runtime` gate refuses it outright rather than running half-configured.

    NOTE the editor's interface sync (`src/utils/subflowPins.ts`) leaves a
    WIRED node alone in either convention — `subflowPinPatchForSelectedFlow`
    returns null for any node that already carries a data edge, so a per-field
    node keeps `output`/`child_output` and its authored pin subset.
    """
    per_field = [pin(p, p, t) for p, t in (child_inputs or [])]
    extra_outputs = [pin(p, p, t) for p, t in (child_outputs or [])]
    return node(node_id, "subflow", label, x, y,
                inputs=[EXEC_IN, pin("inherit_context", "inherit_context", "boolean"),
                        *(per_field or [pin("input", "input", "object")])],
                outputs=[EXEC_OUT, pin("output", "output", "object"),
                         pin("child_output", "child_output", "object"),
                         *extra_outputs],
                pin_defaults={"inherit_context": False},
                extra={"subflowId": flow_id})


def template_node(node_id, template_text, x, y):
    return node(node_id, "string_template", "Compose", x, y,
                inputs=[pin("template", "template", "string"),
                        pin("vars", "vars", "object")],
                outputs=[pin("result", "result", "string")],
                pin_defaults={"template": template_text})


# --- the LOOP-FAMILY catalog builders (added 2026-07-31 for the hand-built
# llm_call+tool loops: react-coder / ralph-coder). Every one of these node
# shapes already existed as a PRIVATE copy inside
# build_multiagent_coding_workflow.py; a second and third call site is exactly
# the promotion rule the doctrine states ("promote at the SECOND call site"),
# so they live here now. The multiagent generator keeps its own copies
# deliberately: touching it would re-emit a shipped, live-proven bundle for a
# refactor's benefit. Additive only — no existing helper changed.


def call_tool_node(node_id, label, allowed, x, y):
    """ONE deterministic tool call on the exec lane (`tool_call` = {name,
    arguments, call_id}). `allowed` is the node-local allowlist: the runtime
    refuses anything else even if a composer names it."""
    return node(node_id, "call_tool", label, x, y,
                inputs=[EXEC_IN, pin("tool_call", "tool_call", "object"),
                        pin("allowed_tools", "allowed_tools", "array")],
                outputs=[EXEC_OUT, pin("result", "result", "any"),
                         pin("success", "success", "boolean"),
                         pin("raw", "raw", "object")],
                pin_defaults={"allowed_tools": allowed},
                extra={"icon": "&#x1F527;", "headerColor": "#16A085"})


def tool_calls_node(node_id, label, allowed, x, y):
    """The MODEL's tool calls execute (the act half of a ReAct step).

    `allowed_tools` is BOTH a pin default and `effectConfig.allowed_tools`
    (the agora-react-agent idiom): the pin is what an author edits on the
    canvas, the effect config is what the runtime enforces when the pin is
    unwired. Outputs `results` (per-call {call_id,name,success,output,error})
    and a `success` that is True only when EVERY call succeeded."""
    return node(node_id, "tool_calls", label, x, y,
                inputs=[EXEC_IN, pin("tool_calls", "tool_calls", "array"),
                        pin("allowed_tools", "allowed_tools", "array")],
                outputs=[EXEC_OUT, pin("results", "results", "array"),
                         pin("success", "success", "boolean")],
                pin_defaults={"allowed_tools": allowed},
                extra={"icon": "&#x1F528;", "headerColor": "#16A085",
                       "effectConfig": {"allowed_tools": allowed}})


def has_tools_node(node_id, label, x, y):
    """Pure predicate: did the model ask for tools? (the ReAct branch)."""
    return node(node_id, "has_tools", label, x, y,
                inputs=[pin("array", "array", "array")],
                outputs=[pin("result", "result", "boolean")],
                extra={"icon": "&#x1F50D;", "headerColor": "#E74C3C"})


def format_tool_results_node(node_id, label, x, y):
    """Pure: runtime-owned rendering of tool results as observation text.

    The runtime owns the result envelope, so it owns the renderer — a
    flow-local formatter re-forks a shape that has changed under flows
    before (same argument as the promoted `text_of` builtin)."""
    return node(node_id, "format_tool_results", label, x, y,
                inputs=[pin("results", "results", "array")],
                outputs=[pin("result", "result", "string")],
                extra={"icon": "&#x1F4CB;", "headerColor": "#3498DB"})


def stringify_json_node(node_id, label, x, y, *, mode="minified"):
    """Pure: any value -> text (runtime-owned JSON writer)."""
    return node(node_id, "stringify_json", label, x, y,
                inputs=[pin("value", "value", "any"), pin("mode", "mode", "string")],
                outputs=[pin("result", "result", "string")],
                pin_defaults={"mode": mode})


def if_node(node_id, label, x, y):
    return node(node_id, "if", label, x, y,
                inputs=[EXEC_IN, pin("condition", "condition", "boolean")],
                outputs=[pin("true", "true", "execution"),
                         pin("false", "false", "execution")],
                extra={"icon": "&#x1F500;", "headerColor": "#F39C12"})


def ask_user_node(node_id, label, x, y, *, prompt_default="", choices=None):
    """The human gate. Runs ONLY behind a wait-mode `if` — an auto run must
    execute zero of these (the multiagent invariant, kept)."""
    defaults = {"prompt": prompt_default}
    if choices is not None:
        defaults["choices"] = choices
    return node(node_id, "ask_user", label, x, y,
                inputs=[EXEC_IN, pin("prompt", "prompt", "string"),
                        pin("choices", "choices", "array")],
                outputs=[EXEC_OUT, pin("response", "response", "string")],
                pin_defaults=defaults,
                extra={"icon": "&#x2753;", "headerColor": "#9B59B6"})


def answer_user_node(node_id, label, x, y, *, level="message"):
    """One run-visible progress line (the TUI's live channel)."""
    return node(node_id, "answer_user", label, x, y,
                inputs=[EXEC_IN, pin("message", "message", "string"),
                        pin("level", "level", "string")],
                outputs=[EXEC_OUT, pin("message", "message", "string")],
                pin_defaults={"level": level},
                extra={"icon": "&#x1F4AC;", "headerColor": "#9B59B6"})


def read_pin(N, E, node_id, pin_id, var_name, default, x, y, *, chip=None):
    """Feed ONE input pin from a Get Variable chip instead of a pin expression.

    `get_var` resolves DOTTED paths (`_runtime.inbox`) and returns `default`
    when any segment is missing, so this is an exact replacement for an
    access expression — and the canvas draws the read (operator ruling
    2026-07-30). Positions are seeds only; `apply_flow_layout` docks folded
    chips beside their consumer."""
    chip_id = chip or f"{node_id}_{pin_id}"
    N.append(get_var(chip_id, var_name, default, x, y))
    E.append(edge(chip_id, "value", node_id, pin_id))


def read_vars(N, E, node_id, specs, x, y):
    """One Get Variable chip per run var a node reads — the anti-blob move.

    Each entry is `(pin_id, var_name, default)`. The chips stacked beside a
    node ARE the list of variables it uses, readable without opening it."""
    for pin_id, var_name, default in specs:
        read_pin(N, E, node_id, pin_id, var_name, default, x, y)
        y -= 140


def system_datetime_node(node_id, label, x, y):
    """Pure source node: current time (iso/timezone/...). No exec pins."""
    return node(node_id, "system_datetime", label, x, y,
                outputs=[pin("iso", "iso", "string"),
                         pin("timezone", "timezone", "string"),
                         pin("utc_offset_minutes", "utc_offset_minutes", "number"),
                         pin("locale", "locale", "string")])


def write_file_node(node_id, label, x, y):
    """Write text to a workspace-relative path. Returns bytes + resolved path."""
    return node(node_id, "write_file", label, x, y,
                inputs=[EXEC_IN, pin("file_path", "file_path", "workspace_file"),
                        pin("content", "content", "any")],
                outputs=[EXEC_OUT, pin("bytes", "bytes", "number"),
                         pin("file_path", "file_path", "workspace_file")])


def write_pdf_node(node_id, label, x, y):
    """Render markdown content to a PDF at a workspace path (bytes+sha256+path)."""
    return node(node_id, "write_pdf", label, x, y,
                inputs=[EXEC_IN, pin("file_path", "file_path", "workspace_file"),
                        pin("content", "content", "any"), pin("title", "title", "string")],
                outputs=[EXEC_OUT, pin("bytes", "bytes", "number"),
                         pin("file_path", "file_path", "workspace_file"),
                         pin("sha256", "sha256", "string"),
                         pin("content_type", "content_type", "string")])


def write_chart_node(node_id, label, x, y):
    """Render a STRUCTURED chart spec to a workspace PNG (+ .pdf sibling).

    First-class runtime effect node (write_pdf trust class, operator ruling
    2026-07-20): no shell, no approval prompt — the in-process replacement
    for the write-script-then-execute_command lane. Render failures return
    ok:false + warnings (never a flow failure) so callers keep honest
    text fallbacks.
    """
    return node(node_id, "write_chart", label, x, y,
                inputs=[EXEC_IN, pin("file_path", "file_path", "workspace_file"),
                        pin("spec", "spec", "object")],
                outputs=[EXEC_OUT, pin("ok", "ok", "boolean"),
                         pin("rendered", "rendered", "boolean"),
                         pin("file_path", "file_path", "workspace_file"),
                         pin("pdf_path", "pdf_path", "string"),
                         pin("error", "error", "string"),
                         pin("warnings", "warnings", "array")])


def write_docx_node(node_id, label, x, y):
    """Render markdown content to a DOCX at a workspace path (bytes+sha256+path)."""
    return node(node_id, "write_docx", label, x, y,
                inputs=[EXEC_IN, pin("file_path", "file_path", "workspace_file"),
                        pin("content", "content", "any"), pin("title", "title", "string")],
                outputs=[EXEC_OUT, pin("bytes", "bytes", "number"),
                         pin("file_path", "file_path", "workspace_file"),
                         pin("sha256", "sha256", "string"),
                         pin("content_type", "content_type", "string")])


def import_workspace_file_node(node_id, label, x, y, *, content_type=None):
    """Snapshot a workspace file into a durable run artifact (id + ref + meta).

    This is the registration lane for report products: write_* nodes only
    place bytes in the workspace folder; only an artifact-store write makes a
    file listable/servable per run (observer's durable-artifacts finding).

    ALWAYS pass an explicit content_type when the file type is known:
    exec-chained nodes receive the previous node's output as their base
    payload, so an unconnected content_type input INHERITS any upstream
    "content_type" output (live incident 2026-07-15: three report imports all
    registered as DOCX because write_docx ran just before them). An explicit
    pin default is both honest and leak-proof.
    """
    pin_defaults = {"content_type": content_type} if content_type else None
    return node(node_id, "import_workspace_file", label, x, y,
                inputs=[EXEC_IN, pin("file_path", "file_path", "workspace_file"),
                        pin("content_type", "content_type", "string")],
                outputs=[EXEC_OUT, pin("artifact", "artifact", "artifact"),
                         pin("artifact_ref", "artifact_ref", "artifact"),
                         pin("artifact_id", "artifact_id", "string"),
                         pin("content_type", "content_type", "string"),
                         pin("size_bytes", "size_bytes", "number"),
                         pin("source_path", "source_path", "workspace_file")],
                pin_defaults=pin_defaults)


# --- Entity mind nodes (the entity "brain" lane, backlog 0153) --------------
# First-class MEMORY_*/DIARY_* effect nodes. Handlers resolve ONLY on an
# entity runtime (gateway door stamp routing / open_entity_runtime); the
# channel carries authorship — no node takes an "entity" pin by design.


def memory_recall_node(node_id, label, x, y, *, pin_defaults=None):
    """Passive/deliberate reconstruction: one bounded recall (pure read)."""
    return node(node_id, "memory_recall", label, x, y,
                inputs=[EXEC_IN,
                        pin("cue_text", "cue_text", "string"),
                        pin("scopes", "scopes", "array"),
                        pin("view", "view", "string"),
                        pin("effort", "effort", "string"),
                        pin("budget", "budget", "object"),
                        pin("participants", "participants", "array"),
                        pin("anchor_record_ids", "anchor_record_ids", "array"),
                        pin("turn_id", "turn_id", "string")],
                outputs=[EXEC_OUT,
                         pin("handles", "handles", "array"),
                         pin("trace_id", "trace_id", "string"),
                         pin("as_of_seq", "as_of_seq", "number"),
                         pin("result", "result", "object"),
                         pin("success", "success", "boolean")],
                pin_defaults=pin_defaults)


def memory_commit_node(node_id, label, x, y, *, pin_defaults=None):
    """The involuntary trail: commit the selection actually used (the ONLY strengthening path)."""
    return node(node_id, "memory_commit", label, x, y,
                inputs=[EXEC_IN,
                        pin("trace_id", "trace_id", "string"),
                        pin("used_record_ids", "used_record_ids", "array"),
                        pin("prompt_token_estimate", "prompt_token_estimate", "number")],
                outputs=[EXEC_OUT,
                         pin("committed", "committed", "number"),
                         pin("result", "result", "object"),
                         pin("success", "success", "boolean")],
                pin_defaults=pin_defaults)


def memory_form_node(node_id, label, x, y, *, pin_defaults=None):
    """Formation: land typed records (episode/summary/lesson/...) in the graph."""
    return node(node_id, "memory_form", label, x, y,
                inputs=[EXEC_IN,
                        pin("records", "records", "array"),
                        pin("scope", "scope", "string"),
                        pin("turn_id", "turn_id", "string"),
                        pin("idempotency_key", "idempotency_key", "string")],
                outputs=[EXEC_OUT,
                         pin("record_ids", "record_ids", "array"),
                         pin("formed", "formed", "number"),
                         pin("result", "result", "object"),
                         pin("success", "success", "boolean")],
                pin_defaults=pin_defaults)


def memory_adjust_node(node_id, label, x, y, *, pin_defaults=None):
    """Deliberate salience act: reinforce / attenuate / refocus / close
    (reason + turn_id mandatory). ttl_activity (NOT ttl) + scope were
    MISSING here (cleanup adversary P0-1.1, 2026-07-25) — recreating the
    exact starvation the executor comment memorializes: an adjust node
    built from this helper could never bound a refocus."""
    return node(node_id, "memory_adjust", label, x, y,
                inputs=[EXEC_IN,
                        pin("op", "op", "string"),
                        pin("record_id", "record_id", "string"),
                        pin("reason", "reason", "string"),
                        pin("weight", "weight", "number"),
                        pin("ttl_activity", "ttl_activity", "number"),
                        pin("scope", "scope", "string"),
                        pin("turn_id", "turn_id", "string")],
                outputs=[EXEC_OUT,
                         pin("result", "result", "object"),
                         pin("success", "success", "boolean")],
                pin_defaults=pin_defaults)


def memory_appraise_node(node_id, label, x, y, *, pin_defaults=None):
    """Feelings: elected valence toward a target (routine band ±1..3, clamped loudly)."""
    return node(node_id, "memory_appraise", label, x, y,
                inputs=[EXEC_IN,
                        pin("op", "op", "string"),
                        pin("target_id", "target_id", "string"),
                        pin("sign", "sign", "number"),
                        pin("magnitude", "magnitude", "number"),
                        pin("reason", "reason", "string"),
                        pin("scope", "scope", "string"),
                        pin("turn_id", "turn_id", "string")],
                outputs=[EXEC_OUT,
                         pin("result", "result", "object"),
                         pin("success", "success", "boolean")],
                pin_defaults=pin_defaults)


def diary_write_node(node_id, label, x, y, *, pin_defaults=None):
    """The book: append one entity-elected entry (sole-author chain + projection).

    digest_method (optional, runtime c5271): WRITER-declared mechanical
    authorship — set it ONLY on machine-worded writes (deterministic close
    notes); entity-elected words must never carry it."""
    return node(node_id, "diary_write", label, x, y,
                inputs=[EXEC_IN,
                        pin("text", "text", "string"),
                        pin("gist", "gist", "string"),
                        pin("kind", "kind", "string"),
                        pin("visibility", "visibility", "string"),
                        pin("anchor_graph_ids", "anchor_graph_ids", "array"),
                        pin("turn_id", "turn_id", "string"),
                        pin("digest_method", "digest_method", "string")],
                outputs=[EXEC_OUT,
                         pin("entry_id", "entry_id", "string"),
                         pin("projected_record_id", "projected_record_id", "string"),
                         pin("result", "result", "object"),
                         pin("success", "success", "boolean")],
                pin_defaults=pin_defaults)


def diary_read_node(node_id, label, x, y, *, pin_defaults=None):
    """Read one diary entry by id (re-entry key + birth trail included)."""
    return node(node_id, "diary_read", label, x, y,
                inputs=[EXEC_IN,
                        pin("entry_id", "entry_id", "string"),
                        pin("reason", "reason", "string")],
                outputs=[EXEC_OUT,
                         pin("text", "text", "string"),
                         pin("result", "result", "object"),
                         pin("success", "success", "boolean")],
                pin_defaults=pin_defaults)


def memory_consolidate_node(node_id, label, x, y, *, pin_defaults=None):
    """The night: ONE engine sleep_pass (resolution, maintenance, world
    models, mining, identity review, dream). Honest non-runs return
    {ran: false, reason} (lease-held / operator-paused)."""
    return node(node_id, "memory_consolidate", label, x, y,
                inputs=[EXEC_IN,
                        pin("scopes", "scopes", "array"),
                        pin("include_dream", "include_dream", "boolean"),
                        pin("include_identity", "include_identity", "boolean"),
                        pin("report_only", "report_only", "boolean"),
                        pin("max_candidates", "max_candidates", "number"),
                        pin("scan_limit", "scan_limit", "number")],
                outputs=[EXEC_OUT,
                         pin("ran", "ran", "boolean"),
                         pin("reason", "reason", "string"),
                         pin("dream_record_id", "dream_record_id", "string"),
                         pin("maintenance_candidates", "maintenance_candidates", "array"),
                         pin("result", "result", "object"),
                         pin("success", "success", "boolean")],
                pin_defaults=pin_defaults)


def memory_probe_node(node_id, label, x, y, *, pin_defaults=None):
    """Deliberate reach (active reconstruction): probe / expand / familiarity.
    reason is MANDATORY on probe+expand (deliberate acts are audited)."""
    return node(node_id, "memory_probe", label, x, y,
                inputs=[EXEC_IN,
                        pin("op", "op", "string"),
                        pin("cue", "cue", "string"),
                        pin("record_ids", "record_ids", "array"),
                        pin("reason", "reason", "string"),
                        pin("effort", "effort", "string")],
                outputs=[EXEC_OUT,
                         pin("hits", "hits", "array"),
                         pin("result", "result", "object"),
                         pin("success", "success", "boolean")],
                pin_defaults=pin_defaults)


def memory_tend_node(node_id, label, x, y, *, pin_defaults=None):
    """Tending elections: the ONE route shared with the chat driver
    (memory's ```tend grammar — pin/silence/refocus/heal_scar/break_bond/
    revisit/dispose). body = the fence body VERBATIM (grammar stays
    engine-owned); refusals return as DATA, never fail the effect.
    Empty body fails loudly — gate dispatch on has_tend.

    channel (runtime tend.py 2026-07-25): the door-verified reflection
    channel — tending REFUSES without it (the privileged default was
    removed, memory's P0-1 fix). On the door lane the gate injects it from
    the verified stamp; a home-direct flow states 'entity-reflection' where
    it is true by construction (own time is the entity's own reflection)."""
    return node(node_id, "memory_tend", label, x, y,
                inputs=[EXEC_IN,
                        pin("body", "body", "string"),
                        pin("scope", "scope", "string"),
                        pin("channel", "channel", "string")],
                outputs=[EXEC_OUT,
                         pin("applied", "applied", "array"),
                         pin("refused", "refused", "array"),
                         pin("result", "result", "object"),
                         pin("success", "success", "boolean")],
                pin_defaults=pin_defaults)


def life_query_node(node_id, label, x, y, *, pin_defaults=None):
    """Life reads: alive_drives / cognition_health / entity_card (pure)."""
    return node(node_id, "life_query", label, x, y,
                inputs=[EXEC_IN,
                        pin("op", "op", "string"),
                        pin("k", "k", "number"),
                        pin("as_of", "as_of", "number")],
                outputs=[EXEC_OUT,
                         pin("items", "items", "array"),
                         pin("result", "result", "object"),
                         pin("success", "success", "boolean")],
                pin_defaults=pin_defaults)


def entity_tools_query_node(node_id, label, x, y, *, pin_defaults=None):
    """The phase's tool grant resolves (pure read): tool_policy.yaml when the
    operator wrote one, the RULED per-phase defaults otherwise. Outputs the
    granted names (`tools` — taught in the shelf prompt) and the native
    declaration specs (the llm tools pin). The grant is the ONE authority —
    execution re-resolves it server-side; this node can never widen it
    (operator find 2026-07-25: the flow lane served zero tools). Pins mirror
    runtime identity/tool_effects.py ENTITY_TOOLS_QUERY exactly."""
    return node(node_id, "entity_tools_query", label, x, y,
                inputs=[EXEC_IN,
                        pin("phase", "phase", "string")],
                outputs=[EXEC_OUT,
                         pin("tools", "tools", "array"),
                         pin("specs", "specs", "array"),
                         pin("notes", "notes", "array"),
                         pin("source", "source", "string"),
                         pin("success", "success", "boolean")],
                pin_defaults=pin_defaults)


def entity_tools_execute_node(node_id, label, x, y, *, pin_defaults=None):
    """ONE batch of native tool calls executes under the grant (runtime
    re-resolves the grant at execution — 'refuse at execution regardless';
    tier gating stays runtime-owned; rounds live in the FLOW graph).
    Refusals return as marker lines (`markers`, shown to the mind verbatim);
    `tools_ran` carries the host-authored unique names for the tool gauge
    (never parsed from prose). Pins mirror runtime identity/tool_effects.py
    ENTITY_TOOLS_EXECUTE exactly."""
    return node(node_id, "entity_tools_execute", label, x, y,
                inputs=[EXEC_IN,
                        pin("tool_calls", "tool_calls", "array"),
                        pin("phase", "phase", "string"),
                        pin("max_calls", "max_calls", "number")],
                outputs=[EXEC_OUT,
                         pin("results_message", "results_message", "string"),
                         pin("tools_ran", "tools_ran", "array"),
                         pin("results", "results", "array"),
                         pin("markers", "markers", "array"),
                         pin("notices", "notices", "array"),
                         pin("success", "success", "boolean")],
                pin_defaults=pin_defaults)


# --- THE node box model (0156 Stage 1 item 2) --------------------------------
# ONE source of node geometry, consumed by the layout below, by
# `layout_overlap_findings`, and by `audit_flow_graph.py` (which imports
# `node_box` rather than keeping a third guess). Matches Canvas.tsx: a node is
# NODE_WIDTH wide and grows a PIN_ROW_H row per data pin over a fixed chrome
# height, never shrinking below CANVAS_MIN_HEIGHT.
CANVAS_MIN_WIDTH = 320.0
CANVAS_MIN_HEIGHT = 220.0
NODE_WIDTH = CANVAS_MIN_WIDTH
NODE_CHROME_H = 90.0
PIN_ROW_H = 26.0
COLUMN_GAP_X = 160.0
NODE_GAP_Y = 100.0
EXEC_BRANCH_LANE_GAP_Y = 120.0
_BRANCH_HANDLES = frozenset({"done", "false"})
_LAYOUT_TRIGGERS = {"on_flow_start", "on_user_request", "on_agent_message", "on_event"}


def data_pin_count(node: dict[str, Any], key: str) -> int:
    """Non-execution pins on `inputs` / `outputs` — the rows a node draws."""
    return len([
        p for p in (node.get("data") or {}).get(key) or []
        if isinstance(p, dict) and p.get("type") != "execution"
    ])


def node_height(node: dict[str, Any]) -> float:
    rows = max(data_pin_count(node, "inputs"), data_pin_count(node, "outputs"))
    return max(NODE_CHROME_H + PIN_ROW_H * rows, CANVAS_MIN_HEIGHT)


def node_box(node: dict[str, Any]) -> tuple[float, float, float, float]:
    """Approximate rendered box (x, y, w, h). THE box model — see above."""
    pos = node.get("position") or {}
    return (float(pos.get("x") or 0.0), float(pos.get("y") or 0.0),
            NODE_WIDTH, node_height(node))


def boxes_overlap(a: tuple, b: tuple) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def has_exec_pin(node: dict[str, Any]) -> bool:
    """Does the node declare any execution pin? (pure/lazy nodes do not)."""
    data = node.get("data") or {}
    for key in ("inputs", "outputs"):
        for pin in data.get(key) or []:
            if isinstance(pin, dict) and pin.get("type") == "execution":
                return True
    return False


# Folded-getter chip geometry (0156 Stage 1). The editor renders a folded read
# as a pill ON the consumer's pin row, so the node card itself is only ever
# seen when revealed by selection — it is docked in the consumer's left gutter,
# aligned to the pin row it feeds, and contributes NO height to the column.
FOLDED_GETTER_WIDTH = 140.0
FOLDED_GETTER_GUTTER_X = 15.0
_PIN_ROW_HEADER_H = 44.0
_PIN_ROW_H = 26.0


def folded_getter_ids(flow: dict[str, Any]) -> dict[str, tuple[str, str]]:
    """Folded getter id -> (consumer id, consumer input pin id).

    PARITY predicate with `src/utils/foldedGetters.ts` (computeFoldedGetters) —
    a `get_var` folds when its `pinDefaults.name` is a non-empty string, it has
    no incoming edges, and exactly one edge leaves its `value` pin to an
    existing target. The two implementations are pinned together by tests
    asserting the same fold count on the same shipped flow — change one,
    change both.
    """
    nodes = {n["id"]: n for n in flow.get("nodes") or []}
    outgoing: dict[str, list[dict[str, Any]]] = {}
    has_incoming: set[str] = set()
    for edge in flow.get("edges") or []:
        outgoing.setdefault(edge.get("source"), []).append(edge)
        has_incoming.add(edge.get("target"))

    folded: dict[str, tuple[str, str]] = {}
    for node_id, node in nodes.items():
        data = node.get("data") or {}
        if data.get("nodeType") != "get_var":
            continue
        name = (data.get("pinDefaults") or {}).get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        if node_id in has_incoming:
            continue
        outs = outgoing.get(node_id) or []
        if len(outs) != 1:
            continue
        edge = outs[0]
        if (edge.get("sourceHandle") or "value") != "value":
            continue
        target = edge.get("target")
        target_handle = edge.get("targetHandle")
        if target not in nodes or not target_handle:
            continue
        folded[node_id] = (target, str(target_handle))
    return folded


def _dock_folded_getters(
    nodes: dict[str, dict[str, Any]], folded: dict[str, tuple[str, str]]
) -> None:
    """Place each folded getter in its consumer's left gutter, aligned to the
    pin row it feeds. Position only matters when the author reveals the chip
    (selection); it never participates in column stacking or overlap."""
    for getter_id, (consumer_id, pin_id) in folded.items():
        consumer = nodes.get(consumer_id)
        getter = nodes.get(getter_id)
        if not consumer or not getter:
            continue
        cpos = consumer.get("position") or {}
        data = consumer.get("data") or {}
        data_pins = [
            p for p in data.get("inputs") or [] if isinstance(p, dict) and p.get("type") != "execution"
        ]
        row = next((i for i, p in enumerate(data_pins) if p.get("id") == pin_id), 0)
        getter["position"] = {
            "x": float(cpos.get("x") or 0.0) - FOLDED_GETTER_WIDTH - FOLDED_GETTER_GUTTER_X,
            "y": float(cpos.get("y") or 0.0) + _PIN_ROW_HEADER_H + row * _PIN_ROW_H,
        }


def apply_flow_layout(flow: dict[str, Any]) -> None:
    """Assign left-to-right positions from exec depth (zero-overlap audit model).

    Exec nodes receive a column from longest-path BFS off trigger nodes.
    Pure (non-exec) helpers share the column of their nearest downstream
    exec consumer and stack above the exec lane within that column.
    """
    nodes = {n["id"]: n for n in flow["nodes"]}
    edges = flow.get("edges") or []
    # Folded getters (0156): rendered as pin-row pills, so they get NO column
    # cell — they are docked beside their consumer after the columns land.
    folded = folded_getter_ids(flow)
    exec_edges: list[tuple[str, str, str]] = []
    data_successors: dict[str, list[str]] = {}
    for edge in edges:
        target_handle = str(edge.get("targetHandle") or "")
        source_handle = str(edge.get("sourceHandle") or "")
        if target_handle == "exec-in":
            exec_edges.append((edge["source"], edge["target"], source_handle))
            continue
        if source_handle in ("exec-out", "true", "false", "loop", "done"):
            continue
        data_successors.setdefault(edge["source"], []).append(edge["target"])

    depth: dict[str, int] = {}
    lane: dict[str, int] = {}
    for node_id, node in nodes.items():
        if (node.get("data") or {}).get("nodeType") in _LAYOUT_TRIGGERS:
            depth[node_id] = 0
            lane[node_id] = 0
    changed = True
    while changed:
        changed = False
        for source_id, target_id, source_handle in exec_edges:
            if source_id not in depth:
                continue
            next_depth = depth[source_id] + 1
            next_lane = 1 if source_handle in _BRANCH_HANDLES else lane.get(source_id, 0)
            if depth.get(target_id, -1) < next_depth:
                depth[target_id] = next_depth
                lane[target_id] = next_lane
                changed = True
            elif depth.get(target_id, -1) == next_depth and lane.get(target_id, 0) < next_lane:
                lane[target_id] = next_lane
                changed = True

    for _ in range(len(nodes)):
        for node_id, node in nodes.items():
            if node_id in depth or has_exec_pin(node):
                continue
            consumer_depths = [
                depth[consumer_id]
                for consumer_id in data_successors.get(node_id, [])
                if consumer_id in depth
            ]
            if consumer_depths:
                best_depth = min(consumer_depths)
                depth[node_id] = best_depth
                consumers_at_depth = [
                    consumer_id
                    for consumer_id in data_successors.get(node_id, [])
                    if depth.get(consumer_id) == best_depth
                ]
                if consumers_at_depth:
                    lane[node_id] = min(lane.get(consumer_id, 0) for consumer_id in consumers_at_depth)

    fallback = max(depth.values()) if depth else 0
    for node_id, node in nodes.items():
        if node_id not in depth:
            depth[node_id] = fallback
        lane.setdefault(node_id, 0)

    by_depth: dict[int, list[str]] = {}
    for node_id, column in depth.items():
        by_depth.setdefault(column, []).append(node_id)

    def _lane_ids(column_ids: list[str], lane_index: int) -> tuple[list[str], list[str]]:
        lane_ids = [
            node_id
            for node_id in column_ids
            if lane.get(node_id, 0) == lane_index and node_id not in folded
        ]
        by_seed_y = lambda node_id: float((nodes[node_id].get("position") or {}).get("y", 0.0))  # noqa: E731
        exec_ids = sorted([n for n in lane_ids if has_exec_pin(nodes[n])], key=by_seed_y)
        pure_ids = sorted([n for n in lane_ids if not has_exec_pin(nodes[n])], key=by_seed_y)
        return exec_ids, pure_ids

    def _pure_stack_height(pure_ids: list[str]) -> float:
        """Vertical space the pure helpers consume ABOVE a lane's exec base."""
        return sum(node_height(nodes[n]) + NODE_GAP_Y for n in pure_ids)

    def _place_lane(column_ids: list[str], lane_index: int, x_pos: float, y_base: float) -> float:
        """Place one lane: pure helpers stack upward from `y_base`, exec nodes
        downward from it. Returns the bottom of the exec stack."""
        exec_ids, pure_ids = _lane_ids(column_ids, lane_index)
        y = y_base
        for node_id in reversed(pure_ids):
            y -= node_height(nodes[node_id]) + NODE_GAP_Y
            nodes[node_id]["position"] = {"x": x_pos, "y": y}
        y = y_base
        for node_id in exec_ids:
            nodes[node_id]["position"] = {"x": x_pos, "y": y}
            y += node_height(nodes[node_id]) + NODE_GAP_Y
        return y

    x = 0.0
    for column_index in sorted(by_depth.keys()):
        column_ids = by_depth[column_index]
        lane0_bottom = _place_lane(column_ids, 0, x, 0.0)
        # Lane 1's pure helpers also stack UPWARD from its base, so the base has
        # to clear its own pure stack or those helpers climb back into lane 0's
        # exec column. Before local getter chips existed, branch lanes rarely
        # carried pure helpers and the collision never showed up.
        _, lane1_pure = _lane_ids(column_ids, 1)
        lane1_base = lane0_bottom + EXEC_BRANCH_LANE_GAP_Y + _pure_stack_height(lane1_pure)
        _place_lane(column_ids, 1, x, lane1_base)
        x += NODE_WIDTH + COLUMN_GAP_X

    _dock_folded_getters(nodes, folded)


def layout_overlap_findings(flow: dict[str, Any]) -> list[str]:
    """Return overlap pairs using `node_box` — the same model audit_flow_graph
    imports, so the builder's own check and the gate can never disagree.

    Folded getters (0156) render as pin-row pills, not node cards, so they
    have NO box: they can neither collide nor be collided with. Their docked
    reveal position deliberately overlaps the consumer's gutter.
    """
    folded = folded_getter_ids(flow)
    boxes = {
        n["id"]: node_box(n)
        for n in flow.get("nodes") or []
        if n["id"] not in folded
    }
    node_ids = list(boxes)
    return [
        f"OVERLAP {left_id} <-> {right_id}"
        for index, left_id in enumerate(node_ids)
        for right_id in node_ids[index + 1:]
        if boxes_overlap(boxes[left_id], boxes[right_id])
    ]


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def validate_edges(flow: dict[str, Any]) -> list[str]:
    """Return a list of edge problems (unknown node/pin endpoints). Empty = ok."""
    ids = {n["id"] for n in flow["nodes"]}
    pinmap = {
        n["id"]: {
            "in": {p["id"] for p in (n["data"].get("inputs") or [])},
            "out": {p["id"] for p in (n["data"].get("outputs") or [])},
        }
        for n in flow["nodes"]
    }
    # A `code` node exposes each KEY of its returned dict as a pullable output
    # handle (runtime-resolved), beyond the declared output/success/execution
    # pins — this is the deep-research idiom (e.g. loop_condition.condition ->
    # while.condition). So any source handle on a code node is legal.
    code_ids = {n["id"] for n in flow["nodes"] if (n["data"].get("nodeType") == "code")}
    # A `subflow` node's `child_output` handle is RUNTIME-PROVIDED (carries the
    # child run's whole output map; {success:false, error} when the child run
    # DIES while the mapped `output` pin reads None) — the coding-agent
    # verifier-death idiom. Legal despite not being a declared pin.
    subflow_ids = {n["id"] for n in flow["nodes"] if (n["data"].get("nodeType") == "subflow")}
    problems: list[str] = []
    for e in flow["edges"]:
        if e["source"] not in ids:
            problems.append(f"{e['id']}: unknown source {e['source']}")
            continue
        if e["target"] not in ids:
            problems.append(f"{e['id']}: unknown target {e['target']}")
            continue
        if (e["source"] not in code_ids
                and not (e["source"] in subflow_ids and e["sourceHandle"] == "child_output")
                and e["sourceHandle"] not in pinmap[e["source"]]["out"]):
            problems.append(f"{e['id']}: no out-pin {e['source']}.{e['sourceHandle']}")
        if e["targetHandle"] not in pinmap[e["target"]]["in"]:
            problems.append(f"{e['id']}: no in-pin {e['target']}.{e['targetHandle']}")
    # Code-node INPUT COVERAGE: an unwired data input binds None silently at
    # run time (live incident 2026-07-20: exec_args.prep had no edge, so the
    # render command was "" and execute_command "succeeded" doing nothing —
    # rendered:false end-to-end with a confusing warning). A declared code
    # input must have an edge or a pin default; anything else is a build bug.
    incoming: dict[str, set[str]] = {}
    for e in flow["edges"]:
        incoming.setdefault(e["target"], set()).add(e["targetHandle"])
    for n in flow["nodes"]:
        if n["data"].get("nodeType") != "code":
            continue
        defaults = n["data"].get("pinDefaults") or {}
        # A pin expression SATISFIES an input (same rule as the editor's
        # preflight): the runtime computes the pin at resolution time, so an
        # expression-fed code input is not a coverage gap.
        expressions = n["data"].get("pinExpressions") or {}
        for p in n["data"].get("inputs") or []:
            pid = p.get("id")
            if pid == "permissions" or p.get("type") == "execution":
                continue
            if (pid not in incoming.get(n["id"], set())
                    and pid not in defaults and pid not in expressions):
                problems.append(f"{n['id']}.{pid}: code input has no edge and no pin default")
    return problems


def pack_bundle(*, root_flow_id, bundle_id, bundle_version, entrypoints, metadata):
    sys.path.insert(0, str(ROOT / "abstractruntime" / "src"))
    from abstractruntime.workflow_bundle import pack_workflow_bundle

    BUNDLES_DIR.mkdir(parents=True, exist_ok=True)
    out_path = BUNDLES_DIR / f"{bundle_id}@{bundle_version}.flow"
    pack_workflow_bundle(
        root_flow_json=FLOWS_DIR / f"{root_flow_id}.json",
        out_path=out_path,
        bundle_id=bundle_id,
        bundle_version=bundle_version,
        flows_dir=FLOWS_DIR,
        entrypoints=entrypoints,
        default_entrypoint=entrypoints[0],
        metadata=metadata,
    )
    return out_path


def compile_check(root_id: str, flow_ids: list[str]) -> None:
    """Compile the flow tree through the real runtime compiler; raises on error."""
    sys.path.insert(0, str(ROOT / "abstractruntime" / "src"))
    from abstractruntime.visualflow_compiler import compiler as C

    flows = {}
    for fid in flow_ids:
        flows[fid] = json.loads((FLOWS_DIR / f"{fid}.json").read_text())
    C.compile_visualflow_tree(root_id=root_id, flows_by_id=flows)
