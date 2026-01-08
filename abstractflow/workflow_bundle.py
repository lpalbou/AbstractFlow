"""WorkflowBundle (.flow) tooling for AbstractFlow (authoring-side).

This module implements:
- bundle pack: VisualFlow root + reachable subflows -> `.flow` zip
- bundle inspect: read manifest summary
- bundle unpack: extract to a directory

Notes:
- Packing requires `abstractflow` (VisualFlow models).
- Reading bundles is handled in `abstractruntime.workflow_bundle` (stdlib-only).
"""

from __future__ import annotations

import json
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from abstractruntime.workflow_bundle import (
    WORKFLOW_BUNDLE_FORMAT_VERSION_V1,
    WorkflowBundleEntrypoint,
    WorkflowBundleManifest,
    WorkflowBundleError,
    open_workflow_bundle,
    workflow_bundle_manifest_to_dict,
)

from .visual.models import NodeType, VisualFlow


@dataclass(frozen=True)
class PackedWorkflowBundle:
    path: Path
    manifest: WorkflowBundleManifest


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json_bytes(path: Path) -> bytes:
    return path.read_bytes()


def _load_visualflow_from_bytes(raw: bytes) -> VisualFlow:
    data = json.loads(raw.decode("utf-8"))
    return VisualFlow.model_validate(data)


def _node_type_str(node: Any) -> str:
    t = getattr(node, "type", None)
    return t.value if hasattr(t, "value") else str(t or "")


def _reachable_exec_node_ids(flow: VisualFlow) -> set[str]:
    """Return exec-reachable node ids (Blueprint-style; ignores disconnected exec nodes)."""
    exec_ids: set[str] = set()
    for n in flow.nodes:
        data = dict(n.data) if isinstance(n.data, dict) else {}
        pins = data.get("inputs") if isinstance(data.get("inputs"), list) else []
        pins2 = data.get("outputs") if isinstance(data.get("outputs"), list) else []
        for p in list(pins) + list(pins2):
            if isinstance(p, dict) and p.get("type") == "execution":
                exec_ids.add(str(n.id))
                break

    if not exec_ids:
        return set()

    incoming_exec = {e.target for e in flow.edges if getattr(e, "targetHandle", None) == "exec-in"}

    roots: list[str] = []
    if isinstance(flow.entryNode, str) and flow.entryNode in exec_ids:
        roots.append(flow.entryNode)
    for n in flow.nodes:
        if _node_type_str(n) == str(NodeType.ON_EVENT.value) and n.id in exec_ids:
            roots.append(n.id)
    if not roots:
        for n in flow.nodes:
            if n.id in exec_ids and n.id not in incoming_exec:
                roots.append(n.id)
                break
    if not roots:
        roots.append(next(iter(exec_ids)))

    adj: Dict[str, list[str]] = {}
    for e in flow.edges:
        if getattr(e, "targetHandle", None) != "exec-in":
            continue
        if e.source not in exec_ids or e.target not in exec_ids:
            continue
        adj.setdefault(e.source, []).append(e.target)

    reachable: set[str] = set()
    stack = list(dict.fromkeys([r for r in roots if isinstance(r, str) and r]))
    while stack:
        cur = stack.pop()
        if cur in reachable:
            continue
        reachable.add(cur)
        for nxt in adj.get(cur, []):
            if nxt not in reachable:
                stack.append(nxt)
    return reachable


def _collect_reachable_flows(
    *, root_flow: VisualFlow, root_bytes: bytes, flows_dir: Path
) -> Tuple[List[Tuple[str, VisualFlow, bytes]], List[str]]:
    """Return [(flow_id, flow, raw_bytes)] in discovery order + list of missing subflow ids."""
    ordered: list[Tuple[str, VisualFlow, bytes]] = []
    visited: set[str] = set()
    missing: list[str] = []

    # Memoize loaded files by id for reuse.
    cache: Dict[str, Tuple[VisualFlow, bytes]] = {str(root_flow.id): (root_flow, root_bytes)}

    def _load_by_id(flow_id: str) -> Optional[Tuple[VisualFlow, bytes]]:
        fid = str(flow_id or "").strip()
        if not fid:
            return None
        if fid in cache:
            return cache[fid]
        p = (flows_dir / f"{fid}.json").resolve()
        if not p.exists():
            return None
        raw = _read_json_bytes(p)
        vf = _load_visualflow_from_bytes(raw)
        cache[fid] = (vf, raw)
        return cache[fid]

    def _dfs(vf: VisualFlow, raw: bytes) -> None:
        fid = str(vf.id)
        if fid in visited:
            return
        visited.add(fid)
        ordered.append((fid, vf, raw))

        reachable = _reachable_exec_node_ids(vf)
        for n in vf.nodes:
            if _node_type_str(n) != str(NodeType.SUBFLOW.value):
                continue
            if reachable and n.id not in reachable:
                continue
            data = n.data if isinstance(n.data, dict) else {}
            sub_id = data.get("subflowId") or data.get("flowId")
            if not isinstance(sub_id, str) or not sub_id.strip():
                # Match VisualFlow executor behavior: fail if a reachable subflow is malformed.
                missing.append(f"<missing-subflow-id:{fid}:{n.id}>")
                continue
            sub_id = sub_id.strip()
            child = _load_by_id(sub_id)
            if child is None:
                # Self-recursion is valid even if the file isn't duplicated on disk.
                if sub_id == fid:
                    _dfs(vf, raw)
                    continue
                missing.append(sub_id)
                continue
            _dfs(child[0], child[1])

    _dfs(root_flow, root_bytes)
    return ordered, missing


