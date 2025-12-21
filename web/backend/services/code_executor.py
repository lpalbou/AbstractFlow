"""Web backend code execution helpers.

Re-export the portable implementation from `abstractflow.visual.code_executor`.
"""

from __future__ import annotations

from abstractflow.visual.code_executor import (  # noqa: F401
    CodeExecutionError,
    RESTRICTED_PYTHON_AVAILABLE,
    create_code_handler,
    validate_code,
)

__all__ = [
    "CodeExecutionError",
    "RESTRICTED_PYTHON_AVAILABLE",
    "create_code_handler",
    "validate_code",
]

