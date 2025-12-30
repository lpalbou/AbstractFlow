"""Regression tests for WS run controls responsiveness.

Motivation
----------
Historically, `web.backend.routes.ws.control_run()` would await a per-connection lock
that was also held across `runner.step()` calls (which can block on local LLM HTTP
requests). That design made pause/cancel/resume appear "broken" exactly when the
workflow was stuck.

This test ensures `control_run()` remains responsive even if the execution loop
is currently holding the lock.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Optional

import anyio


@dataclass
class _CapturingWebSocket:
    sent: list[dict]

    async def send_json(self, data: Any) -> None:  # matches FastAPI WebSocket API
        assert isinstance(data, dict)
        self.sent.append(data)


@dataclass
class _Runner:
    runtime: Any
    run_id: Optional[str] = None


def test_ws_cancel_does_not_block_on_connection_lock() -> None:
    import web.backend.routes.ws as ws_routes

    from abstractruntime.core.models import StepPlan
    from abstractruntime.core.runtime import Runtime
    from abstractruntime.core.spec import WorkflowSpec
    from abstractruntime.storage.in_memory import InMemoryLedgerStore, InMemoryRunStore

    def done(run, ctx) -> StepPlan:
        return StepPlan(node_id="done", complete_output={"ok": True})

    workflow = WorkflowSpec(workflow_id="w_cancel_lock", entry_node="done", nodes={"done": done})
    runtime = Runtime(run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore())
    run_id = runtime.start(workflow=workflow)

    connection_id = "conn_cancel_lock"
    ws = _CapturingWebSocket(sent=[])
    runner = _Runner(runtime=runtime, run_id=run_id)

    async def _block_forever() -> None:
        await asyncio.sleep(9999)

    async def _drive() -> None:
        # Simulate the execution loop holding the lock across a long-running step.
        lock = asyncio.Lock()
        await lock.acquire()
        task = asyncio.create_task(_block_forever())

        ws_routes._active_tasks[connection_id] = task
        ws_routes._active_runners[connection_id] = runner
        ws_routes._active_run_ids[connection_id] = run_id
        gate = asyncio.Event()
        gate.set()
        ws_routes._control_gates[connection_id] = gate
        ws_routes._connection_locks[connection_id] = lock

        try:
            with anyio.fail_after(1.0):
                await ws_routes.control_run(
                    websocket=ws,  # type: ignore[arg-type]
                    connection_id=connection_id,
                    action="cancel",
                )
            # Must notify the UI promptly.
            assert any(m.get("type") == "flow_cancelled" for m in ws.sent)

            # Must cancel the in-flight execution task promptly.
            with anyio.fail_after(1.0):
                await task
        except asyncio.CancelledError:
            # Expected: the task must be cancelled by control_run().
            pass
        finally:
            try:
                if lock.locked():
                    lock.release()
            except Exception:
                pass
            ws_routes._active_tasks.pop(connection_id, None)
            ws_routes._active_runners.pop(connection_id, None)
            ws_routes._active_run_ids.pop(connection_id, None)
            ws_routes._control_gates.pop(connection_id, None)
            ws_routes._connection_locks.pop(connection_id, None)

    anyio.run(_drive)


