"""Local/dev runner for the AbstractFlow web backend.

Why:
- `uvicorn` rejects unknown flags, so we can't do `uvicorn ... --monitor-gpu`.
- We still want a simple CLI switch (`--monitor-gpu`) for local runs.
"""

from __future__ import annotations

import argparse
import os

import uvicorn


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="python -m backend", add_help=True)
    p.add_argument("--host", default=os.getenv("HOST", "0.0.0.0"))
    p.add_argument("--port", type=int, default=int(os.getenv("PORT", "8080")))
    p.add_argument("--reload", action="store_true", help="Enable auto-reload (dev)")
    p.add_argument("--log-level", default=os.getenv("LOG_LEVEL", "info"))
    p.add_argument("--monitor-gpu", action="store_true", help="Show the small GPU widget in the UI")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)

    if args.monitor_gpu:
        os.environ["ABSTRACTFLOW_MONITOR_GPU"] = "1"

    uvicorn.run(
        "backend.main:app",
        host=str(args.host),
        port=int(args.port),
        reload=bool(args.reload),
        log_level=str(args.log_level),
    )


if __name__ == "__main__":
    main()

