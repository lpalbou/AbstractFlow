#!/usr/bin/env python3
"""Write and check the entrypoint names/descriptions of the shipped workflows.

The gateway shows, per bundle, the default entrypoint's `name` and
`description` from the bundle manifest (and per version, every entrypoint's).
`workflow_labels.py` holds that text; this tool puts it where it is read:

  apply  — for every bundle id in the table, the LATEST version in the bundles
           dir (every file at that version: basic-agent ships as both
           basic-agent.flow and basic-agent@0.0.5.flow) gets the table's
           name/description in its manifest entrypoints and in each
           entrypoint's VisualFlow JSON (`name`, `description`). Nothing else
           changes: every other zip member keeps its bytes, the manifest keeps
           every other field (created_at included), and a JSON member that
           would not re-serialize byte-identically stops the run. Older
           versions are never touched. Bundles listed in NEW_VERSIONS are
           written as a NEW file at that version instead (a bundle the gateway
           publishes into its catalog is immutable by sha, so its text change
           needs a version bump); the source version stays as it is. The
           example VisualFlow JSONs this repository builds from
           (examples/flows/<flow_id>.json) are relabelled the same way.
  check  — no writes. Fails (exit 1) when the table breaks its rules, when a
           build script would produce other text, when an example JSON or a
           latest shipped bundle carries other text, or when a latest shipped
           bundle has an entrypoint the table does not name.

Usage:
  relabel_shipped_bundles.py apply --bundles-dir ../abstractgateway/flows/bundles
  relabel_shipped_bundles.py check --bundles-dir ../abstractgateway/flows/bundles
"""

from __future__ import annotations

import argparse
import importlib.util
import io
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
EXAMPLES_DIR = REPO_ROOT / "examples" / "flows"
sys.path.insert(0, str(HERE))

from workflow_labels import ENTRYPOINT_LABELS, table_problems  # noqa: E402

# bundle id -> (version to write, version to copy from). docs-qa is published
# into the gateway's tenant catalog at boot, where a version is immutable by
# sha (abstractgateway shipped_catalog.py), so its new text ships as 0.1.2.
NEW_VERSIONS: dict[str, tuple[str, str]] = {"docs-qa": ("0.1.2", "0.1.1")}

# The build functions that produce each entrypoint flow built in this
# repository: (script file, function name, flow id). `check` calls them and
# compares the `name`/`description` they emit with the table.
BUILDERS: tuple[tuple[str, str, str], ...] = (
    ("build_map_reduce_workflow.py", "build_flow", "map-reduce"),
    ("build_structured_extract_workflow.py", "build_flow", "structured-extract"),
    ("build_adversarial_review_workflow.py", "build_flow", "adversarial-review"),
    ("build_co_scientist_workflow.py", "build_flow", "co-scientist"),
    ("build_coding_agent_workflow.py", "build_root_flow", "coding-agent"),
    ("build_coding_agent_workflow.py", "build_chat_entrypoint_flow", "coder"),
    ("build_deep_research_workflows.py", "build_root_flow", "deep-research"),
    ("build_meta_intelligence_workflows.py", "build_consensus", "meta-consensus"),
    ("build_meta_intelligence_workflows.py", "build_debate", "meta-debate"),
    ("build_meta_intelligence_workflows.py", "build_reflect", "meta-reflect"),
    ("build_meta_intelligence_workflows.py", "build_perspectives", "meta-perspectives"),
    ("build_meta_intelligence_workflows.py", "build_deliberate", "meta-deliberate"),
    ("build_meta_intelligence_workflows.py", "build_baseline", "meta-baseline"),
)

# Entrypoint flows whose source is an example JSON edited in AbstractFlow (no
# generator): basic-agent's root. build_basic_agent_bundle.py packs it.
HAND_EDITED_SOURCES: tuple[str, ...] = ("81795ea9",)


def fail(msg: str) -> None:
    print(f"RELABEL FAIL: {msg}", file=sys.stderr)


def _labels_by_flow() -> dict[str, tuple[str, str]]:
    out: dict[str, tuple[str, str]] = {}
    for entries in ENTRYPOINT_LABELS.values():
        out.update(entries)
    return out


def _json_dump_like(original: bytes, data: Any) -> bytes:
    """Serialize `data` the way `original` was serialized, or raise.

    Two layouts exist in the shipped artifacts: indent=2 with and without a
    trailing newline, with or without ASCII escaping. The layout is detected
    by re-serializing the ORIGINAL; if none reproduces it byte for byte, the
    member is not rewritten (a rewrite would change more than the labels)."""
    parsed = json.loads(original.decode("utf-8"))
    for ensure_ascii in (False, True):
        for suffix in ("\n", ""):
            if (json.dumps(parsed, indent=2, ensure_ascii=ensure_ascii) + suffix).encode("utf-8") == original:
                return (json.dumps(data, indent=2, ensure_ascii=ensure_ascii) + suffix).encode("utf-8")
    raise ValueError("does not re-serialize byte-identically; refusing to rewrite it")


