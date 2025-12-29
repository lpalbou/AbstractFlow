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


def get_builtin_handler(node_type: str) -> Optional[Callable[[Any], Any]]:
    """Get a built-in handler function for a node type."""
    return BUILTIN_HANDLERS.get(node_type)


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
    items = inputs.get("items", [])
    delimiter = str(inputs.get("delimiter", ","))
    return delimiter.join(str(item) for item in items)


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
        return a < b
    if op == "<=":
        return a <= b
    if op == ">":
        return a > b
    if op == ">=":
        return a >= b
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


# Data operations
def data_get(inputs: Dict[str, Any]) -> Any:
    """Get property from object."""
    obj = inputs.get("object", {})
    key = str(inputs.get("key", ""))

    # Support dot notation
    parts = key.split(".")
    current: Any = obj
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list) and part.isdigit():
            current = current[int(part)]
        else:
            return None
    return current


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
    # Data
    "get": data_get,
    "set": data_set,
    "merge": data_merge,
    "array_map": data_array_map,
    "array_filter": data_array_filter,
    "parse_json": data_parse_json,
    "system_datetime": system_datetime,
    # Literals
    "literal_string": literal_string,
    "literal_number": literal_number,
    "literal_boolean": literal_boolean,
    "literal_json": literal_json,
    "literal_array": literal_array,
}

