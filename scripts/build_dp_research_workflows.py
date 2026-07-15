#!/usr/bin/env python3
"""Build the `dp-` production research workflow family.

The generated VisualFlow JSON is intentionally plain and editable in
AbstractFlow. The script also packs the root WorkflowBundle for Gateway.
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
BUNDLE_PATH = BUNDLES_DIR / "dp-research@0.1.1.flow"


def _pin(pin_id: str, label: str, pin_type: str, description: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"id": pin_id, "label": label, "type": pin_type}
    if description:
        out["description"] = description
    return out


EXEC_IN = _pin("exec-in", "", "execution")
EXEC_OUT = _pin("exec-out", "", "execution")


START_PINS = [
    _pin("request", "What should be researched?", "string"),
    _pin("viewpoint", "Viewpoint or angle", "string"),
    _pin("effort", "Effort", "string"),
    _pin("provider", "Provider (optional)", "provider_text"),
    _pin("model", "Model (optional)", "model"),
]


START_DEFAULTS = {
    "effort": "standard",
    "provider": "",
    "model": "",
}


SETTINGS_PIN = _pin("settings", "Derived effort settings", "object")


DERIVE_SETTINGS_CODE = """
effort_text = str(effort or "standard").strip().lower().replace("_", " ").replace("-", " ")
if effort_text in ("quick", "quick search", "quick report", "fast", "fast search", "brief", "brief search"):
    effort_key = "quick"
elif effort_text in ("thorough", "thorough search", "thorough report", "deep", "deep research", "exhaustive"):
    effort_key = "thorough"
else:
    effort_key = "standard"

profiles = {
    "quick": {
        "effort": "quick",
        "effort_preset": "Quick search",
        "audience": "Technical decision-maker",
        "quality_profile": "Fast, source-grounded answer with concise adversarial gap check",
        "max_iterations": 3,
        "deadline_minutes": 8,
        "max_sources": 12,
        "max_review_rounds": 1,
        "source_policy": "Prefer primary or highly authoritative sources. Fetch before citing. Stop once the core answer is supported.",
        "citation_policy": "Cite decisive claims and flag uncertainty instead of over-searching.",
        "output_prefix": "reports/dp-quick-research",
        "report_title": "Quick Research Brief",
        "include_images": False,
    },
    "standard": {
        "effort": "standard",
        "effort_preset": "Standard search",
        "audience": "Technical decision-maker",
        "quality_profile": "Balanced research with adversarial review, source ledger, and evidence checks",
        "max_iterations": 6,
        "deadline_minutes": 20,
        "max_sources": 28,
        "max_review_rounds": 2,
        "source_policy": "Prefer primary, recent, authoritative sources. Fetch before citing and compare at least one contrary source when useful.",
        "citation_policy": "Every important factual claim needs a source id or an explicit limitation.",
        "output_prefix": "reports/dp-standard-research",
        "report_title": "Research Report",
        "include_images": True,
    },
    "thorough": {
        "effort": "thorough",
        "effort_preset": "Thorough search",
        "audience": "Technical decision-maker",
        "quality_profile": "SOTA deep research with independent adversarial review, provenance, and strict evidence audit",
        "max_iterations": 10,
        "deadline_minutes": 45,
        "max_sources": 64,
        "max_review_rounds": 3,
        "source_policy": "Prefer primary, recent, authoritative sources. Fetch before citing, triangulate important claims, and actively seek disconfirming evidence.",
        "citation_policy": "Every non-obvious factual claim needs a source id or limitation. Distinguish primary evidence from commentary.",
        "output_prefix": "reports/dp-thorough-research",
        "report_title": "Deep Research Report",
        "include_images": True,
    },
}

profile = dict(profiles[effort_key])
provider_text = str(provider or "").strip()
model_text = str(model or "").strip()
if (provider_text and not model_text) or (model_text and not provider_text):
    raise ValueError("provider and model must both be set, or both left blank for Gateway/Core defaults")
profile["provider"] = provider_text
profile["model"] = model_text

return profile
""".strip()


RESEARCH_LOOP_CONDITION_CODE = """
state = loop_state or {}
completed = int(state.get("rounds_completed", 0) or 0)
max_rounds_value = int(max_review_rounds or 0)
continue_value = state.get("continue_research")
if continue_value is None:
    continue_value = True
condition = bool(continue_value) and completed < max_rounds_value
return {
    "condition": condition,
    "rounds_completed": completed,
    "max_review_rounds": max_rounds_value,
    "continue_research": bool(continue_value),
}
""".strip()


NEXT_LOOP_STATE_CODE = """
review_obj = review or {}
next_round = int(round_index or 0) + 1
continue_value = review_obj.get("continue_research")
if continue_value is None:
    continue_value = False
return {
    "rounds_completed": next_round,
    "continue_research": bool(continue_value),
    "verdict": review_obj.get("verdict"),
    "useful_insights": review_obj.get("useful_insights") or [],
    "investigate_next": review_obj.get("investigate_next") or [],
    "user_relevance": review_obj.get("user_relevance") or [],
    "risks": review_obj.get("risks") or [],
}
""".strip()


NORMALIZE_REPORT_MARKDOWN_CODE = """
def _as_text(value):
    if value is None:
        return ""
    return str(value).strip()


def _source_list(value):
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        nested = value.get("source_ledger") or value.get("sources") or value.get("items")
        if isinstance(nested, list):
            return nested
    return []


def _heading_title(line):
    stripped = str(line or "").strip()
    if not stripped.startswith("#"):
        return ""
    count = 0
    while count < len(stripped) and stripped[count] == "#":
        count = count + 1
    if count < 1 or count > 6:
        return ""
    if count >= len(stripped) or stripped[count] not in (" ", "\\t"):
        return ""
    return stripped[count:].strip().strip("#").strip().lower()


def _is_blocked_heading(title, remove_references):
    compact = " ".join(
        str(title or "").strip(" :.;").replace("-", " ").replace("_", " ").replace("/", " ").split()
    )
    if bool(remove_references) and compact == "references":
        return True
    return compact in (
        "evidence table",
        "evidence matrix",
        "bibliography",
        "claim evidence matrix",
        "citation index",
        "citation ids",
        "citation list",
        "citations",
        "citations source ids",
        "citations and source ids",
        "source ids",
        "source id list",
        "source index",
        "source list",
        "sources cited",
        "works cited",
    )


def _has_references_heading(text):
    for line in str(text or "").split("\\n"):
        if _heading_title(line) == "references":
            return True
    return False


def _remove_blocked_sections(text, remove_references):
    kept = []
    skip = False
    for line in str(text or "").split("\\n"):
        title = _heading_title(line)
        if title:
            if _is_blocked_heading(title, remove_references):
                skip = True
                continue
            if skip:
                skip = False
        if not skip:
            kept.append(line)
    return "\\n".join(kept)


def _reference_line(source):
    if not isinstance(source, dict):
        return ""
    source_id = _as_text(source.get("source_id") or source.get("id"))
    if not source_id:
        return ""
    title = _as_text(source.get("title")) or "Untitled source"
    url_or_path = _as_text(source.get("url_or_path") or source.get("url") or source.get("path"))
    source_type = _as_text(source.get("source_type") or source.get("type"))
    fetched = source.get("fetched")
    quality = _as_text(source.get("evidence_quality") or source.get("quality"))
    parts = [f"- [{source_id}] {title}"]
    if url_or_path:
        parts.append(url_or_path)
    details = []
    if source_type:
        details.append(f"type: {source_type}")
    if fetched is not None:
        details.append(f"fetched: {bool(fetched)}")
    if quality:
        details.append(f"evidence quality: {quality}")
    line = ". ".join(parts)
    if details:
        line = f"{line} ({'; '.join(details)})"
    return line


sources = _source_list(source_ledger)
text = _as_text(report_markdown).replace("\\r\\n", "\\n").replace("\\r", "\\n")
text = _remove_blocked_sections(text, bool(sources))
while "\\n\\n\\n" in text:
    text = text.replace("\\n\\n\\n", "\\n\\n")
text = text.strip()

