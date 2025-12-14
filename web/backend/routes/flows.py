"""Flow CRUD and execution routes."""

from __future__ import annotations

from datetime import datetime
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

router = APIRouter(prefix="/flows", tags=["flows"])

# In-memory storage (replace with database in production)
_flows: Dict[str, VisualFlow] = {}


@router.get("", response_model=List[VisualFlow])
async def list_flows():
    """List all saved flows."""
    return list(_flows.values())


@router.post("", response_model=VisualFlow)
async def create_flow(request: FlowCreateRequest):
    """Create a new flow."""
    now = datetime.utcnow().isoformat()
    flow = VisualFlow(
        id=str(uuid.uuid4())[:8],
        name=request.name,
        description=request.description,
        nodes=[],
        edges=[],
        created_at=now,
        updated_at=now,
    )
    _flows[flow.id] = flow
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
    return flow


@router.delete("/{flow_id}")
async def delete_flow(flow_id: str):
    """Delete a flow."""
    if flow_id not in _flows:
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")
    del _flows[flow_id]
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
