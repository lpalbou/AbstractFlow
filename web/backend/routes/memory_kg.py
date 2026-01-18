"""Memory KG routes (debug/observability).

These endpoints are for UI exploration/debugging (e.g. graph viewers) and are
implemented as thin wrappers around the same `memory_kg_*` effect handlers used
by VisualFlow execution.
"""

from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.runtime_stores import get_runtime_stores


router = APIRouter(prefix="/memory/kg", tags=["memory_kg"])


class KgQueryRequest(BaseModel):
    run_id: Optional[str] = Field(default=None, description="Run id used to resolve scope owner ids (run/session/all).")
    scope: str = Field(default="session", description="run | session | global | all")
    owner_id: Optional[str] = Field(default=None, description="Explicit owner_id override (advanced).")

    query_text: Optional[str] = Field(default="", description="Semantic query (requires embeddings).")
    subject: Optional[str] = Field(default="", description="Exact-match subject filter (trim+lower).")
    predicate: Optional[str] = Field(default="", description="Exact-match predicate filter (trim+lower).")
    object: Optional[str] = Field(default="", description="Exact-match object filter (trim+lower).")

    since: Optional[str] = Field(default=None, description="Lower bound for observed_at (ISO string).")
    until: Optional[str] = Field(default=None, description="Upper bound for observed_at (ISO string).")
    active_at: Optional[str] = Field(default=None, description="Temporal validity point (valid_from/valid_until).")
    order: Optional[str] = Field(default=None, description="asc | desc (non-semantic queries only).")

    min_score: Optional[float] = Field(default=None, description="Cosine similarity threshold for semantic query_text.")
    limit: int = Field(default=80, ge=1, le=10_000, description="Max results.")

    max_input_tokens: Optional[int] = Field(
        default=None,
        ge=1,
        le=200_000,
        description="If set, also returns packets + active_memory_text (token-budgeted).",
    )
    model: Optional[str] = Field(default=None, description="Optional model id used for token estimation (budgeting).")


def _ensure_abstractmemory_src_layout() -> None:
    # Dev convenience (monorepo): ensure `abstractmemory/src` wins import resolution.
    repo_root = Path(__file__).resolve().parents[4]  # .../abstractframework
    mem_src = repo_root / "abstractmemory" / "src"
    if not mem_src.is_dir():
        return
    mem_src_str = str(mem_src)
    try:
        sys.path.remove(mem_src_str)
    except ValueError:
        pass
    sys.path.insert(0, mem_src_str)


def _resolve_memory_dir(*, artifact_store: Any) -> Path:
    raw = os.getenv("ABSTRACTMEMORY_DIR") or os.getenv("ABSTRACTFLOW_MEMORY_DIR")
    if isinstance(raw, str) and raw.strip():
        return Path(raw).expanduser().resolve()

    base_attr = getattr(artifact_store, "_base", None)
    if base_attr is not None:
        try:
            return Path(base_attr).expanduser().resolve() / "abstractmemory"
        except Exception:
            pass

    raise RuntimeError(
        "No durable memory directory could be resolved. "
        "Set `ABSTRACTFLOW_MEMORY_DIR` (or `ABSTRACTMEMORY_DIR`), or run the backend with a file-backed ArtifactStore."
    )


def _get_kg_store(*, artifact_store: Any) -> Any:
    from abstractflow.visual.executor import _MEMORY_KG_STORE_CACHE, _MEMORY_KG_STORE_CACHE_LOCK, _resolve_gateway_auth_token

    _ensure_abstractmemory_src_layout()
    from abstractmemory import LanceDBTripleStore
    from abstractmemory.embeddings import AbstractGatewayTextEmbedder

    base_dir = _resolve_memory_dir(artifact_store=artifact_store)
    base_dir.mkdir(parents=True, exist_ok=True)

    gateway_url = str(os.getenv("ABSTRACTFLOW_GATEWAY_URL") or os.getenv("ABSTRACTGATEWAY_URL") or "").strip()
    if not gateway_url:
        gateway_url = "http://127.0.0.1:8081"

    auth_token = _resolve_gateway_auth_token()

    embed_provider = (
        os.getenv("ABSTRACTFLOW_EMBEDDING_PROVIDER")
        or os.getenv("ABSTRACTMEMORY_EMBEDDING_PROVIDER")
        or os.getenv("ABSTRACTGATEWAY_EMBEDDING_PROVIDER")
    )
    embedder = None
    if str(embed_provider or "").strip().lower() not in {"__disabled__", "disabled", "none", "off"}:
        embedder = AbstractGatewayTextEmbedder(base_url=gateway_url, auth_token=auth_token)

    token_fingerprint = "embeddings_disabled"
    if embedder is not None:
        if auth_token:
            token_fingerprint = hashlib.sha256(auth_token.encode("utf-8")).hexdigest()[:12]
        else:
            token_fingerprint = "missing_token"

    cache_key = (str(base_dir), gateway_url if embedder is not None else "__embeddings_disabled__", token_fingerprint)
    with _MEMORY_KG_STORE_CACHE_LOCK:
        store_obj = _MEMORY_KG_STORE_CACHE.get(cache_key)
        if store_obj is None:
            store_obj = LanceDBTripleStore(base_dir / "kg", embedder=embedder)
            _MEMORY_KG_STORE_CACHE[cache_key] = store_obj
        return store_obj


@router.post("/query")
async def kg_query(request: KgQueryRequest) -> Dict[str, Any]:
    """Run a `memory_kg_query` against the same store used by VisualFlow execution."""
    run_store, _, artifact_store = get_runtime_stores()

    store = None
    try:
        store = _get_kg_store(artifact_store=artifact_store)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    run_id = str(request.run_id or "").strip()
    if not run_id:
        raise HTTPException(status_code=400, detail="run_id is required (used to resolve scope owner ids).")

    run = run_store.load(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"run_id not found: {run_id}")

    try:
        from abstractruntime.core.models import Effect, EffectType
        from abstractruntime.integrations.abstractmemory.effect_handlers import build_memory_kg_effect_handlers
        from abstractruntime.storage.artifacts import utc_now_iso
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"AbstractRuntime memory KG integration unavailable: {e}") from e

    handlers = build_memory_kg_effect_handlers(store=store, run_store=run_store, now_iso=utc_now_iso)
    handler = handlers[EffectType.MEMORY_KG_QUERY]

    payload = request.model_dump(exclude_none=True)
    # Keep default behavior: when owner_id is omitted/blank, runtime resolves from scope+run state.
    if not isinstance(payload.get("owner_id"), str) or not str(payload.get("owner_id") or "").strip():
        payload.pop("owner_id", None)

    outcome = handler(run, Effect(type=EffectType.MEMORY_KG_QUERY, payload=payload), None)
    if getattr(outcome, "status", None) == "failed":
        msg = str(getattr(outcome, "error", None) or "MEMORY_KG_QUERY failed")
        raise HTTPException(status_code=400, detail=msg)

    result = getattr(outcome, "result", None)
    return result if isinstance(result, dict) else {"ok": True, "result": result}

