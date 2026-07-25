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
    "while": "#F39C12", "for": "#F39C12", "loop": "#F39C12",
    "code": "#9B59B6", "string_template": "#E74C3C", "stringify_json": "#3498DB",
}
_ICON = {
    "on_flow_start": "&#x1F3C1;", "on_flow_end": "&#x23F9;", "subflow": "&#x1F4E6;",
    "agent": "&#x1F916;", "llm_call": "&#x1F4AD;", "make_object": "{}",
    "get": "&#x1F4E5;", "get_var": "&#x1F4E5;", "set_var": "&#x1F4E4;",
    "while": "&#x1F501;", "for": "&#x1F522;", "loop": "&#x1F501;",
    "code": "&#x1F9E9;", "string_template": "&#x1F9FE;", "stringify_json": "&#x1F4DD;",
}


def pin(pin_id: str, label: str, pin_type: str) -> dict[str, Any]:
    return {"id": pin_id, "label": label, "type": pin_type}


def node(node_id, node_type, label, x, y, *, inputs=None, outputs=None,
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


def edge(source, source_handle, target, target_handle, *, animated=False):
    return {
        "id": f"e-{source}-{source_handle}-{target}-{target_handle}".replace(":", "-"),
        "source": source, "sourceHandle": source_handle,
        "target": target, "targetHandle": target_handle, "animated": animated,
    }


def base_flow(flow_id, name, description, interfaces=None):
    now = datetime.now(timezone.utc).isoformat()
    return {"id": flow_id, "name": name, "description": description,
            "interfaces": interfaces or [], "nodes": [], "edges": [],
            "entryNode": "start", "created_at": now, "updated_at": now}


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


def code_node(node_id, label, code_body, x, y, inputs, output_type="object"):
    return node(
        node_id, "code", label, x, y,
        inputs=[*inputs, pin("permissions", "permissions", "string")],
        outputs=[pin("output", "output", output_type),
                 pin("success", "success", "boolean"),
                 pin("execution", "execution", "object")],
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


def subflow_node(node_id, label, flow_id, x, y):
    """deep-research subflow convention: one `input` object in, one `output`
    object out; the runtime maps input keys to the child's on_flow_start
    fields by name and collects on_flow_end fields into output."""
    return node(node_id, "subflow", label, x, y,
                inputs=[EXEC_IN, pin("inherit_context", "inherit_context", "boolean"),
                        pin("input", "input", "object")],
                outputs=[EXEC_OUT, pin("output", "output", "object")],
                pin_defaults={"inherit_context": False},
                extra={"subflowId": flow_id})


def template_node(node_id, template_text, x, y):
    return node(node_id, "string_template", "Compose", x, y,
                inputs=[pin("template", "template", "string"),
                        pin("vars", "vars", "object")],
                outputs=[pin("result", "result", "string")],
                pin_defaults={"template": template_text})


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
        for p in n["data"].get("inputs") or []:
            pid = p.get("id")
            if pid == "permissions" or p.get("type") == "execution":
                continue
            if pid not in incoming.get(n["id"], set()) and pid not in defaults:
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
