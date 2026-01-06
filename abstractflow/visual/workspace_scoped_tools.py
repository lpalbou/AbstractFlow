"""Workspace-scoped tool execution helpers.

These are host-friendly utilities to scope filesystem-ish tool calls (files + shell)
to a single "workspace root" folder:

- Relative paths resolve under `workspace_root`.
- Absolute paths are only allowed if they remain under `workspace_root`.
- `execute_command` defaults to `working_directory=workspace_root` when not specified.

This is implemented as a thin wrapper around an AbstractRuntime ToolExecutor that
rewrites/validates tool call arguments before delegating.
"""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def _resolve_no_strict(path: Path) -> Path:
    """Resolve without requiring the path to exist (best-effort across py versions)."""
    try:
        return path.resolve(strict=False)
    except TypeError:  # pragma: no cover (older python)
        return path.resolve()


def _find_repo_root_from_here(*, start: Path, max_hops: int = 10) -> Optional[Path]:
    """Best-effort monorepo root detection for local/dev runs."""
    cur = _resolve_no_strict(start)
    for _ in range(max_hops):
        docs = cur / "docs" / "KnowledgeBase.md"
        if docs.exists():
            return cur
        if (cur / "abstractflow").exists() and (cur / "abstractcore").exists() and (cur / "abstractruntime").exists():
            return cur
        nxt = cur.parent
        if nxt == cur:
            break
        cur = nxt
    return None


def resolve_workspace_base_dir() -> Path:
    """Base directory against which relative workspace roots are resolved.

    Priority:
    - `ABSTRACTFLOW_WORKSPACE_BASE_DIR` env var, if set.
    - Best-effort monorepo root detection from this file location.
    - Current working directory.
    """
    env = os.getenv("ABSTRACTFLOW_WORKSPACE_BASE_DIR")
    if isinstance(env, str) and env.strip():
        return _resolve_no_strict(Path(env.strip()).expanduser())

    here_dir = Path(__file__).resolve().parent
    guessed = _find_repo_root_from_here(start=here_dir)
    if guessed is not None:
        return guessed

    return _resolve_no_strict(Path.cwd())


def _resolve_under_root(*, root: Path, user_path: str) -> Path:
    """Resolve a user-provided path under a workspace root and ensure it doesn't escape."""
    p = Path(str(user_path or "").strip()).expanduser()
    if not p.is_absolute():
        p = root / p
    resolved = _resolve_no_strict(p)
    root_resolved = _resolve_no_strict(root)
    try:
        resolved.relative_to(root_resolved)
    except Exception as e:
        raise ValueError(f"Path escapes workspace_root: '{user_path}'") from e
    return resolved


def _normalize_arguments(raw: Any) -> Dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return dict(raw)
    # Some models emit JSON strings for args.
    if isinstance(raw, str) and raw.strip():
        import json

        try:
            parsed = json.loads(raw)
        except Exception:
            return {}
        return dict(parsed) if isinstance(parsed, dict) else {}
    return {}


@dataclass(frozen=True)
class WorkspaceScope:
    root: Path

    @classmethod
    def from_input_data(
        cls, input_data: Dict[str, Any], *, key: str = "workspace_root", base_dir: Optional[Path] = None
    ) -> Optional["WorkspaceScope"]:
        raw = input_data.get(key)
        if not isinstance(raw, str) or not raw.strip():
            return None
        base = base_dir or resolve_workspace_base_dir()
        root = Path(raw.strip()).expanduser()
        if not root.is_absolute():
            root = base / root
        root = _resolve_no_strict(root)
        if root.exists() and not root.is_dir():
            raise ValueError(f"workspace_root must be a directory (got file): {raw}")
        root.mkdir(parents=True, exist_ok=True)
        return cls(root=root)


