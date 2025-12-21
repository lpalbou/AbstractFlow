from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import tempfile


def test_web_backend_dev_import_paths_prioritize_runtime_src() -> None:
    """Ensure `cd abstractflow/web && PYTHONPATH=. uvicorn backend.main:app` is stable.

    Regression: importing AbstractFlow backend in a monorepo can accidentally
    resolve `abstractruntime` to a partial/shadowed package that lacks submodules
    like `abstractruntime.scheduler`.
    """

    repo_root = Path(__file__).resolve().parents[2]
    web_dir = repo_root / "abstractflow" / "web"

    with tempfile.TemporaryDirectory() as tmp:
        shadow = Path(tmp) / "abstractruntime"
        shadow.mkdir(parents=True, exist_ok=True)
        (shadow / "__init__.py").write_text("__version__ = '0.0.0'\n", encoding="utf-8")

        env = dict(os.environ)
        env["PYTHONPATH"] = os.pathsep.join([tmp, "."])

        code = (
            "import backend\n"
            "import abstractruntime\n"
            "import abstractruntime.scheduler\n"
            "print(abstractruntime.__file__)\n"
        )
        proc = subprocess.run(
            [sys.executable, "-c", code],
            cwd=str(web_dir),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

        assert proc.returncode == 0, proc.stderr
        expected = repo_root / "abstractruntime" / "src" / "abstractruntime" / "__init__.py"
        assert str(expected) in proc.stdout