def pack_workflow_bundle(
    *,
    root_flow_json: str | Path,
    out_path: str | Path,
    bundle_id: Optional[str] = None,
    bundle_version: str = "0.0.0",
    flows_dir: Optional[str | Path] = None,
    entrypoints: Optional[List[str]] = None,
) -> PackedWorkflowBundle:
    """Pack a `.flow` bundle from a root VisualFlow JSON file."""
    root_path = Path(root_flow_json).expanduser().resolve()
    if not root_path.exists():
        raise FileNotFoundError(f"root flow not found: {root_path}")
    root_bytes = _read_json_bytes(root_path)
    root_flow = _load_visualflow_from_bytes(root_bytes)

    flows_base = Path(flows_dir).expanduser().resolve() if flows_dir is not None else root_path.parent
    if not flows_base.exists() or not flows_base.is_dir():
        raise FileNotFoundError(f"flows_dir does not exist: {flows_base}")

    ordered, missing = _collect_reachable_flows(root_flow=root_flow, root_bytes=root_bytes, flows_dir=flows_base)
    if missing:
        uniq = sorted(set(missing))
        raise WorkflowBundleError(f"Missing referenced subflows in flows_dir: {uniq}")

    # Entry points: default to root flow id.
    entry_ids = list(entrypoints) if isinstance(entrypoints, list) and entrypoints else [str(root_flow.id)]

    # Compile artifacts for all included flows.
    flows_json: Dict[str, bytes] = {}
    interfaces_by_flow: Dict[str, list[str]] = {}
    name_by_flow: Dict[str, str] = {}
    desc_by_flow: Dict[str, str] = {}

    for fid, vf, raw in ordered:
        flows_json[fid] = raw
        name_by_flow[fid] = str(getattr(vf, "name", "") or "")
        desc_by_flow[fid] = str(getattr(vf, "description", "") or "")
        interfaces_by_flow[fid] = list(getattr(vf, "interfaces", []) or [])

    bid = str(bundle_id or "").strip() or str(root_flow.id)
    created_at = _now_iso()

    eps: list[WorkflowBundleEntrypoint] = []
    for fid in entry_ids:
        fid2 = str(fid or "").strip()
        if not fid2:
            continue
        eps.append(
            WorkflowBundleEntrypoint(
                flow_id=fid2,
                name=name_by_flow.get(fid2) or fid2,
                description=desc_by_flow.get(fid2, ""),
                interfaces=list(interfaces_by_flow.get(fid2, [])),
            )
        )
    if not eps:
        raise WorkflowBundleError("No valid entrypoints specified")

    manifest = WorkflowBundleManifest(
        bundle_format_version=WORKFLOW_BUNDLE_FORMAT_VERSION_V1,
        bundle_id=bid,
        bundle_version=str(bundle_version or "0.0.0"),
        created_at=created_at,
        entrypoints=eps,
        flows={fid: f"flows/{fid}.json" for fid in sorted(flows_json.keys())},
        artifacts={},
        assets={},
        metadata={},
    )
    manifest.validate()

    out = Path(out_path).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    # Deterministic write order for reproducibility.
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(workflow_bundle_manifest_to_dict(manifest), indent=2, ensure_ascii=False))
        for fid in sorted(flows_json.keys()):
            zf.writestr(f"flows/{fid}.json", flows_json[fid])

    return PackedWorkflowBundle(path=out, manifest=manifest)


def inspect_workflow_bundle(*, bundle_path: str | Path) -> WorkflowBundleManifest:
    b = open_workflow_bundle(bundle_path)
    return b.manifest


def unpack_workflow_bundle(*, bundle_path: str | Path, out_dir: str | Path) -> Path:
    src = Path(bundle_path).expanduser().resolve()
    out = Path(out_dir).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)

    if src.is_dir():
        # Directory bundle: copy files (best-effort).
        for p in src.rglob("*"):
            if p.is_dir():
                continue
            rel = p.relative_to(src)
            dst = out / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(p.read_bytes())
        return out

    with zipfile.ZipFile(src, "r") as zf:
        zf.extractall(out)
    return out

