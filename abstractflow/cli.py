"""Command-line interface for AbstractFlow.

Current implemented features:
- WorkflowBundle (.flow) pack/inspect/unpack (backlog 314)

Other commands are intentionally kept minimal for now.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import List, Optional

from .workflow_bundle import inspect_workflow_bundle, pack_workflow_bundle, unpack_workflow_bundle
from abstractruntime.workflow_bundle import workflow_bundle_manifest_to_dict


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="abstractflow", add_help=True)
    sub = p.add_subparsers(dest="command")

    bundle = sub.add_parser("bundle", help="WorkflowBundle (.flow) tools")
    bundle_sub = bundle.add_subparsers(dest="bundle_cmd")

    pack = bundle_sub.add_parser("pack", help="Pack a .flow bundle from a root VisualFlow JSON file")
    pack.add_argument("root", help="Path to root VisualFlow JSON (e.g., ./flows/<id>.json)")
    pack.add_argument("--out", required=True, help="Output .flow path")
    pack.add_argument("--bundle-id", default=None, help="Bundle id (default: root flow id)")
    pack.add_argument("--bundle-version", default="0.0.0", help="Bundle version (default: 0.0.0)")
    pack.add_argument("--flows-dir", default=None, help="Directory containing flow JSON files (default: root's directory)")
    pack.add_argument(
        "--entrypoint",
        action="append",
        default=None,
        help="Entrypoint flow id (repeatable). Default: root flow id",
    )

    insp = bundle_sub.add_parser("inspect", help="Print bundle manifest (JSON)")
    insp.add_argument("bundle", help="Path to .flow (zip) or extracted directory")

    unpack = bundle_sub.add_parser("unpack", help="Extract a .flow bundle to a directory")
    unpack.add_argument("bundle", help="Path to .flow (zip) or extracted directory")
    unpack.add_argument("--dir", required=True, help="Output directory")

    return p


def main(args: Optional[List[str]] = None) -> int:
    if args is None:
        args = sys.argv[1:]

    parser = _build_parser()
    ns = parser.parse_args(args)

    if ns.command == "bundle":
        if ns.bundle_cmd == "pack":
            packed = pack_workflow_bundle(
                root_flow_json=ns.root,
                out_path=ns.out,
                bundle_id=ns.bundle_id,
                bundle_version=ns.bundle_version,
                flows_dir=ns.flows_dir,
                entrypoints=list(ns.entrypoint) if isinstance(ns.entrypoint, list) and ns.entrypoint else None,
            )
            sys.stdout.write(str(packed.path) + "\n")
            return 0

        if ns.bundle_cmd == "inspect":
            man = inspect_workflow_bundle(bundle_path=ns.bundle)
            sys.stdout.write(json.dumps(workflow_bundle_manifest_to_dict(man), indent=2, ensure_ascii=False) + "\n")
            return 0

        if ns.bundle_cmd == "unpack":
            out = unpack_workflow_bundle(bundle_path=ns.bundle, out_dir=ns.dir)
            sys.stdout.write(str(out) + "\n")
            return 0

        parser.error("Missing bundle subcommand (pack|inspect|unpack)")

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