def _version_key(v: str) -> tuple:
    parts = []
    for p in v.split("."):
        parts.append((0, int(p), "") if p.isdigit() else (1, 0, p))
    return tuple(parts)


def _scan(bundles_dir: Path) -> dict[str, dict[str, list[Path]]]:
    """bundle_id -> version -> [files], from each file's manifest."""
    out: dict[str, dict[str, list[Path]]] = {}
    for path in sorted(bundles_dir.glob("*.flow")):
        with zipfile.ZipFile(path) as zf:
            man = json.loads(zf.read("manifest.json").decode("utf-8"))
        out.setdefault(str(man["bundle_id"]), {}).setdefault(str(man["bundle_version"]), []).append(path)
    return out


def _latest_files(scan: dict[str, dict[str, list[Path]]], bundle_id: str) -> tuple[str, list[Path]]:
    versions = scan.get(bundle_id) or {}
    if not versions:
        return "", []
    latest = max(versions, key=_version_key)
    return latest, versions[latest]


def _relabel_zip(src: Path, dest: Path, bundle_id: str, *, new_version: str | None = None) -> list[str]:
    """Rewrite `src` into `dest` with the table's labels. Returns what changed."""
    labels = ENTRYPOINT_LABELS[bundle_id]
    changed: list[str] = []
    with zipfile.ZipFile(src) as zf:
        infos = zf.infolist()
        members = {i.filename: zf.read(i.filename) for i in infos}
    man_raw = members["manifest.json"]
    man = json.loads(man_raw.decode("utf-8"))
    for ep in man.get("entrypoints") or []:
        fid = str(ep.get("flow_id") or "")
        if fid not in labels:
            raise KeyError(f"{src.name}: entrypoint {fid!r} has no entry in workflow_labels.py")
        name, desc = labels[fid]
        if ep.get("name") != name or ep.get("description") != desc:
            changed.append(f"manifest {fid}: {ep.get('name')!r} -> {name!r}")
        ep["name"], ep["description"] = name, desc
        rel = (man.get("flows") or {}).get(fid)
        if rel:
            flow_raw = members[rel]
            flow = json.loads(flow_raw.decode("utf-8"))
            if flow.get("name") != name or flow.get("description") != desc:
                changed.append(f"{rel}: name/description")
            flow["name"], flow["description"] = name, desc
            try:
                members[rel] = _json_dump_like(flow_raw, flow)
            except ValueError as exc:
                raise ValueError(f"{src.name}:{rel} {exc}") from exc
    if new_version is not None:
        # A new version is a new artifact: its own version and creation time.
        man["bundle_version"] = new_version
        man["created_at"] = datetime.now(timezone.utc).isoformat()
        changed.append(f"bundle_version -> {new_version}")
    try:
        members["manifest.json"] = _json_dump_like(man_raw, man)
    except ValueError as exc:
        raise ValueError(f"{src.name}:manifest.json {exc}") from exc
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as out:
        for info in infos:
            out.writestr(info, members[info.filename], compress_type=info.compress_type)
    tmp = dest.with_name(dest.name + ".tmp")
    tmp.write_bytes(buf.getvalue())
    tmp.replace(dest)
    return changed


def _relabel_example(flow_id: str) -> bool:
    path = EXAMPLES_DIR / f"{flow_id}.json"
    raw = path.read_bytes()
    flow = json.loads(raw.decode("utf-8"))
    name, desc = _labels_by_flow()[flow_id]
    if flow.get("name") == name and flow.get("description") == desc:
        return False
    flow["name"], flow["description"] = name, desc
    path.write_bytes(_json_dump_like(raw, flow))
    return True


