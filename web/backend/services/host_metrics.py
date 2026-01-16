from __future__ import annotations

import datetime
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from typing import Any, Dict, List, Optional


_CACHE_LOCK = threading.Lock()
_CACHE_AT_S: float = 0.0
_CACHE_VALUE: Optional[Dict[str, Any]] = None


def _utc_now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _parse_nvidia_smi_csv(text: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for raw_line in str(text or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 3:
            continue
        try:
            idx = int(parts[0])
        except Exception:
            continue
        name = parts[1]
        try:
            util = float(parts[2])
        except Exception:
            util = None
        out.append({"index": idx, "name": name, "utilization_gpu_pct": util})
    return out


def _read_nvidia_smi_gpu_metrics(*, timeout_s: float = 1.0) -> Dict[str, Any]:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return {"supported": False, "reason": "nvidia-smi not available"}

    cmd = [
        exe,
        "--query-gpu=index,name,utilization.gpu",
        "--format=csv,noheader,nounits",
    ]

    try:
        p = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=float(timeout_s),
            check=False,
        )
    except Exception as e:
        return {"supported": False, "reason": f"nvidia-smi failed: {e}"}

    if p.returncode != 0:
        stderr = (p.stderr or "").strip()
        detail = f" (exit={p.returncode})"
        if stderr:
            detail = f"{detail}: {stderr}"
        return {"supported": False, "reason": f"nvidia-smi error{detail}"}

    gpus = _parse_nvidia_smi_csv(p.stdout or "")
    vals = [g.get("utilization_gpu_pct") for g in gpus if isinstance(g.get("utilization_gpu_pct"), (int, float))]
    utilization: Optional[float] = None
    if vals:
        utilization = float(sum(vals) / len(vals))

    return {
        "supported": True,
        "source": "nvidia-smi",
        "utilization_gpu_pct": utilization,
        "gpus": gpus,
    }


_IOREG_ENTRY_HEADER_RE = re.compile(r"^\\+\\-o\\s+([^\\s<]+)\\s+<class\\s+([^,>]+)")
_IOREG_MODEL_RE = re.compile(r'"model"\\s*=\\s*"([^"]+)"')
_IOREG_PERF_STATS_RE = re.compile(r'"PerformanceStatistics"\\s*=\\s*\\{(.*?)\\}', re.DOTALL)
_IOREG_KV_RE = re.compile(r'"([^"]+)"\\s*=\\s*([^,}]+)')


def _coerce_number(value: str) -> Optional[float]:
    s = str(value or "").strip()
    if not s:
        return None
    if s.startswith("<") or s.startswith("("):
        return None
    try:
        if "." in s:
            return float(s)
        return float(int(s))
    except Exception:
        return None


def _parse_ioreg_ioaccelerator_output(text: str) -> List[Dict[str, Any]]:
    entries: list[str] = []
    cur: list[str] = []
    for line in str(text or "").splitlines():
        if line.startswith("+-o "):
            if cur:
                entries.append("\n".join(cur))
            cur = [line]
        else:
            if cur:
                cur.append(line)
    if cur:
        entries.append("\n".join(cur))

    gpus: List[Dict[str, Any]] = []
    for entry in entries:
        header = entry.splitlines()[0] if entry else ""
        m = _IOREG_ENTRY_HEADER_RE.match(header)
        if m:
            obj_name = m.group(1)
            cls_name = m.group(2)
        else:
            obj_name = ""
            cls_name = ""

        model_m = _IOREG_MODEL_RE.search(entry)
        model = model_m.group(1) if model_m else ""

        perf_m = _IOREG_PERF_STATS_RE.search(entry)
        if not perf_m:
            continue
        body = perf_m.group(1)

        stats: Dict[str, Any] = {}
        for k, v_raw in _IOREG_KV_RE.findall(body):
            num = _coerce_number(v_raw)
            stats[k] = num if num is not None else str(v_raw).strip()

        if not any(k in stats for k in ("Device Utilization %", "Renderer Utilization %", "Tiler Utilization %")):
            continue

        dev = stats.get("Device Utilization %")
        rend = stats.get("Renderer Utilization %")
        tiler = stats.get("Tiler Utilization %")

        gpus.append(
            {
                "index": len(gpus),
                "name": (model or obj_name or cls_name or "GPU").strip() or "GPU",
                "utilization_gpu_pct": dev if isinstance(dev, (int, float)) else None,
                "renderer_utilization_pct": rend if isinstance(rend, (int, float)) else None,
                "tiler_utilization_pct": tiler if isinstance(tiler, (int, float)) else None,
            }
        )

    return gpus


def _read_ioreg_gpu_metrics(*, timeout_s: float = 1.0) -> Dict[str, Any]:
    exe = shutil.which("ioreg") or "/usr/sbin/ioreg"
    if not exe:
        return {"supported": False, "reason": "ioreg not available"}

    cmd = [exe, "-r", "-c", "IOAccelerator", "-l"]
    try:
        p = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=float(timeout_s),
            check=False,
        )
    except Exception as e:
        return {"supported": False, "reason": f"ioreg failed: {e}"}

    if p.returncode != 0:
        stderr = (p.stderr or "").strip()
        detail = f" (exit={p.returncode})"
        if stderr:
            detail = f"{detail}: {stderr}"
        return {"supported": False, "reason": f"ioreg error{detail}"}

    gpus = _parse_ioreg_ioaccelerator_output(p.stdout or "")
    if not gpus:
        return {"supported": False, "reason": "IOAccelerator performance stats not found"}

    vals = [g.get("utilization_gpu_pct") for g in gpus if isinstance(g.get("utilization_gpu_pct"), (int, float))]
    utilization: Optional[float] = None
    if vals:
        utilization = float(sum(vals) / len(vals))

    return {
        "supported": True,
        "source": "ioreg",
        "utilization_gpu_pct": utilization,
        "gpus": gpus,
    }


