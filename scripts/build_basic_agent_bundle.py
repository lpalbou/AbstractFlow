#!/usr/bin/env python3
"""Pack + sync-audit the shipped basic-agent bundle from flow's source.

Maintainer ruling (2026-07-11, agora commons c726): the SOURCE flow files
(examples/flows/) and the SHIPPED basic-agent bundle(s) must be IN SYNC, and
basic-agent's on_flow_start pinDefault carries max_iterations=20 — the pin is
authoritative workflow design ("if the workflow put 3, it's 3"), so the
publish-time check verifies source/shipped SYNC (the actual January incident
class was DESYNC: source drifted to 5 while the shipped bundle said 20),
never pin-vs-framework-default divergence.

Modes:
  pack   — rebuild the bundle artifacts from source, then run the audit.
  check  — audit only (no writes): byte-compare each bundle's flows/*.json
           against source, verify the manifest declares the agent interface
           on the default entrypoint, verify the bundle LOADS (presence of a
           file is not the invariant — a corrupt bundle boots the gateway and
           dies as a load warning), and verify the ruled max_iterations pin.

Exit code 0 = in sync / packed and verified; 1 = any check failed (loud,
per-check messages on stderr).
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_FLOWS_DIR = REPO_ROOT / "examples" / "flows"
ROOT_FLOW_ID = "81795ea9"
BUNDLE_ID = "basic-agent"
AGENT_INTERFACE = "abstractcode.agent.v1"
# The ruled basic-agent pin (2026-07-11). A deliberate change updates this
# constant in the same change that edits the source flow — the loud path.
RULED_MAX_ITERATIONS = 20
# The shipped artifacts to keep in sync: the wheel ships basic-agent.flow
# (manifest version 0.0.0); the dev/repo layout additionally carries
# basic-agent@0.0.1.flow and start_run latest-picks it, so both must stay
# byte-equal on their flow payloads or pip and dev behavior split silently.
ARTIFACTS: tuple[tuple[str, str], ...] = (
    # 0.0.2 = adversary wave 2026-07-20: the status helper's wait_until Delay
    # was dead (data-only, never executed — every configured post_delay was
    # silently dropped) and the root's memory pin was declared but unwired.
    # Both artifacts move to one version; bundle versions are immutable by
    # sha, so the content change forces the bump.
    # 0.0.3 = 2026-07-21: dropped the on_flow_start provider/model pinDefaults
    # (lmstudio / qwen/qwen3-next-80b — the model no longer exists in LM
    # Studio, so every run without explicit overrides failed). Absent pins
    # mean "resolve at runtime": run _runtime > gateway defaults >
    # AbstractCore config defaults.
    ("basic-agent.flow", "0.0.3"),
    ("basic-agent@0.0.3.flow", "0.0.3"),
)


def default_bundles_dir() -> Path:
    return REPO_ROOT.parent / "abstractgateway" / "flows" / "bundles"


def fail(msg: str) -> None:
    print(f"SYNC-AUDIT FAIL: {msg}", file=sys.stderr)


def _expected_flow_set() -> set[str]:
    """Source-derived reachable flow set, via the REAL packer (one authority).

    Packing to a temp file and reading the produced manifest reuses the
    packer's reachability walk instead of re-implementing it — so a shipped
    bundle whose manifest DROPS a reachable subflow (or smuggles an extra
    member the packer would not include) fails the completeness check.
    """
    import tempfile

    from abstractruntime.workflow_bundle import open_workflow_bundle, pack_workflow_bundle

    with tempfile.TemporaryDirectory(prefix="basic_agent_audit_") as td:
        tmp_path = Path(td) / "audit.flow"
        packed = pack_workflow_bundle(
            root_flow_json=SOURCE_FLOWS_DIR / f"{ROOT_FLOW_ID}.json",
            out_path=tmp_path,
            bundle_id=BUNDLE_ID,
            bundle_version="0.0.0",
            flows_dir=SOURCE_FLOWS_DIR,
            entrypoints=[ROOT_FLOW_ID],
            default_entrypoint=ROOT_FLOW_ID,
        )
        # Re-open through the reader for symmetry with the shipped audit.
        man = open_workflow_bundle(packed.path).manifest
        return set((man.flows or {}).keys())


def audit_bundle(bundle_path: Path, *, expected_version: str, expected_flows: set[str]) -> list[str]:
    """Return a list of failure messages (empty = the bundle passes)."""
    errors: list[str] = []
    if not bundle_path.is_file():
        return [f"{bundle_path.name}: missing"]

    # Loadability through the real reader — the boot check is presence-only,
    # so the audit must prove the artifact actually opens and validates.
    # (Import errors are environment problems, reported as such — never
    # mislabeled as bundle corruption.)
    try:
        from abstractruntime.workflow_bundle import open_workflow_bundle
    except ImportError as exc:
        return [f"environment: abstractruntime not importable ({exc}); activate the framework venv"]
    try:
        bundle = open_workflow_bundle(bundle_path)
        man = bundle.manifest
    except Exception as exc:
        return [f"{bundle_path.name}: does not load: {exc}"]

    if str(man.bundle_id) != BUNDLE_ID:
        errors.append(f"{bundle_path.name}: bundle_id {man.bundle_id!r} != {BUNDLE_ID!r}")
    if str(man.bundle_version) != expected_version:
        errors.append(
            f"{bundle_path.name}: bundle_version {man.bundle_version!r} != {expected_version!r}"
        )

    default_ep = str(man.default_entrypoint or "")
    eps_by_id = {ep.flow_id: ep for ep in list(man.entrypoints or [])}
    ep = eps_by_id.get(default_ep)
    if ep is None:
        errors.append(f"{bundle_path.name}: default entrypoint {default_ep!r} not declared")
    elif AGENT_INTERFACE not in list(ep.interfaces or []):
        errors.append(
            f"{bundle_path.name}: default entrypoint lacks interface {AGENT_INTERFACE!r}"
        )

    # Completeness: the shipped manifest's flow set must equal the
    # source-derived reachable set (a manifest is data, never trusted alone).
    shipped_flows = set((man.flows or {}).keys())
    if shipped_flows != expected_flows:
        missing = sorted(expected_flows - shipped_flows)
        extra = sorted(shipped_flows - expected_flows)
        detail = []
        if missing:
            detail.append(f"missing from bundle: {missing}")
        if extra:
            detail.append(f"extra in bundle: {extra}")
        errors.append(f"{bundle_path.name}: flow set diverges from source reachability ({'; '.join(detail)})")

    # Source/shipped byte identity per flow file — the January incident class.
    try:
        with zipfile.ZipFile(bundle_path) as zf:
            for fid, rel in sorted((man.flows or {}).items()):
                source_path = SOURCE_FLOWS_DIR / f"{fid}.json"
                if not source_path.is_file():
                    errors.append(f"{bundle_path.name}: flow {fid} has no source file {source_path}")
                    continue
                try:
                    bundled = zf.read(rel)
                except KeyError:
                    errors.append(f"{bundle_path.name}: manifest names {rel} but the zip has no such member")
                    continue
                source = source_path.read_bytes()
                if bundled != source:
                    errors.append(
                        f"{bundle_path.name}: flows/{fid}.json differs from source "
                        f"{source_path.relative_to(REPO_ROOT)} (re-pack or reconcile)"
                    )
            # The ruled pin, read from the bundled root flow itself.
            root_rel = (man.flows or {}).get(ROOT_FLOW_ID)
            if root_rel is None:
                errors.append(f"{bundle_path.name}: root flow {ROOT_FLOW_ID} missing from manifest")
            else:
                try:
                    root = json.loads(zf.read(root_rel).decode("utf-8"))
                except Exception as exc:
                    errors.append(f"{bundle_path.name}: root flow unreadable/malformed: {exc}")
                else:
                    pin = _on_flow_start_max_iterations(root)
                    if pin != RULED_MAX_ITERATIONS:
                        errors.append(
                            f"{bundle_path.name}: on_flow_start pinDefaults.max_iterations "
                            f"= {pin!r}, ruled value is {RULED_MAX_ITERATIONS} (2026-07-11)"
                        )
    except zipfile.BadZipFile as exc:
        errors.append(f"{bundle_path.name}: not a readable zip: {exc}")
    return errors


def _on_flow_start_max_iterations(flow: dict) -> object:
    for node in list(flow.get("nodes") or []):
        data = node.get("data") or {}
        node_type = node.get("type") or data.get("nodeType")
        if node_type == "on_flow_start":
            defaults = data.get("pinDefaults") or {}
            return defaults.get("max_iterations")
    return None


def pack(bundles_dir: Path) -> int:
    from abstractruntime.workflow_bundle import pack_workflow_bundle

    root_flow = SOURCE_FLOWS_DIR / f"{ROOT_FLOW_ID}.json"
    source_pin = _on_flow_start_max_iterations(json.loads(root_flow.read_text(encoding="utf-8")))
    if source_pin != RULED_MAX_ITERATIONS:
        fail(
            f"source {root_flow.name} pinDefaults.max_iterations = {source_pin!r}; "
            f"ruled value is {RULED_MAX_ITERATIONS}. Fix the source (or update the "
            "ruling constant in the same change) before packing."
        )
        return 1

    for filename, version in ARTIFACTS:
        out_path = bundles_dir / filename
        packed = pack_workflow_bundle(
            root_flow_json=root_flow,
            out_path=out_path,
            bundle_id=BUNDLE_ID,
            bundle_version=version,
            flows_dir=SOURCE_FLOWS_DIR,
            entrypoints=[ROOT_FLOW_ID],
            default_entrypoint=ROOT_FLOW_ID,
        )
        print(f"packed {out_path} ({packed.manifest.bundle_id}@{packed.manifest.bundle_version})")
    return 0


def check(bundles_dir: Path) -> int:
    try:
        expected_flows = _expected_flow_set()
    except ImportError as exc:
        fail(f"environment: abstractruntime not importable ({exc}); activate the framework venv")
        return 1
    except Exception as exc:
        fail(f"source flows do not pack cleanly: {exc}")
        return 1
    all_errors: list[str] = []
    for filename, version in ARTIFACTS:
        all_errors.extend(
            audit_bundle(bundles_dir / filename, expected_version=version, expected_flows=expected_flows)
        )
    if all_errors:
        for err in all_errors:
            fail(err)
        return 1
    print(f"sync audit OK: {', '.join(name for name, _ in ARTIFACTS)} match source, load, and declare {AGENT_INTERFACE}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("pack", "check"), help="pack = rebuild from source then audit; check = audit only")
    parser.add_argument(
        "--bundles-dir",
        type=Path,
        default=default_bundles_dir(),
        help="Directory holding the shipped bundle artifacts (default: sibling abstractgateway/flows/bundles)",
    )
    args = parser.parse_args()

    bundles_dir = args.bundles_dir.expanduser().resolve()
    if not bundles_dir.is_dir():
        fail(f"bundles dir does not exist: {bundles_dir}")
        return 1

    if args.mode == "pack":
        rc = pack(bundles_dir)
        if rc != 0:
            return rc
    return check(bundles_dir)


if __name__ == "__main__":
    sys.exit(main())