def apply(bundles_dir: Path) -> int:
    problems = table_problems()
    if problems:
        for p in problems:
            fail(p)
        return 1
    for flow_id in [b[2] for b in BUILDERS] + list(HAND_EDITED_SOURCES):
        if _relabel_example(flow_id):
            print(f"relabelled examples/flows/{flow_id}.json")
    scan = _scan(bundles_dir)
    for bundle_id in ENTRYPOINT_LABELS:
        if bundle_id in NEW_VERSIONS:
            new_v, from_v = NEW_VERSIONS[bundle_id]
            if new_v not in (scan.get(bundle_id) or {}):
                sources = (scan.get(bundle_id) or {}).get(from_v) or []
                if len(sources) != 1:
                    fail(f"{bundle_id}@{from_v}: expected exactly one source file, found {len(sources)}")
                    return 1
                dest = bundles_dir / f"{bundle_id}@{new_v}.flow"
                changes = _relabel_zip(sources[0], dest, bundle_id, new_version=new_v)
                print(f"wrote {dest.name} from {sources[0].name}: {'; '.join(changes)}")
                scan = _scan(bundles_dir)
        version, files = _latest_files(scan, bundle_id)
        if not files:
            fail(f"{bundle_id}: no bundle in {bundles_dir}")
            return 1
        for path in files:
            changes = _relabel_zip(path, path, bundle_id)
            print(f"{path.name} ({bundle_id}@{version}): {'; '.join(changes) if changes else 'already labelled'}")
    return 0


def _load_module(filename: str):
    spec = importlib.util.spec_from_file_location(f"_labels_check_{filename[:-3]}", HERE / filename)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def check(bundles_dir: Path) -> int:
    errors: list[str] = list(table_problems())
    by_flow = _labels_by_flow()

    modules: dict[str, Any] = {}
    for filename, func, flow_id in BUILDERS:
        mod = modules.get(filename) or _load_module(filename)
        modules[filename] = mod
        builder: Callable[[], dict] = getattr(mod, func)
        flow = builder()
        want = by_flow[flow_id]
        got = (flow.get("name"), flow.get("description"))
        if flow.get("id") != flow_id:
            errors.append(f"{filename}:{func} builds flow {flow.get('id')!r}, expected {flow_id!r}")
        elif got != want:
            errors.append(f"{filename}:{func} emits name/description {got!r}, table says {want!r}")

    for flow_id in [b[2] for b in BUILDERS] + list(HAND_EDITED_SOURCES):
        path = EXAMPLES_DIR / f"{flow_id}.json"
        flow = json.loads(path.read_text(encoding="utf-8"))
        if (flow.get("name"), flow.get("description")) != by_flow[flow_id]:
            errors.append(f"examples/flows/{flow_id}.json: name/description differ from the table")

    scan = _scan(bundles_dir)
    for bundle_id in scan:
        if bundle_id not in ENTRYPOINT_LABELS:
            errors.append(f"{bundle_id}: shipped in {bundles_dir} but has no entry in workflow_labels.py")
    for bundle_id, labels in ENTRYPOINT_LABELS.items():
        version, files = _latest_files(scan, bundle_id)
        if not files:
            errors.append(f"{bundle_id}: no bundle in {bundles_dir}")
            continue
        if bundle_id in NEW_VERSIONS and version != NEW_VERSIONS[bundle_id][0]:
            errors.append(f"{bundle_id}: latest shipped is {version}, expected {NEW_VERSIONS[bundle_id][0]}")
        for path in files:
            with zipfile.ZipFile(path) as zf:
                man = json.loads(zf.read("manifest.json").decode("utf-8"))
                for ep in man.get("entrypoints") or []:
                    fid = str(ep.get("flow_id") or "")
                    want = labels.get(fid)
                    if want is None:
                        errors.append(f"{path.name}: entrypoint {fid!r} has no entry in workflow_labels.py")
                        continue
                    if (ep.get("name"), ep.get("description")) != want:
                        errors.append(f"{path.name}: manifest entrypoint {fid!r} carries {ep.get('name')!r} / {ep.get('description')!r}")
                    rel = (man.get("flows") or {}).get(fid)
                    if rel:
                        flow = json.loads(zf.read(rel).decode("utf-8"))
                        if (flow.get("name"), flow.get("description")) != want:
                            errors.append(f"{path.name}:{rel}: flow name/description differ from the table")
    if errors:
        for e in errors:
            fail(e)
        return 1
    count = sum(len(v) for v in ENTRYPOINT_LABELS.values())
    print(f"labels OK: {count} entrypoints in {len(ENTRYPOINT_LABELS)} bundles; build scripts, examples and latest shipped bundles agree")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=("apply", "check"))
    ap.add_argument("--bundles-dir", type=Path, required=True, help="the gateway's flows/bundles directory")
    args = ap.parse_args()
    bundles_dir = args.bundles_dir.expanduser().resolve()
    if not bundles_dir.is_dir():
        fail(f"bundles dir does not exist: {bundles_dir}")
        return 1
    if args.mode == "apply":
        rc = apply(bundles_dir)
        if rc:
            return rc
    return check(bundles_dir)


if __name__ == "__main__":
    sys.exit(main())
