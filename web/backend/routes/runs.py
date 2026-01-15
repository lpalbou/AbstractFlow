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
import os
from pathlib import Path
import subprocess
import sys
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

from ..services.execution_workspace import resolve_base_execution_dir
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


def _best_effort_node_output_from_run(run: Any, node_id: str) -> Any:
    """Best-effort durable node output lookup from persisted run vars.

    Why:
    - Some effectful nodes (notably async+wait START_SUBWORKFLOW used by Agent nodes)
      transition through `status="waiting"` and then resume to the next node without
      emitting a ledger "completed" record for the waiting node.
    - For run history UX, we still want a node_complete payload so steps don't appear
      to run forever, and users can inspect the effective output/result.
    """
    if run is None:
        return None
    vars0 = getattr(run, "vars", None)
    if not isinstance(vars0, dict):
        return None
    temp = vars0.get("_temp")
    if not isinstance(temp, dict):
        return None
    effects = temp.get("effects")
    if isinstance(effects, dict) and node_id in effects:
        return effects.get(node_id)
    node_outputs = temp.get("node_outputs")
    if isinstance(node_outputs, dict) and node_id in node_outputs:
        return node_outputs.get(node_id)
    return None


def _sum_llm_usage_from_ledger_tree(*, run_store: Any, ledger_store: Any, run_id: str) -> tuple[int, int]:
    """Return cumulative (input_tokens, output_tokens) for the run tree rooted at run_id.

    Source of truth is the durable ledger:
    - each completed `llm_call` effect is appended as a record with `result.usage`

    This is the only robust way to count:
    - loops (same node id executed many times)
    - subflows / agent subruns (different workflow graphs)
    """
    seen_runs: set[str] = set()
    seen_steps: set[str] = set()
    queue: list[str] = [run_id]
    total_in = 0
    total_out = 0

    def _as_int(v: Any) -> int:
        try:
            n = int(v)
            return n if n >= 0 else 0
        except Exception:
            return 0

    def _extract_usage_tokens(usage_raw: Any) -> tuple[int, int]:
        if not isinstance(usage_raw, dict):
            return (0, 0)
        i = usage_raw.get("prompt_tokens")
        if i is None:
            i = usage_raw.get("input_tokens")
        o = usage_raw.get("completion_tokens")
        if o is None:
            o = usage_raw.get("output_tokens")
        return (_as_int(i), _as_int(o))

    while queue:
        rid = queue.pop(0)
        if rid in seen_runs:
            continue
        seen_runs.add(rid)

        # Sum LLM_CALL usage for this run.
        try:
            records = ledger_store.list(rid) if hasattr(ledger_store, "list") else []
        except Exception:
            records = []
        for rec in records or []:
            if not isinstance(rec, dict):
                continue
            if rec.get("status") != "completed":
                continue
            eff = rec.get("effect")
            if not isinstance(eff, dict) or eff.get("type") != "llm_call":
                continue
            step_id = rec.get("step_id")
            if isinstance(step_id, str) and step_id:
                if step_id in seen_steps:
                    continue
                seen_steps.add(step_id)
            result = rec.get("result")
            usage = None
            if isinstance(result, dict):
                usage = result.get("usage")
                if usage is None:
                    raw = result.get("raw")
                    if isinstance(raw, dict):
                        usage = raw.get("usage")
            i, o = _extract_usage_tokens(usage)
            total_in += i
            total_out += o

        # Enqueue children if supported.
        list_children = getattr(run_store, "list_children", None)
        if callable(list_children):
            try:
                children = list_children(parent_run_id=rid) or []
            except Exception:
                children = []
            for c in children:
                cid = getattr(c, "run_id", None)
                if isinstance(cid, str) and cid and cid not in seen_runs:
                    queue.append(cid)

    return (total_in, total_out)


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


@router.get("/execution-workspace")
async def get_execution_workspace() -> Dict[str, Any]:
    """Return server-side execution workspace defaults for the UI.

    Notes:
    - This is used to prefill the Run Flow form with the per-run workspace folder path.
    - `workspace_root` defaults to a random directory under `<base>/.abstractflow/runs/<uuid>`.
    """
    base = resolve_base_execution_dir()
    random_root = base / ".abstractflow" / "runs"
    return {
        "base_execution_dir": str(base),
        "default_random_root": str(random_root),
        "alias_pattern": "<base>/<run_id>",
    }


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


def _resolve_no_strict(path: Path) -> Path:
    try:
        return path.expanduser().resolve(strict=False)
    except TypeError:  # pragma: no cover (older python)
        return path.expanduser().resolve()


def _is_under_dir(path: Path, base: Path) -> bool:
    try:
        return _resolve_no_strict(path).is_relative_to(_resolve_no_strict(base))
    except Exception:
        # Fallback for older runtimes (best-effort).
        p = str(_resolve_no_strict(path))
        b = str(_resolve_no_strict(base))
        return p.startswith(b.rstrip("/") + "/") or p == b


