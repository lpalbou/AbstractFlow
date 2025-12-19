"""Flow CRUD and execution routes."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List
import uuid

from fastapi import APIRouter, HTTPException

from ..models import (
    VisualFlow,
    FlowCreateRequest,
    FlowUpdateRequest,
    FlowRunRequest,
    FlowRunResult,
)
from ..services.executor import visual_to_flow, execute_flow

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/flows", tags=["flows"])

# File-based persistence
FLOWS_DIR = Path("./flows")
FLOWS_DIR.mkdir(exist_ok=True)


def _load_flows_from_disk() -> Dict[str, VisualFlow]:
    """Load all flows from disk on startup."""
    flows: Dict[str, VisualFlow] = {}
    for path in FLOWS_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text())
            flow = VisualFlow(**data)
            flows[flow.id] = flow
            logger.info(f"Loaded flow '{flow.name}' ({flow.id}) from {path}")
        except Exception as e:
            logger.warning(f"Failed to load flow from {path}: {e}")
    return flows


def _save_flow_to_disk(flow: VisualFlow) -> None:
    """Persist a single flow to disk."""
    path = FLOWS_DIR / f"{flow.id}.json"
    path.write_text(flow.model_dump_json(indent=2))
    logger.info(f"Saved flow '{flow.name}' ({flow.id}) to {path}")


def _delete_flow_from_disk(flow_id: str) -> None:
    """Remove a flow file from disk."""
    path = FLOWS_DIR / f"{flow_id}.json"
    if path.exists():
        path.unlink()
        logger.info(f"Deleted flow file {path}")


# Load existing flows from disk on module import
_flows: Dict[str, VisualFlow] = _load_flows_from_disk()


@router.get("", response_model=List[VisualFlow])
async def list_flows():
    """List all saved flows."""
    return list(_flows.values())


@router.post("", response_model=VisualFlow)
async def create_flow(request: FlowCreateRequest):
    """Create a new flow with nodes and edges."""
    now = datetime.utcnow().isoformat()
    flow = VisualFlow(
        id=str(uuid.uuid4())[:8],
        name=request.name,
        description=request.description,
        nodes=request.nodes,
        edges=request.edges,
        entryNode=request.entryNode,
        created_at=now,
        updated_at=now,
    )
    _flows[flow.id] = flow
    _save_flow_to_disk(flow)  # Persist to disk
    return flow


@router.get("/{flow_id}", response_model=VisualFlow)
async def get_flow(flow_id: str):
    """Get a specific flow by ID."""
    if flow_id not in _flows:
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")
    return _flows[flow_id]


@router.put("/{flow_id}", response_model=VisualFlow)
async def update_flow(flow_id: str, request: FlowUpdateRequest):
    """Update an existing flow."""
    if flow_id not in _flows:
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")

    flow = _flows[flow_id]

    # Update fields if provided
    if request.name is not None:
        flow.name = request.name
    if request.description is not None:
        flow.description = request.description
    if request.nodes is not None:
        flow.nodes = request.nodes
    if request.edges is not None:
        flow.edges = request.edges
    if request.entryNode is not None:
        flow.entryNode = request.entryNode

    flow.updated_at = datetime.utcnow().isoformat()
    _flows[flow_id] = flow
    _save_flow_to_disk(flow)  # Persist to disk
    return flow


@router.delete("/{flow_id}")
async def delete_flow(flow_id: str):
    """Delete a flow."""
    if flow_id not in _flows:
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")
    del _flows[flow_id]
    _delete_flow_from_disk(flow_id)  # Remove from disk
    return {"status": "deleted", "id": flow_id}


@router.post("/{flow_id}/run", response_model=FlowRunResult)
async def run_flow(flow_id: str, request: FlowRunRequest):
    """Execute a flow and return the result."""
    if flow_id not in _flows:
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")

    visual_flow = _flows[flow_id]

    try:
        # Convert visual flow to AbstractFlow
        flow = visual_to_flow(visual_flow)

        # Execute the flow
        result = execute_flow(flow, request.input_data)

        return FlowRunResult(
            success=True,
            result=result.get("result"),
            run_id=result.get("run_id"),
        )
    except Exception as e:
        return FlowRunResult(
            success=False,
            error=str(e),
        )


@router.post("/{flow_id}/validate")
async def validate_flow(flow_id: str):
    """Validate a flow without executing it."""
    if flow_id not in _flows:
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")

    visual_flow = _flows[flow_id]

    try:
        flow = visual_to_flow(visual_flow)
        errors = flow.validate()
        return {
            "valid": len(errors) == 0,
            "errors": errors,
        }
    except Exception as e:
        return {
            "valid": False,
            "errors": [str(e)],
        }
