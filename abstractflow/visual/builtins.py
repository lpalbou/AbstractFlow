"""Built-in function handlers for visual nodes.

These are intentionally pure and JSON-friendly so visual workflows can run in
any host that can compile the VisualFlow JSON to a WorkflowSpec.
"""

from __future__ import annotations

import ast
from datetime import datetime
import json
import locale
import os
from typing import Any, Callable, Dict, List, Optional

from abstractruntime.rendering import render_agent_trace_markdown as runtime_render_agent_trace_markdown
from abstractruntime.rendering import stringify_json as runtime_stringify_json


def get_builtin_handler(node_type: str) -> Optional[Callable[[Any], Any]]:
    """Get a built-in handler function for a node type."""
    return BUILTIN_HANDLERS.get(node_type)


def _path_tokens(path: str) -> list[Any]:
    """Parse a dotted/bracket path into tokens.

    Supported:
    - `a.b.c`
    - `a[0].b`

    Returns tokens as str keys and int indices.
    """
    import re

    p = str(path or "").strip()
    if not p:
        return []
    token_re = re.compile(r"([^\.\[\]]+)|\[(\d+)\]")
    out: list[Any] = []
    for m in token_re.finditer(p):
        key = m.group(1)
        if key is not None:
            k = key.strip()
            if k:
                out.append(k)
            continue
        idx = m.group(2)
        if idx is not None:
            try:
                out.append(int(idx))
            except Exception:
                continue
    return out


def _get_path(value: Any, path: str) -> Any:
    """Best-effort nested lookup (dict keys + list indices)."""
    tokens = _path_tokens(path)
    if not tokens:
        return None
    current: Any = value
    for tok in tokens:
        if isinstance(current, dict) and isinstance(tok, str):
            current = current.get(tok)
            continue
        if isinstance(current, list):
            idx: Optional[int] = None
            if isinstance(tok, int):
                idx = tok
            elif isinstance(tok, str) and tok.isdigit():
                idx = int(tok)
            if idx is None:
                return None
            if idx < 0 or idx >= len(current):
                return None
            current = current[idx]
            continue
        return None
    return current


# Math operations
def math_add(inputs: Dict[str, Any]) -> float:
    """Add two numbers."""
    return float(inputs.get("a", 0)) + float(inputs.get("b", 0))


def math_subtract(inputs: Dict[str, Any]) -> float:
    """Subtract b from a."""
    return float(inputs.get("a", 0)) - float(inputs.get("b", 0))


def math_multiply(inputs: Dict[str, Any]) -> float:
    """Multiply two numbers."""
    return float(inputs.get("a", 0)) * float(inputs.get("b", 0))


def math_divide(inputs: Dict[str, Any]) -> float:
    """Divide a by b."""
    b = float(inputs.get("b", 1))
    if b == 0:
        raise ValueError("Division by zero")
    return float(inputs.get("a", 0)) / b


def math_modulo(inputs: Dict[str, Any]) -> float:
    """Get remainder of a divided by b."""
    b = float(inputs.get("b", 1))
    if b == 0:
        raise ValueError("Modulo by zero")
    return float(inputs.get("a", 0)) % b


def math_power(inputs: Dict[str, Any]) -> float:
    """Raise base to exponent power."""
    return float(inputs.get("base", 0)) ** float(inputs.get("exp", 1))


def math_abs(inputs: Dict[str, Any]) -> float:
    """Get absolute value."""
    return abs(float(inputs.get("value", 0)))


def math_round(inputs: Dict[str, Any]) -> float:
    """Round to specified decimal places."""
    value = float(inputs.get("value", 0))
    decimals = int(inputs.get("decimals", 0))
    return round(value, decimals)


# String operations
def string_concat(inputs: Dict[str, Any]) -> str:
    """Concatenate two strings."""
    return str(inputs.get("a", "")) + str(inputs.get("b", ""))


