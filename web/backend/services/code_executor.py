"""Sandboxed Python code execution for custom code nodes."""

from __future__ import annotations

import ast
from typing import Any, Callable, Dict

# Try to import RestrictedPython, fall back to basic execution if not available
try:
    from RestrictedPython import compile_restricted, safe_builtins
    from RestrictedPython.Guards import safe_globals, guarded_iter_unpack_sequence
    from RestrictedPython.Eval import default_guarded_getiter, default_guarded_getitem

    RESTRICTED_PYTHON_AVAILABLE = True
except ImportError:
    RESTRICTED_PYTHON_AVAILABLE = False


class CodeExecutionError(Exception):
    """Error during code execution."""

    pass


def validate_code(code: str) -> None:
    """Validate Python code for safety.

    Raises:
        CodeExecutionError: If code contains disallowed constructs
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise CodeExecutionError(f"Syntax error: {e}")

    # Check for disallowed constructs
    for node in ast.walk(tree):
        # Disallow imports
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise CodeExecutionError("Imports are not allowed")

        # Disallow exec/eval
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                if node.func.id in ("exec", "eval", "compile", "__import__"):
                    raise CodeExecutionError(f"'{node.func.id}' is not allowed")

        # Disallow dunder attributes
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("__") and node.attr.endswith("__"):
                raise CodeExecutionError(
                    f"Access to dunder attributes ('{node.attr}') is not allowed"
                )


def create_code_handler(code: str, function_name: str = "transform") -> Callable:
    """Create a handler function from user-provided Python code.

    The code should define a function that takes input data and returns a result.

    Args:
        code: Python code containing a function definition
        function_name: Name of the function to call (default: "transform")

    Returns:
        A callable that executes the user code

    Example code:
        ```python
        def transform(input):
            return input * 2
        ```
    """
    # Validate the code first
    validate_code(code)

    if RESTRICTED_PYTHON_AVAILABLE:
        return _create_restricted_handler(code, function_name)
    else:
        return _create_basic_handler(code, function_name)


def _create_restricted_handler(code: str, function_name: str) -> Callable:
    """Create handler using RestrictedPython for sandboxed execution."""
    # Compile with RestrictedPython
    byte_code = compile_restricted(code, filename="<user_code>", mode="exec")

    if byte_code.errors:
        raise CodeExecutionError(
            f"Compilation errors: {'; '.join(byte_code.errors)}"
        )

    def handler(input_data: Any) -> Any:
        # Create safe globals
        restricted_globals = {
            "__builtins__": safe_builtins,
            "_getiter_": default_guarded_getiter,
            "_getitem_": default_guarded_getitem,
            "_iter_unpack_sequence_": guarded_iter_unpack_sequence,
            # Allow some safe built-ins
            "len": len,
            "str": str,
            "int": int,
            "float": float,
            "bool": bool,
            "list": list,
            "dict": dict,
            "tuple": tuple,
            "set": set,
            "range": range,
            "enumerate": enumerate,
            "zip": zip,
            "map": map,
            "filter": filter,
            "sorted": sorted,
            "reversed": reversed,
            "min": min,
            "max": max,
            "sum": sum,
            "abs": abs,
            "round": round,
            "isinstance": isinstance,
            "type": type,
            "print": lambda *args, **kwargs: None,  # Silent print
        }

        local_vars: Dict[str, Any] = {}

        try:
            exec(byte_code, restricted_globals, local_vars)
        except Exception as e:
            raise CodeExecutionError(f"Execution error: {e}")

        if function_name not in local_vars:
            raise CodeExecutionError(
                f"Function '{function_name}' not defined in code"
            )

        func = local_vars[function_name]
        if not callable(func):
            raise CodeExecutionError(
                f"'{function_name}' is not a callable function"
            )

        try:
            return func(input_data)
        except Exception as e:
            raise CodeExecutionError(f"Runtime error: {e}")

    return handler


def _create_basic_handler(code: str, function_name: str) -> Callable:
    """Create handler with basic (less secure) execution.

    Used as fallback when RestrictedPython is not available.
    """
    # Compile the code
    try:
        byte_code = compile(code, filename="<user_code>", mode="exec")
    except SyntaxError as e:
        raise CodeExecutionError(f"Syntax error: {e}")

    def handler(input_data: Any) -> Any:
        # Create limited globals
        limited_globals = {
            "__builtins__": {
                "len": len,
                "str": str,
                "int": int,
                "float": float,
                "bool": bool,
                "list": list,
                "dict": dict,
                "tuple": tuple,
                "set": set,
                "range": range,
                "enumerate": enumerate,
                "zip": zip,
                "map": map,
                "filter": filter,
                "sorted": sorted,
                "reversed": reversed,
                "min": min,
                "max": max,
                "sum": sum,
                "abs": abs,
                "round": round,
                "isinstance": isinstance,
                "type": type,
                "print": lambda *args, **kwargs: None,
                "True": True,
                "False": False,
                "None": None,
            }
        }

        local_vars: Dict[str, Any] = {}

        try:
            exec(byte_code, limited_globals, local_vars)
        except Exception as e:
            raise CodeExecutionError(f"Execution error: {e}")

        if function_name not in local_vars:
            raise CodeExecutionError(
                f"Function '{function_name}' not defined in code"
            )

        func = local_vars[function_name]
        if not callable(func):
            raise CodeExecutionError(
                f"'{function_name}' is not a callable function"
            )

        try:
            return func(input_data)
        except Exception as e:
            raise CodeExecutionError(f"Runtime error: {e}")

    return handler
