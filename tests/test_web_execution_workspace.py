from __future__ import annotations

from pathlib import Path


def test_default_workspace_root_creates_hidden_run_dir_and_alias(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_BASE_EXECUTION", str(tmp_path))

    from web.backend.services.execution_workspace import ensure_default_workspace_root, ensure_run_id_workspace_alias

    input_data: dict = {}
    workspace_dir = ensure_default_workspace_root(input_data)
    assert workspace_dir is not None
    assert workspace_dir.exists() and workspace_dir.is_dir()
    assert str(workspace_dir).startswith(str(tmp_path))
    assert ".abstractflow" in str(workspace_dir)
    assert input_data.get("workspace_root") == str(workspace_dir)

    run_id = "11111111-2222-3333-4444-555555555555"
    alias = ensure_run_id_workspace_alias(run_id=run_id, workspace_dir=workspace_dir)
    assert alias is not None
    assert alias.exists()

    # On POSIX hosts, this is expected to be a symlink. On platforms where symlinks
    # are unavailable, the helper falls back to creating a pointer file.
    if alias.is_symlink():
        assert alias.resolve() == workspace_dir.resolve()
    else:
        pointer = alias / "WORKSPACE_POINTER.txt"
        assert pointer.exists()
        text = pointer.read_text(encoding="utf-8")
        assert str(workspace_dir) in text

