"""Run Gateway API (HTTP + SSE).

Backlog 307: Durable Run Gateway (Command Inbox + Ledger Stream)

This is intentionally replay-first:
- The durable ledger is the source of truth.
- SSE is an optimization; clients must be able to reconnect and replay by cursor.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from abstractruntime.storage.commands import CommandRecord

from ..services.run_gateway import get_gateway_runner


router = APIRouter(prefix="/gateway", tags=["gateway"])


class StartRunRequest(BaseModel):
    flow_id: str = Field(..., description="VisualFlow id to start (stored in ./flows).")
    input_data: Dict[str, Any] = Field(default_factory=dict)


class StartRunResponse(BaseModel):
    run_id: str


class SubmitCommandRequest(BaseModel):
    command_id: str = Field(..., description="Client-supplied idempotency key (UUID recommended).")
    run_id: str = Field(..., description="Target run id (or session id for emit_event).")
    type: str = Field(..., description="pause|resume|cancel|emit_event")
    payload: Dict[str, Any] = Field(default_factory=dict)
    ts: Optional[str] = Field(default=None, description="ISO timestamp (optional).")
    client_id: Optional[str] = None


class SubmitCommandResponse(BaseModel):
    accepted: bool
    duplicate: bool
    seq: int


def _run_summary(run: Any) -> Dict[str, Any]:
    waiting = getattr(run, "waiting", None)
    status = getattr(getattr(run, "status", None), "value", None) or str(getattr(run, "status", "unknown"))
    out: Dict[str, Any] = {
        "run_id": getattr(run, "run_id", ""),
        "workflow_id": getattr(run, "workflow_id", None),
        "status": status,
        "current_node": getattr(run, "current_node", None),
        "created_at": getattr(run, "created_at", None),
        "updated_at": getattr(run, "updated_at", None),
        "parent_run_id": getattr(run, "parent_run_id", None),
        "error": getattr(run, "error", None),
        "waiting": None,
    }
    if waiting is not None:
        out["waiting"] = {
            "reason": getattr(getattr(waiting, "reason", None), "value", None) or str(getattr(waiting, "reason", "")),
            "wait_key": getattr(waiting, "wait_key", None),
            "prompt": getattr(waiting, "prompt", None),
            "choices": getattr(waiting, "choices", None),
            "allow_free_text": getattr(waiting, "allow_free_text", None),
            "details": getattr(waiting, "details", None),
        }
    return out


@router.post("/runs/start", response_model=StartRunResponse)
async def start_run(req: StartRunRequest) -> StartRunResponse:
    runner = get_gateway_runner()
    runner.start()

    flow_id = str(req.flow_id or "").strip()
    if not flow_id:
        raise HTTPException(status_code=400, detail="flow_id is required")

    # Import flows registry lazily (loaded from ./flows).
    from .flows import _flows  # type: ignore
    visual_flow = _flows.get(flow_id)
    if visual_flow is None:
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")

    # Start run via the same portable VisualFlow executor used by WS.
    from abstractflow.visual.workspace_scoped_tools import WorkspaceScope, build_scoped_tool_executor
    from abstractflow.visual.executor import create_visual_runner

    input_data = dict(req.input_data or {})
    scope = WorkspaceScope.from_input_data(input_data)
    tool_executor = build_scoped_tool_executor(scope=scope) if scope is not None else None

    vis_runner = create_visual_runner(
        visual_flow,
        flows=_flows,
        run_store=runner.run_store,
        ledger_store=runner.ledger_store,
        artifact_store=runner.artifact_store,
        tool_executor=tool_executor,
    )
    # Mark runs started via the gateway so the background worker can own fulfillment
    # (prevents double-ticking conflicts with WebSocket-driven interactive runs).
    run_id = vis_runner.start(input_data, actor_id="gateway")
    return StartRunResponse(run_id=str(run_id))


@router.get("/runs/{run_id}")
async def get_run(run_id: str) -> Dict[str, Any]:
    runner = get_gateway_runner()
    rs = runner.run_store
    try:
        run = rs.load(str(run_id))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load run: {e}")
    if run is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")
    return _run_summary(run)


@router.get("/runs/{run_id}/ledger")
async def get_ledger(
    run_id: str,
    after: int = Query(0, ge=0, description="Cursor: number of records already consumed."),
    limit: int = Query(200, ge=1, le=2000),
) -> Dict[str, Any]:
    runner = get_gateway_runner()
    ledger = runner.ledger_store.list(str(run_id))
    if not isinstance(ledger, list):
        ledger = []
    a = int(after or 0)
    items = ledger[a : a + int(limit)]
    next_after = a + len(items)
    return {"items": items, "next_after": next_after}


@router.get("/runs/{run_id}/ledger/stream")
async def stream_ledger(
    run_id: str,
    after: int = Query(0, ge=0, description="Cursor: number of records already consumed."),
    heartbeat_s: float = Query(5.0, gt=0.1, le=60.0),
) -> StreamingResponse:
    runner = get_gateway_runner()
    run_id2 = str(run_id)

    async def _gen():
        cursor = int(after or 0)
        last_emit = asyncio.get_event_loop().time()
        while True:
            ledger = runner.ledger_store.list(run_id2)
            if not isinstance(ledger, list):
                ledger = []
            if cursor < 0:
                cursor = 0
            if cursor < len(ledger):
                # Emit new records from cursor.
                while cursor < len(ledger):
                    item = ledger[cursor]
                    data = json.dumps({"cursor": cursor + 1, "record": item}, ensure_ascii=False)
                    yield f"id: {cursor + 1}\n".encode("utf-8")
                    yield b"event: step\n"
                    yield f"data: {data}\n\n".encode("utf-8")
                    cursor += 1
                    last_emit = asyncio.get_event_loop().time()
            else:
                # Heartbeat to keep intermediates from closing the connection.
                now = asyncio.get_event_loop().time()
                if (now - last_emit) >= float(heartbeat_s):
                    yield b": keep-alive\n\n"
                    last_emit = now
                await asyncio.sleep(0.25)

    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.post("/commands", response_model=SubmitCommandResponse)
async def submit_command(req: SubmitCommandRequest) -> SubmitCommandResponse:
    runner = get_gateway_runner()
    # Commands can be accepted even if the runner is disabled; processing happens when the worker runs.

    typ = str(req.type or "").strip()
    if typ not in {"pause", "resume", "cancel", "emit_event"}:
        raise HTTPException(status_code=400, detail="type must be one of pause|resume|cancel|emit_event")

    record = CommandRecord(
        command_id=str(req.command_id),
        run_id=str(req.run_id),
        type=typ,
        payload=dict(req.payload or {}),
        ts=str(req.ts) if isinstance(req.ts, str) and req.ts else "",
        client_id=str(req.client_id) if isinstance(req.client_id, str) and req.client_id else None,
        seq=0,
    )

    try:
        res = runner.command_store.append(record)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to append command: {e}")

    return SubmitCommandResponse(accepted=bool(res.accepted), duplicate=bool(res.duplicate), seq=int(res.seq))


