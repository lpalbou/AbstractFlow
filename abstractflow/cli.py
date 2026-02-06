"""Command-line interface for AbstractFlow.

Current implemented features:
- WorkflowBundle (.flow) pack/inspect/unpack (backlog 314)

Other commands are intentionally kept minimal for now.
"""

from __future__ import annotations

import argparse
import json
import os
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

    serve = sub.add_parser("serve", help="Run the Visual Editor backend (FastAPI)")
    serve.add_argument("--host", default=os.getenv("HOST", "0.0.0.0"))
    serve.add_argument("--port", type=int, default=int(os.getenv("PORT", "8080")))
    serve.add_argument("--reload", action="store_true", help="Enable auto-reload (dev)")
    serve.add_argument("--log-level", default=os.getenv("LOG_LEVEL", "info"))
    serve.add_argument("--monitor-gpu", action="store_true", help="Show the small GPU widget in the UI")
    serve.add_argument(
        "--gateway-url",
        default=os.getenv("ABSTRACTFLOW_GATEWAY_URL") or os.getenv("ABSTRACTGATEWAY_URL") or "",
    )
    serve.add_argument(
        "--gateway-token",
        default=os.getenv("ABSTRACTFLOW_GATEWAY_AUTH_TOKEN")
        or os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN")
        or os.getenv("ABSTRACTCODE_GATEWAY_TOKEN")
        or "",
    )

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

    if ns.command == "serve":
        try:
            import uvicorn  # type: ignore
        except Exception:
            sys.stderr.write(
                "Server dependencies are not installed.\n"
                "Install with: pip install \"abstractflow[server]\"\n"
            )
            return 2

        # Validate backend import early so we can give a clear error message.
        try:
            import backend.main  # noqa: F401
        except Exception as e:
            sys.stderr.write(
                "Failed to import the Visual Editor backend.\n"
                f"Error: {e}\n"
                "Install with: pip install \"abstractflow[server]\"\n"
            )
            return 2

        if bool(getattr(ns, "monitor_gpu", False)):
            os.environ["ABSTRACTFLOW_MONITOR_GPU"] = "1"

        gateway_url = str(getattr(ns, "gateway_url", "") or "").strip()
        gateway_token = str(getattr(ns, "gateway_token", "") or "").strip()
        if gateway_url:
            os.environ.setdefault("ABSTRACTFLOW_GATEWAY_URL", gateway_url)
            os.environ.setdefault("ABSTRACTGATEWAY_URL", gateway_url)
        if gateway_token:
            os.environ.setdefault("ABSTRACTGATEWAY_AUTH_TOKEN", gateway_token)
            os.environ.setdefault("ABSTRACTFLOW_GATEWAY_AUTH_TOKEN", gateway_token)

        uvicorn.run(
            "backend.main:app",
            host=str(getattr(ns, "host", "0.0.0.0")),
            port=int(getattr(ns, "port", 8080)),
            reload=bool(getattr(ns, "reload", False)),
            log_level=str(getattr(ns, "log_level", "info")),
        )
        return 0

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

