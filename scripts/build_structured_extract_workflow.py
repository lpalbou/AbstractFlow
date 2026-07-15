#!/usr/bin/env python3
"""structured-extract workflow: text -> schema-validated JSON with a
validate->reprompt correction loop.

An extractor LLM produces JSON against a caller-supplied JSON Schema; a
deterministic validator checks required keys/types; on failure the specific
validation errors are fed back as a correction reprompt until valid or the
attempt budget is spent. The reusable extraction primitive.
"""
from __future__ import annotations

import wf_common as W

BUILD_PROMPT_CODE = """
src = str(source_text or "").strip()
schema = fields_spec or {}
attempt = int(attempt_no or 0)
errors = validation_errors or []
parts = []
parts.append("Extract structured data from the SOURCE below and return ONLY a JSON object that conforms to the SCHEMA.")
parts.append("")
parts.append("## Schema (JSON Schema)")
parts.append(str(schema) if schema else "(no schema provided; infer a flat object of the key facts)")
parts.append("")
parts.append("## Source")
parts.append(src)
if attempt > 0 and errors:
    parts.append("")
    parts.append("## Your previous output FAILED validation - fix EXACTLY these and re-output the full object:")
    i = 0
    for e in errors:
        i = i + 1
        parts.append(str(i) + ". " + str(e))
parts.append("")
parts.append("Return the JSON object only. Do not invent values not supported by the source; use null (or omit optional keys) when the source does not state a value.")
return "\\n".join(parts)
""".strip()

# The extractor is an llm_call whose resp_schema = fields_spec, so `data` is
# an ALREADY-PARSED object (no json import needed in the sandbox). Validate
# the dict directly against required keys + types.
VALIDATE_CODE = """
def _type_ok(val, t):
    if t == "string":
        return isinstance(val, str)
    if t == "number":
        return isinstance(val, (int, float)) and not isinstance(val, bool)
    if t == "integer":
        return isinstance(val, int) and not isinstance(val, bool)
    if t == "boolean":
        return isinstance(val, bool)
    if t == "array":
        return isinstance(val, list)
    if t == "object":
        return isinstance(val, dict)
    if t == "null":
        return val is None
    return True

obj = extracted if isinstance(extracted, dict) else None
errors = []
if obj is None:
    return {"valid": False, "errors": ["extractor did not return a structured object"], "data": {}, "attempt": int(attempt_no or 0) + 1}
schema = fields_spec if isinstance(fields_spec, dict) else {}
props = schema.get("properties")
required = schema.get("required")
if isinstance(required, list):
    for key in required:
        if key not in obj or obj.get(key) is None:
            errors.append("missing required key: " + str(key))
if isinstance(props, dict):
    for key in props:
        spec = props.get(key)
        if key in obj and obj.get(key) is not None and isinstance(spec, dict) and spec.get("type"):
            t = spec.get("type")
            if not _type_ok(obj.get(key), t):
                errors.append("key '" + str(key) + "' should be " + str(t))
return {
    "valid": len(errors) == 0,
    "errors": errors,
    "data": obj,
    "attempt": int(attempt_no or 0) + 1,
}
""".strip()

LOOP_COND_CODE = """
state = loop_state or {}
attempt = int(state.get("attempt", 0) or 0)
valid = bool(state.get("valid"))
max_a = max(1, int(max_attempts or 1))
return {"condition": (not valid) and attempt < max_a, "attempt": attempt, "valid": valid}
""".strip()

FINAL_CODE = """
state = loop_state or {}
return {
    "data": state.get("data") or {},
    "valid": bool(state.get("valid")),
    "attempts": int(state.get("attempt", 0) or 0),
    "errors": state.get("errors") or [],
}
""".strip()


