"""Flow CRUD and execution routes."""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..models import (
    VisualFlow,
    FlowCreateRequest,
    FlowUpdateRequest,
    FlowRunRequest,
    FlowRunResult,
)
from ..services.executor import create_visual_runner, visual_to_flow
from ..services.execution_workspace import ensure_default_workspace_root, ensure_run_id_workspace_alias
from ..services.runtime_stores import get_runtime_stores
from abstractflow.visual.workspace_scoped_tools import WorkspaceScope, build_scoped_tool_executor
from abstractflow.visual.interfaces import apply_visual_flow_interface_scaffold
from abstractflow.workflow_bundle import pack_workflow_bundle
from abstractruntime.workflow_bundle import open_workflow_bundle

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/flows", tags=["flows"])

# File-based persistence
FLOWS_DIR = Path("./flows")
FLOWS_DIR.mkdir(exist_ok=True)


def _repo_root() -> Path:
    # flows.py -> routes/ (0) -> backend/ (1) -> web/ (2) -> abstractflow/ (3) -> repo root/ (4)
    return Path(__file__).resolve().parents[4]


def _default_publish_dir() -> Path:
    # Prefer explicit publish dir; fall back to the gateway flows dir if set; otherwise
    # default to the monorepo's shared `flows/bundles/` directory.
    raw = (
        os.getenv("ABSTRACTFLOW_PUBLISH_DIR")
        or os.getenv("ABSTRACTGATEWAY_FLOWS_DIR")
        or os.getenv("ABSTRACTFLOW_FLOWS_DIR")
        or ""
    )
    if raw and str(raw).strip():
        return Path(raw).expanduser().resolve()
    return (_repo_root() / "flows" / "bundles").resolve()


_BUNDLE_ID_SAFE_RE = re.compile(r"[^a-zA-Z0-9_-]+")