def string_split(inputs: Dict[str, Any]) -> List[str]:
    """Split a string by a delimiter (defaults are tuned for real-world workflow usage).

    Notes:
    - Visual workflows often use human-edited / LLM-generated text where trailing
      delimiters are common (e.g. "A@@B@@"). A strict `str.split` would produce an
      empty last element and create a spurious downstream loop iteration.
    - We therefore support optional normalization flags with sensible defaults:
      - `trim` (default True): strip whitespace around parts
      - `drop_empty` (default True): drop empty parts after trimming
    - Delimiters may be entered as escape sequences (e.g. "\\n") from the UI.
    """

    raw_text = inputs.get("text", "")
    text = "" if raw_text is None else str(raw_text)

    raw_delim = inputs.get("delimiter", ",")
    delimiter = "" if raw_delim is None else str(raw_delim)
    delimiter = delimiter.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r")

    trim = bool(inputs.get("trim", True))
    drop_empty = bool(inputs.get("drop_empty", True))

    # Avoid ValueError from Python's `split("")` and keep behavior predictable.
    if delimiter == "":
        parts = [text] if text else []
    else:
        raw_maxsplit = inputs.get("maxsplit")
        maxsplit: Optional[int] = None
        if raw_maxsplit is not None:
            try:
                maxsplit = int(raw_maxsplit)
            except Exception:
                maxsplit = None
        if maxsplit is not None and maxsplit >= 0:
            parts = text.split(delimiter, maxsplit)
        else:
            parts = text.split(delimiter)

    if trim:
        parts = [p.strip() for p in parts]

    if drop_empty:
        parts = [p for p in parts if p != ""]

    return parts


def string_join(inputs: Dict[str, Any]) -> str:
    """Join array items with delimiter."""
    items = inputs.get("items")
    # Visual workflows frequently pass optional pins; treat `null` as empty.
    if items is None:
        items_list: list[Any] = []
    elif isinstance(items, list):
        items_list = items
    elif isinstance(items, tuple):
        items_list = list(items)
    else:
        # Defensive: if a non-array leaks in, treat it as a single element instead of
        # iterating characters (strings) or keys (dicts).
        items_list = [items]

    delimiter = str(inputs.get("delimiter", ","))
    # UI often stores escape sequences (e.g. "\\n") in JSON.
    delimiter = delimiter.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r")
    return delimiter.join("" if item is None else str(item) for item in items_list)


def string_format(inputs: Dict[str, Any]) -> str:
    """Format string with values."""
    template = str(inputs.get("template", ""))
    values = inputs.get("values", {})
    if isinstance(values, dict):
        return template.format(**values)
    return template


def string_uppercase(inputs: Dict[str, Any]) -> str:
    """Convert to uppercase."""
    return str(inputs.get("text", "")).upper()


def string_lowercase(inputs: Dict[str, Any]) -> str:
    """Convert to lowercase."""
    return str(inputs.get("text", "")).lower()


def string_trim(inputs: Dict[str, Any]) -> str:
    """Trim whitespace."""
    return str(inputs.get("text", "")).strip()


def string_substring(inputs: Dict[str, Any]) -> str:
    """Get substring."""
    text = str(inputs.get("text", ""))
    start = int(inputs.get("start", 0))
    end = inputs.get("end")
    if end is not None:
        return text[start : int(end)]
    return text[start:]


def string_length(inputs: Dict[str, Any]) -> int:
    """Get string length."""
    return len(str(inputs.get("text", "")))


def string_template(inputs: Dict[str, Any]) -> str:
    """Render a template with placeholders like `{{path.to.value}}`.

    Supported filters:
    - `| json`            -> json.dumps(value)
    - `| join(", ")`      -> join array values with delimiter
    - `| trim` / `| lower` / `| upper`
    """
    import re

    template = str(inputs.get("template", "") or "")
    vars_raw = inputs.get("vars")
    vars_obj = vars_raw if isinstance(vars_raw, dict) else {}

    pat = re.compile(r"\{\{\s*(.*?)\s*\}\}")

    def _apply_filters(value: Any, filters: list[str]) -> Any:
        cur = value
        for f in filters:
            f = f.strip()
            if not f:
                continue
            if f == "json":
                cur = json.dumps(cur, ensure_ascii=False, sort_keys=True)
                continue
            if f.startswith("join"):
                m = re.match(r"join\((.*)\)$", f)
                delim = ", "
                if m:
                    raw = m.group(1).strip()
                    if (raw.startswith('"') and raw.endswith('"')) or (raw.startswith("'") and raw.endswith("'")):
                        raw = raw[1:-1]
                    delim = raw
                if isinstance(cur, list):
                    cur = delim.join("" if x is None else str(x) for x in cur)
                else:
                    cur = "" if cur is None else str(cur)
                continue
            if f == "trim":
                cur = ("" if cur is None else str(cur)).strip()
                continue
            if f == "lower":
                cur = ("" if cur is None else str(cur)).lower()
                continue
            if f == "upper":
                cur = ("" if cur is None else str(cur)).upper()
                continue
            # Unknown filters are ignored (best-effort, stable).
        return cur

    def _render_expr(expr: str) -> str:
        parts = [p.strip() for p in str(expr or "").split("|")]
        path = parts[0] if parts else ""
        filters = parts[1:] if len(parts) > 1 else []
        value = _get_path(vars_obj, path)
        if value is None:
            return ""
        value = _apply_filters(value, filters)
        return "" if value is None else str(value)

    return pat.sub(lambda m: _render_expr(m.group(1)), template)