def build_flow():
    flow = W.base_flow(
        "structured-extract", "structured-extract",
        "Reusable extraction primitive: an LLM extracts JSON from source text against a caller-supplied JSON Schema; a deterministic validator checks required keys/types and feeds specific errors back as a correction reprompt until the output is valid or the attempt budget is spent.",
        ["abstractextract.structured.v1"],
    )
    fields = [
        W.pin("source_text", "source_text", "string"),
        W.pin("fields_spec", "fields_spec", "json_schema"),
        W.pin("max_attempts", "max_attempts", "number"),
        W.pin("provider", "provider", "provider_text"),
        W.pin("model", "model", "model"),
    ]
    flow["nodes"] = [
        W.start_node("Source + schema", fields, -1000, 0,
                     pin_defaults={"max_attempts": 3}),
        W.get_var("get_loop_state", "ex.loop_state",
                  {"attempt": 0, "valid": False, "errors": [], "data": {}}, -660, 200),
        W.code_node("loop_cond", "Retry until valid?", LOOP_COND_CODE, -660, 340,
                    [W.pin("loop_state", "loop_state", "object"),
                     W.pin("max_attempts", "max_attempts", "number")]),
        W.while_node("attempts", "Extract-validate rounds", -660, 500),
        # body
        W.get_var("get_state_body", "ex.loop_state",
                  {"attempt": 0, "valid": False, "errors": [], "data": {}}, -320, -140),
        W.get_node("get_state_errors", "errors", [], -320, -260),
        W.code_node("build_prompt", "Compose extractor prompt", BUILD_PROMPT_CODE, -320, 40,
                    [W.pin("source_text", "source_text", "string"),
                     W.pin("fields_spec", "fields_spec", "object"),
                     W.pin("attempt_no", "attempt_no", "number"),
                     W.pin("validation_errors", "validation_errors", "array")],
                    output_type="string"),
        W.llm_node("extractor", "Extractor LLM", 40, -40,
                   pin_defaults={
                       "system": "You are a precise structured-data extractor. You output only valid JSON conforming to the given schema and never invent facts absent from the source.",
                       "temperature": 0.0,
                   }),
        # resp_schema (fields_spec) makes `data` an already-parsed object.
        W.code_node("validate", "Validate against schema", VALIDATE_CODE, 420, 40,
                    [W.pin("extracted", "extracted", "any"),
                     W.pin("fields_spec", "fields_spec", "object"),
                     W.pin("attempt_no", "attempt_no", "number")]),
        W.set_var("set_state", "Persist loop state", "ex.loop_state", 760, 40),
        # after loop
        W.get_var("get_final_state", "ex.loop_state",
                  {"attempt": 0, "valid": False, "errors": [], "data": {}}, -320, 640),
        W.code_node("final", "Assemble result", FINAL_CODE, 40, 640,
                    [W.pin("loop_state", "loop_state", "object")]),
        W.get_node("get_data", "data", {}, 420, 560),
        W.get_node("get_valid", "valid", False, 420, 680),
        W.get_node("get_attempts", "attempts", 0, 420, 800),
        W.get_node("get_errors", "errors", [], 420, 900),
        W.end_node("Extracted", [
            W.pin("data", "data", "object"),
            W.pin("valid", "valid", "boolean"),
            W.pin("attempts", "attempts", "number"),
            W.pin("errors", "errors", "array"),
        ], 800, 640),
    ]
    flow["edges"] = [
        W.edge("start", "exec-out", "attempts", "exec-in", animated=True),
        W.edge("attempts", "loop", "extractor", "exec-in", animated=True),
        # validate is a PURE node pulled by set_state.value (no exec pins);
        # the extractor's exec-out drives set_state directly.
        W.edge("extractor", "exec-out", "set_state", "exec-in", animated=True),
        W.edge("attempts", "done", "end", "exec-in", animated=True),
        # loop condition
        W.edge("get_loop_state", "value", "loop_cond", "loop_state"),
        W.edge("start", "max_attempts", "loop_cond", "max_attempts"),
        # pull the boolean SUB-KEY of the code node's dict (dp-research idiom),
        # not the whole object — a dict on while.condition is always truthy.
        W.edge("loop_cond", "condition", "attempts", "condition"),
        # extractor prompt (prior errors fed back for the correction reprompt)
        W.edge("start", "source_text", "build_prompt", "source_text"),
        W.edge("start", "fields_spec", "build_prompt", "fields_spec"),
        W.edge("attempts", "index", "build_prompt", "attempt_no"),
        W.edge("get_state_body", "value", "get_state_errors", "object"),
        W.edge("get_state_errors", "value", "build_prompt", "validation_errors"),
        W.edge("build_prompt", "output", "extractor", "prompt"),
        W.edge("start", "provider", "extractor", "provider"),
        W.edge("start", "model", "extractor", "model"),
        W.edge("start", "fields_spec", "extractor", "resp_schema"),
        # validate the already-parsed structured object (extractor.data)
        W.edge("extractor", "data", "validate", "extracted"),
        W.edge("start", "fields_spec", "validate", "fields_spec"),
        W.edge("attempts", "index", "validate", "attempt_no"),
        W.edge("validate", "output", "set_state", "value"),
        # final
        W.edge("get_final_state", "value", "final", "loop_state"),
        W.edge("final", "output", "get_data", "object"),
        W.edge("final", "output", "get_valid", "object"),
        W.edge("final", "output", "get_attempts", "object"),
        W.edge("final", "output", "get_errors", "object"),
        W.edge("get_data", "value", "end", "data"),
        W.edge("get_valid", "value", "end", "valid"),
        W.edge("get_attempts", "value", "end", "attempts"),
        W.edge("get_errors", "value", "end", "errors"),
    ]
    return flow


def main():
    flow = build_flow()
    print("edge problems:", W.validate_edges(flow))
    W.write_json(W.FLOWS_DIR / "structured-extract.json", flow)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
