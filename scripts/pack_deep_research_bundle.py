#!/usr/bin/env python3
"""Pack the deep-research bundle from the SHIPPED flow JSONs.

This is the durable publish path for deep-research: the editable JSONs in
examples/flows/ are the source of truth, but the bundle METADATA lives in
the generator module so there is exactly one copy. Historical note: the
JSONs once drifted AHEAD of the generator (artifact registration nodes,
end artifact-id pins) which made re-running the generator's main() risky;
the 2026-07-20 layout/dead-node wave folded that drift back, so generator
and shipped JSONs are in sync again — keep them that way.

Gateway's contract test (test_deep_research_bundle_contract.py) pins both the
graph contract and the metadata block; the 2026-07-16 rename repack dropped
metadata because the one-off pack call didn't pass it — this script exists so
that cannot happen again. Bump BUNDLE_VERSION (in build_deep_research_workflows.py) when publishing a new wave.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "abstractruntime" / "src"))

_spec = importlib.util.spec_from_file_location("deep_gen", HERE / "build_deep_research_workflows.py")
_gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gen)

# One copy: the generator owns the version (bump it there for a new wave).
BUNDLE_VERSION = _gen.BUNDLE_VERSION


def bundle_metadata() -> dict:
    # One copy: the generator owns the metadata block (2026-07-20 dedup —
    # the literal used to be duplicated here and in the generator's main()).
    return _gen.bundle_metadata()


def main() -> int:
    from abstractruntime.workflow_bundle import pack_workflow_bundle

    flows_dir = ROOT / "abstractflow" / "examples" / "flows"
    out = ROOT / "abstractgateway" / "flows" / "bundles" / f"deep-research@{BUNDLE_VERSION}.flow"
    pack_workflow_bundle(
        root_flow_json=flows_dir / "deep-research.json",
        out_path=out,
        bundle_id="deep-research",
        bundle_version=BUNDLE_VERSION,
        flows_dir=flows_dir,
        entrypoints=["deep-research"],
        default_entrypoint="deep-research",
        metadata=bundle_metadata(),
    )
    print(f"packed {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
