"""Semantics registry routes (for authoring UX)."""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict

from fastapi import APIRouter, HTTPException


router = APIRouter(prefix="/semantics", tags=["semantics"])


@lru_cache(maxsize=1)
def _load_registry() -> Any:
    try:
        from abstractsemantics import load_semantics_registry  # type: ignore

        return load_semantics_registry()
    except Exception as e:
        raise RuntimeError(f"Failed to load semantics registry: {e}") from e


@router.get("")
async def get_semantics_registry() -> Dict[str, Any]:
    """Return the active semantics registry (predicates/types)."""
    try:
        reg = _load_registry()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    def _as_list(value: Any) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        if not isinstance(value, list):
            return out
        for item in value:
            if hasattr(item, "__dict__"):
                d = dict(getattr(item, "__dict__", {}) or {})
                if d:
                    out.append(d)
                    continue
            if isinstance(item, dict):
                out.append(dict(item))
        return out

    prefixes = dict(getattr(reg, "prefixes", {}) or {})
    return {
        "ok": True,
        "version": int(getattr(reg, "version", 0) or 0),
        "prefixes": prefixes,
        "predicates": _as_list(getattr(reg, "predicates", [])),
        "entity_types": _as_list(getattr(reg, "entity_types", [])),
    }

