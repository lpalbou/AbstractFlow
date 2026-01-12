from __future__ import annotations

from pathlib import Path

from abstractflow.workflow_bundle import pack_workflow_bundle
from abstractruntime.workflow_bundle import open_workflow_bundle
from abstractruntime.visualflow_compiler import compile_visualflow


def test_pack_workflow_bundle_creates_flow_zip_with_manifest_and_flows(tmp_path: Path) -> None:
    # Use a real shipped VisualFlow that includes subflows (ac-echo references multiple subflows).
    root = Path(__file__).resolve().parent.parent / "web" / "flows" / "ac-echo.json"
    assert root.exists()

    out = tmp_path / "ac-echo.flow"
    packed = pack_workflow_bundle(root_flow_json=root, out_path=out)
    assert packed.path.exists()

    b = open_workflow_bundle(out)
    man = b.manifest

    assert man.bundle_id == "ac-echo"
    assert man.bundle_format_version == "1"
    assert any(ep.flow_id == "ac-echo" for ep in man.entrypoints)
    assert man.default_entrypoint == "ac-echo"

    # Must include at least root + one subflow.
    assert "ac-echo" in man.flows
    assert len(man.flows) > 1
    assert man.artifacts == {}

    # Every declared flow must be readable and compile successfully.
    for flow_id, rel in man.flows.items():
        raw = b.read_json(rel)
        assert isinstance(raw, dict)
        spec = compile_visualflow(raw)
        assert spec.workflow_id == flow_id


def test_pack_workflow_bundle_embeds_manifest_metadata(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parent.parent / "web" / "flows" / "ac-echo.json"
    assert root.exists()

    out = tmp_path / "ac-echo-meta.flow"
    meta = {"lineage": {"origin": "ac-echo", "previous": "0.0.0"}, "tags": ["test"]}
    pack_workflow_bundle(root_flow_json=root, out_path=out, bundle_id="ac-echo", bundle_version="0.0.1", metadata=meta)

    b = open_workflow_bundle(out)
    assert b.manifest.bundle_id == "ac-echo"
    assert b.manifest.bundle_version == "0.0.1"
    assert b.manifest.metadata.get("lineage") == {"origin": "ac-echo", "previous": "0.0.0"}
    assert b.manifest.metadata.get("tags") == ["test"]