if sources:
    references = [_reference_line(source) for source in sources]
    references = [line for line in references if line]
    if references:
        text = f"{text}\\n\\n## References\\n" + "\\n".join(references)

if not text:
    text = "# Research Report\\n\\nNo report content was produced.\\n"

return text.rstrip() + "\\n"
""".strip()


READ_ONLY_TOOLS = [
    "web_search",
    "fetch_url",
    "skim_websearch",
    "skim_url",
    "read_file",
    "skim_files",
]


PLAN_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["brief", "research_questions", "source_strategy", "quality_gates", "stop_rules"],
    "properties": {
        "brief": {"type": "string"},
        "research_questions": {"type": "array", "items": {"type": "string"}},
        "source_strategy": {"type": "array", "items": {"type": "string"}},
        "quality_gates": {"type": "array", "items": {"type": "string"}},
        "stop_rules": {"type": "array", "items": {"type": "string"}},
    },
}


INVESTIGATION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "answer_hypotheses",
        "source_ledger",
        "iteration_log",
        "claim_candidates",
        "open_questions",
        "limitations",
        "warnings",
    ],
    "properties": {
        "answer_hypotheses": {"type": "array", "items": {"type": "string"}},
        "source_ledger": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": True,
                "required": [
                    "source_id",
                    "title",
                    "url_or_path",
                    "source_type",
                    "fetched",
                    "evidence_quality",
                    "relevance",
                    "fetched_at",
                ],
                "properties": {
                    "source_id": {"type": "string"},
                    "title": {"type": "string"},
                    "url_or_path": {"type": "string"},
                    "source_type": {"type": "string"},
                    "fetched": {"type": "boolean"},
                    "evidence_quality": {"type": "string"},
                    "relevance": {"type": "string"},
                    "fetched_at": {"type": "string"},
                    "content_hash": {"type": "string"},
                    "rejected_reason": {"type": "string"},
                },
            },
        },
        "iteration_log": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": True,
                "required": [
                    "round_index",
                    "queries",
                    "new_findings",
                    "review_guidance_used",
                    "remaining_gaps",
                    "continue_reason",
                ],
                "properties": {
                    "round_index": {"type": "number"},
                    "queries": {"type": "array", "items": {"type": "string"}},
                    "new_findings": {"type": "array", "items": {"type": "string"}},
                    "review_guidance_used": {"type": "array", "items": {"type": "string"}},
                    "remaining_gaps": {"type": "array", "items": {"type": "string"}},
                    "continue_reason": {"type": "string"},
                },
            },
        },
        "claim_candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": True,
                "required": ["claim_id", "claim", "evidence_source_ids", "confidence", "status"],
                "properties": {
                    "claim_id": {"type": "string"},
                    "claim": {"type": "string"},
                    "evidence_source_ids": {"type": "array", "items": {"type": "string"}},
                    "confidence": {"type": "string"},
                    "status": {"type": "string"},
                },
            },
        },
        "open_questions": {"type": "array", "items": {"type": "string"}},
        "limitations": {"type": "array", "items": {"type": "string"}},
        "warnings": {"type": "array", "items": {"type": "string"}},
    },
}


REVIEW_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "verdict",
        "useful_insights",
        "investigate_next",
        "user_relevance",
        "risks",
        "continue_research",
    ],
    "properties": {
        "verdict": {"type": "string"},
        "useful_insights": {"type": "array", "items": {"type": "string"}},
        "investigate_next": {"type": "array", "items": {"type": "string"}},
        "user_relevance": {"type": "array", "items": {"type": "string"}},
        "risks": {"type": "array", "items": {"type": "string"}},
        "continue_research": {"type": "boolean"},
    },
}


RENDER_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "report_markdown",
        "research_run_manifest",
        "source_ledger",
        "claim_evidence_matrix",
        "iteration_log",
        "adversarial_review_summary",
        "limitations",
        "warnings",
        "export_status",
    ],
    "properties": {
        "report_markdown": {"type": "string"},
        "research_run_manifest": {"type": "object"},
        "source_ledger": INVESTIGATION_SCHEMA["properties"]["source_ledger"],
        "claim_evidence_matrix": INVESTIGATION_SCHEMA["properties"]["claim_candidates"],
        "iteration_log": INVESTIGATION_SCHEMA["properties"]["iteration_log"],
        "adversarial_review_summary": {"type": "string"},
        "limitations": {"type": "array", "items": {"type": "string"}},
        "warnings": {"type": "array", "items": {"type": "string"}},
        "export_status": {"type": "object"},
    },
}


def _base_flow(
    flow_id: str, name: str, description: str, interfaces: list[str] | None = None
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": flow_id,
        "name": name,
        "description": description,
        "interfaces": interfaces or [],
        "nodes": [],
        "edges": [],
        "entryNode": "start",
        "created_at": now,
        "updated_at": now,
    }


def _node(
    node_id: str,
    node_type: str,
    label: str,
    x: int,
    y: int,
    *,
    inputs: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    pin_defaults: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    header = {
        "on_flow_start": "#C0392B",
        "on_flow_end": "#C0392B",
        "subflow": "#00CCCC",
        "agent": "#4488FF",
        "llm_call": "#3498DB",
        "make_object": "#3498DB",
        "get": "#3498DB",
        "stringify_json": "#3498DB",
        "string_template": "#E74C3C",
        "write_file": "#16A085",
        "write_pdf": "#16A085",
        "write_docx": "#16A085",
        "parallel": "#F39C12",
        "for": "#F39C12",
        "set_var": "#16A085",
        "get_var": "#16A085",
        "system_datetime": "#C0392B",
        "replace": "#E74C3C",
    }.get(node_type, "#3498DB")
    icon = {
        "on_flow_start": "&#x1F3C1;",
        "on_flow_end": "&#x23F9;",
        "subflow": "&#x1F4E6;",
        "agent": "&#x1F916;",
        "llm_call": "&#x1F4AD;",
        "make_object": "{}",
        "get": "&#x1F4E5;",
        "stringify_json": "&#x1F4DD;",
        "string_template": "&#x1F9FE;",
        "write_file": "&#x1F4BE;",
        "write_pdf": "&#x1F4D5;",
        "write_docx": "&#x1F4D8;",
        "parallel": "&#x2225;",
        "for": "&#x1F522;",
        "set_var": "&#x1F4E4;",
        "get_var": "&#x1F4E5;",
        "system_datetime": "&#x1F552;",
        "replace": "&#x21BA;",
    }.get(node_type, "&#x25A1;")
    data: dict[str, Any] = {
        "nodeType": node_type,
        "label": label,
        "icon": icon,
        "headerColor": header,
        "inputs": inputs or [],
        "outputs": outputs or [],
    }
    if pin_defaults:
        data["pinDefaults"] = pin_defaults
    if extra:
        data.update(extra)
    return {
        "id": node_id,
        "type": node_type,
        "position": {"x": x, "y": y},
        "data": data,
        "label": None,
        "icon": None,
        "headerColor": None,
        "inputs": [],
        "outputs": [],
    }


def _edge(
    source: str, source_handle: str, target: str, target_handle: str, *, animated: bool = False
) -> dict[str, Any]:
    return {
        "id": f"e-{source}-{source_handle}-{target}-{target_handle}".replace(":", "-"),
        "source": source,
        "sourceHandle": source_handle,
        "target": target,
        "targetHandle": target_handle,
        "animated": animated,
    }


def _start_node(
    pins: list[dict[str, Any]] = START_PINS, defaults: dict[str, Any] | None = None
) -> dict[str, Any]:
    return _node(
        "start",
        "on_flow_start",
        "Start research request",
        -900,
        0,
        outputs=[EXEC_OUT, *pins],
        pin_defaults=defaults or START_DEFAULTS,
    )


def _end_node(inputs: list[dict[str, Any]]) -> dict[str, Any]:
    return _node("end", "on_flow_end", "Finish", 1800, 0, inputs=[EXEC_IN, *inputs])


def _make_object(node_id: str, fields: list[tuple[str, str, str]], x: int, y: int) -> dict[str, Any]:
    return _node(
        node_id,
        "make_object",
        "Build JSON",
        x,
        y,
        inputs=[_pin(field, label, pin_type) for field, label, pin_type in fields],
        outputs=[_pin("result", "result", "object")],
    )


def _get_node(node_id: str, key: str, default: Any, x: int, y: int) -> dict[str, Any]:
    return _node(
        node_id,
        "get",
        f"Get {key}",
        x,
        y,
        inputs=[
            _pin("object", "object", "object"),
            _pin("key", "key", "string"),
            _pin("default", "default", "any"),
        ],
        outputs=[_pin("value", "value", "any")],
        pin_defaults={"key": key, "default": default},
    )


def _get_var_node(node_id: str, name: str, default: Any, x: int, y: int) -> dict[str, Any]:
    return _node(
        node_id,
        "get_var",
        f"Get {name}",
        x,
        y,
        inputs=[_pin("name", "name", "string"), _pin("default", "default", "any")],
        outputs=[_pin("value", "value", "any")],
        pin_defaults={"name": name, "default": default},
    )


def _set_var_node(node_id: str, label: str, name: str, x: int, y: int) -> dict[str, Any]:
    return _node(
        node_id,
        "set_var",
        label,
        x,
        y,
        inputs=[
            EXEC_IN,
            _pin("name", "name", "string"),
            _pin("value", "value", "any"),
        ],
        outputs=[EXEC_OUT, _pin("value", "value", "any")],
        pin_defaults={"name": name},
    )


def _settings_node(node_id: str, x: int, y: int) -> dict[str, Any]:
    return _node(
        node_id,
        "code",
        "Derive effort settings",
        x,
        y,
        inputs=[
            EXEC_IN,
            _pin("effort", "effort", "string"),
            _pin("provider", "provider", "provider_text"),
            _pin("model", "model", "model"),
            _pin("permissions", "permissions", "string"),
        ],
        outputs=[
            EXEC_OUT,
            _pin("output", "output", "object"),
            _pin("success", "success", "boolean"),
            _pin("execution", "execution", "object"),
        ],
        pin_defaults={"permissions": "sandbox"},
        extra={
            "functionName": "transform",
            "codeBody": DERIVE_SETTINGS_CODE,
        },
    )


def _code_data_node(
    node_id: str,
    label: str,
    code_body: str,
    x: int,
    y: int,
    inputs: list[dict[str, Any]],
    output_type: str = "object",
) -> dict[str, Any]:
    return _node(
        node_id,
        "code",
        label,
        x,
        y,
        inputs=[*inputs, _pin("permissions", "permissions", "string")],
        outputs=[
            _pin("output", "output", output_type),
            _pin("success", "success", "boolean"),
            _pin("execution", "execution", "object"),
        ],
        pin_defaults={"permissions": "sandbox"},
        extra={
            "functionName": "transform",
            "codeBody": code_body,
        },
    )


def _while_node(node_id: str, label: str, x: int, y: int) -> dict[str, Any]:
    return _node(
        node_id,
        "while",
        label,
        x,
        y,
        inputs=[
            EXEC_IN,
            _pin("condition", "condition", "boolean"),
        ],
        outputs=[
            _pin("loop", "loop", "execution"),
            _pin("done", "done", "execution"),
            _pin("index", "index", "number"),
            _pin("item", "item", "any"),
        ],
        pin_defaults={"condition": True},
    )


def _for_node(node_id: str, label: str, x: int, y: int) -> dict[str, Any]:
    return _node(
        node_id,
        "for",
        label,
        x,
        y,
        inputs=[
            EXEC_IN,
            _pin("start", "start", "number"),
            _pin("end", "end", "number"),
            _pin("step", "step", "number"),
        ],
        outputs=[
            _pin("loop", "loop", "execution"),
            _pin("done", "done", "execution"),
            _pin("i", "i", "number"),
            _pin("index", "index", "number"),
            _pin("total", "total", "number"),
        ],
        pin_defaults={"start": 0, "step": 1},
    )


def _system_datetime_node(node_id: str, x: int, y: int) -> dict[str, Any]:
    return _node(
        node_id,
        "system_datetime",
        "Run timestamp",
        x,
        y,
        outputs=[
            _pin("iso", "iso", "string"),
            _pin("timezone", "timezone", "string"),
            _pin("utc_offset_minutes", "utc_offset_minutes", "number"),
            _pin("locale", "locale", "string"),
        ],
    )


def _replace_node(
    node_id: str,
    label: str,
    pattern: str,
    replacement: str,
    x: int,
    y: int,
) -> dict[str, Any]:
    return _node(
        node_id,
        "replace",
        label,
        x,
        y,
        inputs=[
            _pin("text", "text", "string"),
            _pin("pattern", "pattern", "string"),
            _pin("replacement", "replacement", "string"),
            _pin("mode", "mode", "string"),
        ],
        outputs=[_pin("result", "result", "string")],
        pin_defaults={"pattern": pattern, "replacement": replacement, "mode": "all"},
    )


def _stringify(node_id: str, x: int, y: int) -> dict[str, Any]:
    return _node(
        node_id,
        "stringify_json",
        "Stringify JSON",
        x,
        y,
        inputs=[_pin("value", "value", "any"), _pin("mode", "mode", "string")],
        outputs=[_pin("result", "result", "string")],
        pin_defaults={"mode": "beautify"},
    )


def _template(node_id: str, template: str, x: int, y: int) -> dict[str, Any]:
    return _node(
        node_id,
        "string_template",
        f"Path {template}",
        x,
        y,
        inputs=[_pin("template", "template", "string"), _pin("vars", "vars", "object")],
        outputs=[_pin("result", "result", "string")],
        pin_defaults={"template": template},
    )


def _llm_node(
    node_id: str,
    label: str,
    x: int,
    y: int,
    *,
    system: str,
    schema: dict[str, Any],
    temperature: float = 0.2,
) -> dict[str, Any]:
    return _node(
        node_id,
        "llm_call",
        label,
        x,
        y,
        inputs=[
            EXEC_IN,
            _pin("provider", "provider", "provider_text"),
            _pin("model", "model", "model"),
            _pin("system", "system", "string"),
            _pin("prompt", "prompt", "string"),
            _pin("temperature", "temperature", "number"),
            _pin("resp_schema", "resp_schema", "json_schema"),
        ],
        outputs=[
            EXEC_OUT,
            _pin("response", "response", "string"),
            _pin("data", "data", "object"),
            _pin("success", "success", "boolean"),
            _pin("meta", "meta", "object"),
        ],
        pin_defaults={
            "system": system,
            "temperature": temperature,
            "resp_schema": schema,
        },
    )


def _agent_node(node_id: str, label: str, x: int, y: int, *, system: str) -> dict[str, Any]:
    return _node(
        node_id,
        "agent",
        label,
        x,
        y,
        inputs=[
            EXEC_IN,
            _pin("provider", "provider", "provider_text"),
            _pin("model", "model", "model"),
            _pin("system", "system", "string"),
            _pin("prompt", "prompt", "string"),
            _pin("tools", "tools", "tools"),
            _pin("max_iterations", "max_iterations", "number"),
            _pin("temperature", "temperature", "number"),
            _pin("resp_schema", "resp_schema", "json_schema"),
        ],
        outputs=[
            EXEC_OUT,
            _pin("response", "response", "string"),
            _pin("data", "data", "object"),
            _pin("success", "success", "boolean"),
            _pin("meta", "meta", "object"),
            _pin("scratchpad", "scratchpad", "object"),
        ],
        pin_defaults={
            "system": system,
            "tools": READ_ONLY_TOOLS,
            "temperature": 0.1,
            "resp_schema": INVESTIGATION_SCHEMA,
        },
    )


def _input_fields(extra: list[tuple[str, str, str]] | None = None) -> list[tuple[str, str, str]]:
    base = [(p["id"], p["label"], p["type"]) for p in START_PINS]
    return [*base, *(extra or [])]


def _wire_start_fields(
    flow: dict[str, Any], target: str, fields: list[tuple[str, str, str]]
) -> None:
    for field, _label, _typ in fields:
        if any(p["id"] == field for p in START_PINS):
            flow["edges"].append(_edge("start", field, target, field))


def build_plan_flow() -> dict[str, Any]:
    fields = _input_fields([("settings", "settings", "object")])
    flow = _base_flow("dp-plan", "deep-research-plan", "Research planning subflow.")
    flow["nodes"] = [
        _start_node(),
        _settings_node("derive_settings", -640, -160),
        _make_object("input_json", fields, -520, 120),
        _stringify("prompt_json", -160, 120),
        _get_node("get_provider", "provider", "", -160, -220),
        _get_node("get_model", "model", "", -160, -120),
        _llm_node(
            "planner",
            "Plan research",
            220,
            0,
            system=(
                "You are a planning analyst for a production research workflow. "
                "Create a concise plan before any browsing. Respect the user's request, viewpoint, "
                "audience, source policy, budget, and stop rules. Do not invent sources."
            ),
            schema=PLAN_SCHEMA,
            temperature=0.1,
        ),
        _end_node(
            [
                _pin("plan", "plan", "object"),
                _pin("plan_markdown", "plan_markdown", "string"),
                _pin("meta", "meta", "object"),
            ]
        ),
    ]
    flow["edges"] = [
        _edge("start", "exec-out", "derive_settings", "exec-in", animated=True),
        _edge("derive_settings", "exec-out", "planner", "exec-in", animated=True),
        _edge("start", "effort", "derive_settings", "effort"),
        _edge("start", "provider", "derive_settings", "provider"),
        _edge("start", "model", "derive_settings", "model"),
        _edge("derive_settings", "output", "input_json", "settings"),
        _edge("derive_settings", "output", "get_provider", "object"),
        _edge("derive_settings", "output", "get_model", "object"),
        _edge("input_json", "result", "prompt_json", "value"),
        _edge("prompt_json", "result", "planner", "prompt"),
        _edge("get_provider", "value", "planner", "provider"),
        _edge("get_model", "value", "planner", "model"),
        _edge("planner", "exec-out", "end", "exec-in", animated=True),
        _edge("planner", "data", "end", "plan"),
        _edge("planner", "response", "end", "plan_markdown"),
        _edge("planner", "meta", "end", "meta"),
    ]
    _wire_start_fields(flow, "input_json", fields)
    return flow


def build_investigate_flow() -> dict[str, Any]:
    fields = _input_fields(
        [
            ("settings", "settings", "object"),
            ("plan", "plan", "object"),
            ("prior_investigation", "prior_investigation", "object"),
            ("adversarial_review", "adversarial_review", "object"),
            ("round_index", "round_index", "number"),
            ("total_rounds", "total_rounds", "number"),
        ]
    )
    flow = _base_flow(
        "dp-investigate", "deep-research-investigate", "Evidence gathering and bounded investigation."
    )
    flow["nodes"] = [
        _start_node(
            [
                *START_PINS,
                _pin("plan", "plan", "object"),
                _pin("prior_investigation", "prior_investigation", "object"),
                _pin("adversarial_review", "adversarial_review", "object"),
                _pin("round_index", "round_index", "number"),
                _pin("total_rounds", "total_rounds", "number"),
            ]
        ),
        _settings_node("derive_settings", -640, -160),
        _make_object("input_json", fields, -520, 120),
        _stringify("prompt_json", -160, 120),
        _get_node("get_provider", "provider", "", -160, -260),
        _get_node("get_model", "model", "", -160, -160),
        _get_node("get_max_iterations", "max_iterations", 6, -160, 40),
        _agent_node(
            "researcher",
            "Investigate with evidence tools",
            220,
            0,
            system=(
                "You are the evidence-gathering agent in a controlled research workflow. "
                "Use only the supplied read-only tools. For every source: search, fetch "
                "or skim, record source id, URL/path, timestamp if available, evidence "
                "quality, and rejection reason if rejected. Each investigation pass "
                "must use the latest adversarial_review input, build on "
                "prior_investigation, and write an iteration_log entry explaining what "
                "changed, which reviewer guidance was used, what is still weak, what "
                "the user would care about, and whether another pass is worth the "
                "budget. Never use shell, write, edit, email, or admin tools."
            ),
        ),
        _end_node(
            [
                _pin("investigation", "investigation", "object"),
                _pin("scratchpad", "scratchpad", "object"),
                _pin("meta", "meta", "object"),
            ]
        ),
    ]
    flow["edges"] = [
        _edge("start", "exec-out", "derive_settings", "exec-in", animated=True),
        _edge("derive_settings", "exec-out", "researcher", "exec-in", animated=True),
        _edge("start", "effort", "derive_settings", "effort"),
        _edge("start", "provider", "derive_settings", "provider"),
        _edge("start", "model", "derive_settings", "model"),
        _edge("derive_settings", "output", "input_json", "settings"),
        _edge("derive_settings", "output", "get_provider", "object"),
        _edge("derive_settings", "output", "get_model", "object"),
        _edge("derive_settings", "output", "get_max_iterations", "object"),
        _edge("input_json", "result", "prompt_json", "value"),
        _edge("prompt_json", "result", "researcher", "prompt"),
        _edge("get_provider", "value", "researcher", "provider"),
        _edge("get_model", "value", "researcher", "model"),
        _edge("get_max_iterations", "value", "researcher", "max_iterations"),
        _edge("researcher", "exec-out", "end", "exec-in", animated=True),
        _edge("researcher", "data", "end", "investigation"),
        _edge("researcher", "scratchpad", "end", "scratchpad"),
        _edge("researcher", "meta", "end", "meta"),
    ]
    _wire_start_fields(flow, "input_json", fields)
    flow["edges"].extend(
        [
            _edge("start", "plan", "input_json", "plan"),
            _edge("start", "prior_investigation", "input_json", "prior_investigation"),
            _edge("start", "adversarial_review", "input_json", "adversarial_review"),
            _edge("start", "round_index", "input_json", "round_index"),
            _edge("start", "total_rounds", "input_json", "total_rounds"),
        ]
    )
    return flow


def _critic_call(node_id: str, label: str, x: int, y: int, system: str) -> dict[str, Any]:
    return _llm_node(node_id, label, x, y, system=system, schema=REVIEW_SCHEMA, temperature=0.0)


def build_review_flow() -> dict[str, Any]:
    fields = _input_fields(
        [
            ("settings", "settings", "object"),
            ("plan", "plan", "object"),
            ("investigation", "investigation", "object"),
            ("round_index", "round_index", "number"),
            ("total_rounds", "total_rounds", "number"),
        ]
    )
    flow = _base_flow("dp-review", "deep-research-review", "Three-lens adversarial review subflow.")
    flow["nodes"] = [
        _start_node(
            [
                *START_PINS,
                _pin("plan", "plan", "object"),
                _pin("investigation", "investigation", "object"),
                _pin("round_index", "round_index", "number"),
                _pin("total_rounds", "total_rounds", "number"),
            ]
        ),
        _settings_node("derive_settings", -700, -160),
        _make_object("input_json", fields, -580, 200),
        _stringify("prompt_json", -220, 200),
        _get_node("get_provider", "provider", "", -220, -240),
        _get_node("get_model", "model", "", -220, -140),
        _node(
            "review_parallel",
            "parallel",
            "Run three adversarial lenses",
            80,
            0,
            inputs=[EXEC_IN],
            outputs=[
                _pin("then:0", "Evidence skeptic", "execution"),
                _pin("then:1", "User relevance critic", "execution"),
                _pin("then:2", "Gap hunter", "execution"),
                _pin("completed", "Completed", "execution"),
            ],
        ),
        _critic_call(
            "evidence_skeptic",
            "Evidence skeptic",
            420,
            -220,
            (
                "Attack source quality, missing fetches, weak citations, stale evidence, "
                "and unsupported claims."
            ),
        ),
        _critic_call(
            "relevance_critic",
            "User relevance critic",
            420,
            40,
            (
                "Judge what matters for the requested viewpoint and audience. Cut "
                "interesting but irrelevant material."
            ),
        ),
        _critic_call(
            "gap_hunter",
            "Gap and novelty hunter",
            420,
            300,
            (
                "Find blind spots, contrary evidence, missing comparisons, and "
                "high-value follow-up searches."
            ),
        ),
        _make_object(
            "review_bundle",
            [
                ("evidence_skeptic", "evidence_skeptic", "object"),
                ("relevance_critic", "relevance_critic", "object"),
                ("gap_hunter", "gap_hunter", "object"),
                ("source_payload", "source_payload", "object"),
            ],
            780,
            160,
        ),
        _stringify("synthesis_prompt", 1080, 160),
        _llm_node(
            "review_synthesis",
            "Synthesize adversarial review",
            1380,
            0,
            system=(
                "You are the review chair. Merge the three adversarial reviews into actionable "
                "guidance. Explicitly list which insights are useful, which findings should be "
                "investigated next, and which information is relevant to the user."
            ),
            schema=REVIEW_SCHEMA,
            temperature=0.0,
        ),
        _end_node(
            [
                _pin("adversarial_review", "adversarial_review", "object"),
                _pin("evidence_skeptic", "evidence_skeptic", "object"),
                _pin("relevance_critic", "relevance_critic", "object"),
                _pin("gap_hunter", "gap_hunter", "object"),
                _pin("meta", "meta", "object"),
            ]
        ),
    ]
    flow["edges"] = [
        _edge("start", "exec-out", "derive_settings", "exec-in", animated=True),
        _edge("derive_settings", "exec-out", "review_parallel", "exec-in", animated=True),
        _edge("start", "effort", "derive_settings", "effort"),
        _edge("start", "provider", "derive_settings", "provider"),
        _edge("start", "model", "derive_settings", "model"),
        _edge("derive_settings", "output", "input_json", "settings"),
        _edge("derive_settings", "output", "get_provider", "object"),
        _edge("derive_settings", "output", "get_model", "object"),
        _edge("review_parallel", "then:0", "evidence_skeptic", "exec-in", animated=True),
        _edge("review_parallel", "then:1", "relevance_critic", "exec-in", animated=True),
        _edge("review_parallel", "then:2", "gap_hunter", "exec-in", animated=True),
        _edge("review_parallel", "completed", "review_synthesis", "exec-in", animated=True),
        _edge("input_json", "result", "prompt_json", "value"),
        _edge("prompt_json", "result", "evidence_skeptic", "prompt"),
        _edge("prompt_json", "result", "relevance_critic", "prompt"),
        _edge("prompt_json", "result", "gap_hunter", "prompt"),
        _edge("evidence_skeptic", "data", "review_bundle", "evidence_skeptic"),
        _edge("relevance_critic", "data", "review_bundle", "relevance_critic"),
        _edge("gap_hunter", "data", "review_bundle", "gap_hunter"),
        _edge("input_json", "result", "review_bundle", "source_payload"),
        _edge("review_bundle", "result", "synthesis_prompt", "value"),
        _edge("synthesis_prompt", "result", "review_synthesis", "prompt"),
        _edge("get_provider", "value", "evidence_skeptic", "provider"),
        _edge("get_model", "value", "evidence_skeptic", "model"),
        _edge("get_provider", "value", "relevance_critic", "provider"),
        _edge("get_model", "value", "relevance_critic", "model"),
        _edge("get_provider", "value", "gap_hunter", "provider"),
        _edge("get_model", "value", "gap_hunter", "model"),
        _edge("get_provider", "value", "review_synthesis", "provider"),
        _edge("get_model", "value", "review_synthesis", "model"),
        _edge("review_synthesis", "exec-out", "end", "exec-in", animated=True),
        _edge("review_synthesis", "data", "end", "adversarial_review"),
        _edge("evidence_skeptic", "data", "end", "evidence_skeptic"),
        _edge("relevance_critic", "data", "end", "relevance_critic"),
        _edge("gap_hunter", "data", "end", "gap_hunter"),
        _edge("review_synthesis", "meta", "end", "meta"),
    ]
    _wire_start_fields(flow, "input_json", fields)
    flow["edges"].extend(
        [
            _edge("start", "plan", "input_json", "plan"),
            _edge("start", "investigation", "input_json", "investigation"),
            _edge("start", "round_index", "input_json", "round_index"),
            _edge("start", "total_rounds", "input_json", "total_rounds"),
        ]
    )
    return flow


def build_render_flow() -> dict[str, Any]:
    fields = _input_fields(
        [
            ("settings", "settings", "object"),
            ("plan", "plan", "object"),
            ("investigation", "investigation", "object"),
            ("adversarial_review", "adversarial_review", "object"),
            ("review_rounds_completed", "review_rounds_completed", "number"),
        ]
    )
    flow = _base_flow("dp-render", "deep-research-render", "Final report and audit object renderer.")
    flow["nodes"] = [
        _start_node(
            [
                *START_PINS,
                _pin("plan", "plan", "object"),
                _pin("investigation", "investigation", "object"),
                _pin("adversarial_review", "adversarial_review", "object"),
                _pin("review_rounds_completed", "review_rounds_completed", "number"),
            ]
        ),
        _settings_node("derive_settings", -640, -160),
        _make_object("input_json", fields, -520, 120),
        _stringify("prompt_json", -160, 120),
        _get_node("get_provider", "provider", "", -160, -220),
        _get_node("get_model", "model", "", -160, -120),
        _llm_node(
            "writer",
            "Render report package",
            220,
            0,
            system=(
                "You are the final research report writer. Produce two separate outputs: "
                "a rigorous human-readable Markdown report, and machine-readable audit "
                "objects. In report_markdown, write like a professional article or "
                "research brief: use prose, clear headings, concise lists only when useful, "
                "and inline source citations such as [src_001] next to supported claims. "
                "End report_markdown with a ## References section listing each cited source "
                "with title, URL or path, source type, fetched status, and evidence quality. "
                "Do not include visible sections named Evidence Table, Evidence Matrix, or "
                "Claim-Evidence Matrix, and do not dump audit tables into the report body. "
                "Do not include a separate Citations, Source IDs, Sources Cited, or "
                "Bibliography section; ## References is the only source-list section. "
                "Keep source_ledger and claim_evidence_matrix only as machine-readable audit "
                "outputs. If a comparison table is genuinely useful for the reader, use a "
                "valid multiline Markdown table with a separator row. Do not cite a source "
                "that was not fetched or otherwise available in the source ledger. If "
                "evidence is missing, say so in plain language."
            ),
            schema=RENDER_SCHEMA,
            temperature=0.1,
        ),
        _code_data_node(
            "normalize_report_markdown",
            "Normalize user-facing report",
            NORMALIZE_REPORT_MARKDOWN_CODE,
            620,
            -160,
            [
                _pin("report_markdown", "report_markdown", "string"),
                _pin("source_ledger", "source_ledger", "array"),
            ],
            output_type="string",
        ),
        _end_node(
            [
                _pin("report_markdown", "report_markdown", "string"),
                _pin("research_run_manifest", "research_run_manifest", "object"),
                _pin("source_ledger", "source_ledger", "array"),
                _pin("claim_evidence_matrix", "claim_evidence_matrix", "array"),
                _pin("iteration_log", "iteration_log", "array"),
                _pin("adversarial_review_summary", "adversarial_review_summary", "string"),
                _pin("limitations", "limitations", "array"),
                _pin("warnings", "warnings", "array"),
                _pin("export_status", "export_status", "object"),
                _pin("meta", "meta", "object"),
            ]
        ),
    ]
    flow["edges"] = [
        _edge("start", "exec-out", "derive_settings", "exec-in", animated=True),
        _edge("derive_settings", "exec-out", "writer", "exec-in", animated=True),
        _edge("start", "effort", "derive_settings", "effort"),
        _edge("start", "provider", "derive_settings", "provider"),
        _edge("start", "model", "derive_settings", "model"),
        _edge("derive_settings", "output", "input_json", "settings"),
        _edge("derive_settings", "output", "get_provider", "object"),
        _edge("derive_settings", "output", "get_model", "object"),
        _edge("input_json", "result", "prompt_json", "value"),
        _edge("prompt_json", "result", "writer", "prompt"),
        _edge("get_provider", "value", "writer", "provider"),
        _edge("get_model", "value", "writer", "model"),
        _edge("writer", "exec-out", "end", "exec-in", animated=True),
        _edge("writer", "meta", "end", "meta"),
    ]
    for key, default in [
        ("report_markdown", ""),
        ("research_run_manifest", {}),
        ("source_ledger", []),
        ("claim_evidence_matrix", []),
        ("iteration_log", []),
        ("adversarial_review_summary", ""),
        ("limitations", []),
        ("warnings", []),
        ("export_status", {}),
    ]:
        getter_id = f"get_{key}"
        flow["nodes"].append(_get_node(getter_id, key, default, 620, 180 + len(flow["nodes"]) * 36))
        flow["edges"].append(_edge("writer", "data", getter_id, "object"))
        if key == "report_markdown":
            flow["edges"].append(_edge(getter_id, "value", "normalize_report_markdown", "report_markdown"))
        elif key == "source_ledger":
            flow["edges"].append(_edge(getter_id, "value", "normalize_report_markdown", "source_ledger"))
            flow["edges"].append(_edge(getter_id, "value", "end", key))
        else:
            flow["edges"].append(_edge(getter_id, "value", "end", key))
    flow["edges"].append(_edge("normalize_report_markdown", "output", "end", "report_markdown"))
    _wire_start_fields(flow, "input_json", fields)
    flow["edges"].extend(
        [
            _edge("start", "plan", "input_json", "plan"),
            _edge("start", "investigation", "input_json", "investigation"),
            _edge("start", "adversarial_review", "input_json", "adversarial_review"),
            _edge("start", "review_rounds_completed", "input_json", "review_rounds_completed"),
        ]
    )
    return flow


def _subflow_node(node_id: str, label: str, flow_id: str, x: int, y: int) -> dict[str, Any]:
    return _node(
        node_id,
        "subflow",
        label,
        x,
        y,
        inputs=[
            EXEC_IN,
            _pin("inherit_context", "inherit_context", "boolean"),
            _pin("input", "input", "object"),
        ],
        outputs=[EXEC_OUT, _pin("output", "output", "object")],
        pin_defaults={"inherit_context": False},
        extra={"subflowId": flow_id},
    )


def _write_node(node_id: str, node_type: str, label: str, x: int, y: int) -> dict[str, Any]:
    return _node(
        node_id,
        node_type,
        label,
        x,
        y,
        inputs=[
            EXEC_IN,
            _pin("file_path", "file_path", "workspace_file"),
            _pin("content", "content", "any"),
            _pin("title", "title", "string"),
        ]
        if node_type in {"write_pdf", "write_docx"}
        else [
            EXEC_IN,
            _pin("file_path", "file_path", "workspace_file"),
            _pin("content", "content", "any"),
        ],
        outputs=[
            EXEC_OUT,
            _pin("bytes", "bytes", "number"),
            _pin("file_path", "file_path", "workspace_file"),
            _pin("sha256", "sha256", "string"),
            _pin("content_type", "content_type", "string"),
        ]
        if node_type in {"write_pdf", "write_docx"}
        else [
            EXEC_OUT,
            _pin("bytes", "bytes", "number"),
            _pin("file_path", "file_path", "workspace_file"),
        ],
    )


def build_root_flow() -> dict[str, Any]:
    flow = _base_flow(
        "dp-research",
        "deep-research",
        (
            "Production research workflow with adversarial review, provenance, and "
            "Markdown/PDF/DOCX export."
        ),
        ["abstractcode.agent.v1", "abstractresearch.dp.v1"],
    )
    root_fields = _input_fields()
    investigate_fields = _input_fields(
        [
            ("plan", "plan", "object"),
            ("prior_investigation", "prior_investigation", "object"),
            ("adversarial_review", "adversarial_review", "object"),
            ("round_index", "round_index", "number"),
            ("total_rounds", "total_rounds", "number"),
        ]
    )
    review_fields = _input_fields(
        [
            ("plan", "plan", "object"),
            ("investigation", "investigation", "object"),
            ("round_index", "round_index", "number"),
            ("total_rounds", "total_rounds", "number"),
        ]
    )
    render_fields = _input_fields(
        [
            ("plan", "plan", "object"),
            ("investigation", "investigation", "object"),
            ("adversarial_review", "adversarial_review", "object"),
            ("review_rounds_completed", "review_rounds_completed", "number"),
        ]
    )
    flow["nodes"] = [
        _start_node(),
        _settings_node("derive_settings", -560, -160),
        _get_node("get_max_review_rounds", "max_review_rounds", 2, -220, -340),
        _get_node("get_output_prefix", "output_prefix", "reports/dp-standard-research", 3040, 360),
        _get_node("get_report_title", "report_title", "Research Report", 3040, 500),
        _system_datetime_node("run_timestamp", -560, 320),
        _replace_node("timestamp_no_colons", "Sanitize timestamp colons", ":", "-", -240, 280),
        _replace_node("timestamp_safe", "Sanitize timestamp decimals", ".", "-", 80, 280),
        _set_var_node(
            "set_export_timestamp",
            "Persist export timestamp",
            "dp.export_timestamp",
            -180,
            40,
        ),
        _make_object("plan_input", root_fields, -560, -260),
        _subflow_node("plan", "Plan", "dp-plan", -180, -140),
        _get_node("get_plan", "plan", {}, 160, -260),
        _get_var_node(
            "get_loop_state",
            "dp.loop_state",
            {"rounds_completed": 0, "continue_research": True},
            160,
            -20,
        ),
        _code_data_node(
            "loop_condition",
            "Should research continue?",
            RESEARCH_LOOP_CONDITION_CODE,
            160,
            120,
            [
                _pin("loop_state", "loop_state", "object"),
                _pin("max_review_rounds", "max_review_rounds", "number"),
            ],
        ),
        _while_node("research_rounds", "Review-gated research rounds", 160, 260),
        _get_var_node("get_prior_investigation", "dp.latest_investigation", {}, 520, -340),
        _get_var_node("get_prior_review", "dp.latest_review", {}, 520, -220),
        _make_object(
            "investigate_input",
            investigate_fields,
            520,
            -20,
        ),
        _subflow_node("investigate", "Investigate round", "dp-investigate", 900, -140),
        _get_node("get_investigation", "investigation", {}, 1240, -300),
        _set_var_node(
            "set_latest_investigation",
            "Persist latest investigation",
            "dp.latest_investigation",
            1240,
            -120,
        ),
        _make_object(
            "review_input",
            review_fields,
            1600,
            -20,
        ),
        _subflow_node("review", "Adversarial review round", "dp-review", 1980, -140),
        _get_node("get_review", "adversarial_review", {}, 2320, -300),
        _set_var_node("set_latest_review", "Persist latest review", "dp.latest_review", 2320, -120),
        _code_data_node(
            "next_loop_state",
            "Record reviewer decision",
            NEXT_LOOP_STATE_CODE,
            2320,
            40,
            [
                _pin("review", "review", "object"),
                _pin("round_index", "round_index", "number"),
            ],
        ),
        _set_var_node("set_loop_state", "Persist loop state", "dp.loop_state", 2320, 200),
        _get_var_node("get_final_investigation", "dp.latest_investigation", {}, 2660, -300),
        _get_var_node("get_final_review", "dp.latest_review", {}, 2660, -180),
        _get_var_node(
            "get_final_loop_state",
            "dp.loop_state",
            {"rounds_completed": 0, "continue_research": True},
            2660,
            -60,
        ),
        _get_node("get_review_rounds_completed", "rounds_completed", 0, 2660, 80),
        _make_object("render_input", render_fields, 2660, -20),
        _subflow_node("render", "Render final report", "dp-render", 3040, -140),
        _get_node("get_report_markdown", "report_markdown", "", 3380, -520),
        _get_node("get_manifest", "research_run_manifest", {}, 3380, -400),
        _get_node("get_source_ledger", "source_ledger", [], 3380, -280),
        _get_node("get_claim_matrix", "claim_evidence_matrix", [], 3380, -160),
        _get_node("get_iteration_log", "iteration_log", [], 3380, -40),
        _get_node("get_warnings", "warnings", [], 3380, 80),
        _get_node("get_model_export_status", "export_status", {}, 3380, 200),
        _get_var_node("get_export_timestamp", "dp.export_timestamp", "", 3380, 300),
        _make_object(
            "path_vars",
            [
                ("output_prefix", "output_prefix", "string"),
                ("timestamp", "timestamp", "string"),
            ],
            3380,
            380,
        ),
        _template("path_md", "{{output_prefix}}-{{timestamp}}.md", 3700, -520),
        _template("path_pdf", "{{output_prefix}}-{{timestamp}}.pdf", 3700, -400),
        _template("path_docx", "{{output_prefix}}-{{timestamp}}.docx", 3700, -280),
        _template("path_manifest", "{{output_prefix}}-{{timestamp}}.manifest.json", 3700, -160),
        _template("path_sources", "{{output_prefix}}-{{timestamp}}.sources.json", 3700, -40),
        _template("path_claims", "{{output_prefix}}-{{timestamp}}.claims.json", 3700, 80),
        _template("path_iterations", "{{output_prefix}}-{{timestamp}}.iterations.json", 3700, 200),
        _template("path_warnings", "{{output_prefix}}-{{timestamp}}.warnings.json", 3700, 320),
        _stringify("sources_json", 3700, 460),
        _stringify("claims_json", 3700, 580),
        _stringify("iterations_json", 3700, 700),
        _stringify("warnings_json", 3700, 820),
        _write_node("write_md", "write_file", "Write Markdown", 4080, -520),
        _write_node("write_pdf", "write_pdf", "Write PDF", 4360, -400),
        _write_node("write_docx", "write_docx", "Write DOCX", 4640, -280),
        _write_node("write_sources", "write_file", "Write source ledger", 4920, -40),
        _write_node("write_claims", "write_file", "Write claim matrix", 5200, 80),
        _write_node("write_iterations", "write_file", "Write iteration log", 5480, 200),
        _write_node("write_warnings", "write_file", "Write warnings", 5760, 320),
        _make_object(
            "post_export_manifest",
            [
                ("research_run_manifest", "research_run_manifest", "object"),
                ("generated_at", "generated_at", "string"),
                ("md_path", "md_path", "workspace_file"),
                ("md_bytes", "md_bytes", "number"),
                ("pdf_path", "pdf_path", "workspace_file"),
                ("pdf_bytes", "pdf_bytes", "number"),
                ("pdf_sha256", "pdf_sha256", "string"),
                ("pdf_content_type", "pdf_content_type", "string"),
                ("docx_path", "docx_path", "workspace_file"),
                ("docx_bytes", "docx_bytes", "number"),
                ("docx_sha256", "docx_sha256", "string"),
                ("docx_content_type", "docx_content_type", "string"),
                ("source_ledger_path", "source_ledger_path", "workspace_file"),
                ("claim_matrix_path", "claim_matrix_path", "workspace_file"),
                ("iteration_log_path", "iteration_log_path", "workspace_file"),
                ("warnings_path", "warnings_path", "workspace_file"),
                ("model_export_status", "model_export_status", "object"),
            ],
            6040,
            -120,
        ),
        _stringify("manifest_json", 6040, 120),
        _write_node("write_manifest", "write_file", "Write manifest", 6320, -160),
        _end_node(
            [
                _pin("response", "response", "string"),
                _pin("report_markdown", "report_markdown", "string"),
                _pin("md_path", "md_path", "workspace_file"),
                _pin("pdf_path", "pdf_path", "workspace_file"),
                _pin("docx_path", "docx_path", "workspace_file"),
                _pin("pdf_sha256", "pdf_sha256", "string"),
                _pin("docx_sha256", "docx_sha256", "string"),
                _pin("manifest_path", "manifest_path", "workspace_file"),
                _pin("source_ledger_path", "source_ledger_path", "workspace_file"),
                _pin("claim_matrix_path", "claim_matrix_path", "workspace_file"),
                _pin("iteration_log_path", "iteration_log_path", "workspace_file"),
                _pin("warnings_path", "warnings_path", "workspace_file"),
                _pin("export_manifest", "export_manifest", "object"),
                _pin("export_status", "export_status", "object"),
                _pin("warnings", "warnings", "array"),
                _pin("meta", "meta", "object"),
            ]
        ),
    ]
    flow["nodes"][-1]["position"] = {"x": 6660, "y": 0}
    flow["edges"] = [
        _edge("start", "exec-out", "derive_settings", "exec-in", animated=True),
        _edge("derive_settings", "exec-out", "set_export_timestamp", "exec-in", animated=True),
        _edge("set_export_timestamp", "exec-out", "plan", "exec-in", animated=True),
        _edge("plan", "exec-out", "research_rounds", "exec-in", animated=True),
        _edge("research_rounds", "loop", "investigate", "exec-in", animated=True),
        _edge("investigate", "exec-out", "set_latest_investigation", "exec-in", animated=True),
        _edge("set_latest_investigation", "exec-out", "review", "exec-in", animated=True),
        _edge("review", "exec-out", "set_latest_review", "exec-in", animated=True),
        _edge("set_latest_review", "exec-out", "set_loop_state", "exec-in", animated=True),
        _edge("research_rounds", "done", "render", "exec-in", animated=True),
        _edge("render", "exec-out", "write_md", "exec-in", animated=True),
        _edge("write_md", "exec-out", "write_pdf", "exec-in", animated=True),
        _edge("write_pdf", "exec-out", "write_docx", "exec-in", animated=True),
        _edge("write_docx", "exec-out", "write_sources", "exec-in", animated=True),
        _edge("write_sources", "exec-out", "write_claims", "exec-in", animated=True),
        _edge("write_claims", "exec-out", "write_iterations", "exec-in", animated=True),
        _edge("write_iterations", "exec-out", "write_warnings", "exec-in", animated=True),
        _edge("write_warnings", "exec-out", "write_manifest", "exec-in", animated=True),
        _edge("write_manifest", "exec-out", "end", "exec-in", animated=True),
        _edge("start", "effort", "derive_settings", "effort"),
        _edge("start", "provider", "derive_settings", "provider"),
        _edge("start", "model", "derive_settings", "model"),
        _edge("derive_settings", "output", "get_max_review_rounds", "object"),
        _edge("derive_settings", "output", "get_output_prefix", "object"),
        _edge("derive_settings", "output", "get_report_title", "object"),
        _edge("run_timestamp", "iso", "timestamp_no_colons", "text"),
        _edge("timestamp_no_colons", "result", "timestamp_safe", "text"),
        _edge("timestamp_safe", "result", "set_export_timestamp", "value"),
        _edge("plan_input", "result", "plan", "input"),
        _edge("plan", "output", "get_plan", "object"),
        _edge("get_loop_state", "value", "loop_condition", "loop_state"),
        _edge("get_max_review_rounds", "value", "loop_condition", "max_review_rounds"),
        _edge("loop_condition", "condition", "research_rounds", "condition"),
        _edge("get_plan", "value", "investigate_input", "plan"),
        _edge("get_prior_investigation", "value", "investigate_input", "prior_investigation"),
        _edge("get_prior_review", "value", "investigate_input", "adversarial_review"),
        _edge("research_rounds", "index", "investigate_input", "round_index"),
        _edge("get_max_review_rounds", "value", "investigate_input", "total_rounds"),
        _edge("investigate_input", "result", "investigate", "input"),
        _edge("investigate", "output", "get_investigation", "object"),
        _edge("get_investigation", "value", "set_latest_investigation", "value"),
        _edge("get_plan", "value", "review_input", "plan"),
        _edge("get_investigation", "value", "review_input", "investigation"),
        _edge("research_rounds", "index", "review_input", "round_index"),
        _edge("get_max_review_rounds", "value", "review_input", "total_rounds"),
        _edge("review_input", "result", "review", "input"),
        _edge("review", "output", "get_review", "object"),
        _edge("get_review", "value", "set_latest_review", "value"),
        _edge("get_review", "value", "next_loop_state", "review"),
        _edge("research_rounds", "index", "next_loop_state", "round_index"),
        _edge("next_loop_state", "output", "set_loop_state", "value"),
        _edge("get_plan", "value", "render_input", "plan"),
        _edge("get_final_investigation", "value", "render_input", "investigation"),
        _edge("get_final_review", "value", "render_input", "adversarial_review"),
        _edge("get_final_loop_state", "value", "get_review_rounds_completed", "object"),
        _edge("get_review_rounds_completed", "value", "render_input", "review_rounds_completed"),
        _edge("render_input", "result", "render", "input"),
        _edge("render", "output", "get_report_markdown", "object"),
        _edge("render", "output", "get_manifest", "object"),
        _edge("render", "output", "get_source_ledger", "object"),
        _edge("render", "output", "get_claim_matrix", "object"),
        _edge("render", "output", "get_iteration_log", "object"),
        _edge("render", "output", "get_warnings", "object"),
        _edge("render", "output", "get_model_export_status", "object"),
        _edge("get_output_prefix", "value", "path_vars", "output_prefix"),
        _edge("get_export_timestamp", "value", "path_vars", "timestamp"),
        _edge("path_vars", "result", "path_md", "vars"),
        _edge("path_vars", "result", "path_pdf", "vars"),
        _edge("path_vars", "result", "path_docx", "vars"),
        _edge("path_vars", "result", "path_manifest", "vars"),
        _edge("path_vars", "result", "path_sources", "vars"),
        _edge("path_vars", "result", "path_claims", "vars"),
        _edge("path_vars", "result", "path_iterations", "vars"),
        _edge("path_vars", "result", "path_warnings", "vars"),
        _edge("get_source_ledger", "value", "sources_json", "value"),
        _edge("get_claim_matrix", "value", "claims_json", "value"),
        _edge("get_iteration_log", "value", "iterations_json", "value"),
        _edge("get_warnings", "value", "warnings_json", "value"),
        _edge("path_md", "result", "write_md", "file_path"),
        _edge("get_report_markdown", "value", "write_md", "content"),
        _edge("path_pdf", "result", "write_pdf", "file_path"),
        _edge("get_report_markdown", "value", "write_pdf", "content"),
        _edge("get_report_title", "value", "write_pdf", "title"),
        _edge("path_docx", "result", "write_docx", "file_path"),
        _edge("get_report_markdown", "value", "write_docx", "content"),
        _edge("get_report_title", "value", "write_docx", "title"),
        _edge("path_sources", "result", "write_sources", "file_path"),
        _edge("sources_json", "result", "write_sources", "content"),
        _edge("path_claims", "result", "write_claims", "file_path"),
        _edge("claims_json", "result", "write_claims", "content"),
        _edge("path_iterations", "result", "write_iterations", "file_path"),
        _edge("iterations_json", "result", "write_iterations", "content"),
        _edge("path_warnings", "result", "write_warnings", "file_path"),
        _edge("warnings_json", "result", "write_warnings", "content"),
        _edge("get_manifest", "value", "post_export_manifest", "research_run_manifest"),
        _edge("get_export_timestamp", "value", "post_export_manifest", "generated_at"),
        _edge("write_md", "file_path", "post_export_manifest", "md_path"),
        _edge("write_md", "bytes", "post_export_manifest", "md_bytes"),
        _edge("write_pdf", "file_path", "post_export_manifest", "pdf_path"),
        _edge("write_pdf", "bytes", "post_export_manifest", "pdf_bytes"),
        _edge("write_pdf", "sha256", "post_export_manifest", "pdf_sha256"),
        _edge("write_pdf", "content_type", "post_export_manifest", "pdf_content_type"),
        _edge("write_docx", "file_path", "post_export_manifest", "docx_path"),
        _edge("write_docx", "bytes", "post_export_manifest", "docx_bytes"),
        _edge("write_docx", "sha256", "post_export_manifest", "docx_sha256"),
        _edge("write_docx", "content_type", "post_export_manifest", "docx_content_type"),
        _edge("write_sources", "file_path", "post_export_manifest", "source_ledger_path"),
        _edge("write_claims", "file_path", "post_export_manifest", "claim_matrix_path"),
        _edge("write_iterations", "file_path", "post_export_manifest", "iteration_log_path"),
        _edge("write_warnings", "file_path", "post_export_manifest", "warnings_path"),
        _edge("get_model_export_status", "value", "post_export_manifest", "model_export_status"),
        _edge("post_export_manifest", "result", "manifest_json", "value"),
        _edge("path_manifest", "result", "write_manifest", "file_path"),
        _edge("manifest_json", "result", "write_manifest", "content"),
        _edge("get_report_markdown", "value", "end", "response"),
        _edge("get_report_markdown", "value", "end", "report_markdown"),
        _edge("write_md", "file_path", "end", "md_path"),
        _edge("write_pdf", "file_path", "end", "pdf_path"),
        _edge("write_docx", "file_path", "end", "docx_path"),
        _edge("write_pdf", "sha256", "end", "pdf_sha256"),
        _edge("write_docx", "sha256", "end", "docx_sha256"),
        _edge("write_manifest", "file_path", "end", "manifest_path"),
        _edge("write_sources", "file_path", "end", "source_ledger_path"),
        _edge("write_claims", "file_path", "end", "claim_matrix_path"),
        _edge("write_iterations", "file_path", "end", "iteration_log_path"),
        _edge("write_warnings", "file_path", "end", "warnings_path"),
        _edge("post_export_manifest", "result", "end", "export_manifest"),
        _edge("get_model_export_status", "value", "end", "export_status"),
        _edge("get_warnings", "value", "end", "warnings"),
        _edge("post_export_manifest", "result", "end", "meta"),
    ]
    _wire_start_fields(flow, "plan_input", root_fields)
    _wire_start_fields(flow, "investigate_input", investigate_fields)
    _wire_start_fields(flow, "review_input", review_fields)
    _wire_start_fields(flow, "render_input", render_fields)
    return flow


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    flows = [
        build_plan_flow(),
        build_investigate_flow(),
        build_review_flow(),
        build_render_flow(),
        build_root_flow(),
    ]
    for flow in flows:
        write_json(FLOWS_DIR / f"{flow['id']}.json", flow)

    sys.path.insert(0, str(ROOT / "abstractruntime" / "src"))
    from abstractruntime.workflow_bundle import pack_workflow_bundle

    BUNDLES_DIR.mkdir(parents=True, exist_ok=True)
    pack_workflow_bundle(
        root_flow_json=FLOWS_DIR / "dp-research.json",
        out_path=BUNDLE_PATH,
        bundle_id="dp-research",
        bundle_version="0.1.1",
        flows_dir=FLOWS_DIR,
        entrypoints=["dp-research"],
        default_entrypoint="dp-research",
        metadata={
            "family": "dp",
            "purpose": "production research with adversarial review and document export",
            "source_of_truth": {
                "process": "VisualFlow",
                "execution": "AbstractRuntime",
                "lifecycle": "AbstractGateway catalog",
                "routing": "AbstractCore capability defaults plus run overrides",
            },
            "control_policy": {
                "user_budget_control": "effort",
                "effort_values": ["quick", "standard", "thorough"],
                "outer_loop": "review_gated_while_with_effort_budget",
                "per_pass_agent_cap": "derived_settings.max_iterations",
                "deadline_minutes": "derived_settings.deadline_minutes_prompt_guidance",
                "max_sources": "derived_settings.max_sources_prompt_guidance",
            },
            "default_model_profile": {
                "default": "Gateway/AbstractCore defaults when provider/model are blank",
                "override_pins": ["provider", "model"],
                "role_policy": "planner, researcher, critics, and writer use the same optional override",
            },
            "outputs": [
                "markdown_report",
                "pdf_report",
                "docx_report",
                "research_run_manifest_v1",
                "research_source_ledger_v1",
                "claim_evidence_matrix_v1",
                "iteration_log_v1",
            ],
            "tool_policy": {
                "research_agents": READ_ONLY_TOOLS,
                "review_agents": [],
                "export": "deterministic write_file/write_pdf/write_docx nodes",
            },
        },
    )
    print(f"Wrote {len(flows)} flows to {FLOWS_DIR}")
    print(f"Packed {BUNDLE_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
