"""Built-in function handlers for visual nodes."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional
import math
import re


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
    """Split string by delimiter."""
    text = str(inputs.get("text", ""))
    delimiter = str(inputs.get("delimiter", ","))
    return text.split(delimiter)


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
        return text[start:int(end)]
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
    elif op == "!=":
        return a != b
    elif op == "<":
        return a < b
    elif op == "<=":
        return a <= b
    elif op == ">":
        return a > b
    elif op == ">=":
        return a >= b
    else:
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
    current = obj
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
    for i, part in enumerate(parts[:-1]):
        if part not in current:
            current[part] = {}
        current = current[part]
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

    result = []
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

    result = []
    for item in items:
        if isinstance(item, dict):
            if item.get(key) == value:
                result.append(item)
        elif item == value:
            result.append(item)
    return result


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
        return value
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
    # Literals
    "literal_string": literal_string,
    "literal_number": literal_number,
    "literal_boolean": literal_boolean,
    "literal_json": literal_json,
    "literal_array": literal_array,
}