def _sanitize_bundle_id(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    s = _BUNDLE_ID_SAFE_RE.sub("-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s


def _try_parse_semver(v: str) -> Optional[tuple[int, int, int]]:
    s = str(v or "").strip()
    if not s:
        return None
    parts = [p.strip() for p in s.split(".")]
    if not parts or any(not p for p in parts):
        return None
    nums: list[int] = []
    for p in parts:
        if not p.isdigit():
            return None
        nums.append(int(p))
    while len(nums) < 3:
        nums.append(0)
    return (nums[0], nums[1], nums[2])


def _bump_patch(v: str) -> str:
    sem = _try_parse_semver(v)
    if sem is not None:
        return f"{sem[0]}.{sem[1]}.{sem[2] + 1}"
    s = str(v or "").strip()
    return f"{s}.1" if s else "0.0.1"


def _scan_published_bundle_versions(*, publish_dir: Path, bundle_id: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    if not publish_dir.exists() or not publish_dir.is_dir():
        return out
    for p in sorted(publish_dir.glob("*.flow")):
        try:
            b = open_workflow_bundle(p)
            man = getattr(b, "manifest", None)
            bid = str(getattr(man, "bundle_id", "") or "").strip()
            if bid != bundle_id:
                continue
            out.append(
                {
                    "bundle_version": str(getattr(man, "bundle_version", "0.0.0") or "0.0.0").strip() or "0.0.0",
                    "created_at": str(getattr(man, "created_at", "") or ""),
                    "path": str(p),
                }
            )
        except Exception:
            continue
    return out


def _latest_version(versions: list[dict[str, str]]) -> Optional[str]:
    if not versions:
        return None
    vers = [str(v.get("bundle_version") or "").strip() for v in versions if str(v.get("bundle_version") or "").strip()]
    if not vers:
        return None
    if all(_try_parse_semver(v) is not None for v in vers):
        return max(vers, key=lambda x: _try_parse_semver(x) or (0, 0, 0))
    # fallback: created_at lexicographic (ISO), then version string
    return max(versions, key=lambda x: (str(x.get("created_at") or ""), str(x.get("bundle_version") or ""))).get("bundle_version")


def _origin_version(versions: list[dict[str, str]]) -> Optional[str]:
    if not versions:
        return None
    return min(versions, key=lambda x: (str(x.get("created_at") or ""), str(x.get("bundle_version") or ""))).get("bundle_version")


class PublishFlowRequest(BaseModel):
    bundle_id: Optional[str] = Field(default=None, description="Stable bundle identity (defaults to sanitized flow.name).")
    bundle_version: Optional[str] = Field(default=None, description="Explicit bundle_version. If omitted, auto-bump from existing published versions.")
    publish_dir: Optional[str] = Field(default=None, description="Override publish directory (defaults to repo flows/bundles or ABSTRACTFLOW_PUBLISH_DIR).")
    reload_gateway: bool = Field(default=True, description="If true, POST /api/gateway/bundles/reload after publishing (best-effort).")


class PublishFlowResponse(BaseModel):
    ok: bool
    bundle_id: str
    bundle_version: str
    bundle_ref: str
    bundle_path: str
    gateway_reloaded: bool = False
    gateway_reload_error: Optional[str] = None


def _load_flows_from_disk() -> Dict[str, VisualFlow]:
    """Load all flows from disk on startup."""
    flows: Dict[str, VisualFlow] = {}
    for path in FLOWS_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text())
            flow = VisualFlow(**data)
            # Best-effort: keep interface-marked workflows scaffolded so the editor
            # always shows the expected pins (even for older files).
            try:
                for iid in list(getattr(flow, "interfaces", []) or []):
                    apply_visual_flow_interface_scaffold(flow, str(iid), include_recommended=True)
            except Exception:
                pass
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
        interfaces=list(request.interfaces or []),
        nodes=request.nodes,
        edges=request.edges,
        entryNode=request.entryNode,
        created_at=now,
        updated_at=now,
    )
    # If the flow declares interfaces, ensure required pins exist.
    try:
        for iid in list(getattr(flow, "interfaces", []) or []):
            apply_visual_flow_interface_scaffold(flow, str(iid), include_recommended=True)
    except Exception:
        pass
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
    if request.interfaces is not None:
        flow.interfaces = list(request.interfaces or [])
    if request.nodes is not None:
        flow.nodes = request.nodes
    if request.edges is not None:
        flow.edges = request.edges
    if request.entryNode is not None:
        flow.entryNode = request.entryNode

    # Keep interface-marked flows scaffolded even if only nodes/edges changed.
    try:
        for iid in list(getattr(flow, "interfaces", []) or []):
            apply_visual_flow_interface_scaffold(flow, str(iid), include_recommended=True)
    except Exception:
        pass

    flow.updated_at = datetime.utcnow().isoformat()
    _flows[flow_id] = flow
    _save_flow_to_disk(flow)  # Persist to disk
    return flow


def _gateway_reload_url() -> str:
    raw = str(os.getenv("ABSTRACTFLOW_GATEWAY_URL") or os.getenv("ABSTRACTGATEWAY_URL") or "http://127.0.0.1:8081").strip()
    raw = raw.rstrip("/")
    if raw.endswith("/api"):
        api = raw
    elif raw.endswith("/api/"):
        api = raw.rstrip("/")
    else:
        api = f"{raw}/api"
    return f"{api}/gateway/bundles/reload"


def _gateway_auth_token() -> str:
    # Prefer canonical gateway env var names (with legacy fallbacks).
    raw = os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") or os.getenv("ABSTRACTFLOW_GATEWAY_AUTH_TOKEN") or ""
    return str(raw or "").strip()


def _try_reload_gateway() -> Optional[str]:
    url = _gateway_reload_url()
    req = urllib.request.Request(url=url, method="POST")
    token = _gateway_auth_token()
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            _ = resp.read()
        return None
    except Exception as e:
        return str(e)


@router.post("/{flow_id}/publish", response_model=PublishFlowResponse)
async def publish_flow(flow_id: str, request: PublishFlowRequest) -> PublishFlowResponse:
    """Pack and publish a `.flow` bundle for the specified VisualFlow.

    This mirrors `abstractflow bundle pack ...` but:
    - writes to a shared bundles directory (default: repo `flows/bundles/`)
    - auto-bumps bundle_version to preserve older published bundles
    - adds lineage metadata into the bundle manifest
    """
    if flow_id not in _flows:
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")

    flow = _flows[flow_id]
    bundle_id = _sanitize_bundle_id(str(request.bundle_id or "").strip()) or _sanitize_bundle_id(str(flow.name or "").strip()) or str(flow.id)

    publish_dir = (
        Path(str(request.publish_dir)).expanduser().resolve()
        if isinstance(request.publish_dir, str) and str(request.publish_dir).strip()
        else _default_publish_dir()
    )
    try:
        publish_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create publish_dir '{publish_dir}': {e}")

    existing = _scan_published_bundle_versions(publish_dir=publish_dir, bundle_id=bundle_id)
    prev = _latest_version(existing)
    origin = _origin_version(existing) or prev

    requested_ver = str(request.bundle_version or "").strip() if isinstance(request.bundle_version, str) and str(request.bundle_version).strip() else ""
    if requested_ver:
        if any(str(x.get("bundle_version") or "").strip() == requested_ver for x in existing):
            raise HTTPException(status_code=400, detail=f"bundle_version '{requested_ver}' already exists for bundle '{bundle_id}'")
        new_ver = requested_ver
    else:
        new_ver = "0.0.0" if not prev else _bump_patch(prev)

    out_path = (publish_dir / f"{bundle_id}@{new_ver}.flow").resolve()
    if out_path.exists():
        raise HTTPException(status_code=400, detail=f"Output bundle already exists: {out_path}")

    root_path = (FLOWS_DIR / f"{flow.id}.json").resolve()
    if not root_path.exists():
        raise HTTPException(status_code=500, detail=f"Flow file not found on disk: {root_path}")

    published_at = datetime.utcnow().isoformat() + "Z"
    metadata: Dict[str, Any] = {
        "publisher": {"host": "abstractflow.web", "published_at": published_at},
        "source": {"root_flow_id": str(flow.id), "root_flow_name": str(flow.name or ""), "root_flow_updated_at": str(flow.updated_at or "")},
        "lineage": {
            "bundle_id": bundle_id,
            "bundle_version": new_ver,
            "origin_bundle_version": str(origin or new_ver),
            **({"previous_bundle_version": str(prev)} if prev else {}),
        },
    }

    try:
        pack_workflow_bundle(
            root_flow_json=root_path,
            out_path=out_path,
            bundle_id=bundle_id,
            bundle_version=new_ver,
            flows_dir=FLOWS_DIR,
            metadata=metadata,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to publish bundle: {e}")

    gateway_reloaded = False
    gateway_reload_error = None
    if bool(request.reload_gateway):
        gateway_reload_error = _try_reload_gateway()
        gateway_reloaded = gateway_reload_error is None

    return PublishFlowResponse(
        ok=True,
        bundle_id=bundle_id,
        bundle_version=new_ver,
        bundle_ref=f"{bundle_id}@{new_ver}",
        bundle_path=str(out_path),
        gateway_reloaded=bool(gateway_reloaded),
        gateway_reload_error=gateway_reload_error,
    )


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
        input_data = dict(request.input_data or {})
        session_id = None
        try:
            raw = input_data.get("session_id") or input_data.get("sessionId")
            if isinstance(raw, str) and raw.strip():
                session_id = raw.strip()
        except Exception:
            session_id = None
        workspace_dir = ensure_default_workspace_root(input_data)
        scope = WorkspaceScope.from_input_data(input_data)
        tool_executor = build_scoped_tool_executor(scope=scope) if scope is not None else None

        run_store, ledger_store, artifact_store = get_runtime_stores()
        runner = create_visual_runner(
            visual_flow,
            flows=_flows,
            run_store=run_store,
            ledger_store=ledger_store,
            artifact_store=artifact_store,
            tool_executor=tool_executor,
            input_data=input_data,
        )
        result = runner.run(input_data, session_id=session_id)
        if workspace_dir is not None and isinstance(runner.run_id, str) and runner.run_id.strip():
            ensure_run_id_workspace_alias(run_id=runner.run_id.strip(), workspace_dir=workspace_dir)

        if isinstance(result, dict) and result.get("waiting"):
            state = runner.get_state()
            wait = state.waiting if state else None
            payload = {
                "success": False,
                "waiting": True,
                "error": "Flow is waiting for input. Use WebSocket (/api/ws/{flow_id}) to resume.",
                "run_id": runner.run_id,
                "wait_key": wait.wait_key if wait else None,
                "prompt": wait.prompt if wait else None,
                "choices": list(wait.choices) if wait and isinstance(wait.choices, list) else [],
                "allow_free_text": bool(wait.allow_free_text) if wait else None,
            }
        elif isinstance(result, dict):
            payload = {
                "success": bool(result.get("success", True)),
                "waiting": False,
                "result": result.get("result"),
                "error": result.get("error"),
                "run_id": runner.run_id,
            }
        else:
            payload = {"success": True, "waiting": False, "result": result, "run_id": runner.run_id}

        return FlowRunResult(
            success=bool(payload.get("success", False)),
            result=payload.get("result"),
            error=payload.get("error"),
            run_id=payload.get("run_id"),
            waiting=bool(payload.get("waiting", False)),
            wait_key=payload.get("wait_key"),
            prompt=payload.get("prompt"),
            choices=payload.get("choices"),
            allow_free_text=payload.get("allow_free_text"),
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