def _read_host_gpu_metrics_best_effort(*, timeout_s: float = 1.0) -> Dict[str, Any]:
    provider_raw = str(
        os.getenv("ABSTRACTFLOW_GPU_METRICS_PROVIDER")
        or os.getenv("ABSTRACTGATEWAY_GPU_METRICS_PROVIDER")
        or "auto"
    ).strip().lower()
    if provider_raw in {"0", "off", "false", "none", "disabled"}:
        return {"supported": False, "reason": "disabled"}

    if provider_raw not in {"auto", "nvidia-smi", "nvidia", "ioreg", "macos"}:
        return {"supported": False, "reason": f"unknown provider '{provider_raw}'"}

    if provider_raw == "auto":
        providers = ["ioreg", "nvidia-smi"] if sys.platform == "darwin" else ["nvidia-smi", "ioreg"]
    elif provider_raw in {"nvidia", "nvidia-smi"}:
        providers = ["nvidia-smi"]
    else:
        providers = ["ioreg"]

    reasons: list[str] = []
    for p in providers:
        payload = _read_ioreg_gpu_metrics(timeout_s=timeout_s) if p == "ioreg" else _read_nvidia_smi_gpu_metrics(timeout_s=timeout_s)

        if payload.get("supported") is True:
            return payload
        r = payload.get("reason")
        if isinstance(r, str) and r.strip():
            reasons.append(r.strip())

    return {"supported": False, "reason": "; ".join(reasons) if reasons else "unsupported"}


def get_host_gpu_metrics(*, cache_ttl_s: float = 0.5) -> Dict[str, Any]:
    """Return best-effort host GPU utilization metrics.

    Dependency-light:
    - macOS: reads IORegistry IOAccelerator PerformanceStatistics via `ioreg`
    - NVIDIA: reads utilization via `nvidia-smi`
    """

    global _CACHE_AT_S, _CACHE_VALUE

    ttl = max(0.0, float(cache_ttl_s))
    now = time.time()

    if ttl > 0:
        with _CACHE_LOCK:
            if _CACHE_VALUE is not None and (now - _CACHE_AT_S) <= ttl:
                return dict(_CACHE_VALUE)

    payload = _read_host_gpu_metrics_best_effort(timeout_s=1.0)
    out: Dict[str, Any] = {"ts": _utc_now_iso(), **payload}

    if ttl > 0:
        with _CACHE_LOCK:
            _CACHE_AT_S = now
            _CACHE_VALUE = dict(out)

    return out

