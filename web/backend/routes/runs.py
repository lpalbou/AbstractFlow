"""Run history endpoints for the visual editor.

These endpoints provide:
- run listing per workflow (for UX "run history" browsing)
- run replay (reconstruct a UI-friendly event stream from persisted ledger records)

Design notes:
- Source of truth is the durable RunStore/LedgerStore.
- We intentionally return *summaries* (never full vars) to keep payloads small and safe.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

from ..services.runtime_stores import get_runtime_stores

router = APIRouter(prefix="/runs", tags=["runs"])


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _status_str(status: Any) -> str:
    v = getattr(status, "value", None)
    if isinstance(v, str):
        return v
    return str(status)


def _wait_reason_str(waiting: Any) -> Optional[str]:
    if waiting is None:
        return None
    reason = getattr(waiting, "reason", None)
    if reason is None:
        return None
    v = getattr(reason, "value", None)
    if isinstance(v, str):
        return v
    return str(reason)


def _is_pause_wait(waiting: Any, *, run_id: str) -> bool:
    if waiting is None:
        return False
    wait_key = getattr(waiting, "wait_key", None)
    if isinstance(wait_key, str) and wait_key == f"pause:{run_id}":
        return True
    details = getattr(waiting, "details", None)
    if isinstance(details, dict) and details.get("kind") == "pause":
        return True
    return False


def _run_summary(run: Any) -> Dict[str, Any]:
    waiting = getattr(run, "waiting", None)
    run_id = getattr(run, "run_id", None)
    run_id_str = str(run_id) if isinstance(run_id, str) else ""

    status_raw = getattr(run, "status", None)
    status = _status_str(status_raw) if status_raw is not None else "unknown"
    wait_reason = _wait_reason_str(waiting)
    paused = bool(_is_pause_wait(waiting, run_id=run_id_str)) if run_id_str else False

    out: Dict[str, Any] = {
        "run_id": run_id_str,
        "workflow_id": getattr(run, "workflow_id", None),
        "status": status,
        "current_node": getattr(run, "current_node", None),
        "created_at": getattr(run, "created_at", None),
        "updated_at": getattr(run, "updated_at", None),
        "parent_run_id": getattr(run, "parent_run_id", None),
        "error": getattr(run, "error", None),
        "wait_reason": wait_reason,
        "wait_key": getattr(waiting, "wait_key", None) if waiting is not None else None,
        "paused": paused,
    }

    # Optional (only meaningful for user waits, not pause waits).
    if waiting is not None and not paused:
        out["prompt"] = getattr(waiting, "prompt", None)
        out["choices"] = getattr(waiting, "choices", None)
        out["allow_free_text"] = getattr(waiting, "allow_free_text", None)

    return out


def _duration_ms(start_iso: Any, end_iso: Any) -> Optional[float]:
    try:
        s = datetime.fromisoformat(str(start_iso))
        e = datetime.fromisoformat(str(end_iso))
        return max(0.0, (e - s).total_seconds() * 1000.0)
    except Exception:
        return None


@router.get("")
async def list_runs(
    workflow_id: str = Query(..., description="Workflow id to filter runs (e.g. 'multi_agent_state_machine')."),
    limit: int = Query(50, ge=1, le=500),
) -> List[Dict[str, Any]]:
    run_store, _, _ = get_runtime_stores()
    list_fn = getattr(run_store, "list_runs", None)
    if not callable(list_fn):
        raise HTTPException(status_code=500, detail="RunStore does not support list_runs()")
    try:
        runs = list_fn(workflow_id=workflow_id, limit=int(limit))
        return [_run_summary(r) for r in (runs or [])]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list runs: {e}")


@router.get("/{run_id}")
async def get_run(run_id: str) -> Dict[str, Any]:
    run_store, _, _ = get_runtime_stores()
    try:
        run = run_store.load(run_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load run: {e}")
    if run is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")
    return _run_summary(run)


@router.get("/{run_id}/artifacts/{artifact_id}")
async def get_run_artifact(run_id: str, artifact_id: str) -> Dict[str, Any]:
    """Fetch a stored artifact payload by id.

    Note:
    - Artifacts are validated by ArtifactStore (prevents path traversal).
    - `run_id` is currently used for URL scoping/UX; authorization can be layered later.
    """
    _, _, artifact_store = get_runtime_stores()
    try:
        payload = artifact_store.load_json(artifact_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid artifact_id '{artifact_id}': {e}")
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Artifact '{artifact_id}' not found")

    meta: Optional[Dict[str, Any]] = None
    try:
        md = artifact_store.get_metadata(artifact_id)
        meta = md.to_dict() if md is not None else None
    except Exception:
        meta = None

    return {"artifact_id": artifact_id, "metadata": meta, "payload": payload}


@router.get("/{run_id}/history")
async def get_run_history(run_id: str) -> Dict[str, Any]:
    """Return a UI-friendly replay payload for a persisted run."""
    run_store, ledger_store, _ = get_runtime_stores()
    try:
        run = run_store.load(run_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load run: {e}")
    if run is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    # Ledger records for the root run.
    try:
        records = ledger_store.list(run_id) if hasattr(ledger_store, "list") else []
    except Exception:
        records = []

    events: List[Dict[str, Any]] = []
    created_at = getattr(run, "created_at", None) or getattr(run, "updated_at", None) or _utc_now_iso()
    events.append({"type": "flow_start", "ts": created_at, "runId": run_id})

    # Map step records to UI events (best-effort).
    for rec in records:
        if not isinstance(rec, dict):
            continue
        node_id = rec.get("node_id")
        status = str(rec.get("status") or "")
        if not isinstance(node_id, str) or not node_id:
            continue

        if status == "started":
            events.append({"type": "node_start", "ts": rec.get("started_at") or created_at, "runId": run_id, "nodeId": node_id})
            continue

        if status == "completed":
            meta: Dict[str, Any] = {}
            dur = _duration_ms(rec.get("started_at"), rec.get("ended_at"))
            if dur is not None:
                meta["duration_ms"] = round(float(dur), 2)
            events.append(
                {
                    "type": "node_complete",
                    "ts": rec.get("ended_at") or rec.get("started_at") or created_at,
                    "runId": run_id,
                    "nodeId": node_id,
                    "result": rec.get("result"),
                    "meta": meta or None,
                }
            )
            continue

        if status == "failed":
            events.append(
                {
                    "type": "flow_error",
                    "ts": rec.get("ended_at") or rec.get("started_at") or created_at,
                    "runId": run_id,
                    "nodeId": node_id,
                    "error": rec.get("error") or "Step failed",
                }
            )
            continue

        # status == "waiting" is typically used for async+wait (SUBWORKFLOW). The UI
        # already renders a node as “in progress” when it has a node_start without a
        # node_complete, so we don't need a separate event here.

    # Terminal / waiting markers (best-effort) so the modal can render controls.
    summary = _run_summary(run)
    status = str(summary.get("status") or "")
    updated_at = summary.get("updated_at") or _utc_now_iso()

    if status == "completed":
        events.append({"type": "flow_complete", "ts": updated_at, "runId": run_id, "result": getattr(run, "output", None)})
    elif status == "cancelled":
        events.append({"type": "flow_cancelled", "ts": updated_at, "runId": run_id})
    elif status == "failed":
        events.append({"type": "flow_error", "ts": updated_at, "runId": run_id, "error": summary.get("error") or "Run failed"})
    elif status == "waiting":
        # Only surface a waiting prompt when it is real user input (not SUBWORKFLOW) and not pause.
        if summary.get("paused"):
            events.append({"type": "flow_paused", "ts": updated_at, "runId": run_id})
        elif summary.get("wait_reason") and summary.get("wait_reason") != "subworkflow":
            events.append(
                {
                    "type": "flow_waiting",
                    "ts": updated_at,
                    "runId": run_id,
                    "nodeId": summary.get("current_node"),
                    "wait_key": summary.get("wait_key"),
                    "reason": summary.get("wait_reason"),
                    "prompt": summary.get("prompt") or "Please respond:",
                    "choices": summary.get("choices") or [],
                    "allow_free_text": summary.get("allow_free_text") is not False,
                }
            )

    return {"run": summary, "events": events}