# Control flow helpers (these return decision values, not execution control)
def control_compare(inputs: Dict[str, Any]) -> bool:
    """Compare two values."""
    a = inputs.get("a")
    b = inputs.get("b")
    op = str(inputs.get("op", "=="))

    if op == "==":
        return a == b
    if op == "!=":
        return a != b
    if op == "<":
        try:
            return a < b
        except Exception:
            return False
    if op == "<=":
        try:
            return a <= b
        except Exception:
            return False
    if op == ">":
        try:
            return a > b
        except Exception:
            return False
    if op == ">=":
        try:
            return a >= b
        except Exception:
            return False
    raise ValueError(f"Unknown comparison operator: {op}")


def control_not(inputs: Dict[str, Any]) -> bool:
    """Logical NOT."""
    return not bool(inputs.get("value", False))


def control_and(inputs: Dict[str, Any]) -> bool:
    """Logical AND."""
    return bool(inputs.get("a", False)) and bool(inputs.get("b", False))


def control_or(inputs: Dict[str, Any]) -> bool:
    """Logical OR."""
    return bool(inputs.get("a", False)) or bool(inputs.get("b", False))


def control_coalesce(inputs: Dict[str, Any]) -> Any:
    """Return the first non-None input in pin order.

    Pin order is injected by the visual executor as `_pin_order` based on the node's
    input pin list, so selection is deterministic and matches the visual layout.
    """
    order = inputs.get("_pin_order")
    pin_order: list[str] = []
    if isinstance(order, list):
        for x in order:
            if isinstance(x, str) and x:
                pin_order.append(x)
    if not pin_order:
        pin_order = ["a", "b"]

    for pid in pin_order:
        if pid not in inputs:
            continue
        v = inputs.get(pid)
        if v is not None:
            return v
    return None


# Data operations
def data_get(inputs: Dict[str, Any]) -> Any:
    """Get property from object."""
    obj = inputs.get("object", {})
    key = str(inputs.get("key", ""))
    default = inputs.get("default")

    value = _get_path(obj, key)
    if value is None:
        return {"value": default}
    return {"value": value}


