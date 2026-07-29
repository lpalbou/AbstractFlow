#!/usr/bin/env python3
"""Remove gateway visualflow rows that are Toolbar/Rename duplicate spam.

The Flow Library now hides names ending in `` (copy)`` at merge time
(see ``isLibraryDuplicateCopy`` in src/utils/bundledFlows.ts). This script
deletes those rows from the gateway store so the operator's library is clean
server-side too.

Default is dry-run. Pass ``--apply`` to DELETE.

Env:
  ABSTRACTGATEWAY_URL (default http://127.0.0.1:8080)
  ABSTRACTGATEWAY_AUTH_TOKEN or ~/.abstractassistant/gateway_connection.json

Examples:
  python3 scripts/cleanup_gateway_flow_copies.py
  python3 scripts/cleanup_gateway_flow_copies.py --family multiagent
  python3 scripts/cleanup_gateway_flow_copies.py --apply
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

GATEWAY_URL = os.environ.get("ABSTRACTGATEWAY_URL", "http://127.0.0.1:8080").rstrip("/")
LIST_PATH = "/api/gateway/visualflows"
ITEM_PATH = "/api/gateway/visualflows/{flow_id}"

# Keep in sync with src/utils/bundledFlows.ts isLibraryDuplicateCopy().
COPY_NAME_RE = re.compile(r"\s\(copy\)(?:\s*\(copy\))*$", re.IGNORECASE)


def is_duplicate_copy_name(name: str) -> bool:
    return bool(COPY_NAME_RE.search(str(name or "").strip()))


def gateway_token() -> str:
    tok = os.environ.get("ABSTRACTGATEWAY_AUTH_TOKEN", "").strip()
    if tok:
        return tok
    conn = Path.home() / ".abstractassistant" / "gateway_connection.json"
    try:
        return str(json.loads(conn.read_text(encoding="utf-8")).get("auth_token") or "")
    except Exception:
        return ""


def http_json(method: str, path: str, token: str, body: dict[str, Any] | None = None) -> Any:
    url = f"{GATEWAY_URL}{path}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} -> HTTP {exc.code}: {detail[:400]}") from exc


def list_visualflows(token: str) -> list[dict[str, Any]]:
    data = http_json("GET", LIST_PATH, token)
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        rows = data.get("flows") or data.get("items") or data.get("visualflows")
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    raise RuntimeError(f"unexpected visualflows list shape: {type(data).__name__}")


def matches_family(row: dict[str, Any], family: str | None) -> bool:
    if not family:
        return True
    needle = family.strip().lower().replace("-", "")
    if not needle:
        return True
    hay = f"{row.get('id') or ''}\n{row.get('name') or ''}".lower().replace("-", "")
    return needle in hay


def select_copy_rows(rows: list[dict[str, Any]], family: str | None) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for row in rows:
        name = str(row.get("name") or "")
        if not is_duplicate_copy_name(name):
            continue
        if not matches_family(row, family):
            continue
        selected.append(row)
    selected.sort(key=lambda row: (str(row.get("name") or "").lower(), str(row.get("id") or "")))
    return selected


def _flow_payload(detail: Any) -> dict[str, Any] | None:
    if isinstance(detail, dict) and isinstance(detail.get("nodes"), list):
        return detail
    if isinstance(detail, dict) and isinstance(detail.get("flow"), dict):
        flow = detail["flow"]
        if isinstance(flow.get("nodes"), list):
            return flow
    return None


def extract_subflow_refs(flow: dict[str, Any]) -> set[str]:
    refs: set[str] = set()
    for node in flow.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        data = node.get("data") or {}
        if str(data.get("nodeType") or "") != "subflow":
            continue
        for key in ("subflowId", "flowId", "workflowId"):
            for source in (data, data.get("pinDefaults") or {}):
                if not isinstance(source, dict):
                    continue
                val = source.get(key)
                if isinstance(val, str) and val.strip():
                    refs.add(val.strip())
    return refs


def referenced_subflow_ids(rows: list[dict[str, Any]], token: str) -> set[str]:
    """Subflow ids referenced by any non-(copy) gateway row (live family helpers)."""
    refs: set[str] = set()
    for row in rows:
        if is_duplicate_copy_name(str(row.get("name") or "")):
            continue
        flow_id = str(row.get("id") or "").strip()
        if not flow_id:
            continue
        try:
            detail = http_json("GET", ITEM_PATH.format(flow_id=flow_id), token)
        except Exception:
            continue
        payload = _flow_payload(detail)
        if payload:
            refs.update(extract_subflow_refs(payload))
    return refs


def partition_deletable(
    targets: list[dict[str, Any]], referenced: set[str]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    deletable: list[dict[str, Any]] = []
    protected: list[dict[str, Any]] = []
    for row in targets:
        flow_id = str(row.get("id") or "").strip()
        if flow_id and flow_id in referenced:
            protected.append(row)
        else:
            deletable.append(row)
    return deletable, protected


def main() -> int:
    parser = argparse.ArgumentParser(description="Delete gateway visualflow (copy) duplicate rows.")
    parser.add_argument(
        "--family",
        default="",
        help="Optional substring filter (e.g. multiagent) on id+name before deleting.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Perform DELETE. Default is dry-run (list only).",
    )
    args = parser.parse_args()
    family = args.family.strip() or None

    token = gateway_token()
    if not token:
        print("ERROR: no gateway token (ABSTRACTGATEWAY_AUTH_TOKEN or gateway_connection.json)", file=sys.stderr)
        return 2

    try:
        rows = list_visualflows(token)
    except Exception as exc:
        print(f"ERROR: cannot list visualflows at {GATEWAY_URL}: {exc}", file=sys.stderr)
        return 2

    targets = select_copy_rows(rows, family)
    referenced = referenced_subflow_ids(rows, token)
    deletable, protected = partition_deletable(targets, referenced)
    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"{mode}: gateway={GATEWAY_URL} total={len(rows)} copy_rows={len(targets)}"
          + (f" family={family!r}" if family else "")
          + f" deletable={len(deletable)} protected={len(protected)}")

    if protected:
        print("Protected (still referenced by a non-(copy) flow):")
        for row in protected:
            print(f"  keep: {row.get('id')}  {str(row.get('name') or '').strip()!r}")

    if not deletable:
        print("Nothing to delete.")
        return 0

    deleted = 0
    for row in deletable:
        flow_id = str(row.get("id") or "").strip()
        name = str(row.get("name") or "").strip()
        if not flow_id:
            print(f"  SKIP (no id): {name!r}")
            continue
        if not args.apply:
            print(f"  would delete: {flow_id}  {name!r}")
            continue
        try:
            http_json("DELETE", ITEM_PATH.format(flow_id=flow_id), token)
            deleted += 1
            print(f"  deleted: {flow_id}  {name!r}")
        except Exception as exc:
            print(f"  FAIL {flow_id} {name!r}: {exc}", file=sys.stderr)

    if args.apply:
        print(f"Deleted {deleted}/{len(deletable)} copy row(s).")
    else:
        print("Re-run with --apply to delete.")
    return 0 if deleted == len(deletable) or not args.apply else 1


if __name__ == "__main__":
    sys.exit(main())