def _open_directory(path: Path) -> None:
    # Best-effort OS open. This endpoint is intended for local desktop UX.
    if os.name == "nt":
        os.startfile(str(path))  # type: ignore[attr-defined]  # Windows-only
        return

    cmd: list[str]
    if sys.platform.startswith("darwin"):
        cmd = ["open", str(path)]
    else:
        cmd = ["xdg-open", str(path)]

    subprocess.Popen(  # noqa: S603 (local UX helper; path validated below)
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


@router.post("/{run_id}/open-workspace")
async def open_workspace(run_id: str) -> Dict[str, Any]:
    """Open this run's workspace folder in the OS file explorer.

    Security:
    - Only allows opening folders under `ABSTRACTFLOW_BASE_EXECUTION` (or its default).
    - Prefers the stable alias `<base>/<run_id>` when present, otherwise falls back to `run.vars.workspace_root`.
    """
    rid = str(run_id or "").strip()
    if not rid:
        raise HTTPException(status_code=400, detail="run_id is required")

    run_store, _, _ = get_runtime_stores()
    try:
        run = run_store.load(rid)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load run: {e}")
    if run is None:
        raise HTTPException(status_code=404, detail=f"Run '{rid}' not found")

    base = resolve_base_execution_dir()

    alias = _resolve_no_strict(base / rid)
    candidate: Optional[Path] = None
    try:
        if alias.exists() or alias.is_symlink():
            candidate = alias
    except Exception:
        candidate = None

    if candidate is None:
        vars0 = getattr(run, "vars", None)
        raw = vars0.get("workspace_root") if isinstance(vars0, dict) else None
        if isinstance(raw, str) and raw.strip():
            candidate = _resolve_no_strict(Path(raw.strip()))

    if candidate is None:
        raise HTTPException(status_code=404, detail=f"No workspace_root recorded for run '{rid}'")

    if not _is_under_dir(candidate, base):
        raise HTTPException(status_code=403, detail="Refusing to open workspace outside ABSTRACTFLOW_BASE_EXECUTION")

    try:
        if not candidate.exists():
            raise HTTPException(status_code=404, detail=f"Workspace path not found: {candidate}")
        if not candidate.is_dir():
            raise HTTPException(status_code=400, detail=f"Workspace path is not a directory: {candidate}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to validate workspace path: {e}")

    try:
        _open_directory(candidate)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open folder: {e}")

    return {"ok": True, "path": str(candidate)}


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
    open_nodes: Dict[str, str] = {}
    for rec in records:
        if not isinstance(rec, dict):
            continue
        node_id = rec.get("node_id")
        status = str(rec.get("status") or "")
        if not isinstance(node_id, str) or not node_id:
            continue

        if status == "started":
            # Defensive: a new node_start implies prior nodes are no longer active.
            # Some waiting nodes (e.g. async+wait START_SUBWORKFLOW) may never emit
            # a "completed" record. Synthesize a completion at this boundary so the
            # UI doesn't show multiple root steps as running concurrently.
            ts0 = rec.get("started_at") or created_at
            for open_id, open_ts in list(open_nodes.items()):
                if open_id == node_id:
                    continue
                meta0: Dict[str, Any] = {}
                dur0 = _duration_ms(open_ts, ts0)
                if dur0 is not None:
                    meta0["duration_ms"] = round(float(dur0), 2)
                result0 = _best_effort_node_output_from_run(run, open_id)
                events.append(
                    {
                        "type": "node_complete",
                        "ts": ts0,
                        "runId": run_id,
                        "nodeId": open_id,
                        "result": result0,
                        "meta": meta0 or None,
                    }
                )
                open_nodes.pop(open_id, None)

            events.append({"type": "node_start", "ts": rec.get("started_at") or created_at, "runId": run_id, "nodeId": node_id})
            open_nodes[node_id] = rec.get("started_at") or created_at
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
            open_nodes.pop(node_id, None)
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
            open_nodes.pop(node_id, None)
            continue

        # status == "waiting" is typically used for async+wait (SUBWORKFLOW). The UI
        # already renders a node as “in progress” when it has a node_start without a
        # node_complete, so we don't need a separate event here.
        if status == "waiting":
            # Ensure the node is tracked as open so we can synthesize completion later if needed.
            if node_id not in open_nodes:
                open_nodes[node_id] = rec.get("started_at") or created_at
            continue

    # Close any leftover open nodes on terminal runs so history never shows "forever running".
    # Result is best-effort from persisted vars.
    updated_at = getattr(run, "updated_at", None) or created_at or _utc_now_iso()
    for open_id, open_ts in list(open_nodes.items()):
        meta0: Dict[str, Any] = {}
        dur0 = _duration_ms(open_ts, updated_at)
        if dur0 is not None:
            meta0["duration_ms"] = round(float(dur0), 2)
        result0 = _best_effort_node_output_from_run(run, open_id)
        events.append(
            {
                "type": "node_complete",
                "ts": updated_at,
                "runId": run_id,
                "nodeId": open_id,
                "result": result0,
                "meta": meta0 or None,
            }
        )

    # Terminal / waiting markers (best-effort) so the modal can render controls.
    summary = _run_summary(run)
    status = str(summary.get("status") or "")
    updated_at = summary.get("updated_at") or _utc_now_iso()

    if status == "completed":
        meta: Dict[str, Any] = {}
        dur_total = _duration_ms(created_at, updated_at)
        if dur_total is not None:
            meta["duration_ms"] = round(float(dur_total), 2)

        # Include cumulative token totals for the entire run tree (root + descendants).
        in_sum, out_sum = _sum_llm_usage_from_ledger_tree(run_store=run_store, ledger_store=ledger_store, run_id=run_id)
        if in_sum > 0 or out_sum > 0:
            meta["input_tokens"] = int(in_sum)
            meta["output_tokens"] = int(out_sum)
            if dur_total is not None and dur_total > 0 and out_sum > 0:
                meta["tokens_per_s"] = round(float(out_sum) / (float(dur_total) / 1000.0), 2)

        events.append(
            {
                "type": "flow_complete",
                "ts": updated_at,
                "runId": run_id,
                "result": getattr(run, "output", None),
                "meta": meta or None,
            }
        )
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