def data_set(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Set property on object (returns new object)."""
    obj = dict(inputs.get("object", {}))
    key = str(inputs.get("key", ""))
    value = inputs.get("value")

    # Support dot notation
    parts = key.split(".")
    current = obj
    for part in parts[:-1]:
        nxt = current.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            current[part] = nxt
        current = nxt
    current[parts[-1]] = value
    return obj


def data_merge(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Merge two objects."""
    a = dict(inputs.get("a", {}))
    b = dict(inputs.get("b", {}))
    return {**a, **b}


def data_array_map(inputs: Dict[str, Any]) -> List[Any]:
    """Map array items (extract property from each)."""
    items = inputs.get("items", [])
    key = str(inputs.get("key", ""))

    result: list[Any] = []
    for item in items:
        if isinstance(item, dict):
            result.append(item.get(key))
        else:
            result.append(item)
    return result


def data_array_filter(inputs: Dict[str, Any]) -> List[Any]:
    """Filter array by condition."""
    items = inputs.get("items", [])
    key = str(inputs.get("key", ""))
    value = inputs.get("value")

    result: list[Any] = []
    for item in items:
        if isinstance(item, dict):
            if item.get(key) == value:
                result.append(item)
        elif item == value:
            result.append(item)
    return result


def data_array_length(inputs: Dict[str, Any]) -> int:
    """Return array length (0 if not an array)."""
    items = inputs.get("array")
    if isinstance(items, list):
        return len(items)
    if isinstance(items, tuple):
        return len(list(items))
    return 0


def data_array_append(inputs: Dict[str, Any]) -> List[Any]:
    """Append an item to an array (returns a new array)."""
    items = inputs.get("array")
    item = inputs.get("item")
    out: list[Any]
    if isinstance(items, list):
        out = list(items)
    elif isinstance(items, tuple):
        out = list(items)
    elif items is None:
        out = []
    else:
        out = [items]
    out.append(item)
    return out


def data_array_dedup(inputs: Dict[str, Any]) -> List[Any]:
    """Stable-order dedup for arrays.

    If `key` is provided (string path), dedup objects by that path value.
    """
    items = inputs.get("array")
    if not isinstance(items, list):
        if isinstance(items, tuple):
            items = list(items)
        else:
            return []

    key = inputs.get("key")
    key_path = str(key or "").strip()

    def _fingerprint(v: Any) -> str:
        if v is None or isinstance(v, (bool, int, float, str)):
            return f"{type(v).__name__}:{v}"
        try:
            return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
        except Exception:
            return str(v)

    seen: set[str] = set()
    out: list[Any] = []
    for item in items:
        if key_path:
            k = _get_path(item, key_path)
            fp = _fingerprint(k) if k is not None else _fingerprint(item)
        else:
            fp = _fingerprint(item)
        if fp in seen:
            continue
        seen.add(fp)
        out.append(item)
    return out


def system_datetime(_: Dict[str, Any]) -> Dict[str, Any]:
    """Return current system date/time and best-effort locale metadata.

    All values are JSON-serializable and stable-keyed.
    """
    now = datetime.now().astimezone()
    offset = now.utcoffset()
    offset_minutes = int(offset.total_seconds() // 60) if offset is not None else 0

    tzname = now.tzname() or ""

    # Avoid deprecated locale.getdefaultlocale() in Python 3.12+.
    lang = os.environ.get("LC_ALL") or os.environ.get("LANG") or os.environ.get("LC_CTYPE") or ""
    env_locale = lang.split(".", 1)[0] if lang else ""

    loc = locale.getlocale()[0] or env_locale

    return {
        "iso": now.isoformat(),
        "timezone": tzname,
        "utc_offset_minutes": offset_minutes,
        "locale": loc or "",
    }


def data_parse_json(inputs: Dict[str, Any]) -> Any:
    """Parse JSON (or JSON-ish) text into a JSON-serializable Python value.

    Primary use-case: turn an LLM string response into an object/array that can be
    fed into `Break Object` (dynamic pins) or other data nodes.

    Behavior:
    - If the input is already a dict/list, returns it unchanged (idempotent).
    - Tries strict `json.loads` first.
    - If that fails, tries to extract the first JSON object/array substring and parse it.
    - As a last resort, tries `ast.literal_eval` to handle Python-style dicts/lists
      (common in LLM output), then converts to JSON-friendly types.
    - If the parsed value is a scalar, wraps it as `{ "value": <scalar> }` by default,
      so `Break Object` can still expose it.
    """

    def _strip_code_fence(text: str) -> str:
        s = text.strip()
        if not s.startswith("```"):
            return s
        # Opening fence line can be ```json / ```js etc; drop it.
        nl = s.find("\n")
        if nl == -1:
            return s.strip("`").strip()
        body = s[nl + 1 :]
        end = body.rfind("```")
        if end != -1:
            body = body[:end]
        return body.strip()

    def _jsonify(value: Any) -> Any:
        if value is None or isinstance(value, (bool, int, float, str)):
            return value
        if isinstance(value, dict):
            return {str(k): _jsonify(v) for k, v in value.items()}
        if isinstance(value, list):
            return [_jsonify(v) for v in value]
        if isinstance(value, tuple):
            return [_jsonify(v) for v in value]
        return str(value)

    raw = inputs.get("text")
    if isinstance(raw, (dict, list)):
        parsed: Any = raw
    else:
        if raw is None:
            raise ValueError("parse_json requires a non-empty 'text' input.")
        text = _strip_code_fence(str(raw))
        if not text.strip():
            raise ValueError("parse_json requires a non-empty 'text' input.")

        parsed = None
        text_stripped = text.strip()

        try:
            parsed = json.loads(text_stripped)
        except Exception:
            # Best-effort: find and parse the first JSON object/array substring.
            decoder = json.JSONDecoder()
            starts: list[int] = []
            for i, ch in enumerate(text_stripped):
                if ch in "{[":
                    starts.append(i)
                if len(starts) >= 64:
                    break
            for i in starts:
                try:
                    parsed, _end = decoder.raw_decode(text_stripped[i:])
                    break
                except Exception:
                    continue

        if parsed is None:
            # Last resort: tolerate Python-literal dict/list output.
            try:
                parsed = ast.literal_eval(text_stripped)
            except Exception as e:
                raise ValueError(f"Invalid JSON: {e}") from e

    parsed = _jsonify(parsed)

    wrap_scalar = bool(inputs.get("wrap_scalar", True))
    if wrap_scalar and not isinstance(parsed, (dict, list)):
        return {"value": parsed}
    return parsed


def data_stringify_json(inputs: Dict[str, Any]) -> str:
    """Render a JSON-like value into a string (runtime-owned implementation).

    The core stringify logic lives in AbstractRuntime so multiple hosts can reuse it.

    Supported inputs (backward compatible):
    - `value`: JSON value (dict/list/scalar) OR a JSON-ish string.
    - `mode`: none | beautify | minified
    - Legacy: `indent` (<=0 => minified; >0 => beautify with that indent)
    - Legacy: `sort_keys` (bool)
    """

    value = inputs.get("value")

    raw_mode = inputs.get("mode")
    mode = str(raw_mode).strip().lower() if isinstance(raw_mode, str) else ""

    raw_indent = inputs.get("indent")
    indent_n: Optional[int] = None
    if raw_indent is not None:
        try:
            indent_n = int(raw_indent)
        except Exception:
            indent_n = None

    raw_sort_keys = inputs.get("sort_keys")
    sort_keys = bool(raw_sort_keys) if isinstance(raw_sort_keys, bool) else False

    # If mode not provided, infer from legacy indent.
    if not mode:
        if indent_n is not None and indent_n <= 0:
            mode = "minified"
        elif indent_n is not None and indent_n > 0:
            mode = "beautify"
        else:
            mode = "beautify"

    return runtime_stringify_json(
        value,
        mode=mode,
        beautify_indent=indent_n if isinstance(indent_n, int) and indent_n > 0 else 2,
        sort_keys=sort_keys,
        parse_strings=True,
    )


def data_agent_trace_report(inputs: Dict[str, Any]) -> str:
    """Render an agent scratchpad (runtime-owned node traces) into Markdown."""
    scratchpad = inputs.get("scratchpad")
    return runtime_render_agent_trace_markdown(scratchpad)


# Literal value handlers - return configured constant values
def literal_string(inputs: Dict[str, Any]) -> str:
    """Return string literal value."""
    return str(inputs.get("_literalValue", ""))


def literal_number(inputs: Dict[str, Any]) -> float:
    """Return number literal value."""
    value = inputs.get("_literalValue", 0)
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def literal_boolean(inputs: Dict[str, Any]) -> bool:
    """Return boolean literal value."""
    return bool(inputs.get("_literalValue", False))


def literal_json(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Return JSON literal value."""
    value = inputs.get("_literalValue", {})
    if isinstance(value, (dict, list)):
        return value  # type: ignore[return-value]
    return {}


def literal_array(inputs: Dict[str, Any]) -> List[Any]:
    """Return array literal value."""
    value = inputs.get("_literalValue", [])
    if isinstance(value, list):
        return value
    return []


def tools_allowlist(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Return a workflow-scope tool allowlist as a named output.

    The visual editor stores the selected tools as a JSON array of strings in the
    node's `literalValue`. The executor injects it as `_literalValue`.
    """
    value = inputs.get("_literalValue", [])
    if not isinstance(value, list):
        return {"tools": []}
    out: list[str] = []
    for x in value:
        if isinstance(x, str) and x.strip():
            out.append(x.strip())
    # Preserve order; remove duplicates.
    seen: set[str] = set()
    uniq: list[str] = []
    for t in out:
        if t in seen:
            continue
        seen.add(t)
        uniq.append(t)
    return {"tools": uniq}


# Handler registry
BUILTIN_HANDLERS: Dict[str, Callable[[Dict[str, Any]], Any]] = {
    # Math
    "add": math_add,
    "subtract": math_subtract,
    "multiply": math_multiply,
    "divide": math_divide,
    "modulo": math_modulo,
    "power": math_power,
    "abs": math_abs,
    "round": math_round,
    # String
    "concat": string_concat,
    "split": string_split,
    "join": string_join,
    "format": string_format,
    "string_template": string_template,
    "uppercase": string_uppercase,
    "lowercase": string_lowercase,
    "trim": string_trim,
    "substring": string_substring,
    "length": string_length,
    # Control
    "compare": control_compare,
    "not": control_not,
    "and": control_and,
    "or": control_or,
    "coalesce": control_coalesce,
    # Data
    "get": data_get,
    "set": data_set,
    "merge": data_merge,
    "array_map": data_array_map,
    "array_filter": data_array_filter,
    "array_length": data_array_length,
    "array_append": data_array_append,
    "array_dedup": data_array_dedup,
    "parse_json": data_parse_json,
    "stringify_json": data_stringify_json,
    "agent_trace_report": data_agent_trace_report,
    "system_datetime": system_datetime,
    # Literals
    "literal_string": literal_string,
    "literal_number": literal_number,
    "literal_boolean": literal_boolean,
    "literal_json": literal_json,
    "literal_array": literal_array,
    "tools_allowlist": tools_allowlist,
}

