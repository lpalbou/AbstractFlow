#!/usr/bin/env python3
"""Pack the deep-research bundle from the SHIPPED flow JSONs.

This is the durable publish path for deep-research: the editable JSONs in
examples/flows/ are the source of truth (they have drifted AHEAD of the
generator before — title instructions, branding — so re-running the
generator's main() risks regressions), but the bundle METADATA lives here,
imported from the generator module so there is exactly one copy.

Gateway's contract test (test_deep_research_bundle_contract.py) pins both the
graph contract and the metadata block; the 2026-07-16 rename repack dropped
metadata because the one-off pack call didn't pass it — this script exists so
that cannot happen again. Bump BUNDLE_VERSION when publishing a new wave.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "abstractruntime" / "src"))

BUNDLE_VERSION = "0.1.6"

_spec = importlib.util.spec_from_file_location("deep_gen", HERE / "build_deep_research_workflows.py")
_gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gen)


def bundle_metadata() -> dict:
    return {
        "family": "deep-research",
        "purpose": "production research with adversarial review and document export",
        "source_of_truth": {
            "process": "VisualFlow",
            "execution": "AbstractRuntime",
            "lifecycle": "AbstractGateway catalog",
            "routing": "AbstractCore capability defaults plus run overrides",
        },
        "control_policy": {
            "user_budget_control": "effort",
            "effort_values": ["quick", "standard", "thorough"],
            "outer_loop": "review_gated_while_with_effort_budget",
            "per_pass_agent_cap": "derived_settings.max_iterations",
            "deadline_minutes": "derived_settings.deadline_minutes_prompt_guidance",
            "max_sources": "derived_settings.max_sources_prompt_guidance",
        },
        "default_model_profile": {
            "default": "Gateway/AbstractCore defaults when provider/model are blank",
            "override_pins": ["provider", "model"],
            "role_policy": "planner, researcher, critics, and writer use the same optional override",
        },
        "outputs": [
            "markdown_report",
            "pdf_report",
            "docx_report",
            "research_run_manifest_v1",
            "research_source_ledger_v1",
            "claim_evidence_matrix_v1",
            "iteration_log_v1",
        ],
        "tool_policy": {
            "research_agents": _gen.READ_ONLY_TOOLS,
            "review_agents": [],
            "export": "deterministic write_file/write_pdf/write_docx nodes",
        },
    }


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