class WorkspaceScopedToolExecutor:
    """Wrap another ToolExecutor and scope filesystem-ish tool calls to a workspace root."""

    def __init__(self, *, scope: WorkspaceScope, delegate: Any):
        self._scope = scope
        self._delegate = delegate

    def set_timeout_s(self, timeout_s: Optional[float]) -> None:  # pragma: no cover (depends on delegate)
        setter = getattr(self._delegate, "set_timeout_s", None)
        if callable(setter):
            setter(timeout_s)

    def execute(self, *, tool_calls: List[Dict[str, Any]]) -> Dict[str, Any]:
        # Preprocess: rewrite and pre-block invalid calls so we don't crash the whole run.
        blocked: Dict[Tuple[int, str], Dict[str, Any]] = {}
        to_execute: List[Dict[str, Any]] = []

        for i, tc in enumerate(tool_calls or []):
            name = str(tc.get("name", "") or "")
            call_id = str(tc.get("call_id") or tc.get("id") or f"call_{i}")
            args = _normalize_arguments(tc.get("arguments"))

            try:
                rewritten_args = self._rewrite_args(tool_name=name, args=args)
            except Exception as e:
                blocked[(i, call_id)] = {
                    "call_id": call_id,
                    "name": name,
                    "success": False,
                    "output": None,
                    "error": str(e),
                }
                continue

            rewritten = dict(tc)
            rewritten["name"] = name
            rewritten["call_id"] = call_id
            rewritten["arguments"] = rewritten_args
            to_execute.append(rewritten)

        delegate_result = self._delegate.execute(tool_calls=to_execute)

        # If the delegate didn't execute tools, we can't merge blocked results meaningfully.
        if not isinstance(delegate_result, dict) or delegate_result.get("mode") != "executed":
            return delegate_result

        results = delegate_result.get("results")
        if not isinstance(results, list):
            results = []

        by_id: Dict[str, Dict[str, Any]] = {}
        for r in results:
            if not isinstance(r, dict):
                continue
            rid = str(r.get("call_id") or "")
            if rid:
                by_id[rid] = r

        merged: List[Dict[str, Any]] = []
        for i, tc in enumerate(tool_calls or []):
            call_id = str(tc.get("call_id") or tc.get("id") or f"call_{i}")
            key = (i, call_id)
            if key in blocked:
                merged.append(blocked[key])
                continue
            r = by_id.get(call_id)
            if r is None:
                merged.append(
                    {
                        "call_id": call_id,
                        "name": str(tc.get("name", "") or ""),
                        "success": False,
                        "output": None,
                        "error": "Tool result missing (internal error)",
                    }
                )
                continue
            merged.append(r)

        return {"mode": "executed", "results": merged}

    def _rewrite_args(self, *, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """Rewrite tool args so file operations are scoped under workspace_root."""
        root = self._scope.root
        out = dict(args or {})

        def _rewrite_path_field(field: str, *, default_to_root: bool = False) -> None:
            raw = out.get(field)
            if (raw is None or (isinstance(raw, str) and not raw.strip())) and default_to_root:
                out[field] = str(_resolve_no_strict(root))
                return
            if raw is None:
                return
            if not isinstance(raw, str):
                raw = str(raw)
            resolved = _resolve_under_root(root=root, user_path=raw)
            out[field] = str(resolved)

        # Filesystem-ish tools (AbstractCore common tools)
        if tool_name == "list_files":
            _rewrite_path_field("directory_path", default_to_root=True)
            return out
        if tool_name == "search_files":
            _rewrite_path_field("path", default_to_root=True)
            return out
        if tool_name == "analyze_code":
            _rewrite_path_field("file_path")
            if "file_path" not in out:
                raise ValueError("analyze_code requires file_path")
            return out
        if tool_name == "read_file":
            _rewrite_path_field("file_path")
            if "file_path" not in out:
                raise ValueError("read_file requires file_path")
            return out
        if tool_name == "write_file":
            _rewrite_path_field("file_path")
            if "file_path" not in out:
                raise ValueError("write_file requires file_path")
            return out
        if tool_name == "edit_file":
            _rewrite_path_field("file_path")
            if "file_path" not in out:
                raise ValueError("edit_file requires file_path")
            return out
        if tool_name == "execute_command":
            _rewrite_path_field("working_directory", default_to_root=True)
            return out

        return out


def build_scoped_tool_executor(*, scope: WorkspaceScope) -> Any:
    """Create a local tool executor wrapped with workspace scoping."""
    from abstractruntime.integrations.abstractcore.default_tools import get_default_tools
    from abstractruntime.integrations.abstractcore.tool_executor import MappingToolExecutor

    delegate = MappingToolExecutor.from_tools(get_default_tools())
    return WorkspaceScopedToolExecutor(scope=scope, delegate=delegate)




