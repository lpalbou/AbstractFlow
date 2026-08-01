#!/usr/bin/env python3
"""Head-to-head benchmark of the CODING orchestrations through the live gateway.

Every arm implements the same `abstractcode.coding.v1` contract
(`request` + `workspace_root` in -> report/passed out), so the ONLY variable is
the orchestration: how many models, in what topology, with what verification.

    arm            bundle                    what it is
    -------------- ------------------------- -------------------------------------
    baseline       basic-agent@0.0.3         ONE agent node, no verification loop
    coding-agent   coding-agent@0.2.4        agent + deterministic verify gates + fix loop
    multiagent     multiagent-coding@0.0.16  scouts -> planner -> builder -> verify -> doc -> PR
    react-coder    react-coding@0.1.0        hand-wired llm_call+tool_calls ReAct loop
    ralph-coder    ralph-coding@0.1.0        fixed prompt, FRESH context each cycle, workspace-as-memory

Grading is deterministic and cheat-proof: every task ships a `verify.py`
(or `test_*.py`) that the harness RESTORES from the pristine fixture before
running it, so an arm that "fixes" the test instead of the code still fails.

Usage:
    python3 scripts/benchmark_orchestrations.py --arms all --tasks all --seeds 1
    python3 scripts/benchmark_orchestrations.py --list
    python3 scripts/benchmark_orchestrations.py --arms react-coder --tasks bugfix --steer

Env:
    BENCH_TOKEN     gateway bearer token (required)
    BENCH_GATEWAY   default http://127.0.0.1:8080
    BENCH_PROVIDER  default endpoint:airelay
    BENCH_MODEL     default gpt-5.4-mini
    BENCH_DEADLINE  per-run seconds, default 900

Results land in untracked/benchmarks/orchestrations/<timestamp>/.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO = Path(__file__).resolve().parents[1]
GATEWAY = os.environ.get("BENCH_GATEWAY", "http://127.0.0.1:8080")
TOKEN = os.environ.get("BENCH_TOKEN", "")
PROVIDER = os.environ.get("BENCH_PROVIDER", "endpoint:airelay")
MODEL = os.environ.get("BENCH_MODEL", "gpt-5.4-mini")
DEADLINE_S = int(os.environ.get("BENCH_DEADLINE", "900"))
# Workspaces must live under an operator-allowed root or the gateway silently
# drops `workspace_root` and the run writes into a random per-run directory.
WS_BASE = Path(os.environ.get("BENCH_WS_BASE", "/Users/albou/tmp/abstractframework/runtime/workspaces"))
PYBIN = os.environ.get("BENCH_PYTHON", sys.executable or "python3")


# --------------------------------------------------------------------------
# gateway client
# --------------------------------------------------------------------------
def _headers() -> Dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def api(path: str, method: str = "GET", body: Any = None, timeout: int = 60) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(GATEWAY + path, data=data, headers=_headers(), method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as fh:
            return json.loads(fh.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        return {"__http_error__": exc.code, "detail": exc.read().decode()[:600]}
    except Exception as exc:  # noqa: BLE001 - network flakiness must not kill a matrix
        return {"__error__": str(exc)[:300]}


# --------------------------------------------------------------------------
# tasks — each ships pristine fixtures; `protected` files are restored before grading
# --------------------------------------------------------------------------
COUNTER_VERIFY = r'''#!/usr/bin/env python3
"""Deterministic check for the counter page. Exit 0 == pass."""
import re, sys, pathlib

p = pathlib.Path(__file__).parent / "index.html"
if not p.exists():
    print("FAIL: index.html missing"); sys.exit(1)
html = p.read_text(encoding="utf-8", errors="replace")

fails = []
for el_id in ("count", "inc", "dec", "reset"):
    if not re.search(r'id\s*=\s*["\']%s["\']' % el_id, html):
        fails.append("missing element id=%s" % el_id)

scripts = re.findall(r"<script\b[^>]*>(.*?)</script>", html, re.S | re.I)
js = "\n".join(scripts)
if not js.strip():
    fails.append("no inline <script> logic")
for el_id in ("count", "inc", "dec", "reset"):
    if el_id not in js:
        fails.append("script never references id=%s" % el_id)
if not re.search(r"addEventListener|onclick", js, re.I):
    fails.append("no click wiring in script")
if re.search(r'<script[^>]+src\s*=\s*["\']https?://', html, re.I):
    fails.append("external script src is not allowed (single self-contained file)")
if not re.search(r">\s*0\s*<", html):
    fails.append("counter display does not start at 0")

if fails:
    print("FAIL: " + "; ".join(fails)); sys.exit(1)
print("PASS: counter page satisfies the DOM contract"); sys.exit(0)
'''

STATS_TESTS = r'''#!/usr/bin/env python3
"""Provided test cases for stats.py. Exit 0 == pass. Do not edit this file."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
try:
    import stats
except Exception as exc:
    print("FAIL: cannot import stats.py: %r" % (exc,)); sys.exit(1)

def check(name, got, want):
    if got != want:
        print("FAIL: %s -> %r (expected %r)" % (name, got, want)); sys.exit(1)

check("mean([1,2,3,4])", stats.mean([1, 2, 3, 4]), 2.5)
check("median([3,1,2])", stats.median([3, 1, 2]), 2)
check("median([4,1,3,2])", stats.median([4, 1, 3, 2]), 2.5)
check("mode([1,2,2,3])", stats.mode([1, 2, 2, 3]), 2)
try:
    stats.mean([])
except ValueError:
    pass
else:
    print("FAIL: mean([]) must raise ValueError"); sys.exit(1)
print("PASS: 3/3 stats cases"); sys.exit(0)
'''

CALC_BUGGY = r'''"""Tiny expression helpers. One of these is wrong."""


def add(a, b):
    return a + b


def subtract(a, b):
    return a + b


def multiply(a, b):
    return a * b
'''

LEDGER_SRC = r'''"""Running ledger built on calc.py."""
from calc import add, subtract


def running_total(entries):
    """entries: list of (kind, amount) with kind in {'credit', 'debit'}."""
    total = 0
    for kind, amount in entries:
        if kind == "credit":
            total = add(total, amount)
        elif kind == "debit":
            total = subtract(total, amount)
        else:
            raise ValueError("unknown kind: %r" % (kind,))
    return total
'''

CALC_TESTS = r'''#!/usr/bin/env python3
"""Provided regression tests. Exit 0 == pass. Do not edit this file."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from calc import add, subtract, multiply
from ledger import running_total

def check(name, got, want):
    if got != want:
        print("FAIL: %s -> %r (expected %r)" % (name, got, want)); sys.exit(1)

check("add(2,3)", add(2, 3), 5)
check("subtract(9,4)", subtract(9, 4), 5)
check("multiply(3,4)", multiply(3, 4), 12)
check("running_total credits", running_total([("credit", 10), ("credit", 5)]), 15)
check("running_total mixed", running_total([("credit", 100), ("debit", 30), ("debit", 20)]), 50)
print("PASS: ledger regression suite"); sys.exit(0)
'''

TASKS: Dict[str, Dict[str, Any]] = {
    "counter": {
        "label": "single-file HTML counter with a fixed DOM contract",
        "fixtures": {"verify.py": COUNTER_VERIFY},
        "protected": ["verify.py"],
        "verify_cmd": "python3 verify.py",
        "request": (
            "Create a single self-contained file `index.html` in the workspace root: a counter page.\n"
            "Hard requirements (a checker enforces them exactly):\n"
            "  - an element with id=\"count\" that displays the current value and starts at 0\n"
            "  - buttons with id=\"inc\" (adds 1), id=\"dec\" (subtracts 1), id=\"reset\" (sets back to 0)\n"
            "  - all behaviour in ONE inline <script> block in the same file; no external scripts, no CDN\n"
            "The workspace already contains `verify.py`. Your work is correct when `python3 verify.py` "
            "exits 0. Do not modify verify.py."
        ),
        "artifacts": ["index.html"],
    },
    "stats": {
        "label": "Python module that must pass 3 provided test cases",
        "fixtures": {"test_stats.py": STATS_TESTS},
        "protected": ["test_stats.py"],
        "verify_cmd": "python3 test_stats.py",
        "request": (
            "Create `stats.py` in the workspace root exposing three functions:\n"
            "  - mean(values) -> arithmetic mean as a float; raise ValueError on an empty list\n"
            "  - median(values) -> middle value; average of the two middle values for even length\n"
            "  - mode(values) -> most frequent value\n"
            "The workspace already contains `test_stats.py` with the exact expectations. "
            "Your work is correct when `python3 test_stats.py` exits 0. Do not modify test_stats.py."
        ),
        "artifacts": ["stats.py"],
    },
    "bugfix": {
        "label": "find and fix a seeded bug across a 2-file mini project",
        "fixtures": {"calc.py": CALC_BUGGY, "ledger.py": LEDGER_SRC, "test_calc.py": CALC_TESTS},
        "protected": ["test_calc.py"],
        "verify_cmd": "python3 test_calc.py",
        "request": (
            "This workspace holds a small project: `calc.py`, `ledger.py` and the provided test file "
            "`test_calc.py`. Running `python3 test_calc.py` currently FAILS. Find the bug in the source "
            "and fix it so the suite passes. Keep every existing public function; change behaviour only "
            "where it is actually wrong. Do not modify test_calc.py."
        ),
        "artifacts": ["calc.py", "ledger.py"],
    },
}


# --------------------------------------------------------------------------
# arms
# --------------------------------------------------------------------------
def _budget_note(text: str) -> str:
    return text


ARMS: Dict[str, Dict[str, Any]] = {
    "baseline": {
        "bundle_id": "basic-agent",
        "bundle_version": "0.0.3",
        "flow_id": "81795ea9",
        "contract": "agent.v1",
        "topology": "1 agent node, no verification loop (control)",
        "budget": "max_iterations=14",
        # basic-agent@0.0.3 ends on a status-update subflow (flow 15f19f7f) that spins on
        # `wait_until` and never terminates (observed live 2026-07-31: 486 wait_until steps).
        # The agent's work is already on disk long before that, so cap this arm short and
        # read the real finish time off the ledger instead of the root run's status.
        "deadline_s": 240,
        "inputs": lambda task, ws: {
            "prompt": task["request"] + "\n\nWhen you believe you are done, run the verification command "
                      "yourself with execute_command and fix anything it reports.",
            "tools": ["list_files", "read_file", "write_file", "edit_file", "execute_command", "search_files"],
            "max_iterations": 14,
            "temperature": 0.0,
        },
    },
    "coding-agent": {
        "bundle_id": "coding-agent",
        "bundle_version": "0.2.4",
        "flow_id": "coding-agent",
        "contract": "coding.v1",
        "topology": "builder agent + independent verifier + deterministic gates + fix loop",
        "budget": "max_rounds=3",
        "inputs": lambda task, ws: {
            "request": task["request"],
            "build_command": "",
            "run_command": task["verify_cmd"],
            "max_rounds": 3,
        },
    },
    "multiagent": {
        "bundle_id": "multiagent-coding",
        "bundle_version": "0.0.16",
        "flow_id": "multiagent-coding",
        "contract": "coding.v1",
        "topology": "scouts -> planner -> gate -> builder -> lint -> verify -> doc -> PR -> review gate -> merge",
        "budget": "max_plan_revisions=1, max_fix_cycles=3, max_review_rounds=1",
        "inputs": lambda task, ws: {
            "request": task["request"],
            "gating_mode": "auto",
            "max_plan_revisions": 1,
            "max_fix_cycles": 3,
            "max_review_rounds": 1,
            "browser_probe_available": False,
            "build_command": "",
            "run_command": task["verify_cmd"],
        },
    },
    "react-coder": {
        "bundle_id": "react-coding",
        "bundle_version": "0.1.0",
        "flow_id": "react-coding",
        "contract": "coding.v1",
        "topology": "hand-wired llm_call + tool_calls loop, accumulating transcript, no agent node",
        "budget": "max_cycles=12",
        "inputs": lambda task, ws: {
            "request": task["request"],
            "gating_mode": "auto",
            "max_cycles": 12,
            "verify_command": task["verify_cmd"],
            "browser_probe_available": False,
        },
    },
    # --- agent.v1 wrapper arms: same pipelines reached through the chat-agent entrypoint.
    # They take a bare `prompt` instead of `request`, so they also test whether the
    # wrapper preserves the pipeline's behaviour.
    "coder-v1": {
        "bundle_id": "coding-agent",
        "bundle_version": "0.2.5",
        "flow_id": "coder",
        "contract": "agent.v1",
        "topology": "agent.v1 wrapper over coding-agent 0.2.5 (adds steer-inbox draining)",
        "budget": "flow defaults (max_rounds=4)",
        "inputs": lambda task, ws: {
            "prompt": task["request"],
            "tools": ["list_files", "read_file", "write_file", "edit_file", "execute_command", "search_files"],
        },
    },
    "multiagent-coder-v1": {
        "bundle_id": "multiagent-coding",
        "bundle_version": "0.0.16",
        "flow_id": "multiagent-coder",
        "contract": "agent.v1",
        "topology": "agent.v1 wrapper over the multi-agent pipeline",
        "budget": "flow defaults",
        "inputs": lambda task, ws: {
            "prompt": task["request"],
            "gating_mode": "auto",
            "browser_probe_available": False,
            "tools": ["list_files", "read_file", "write_file", "edit_file", "execute_command", "search_files"],
        },
    },
    "react-coder-v1": {
        "bundle_id": "react-coding",
        "bundle_version": "0.1.0",
        "flow_id": "react-coder",
        "contract": "agent.v1",
        "topology": "agent.v1 wrapper over the hand-wired ReAct loop",
        "budget": "flow defaults (max_cycles=12)",
        "inputs": lambda task, ws: {
            "prompt": task["request"],
            "gating_mode": "auto",
            "browser_probe_available": False,
            "tools": ["list_files", "read_file", "write_file", "edit_file", "execute_command", "search_files"],
        },
    },
    "ralph-coder-v1": {
        "bundle_id": "ralph-coding",
        "bundle_version": "0.1.0",
        "flow_id": "ralph-coder",
        "contract": "agent.v1",
        "topology": "agent.v1 wrapper over the Ralph loop",
        "budget": "flow defaults (max_cycles=8)",
        "inputs": lambda task, ws: {
            "prompt": task["request"],
            "gating_mode": "auto",
            "browser_probe_available": False,
            "tools": ["list_files", "read_file", "write_file", "edit_file", "execute_command", "search_files"],
        },
    },
    "ralph-coder": {
        "bundle_id": "ralph-coding",
        "bundle_version": "0.1.0",
        "flow_id": "ralph-coding",
        "contract": "coding.v1",
        "topology": "same prompt every cycle to a FRESH session; PLAN.md/PROGRESS.md is the memory",
        "budget": "max_cycles=5, max_steps_per_cycle=8",
        "inputs": lambda task, ws: {
            "request": task["request"],
            "gating_mode": "auto",
            "max_cycles": 5,
            "max_steps_per_cycle": 8,
            "verify_command": task["verify_cmd"],
            "browser_probe_available": False,
        },
    },
}


# --------------------------------------------------------------------------
# workspace lifecycle
# --------------------------------------------------------------------------
def make_workspace(stamp: str, arm: str, task_id: str, seed: int) -> Path:
    ws = WS_BASE / f"bench-{stamp}" / f"{arm}__{task_id}__s{seed}"
    if ws.exists():
        shutil.rmtree(ws)
    ws.mkdir(parents=True)
    for name, content in TASKS[task_id]["fixtures"].items():
        (ws / name).write_text(content, encoding="utf-8")
    return ws


def restore_protected(ws: Path, task_id: str) -> List[str]:
    """Put the pristine fixture back; report (and ARCHIVE) any protected file tampered with.

    Archiving matters: without it the evidence of what an arm did to the grader is
    destroyed by the restore itself.
    """
    tampered: List[str] = []
    task = TASKS[task_id]
    for name in task["protected"]:
        pristine = task["fixtures"][name]
        target = ws / name
        current = target.read_text(encoding="utf-8", errors="replace") if target.exists() else None
        if current != pristine:
            tampered.append(name if current is not None else f"{name} (deleted)")
            if current is not None:
                (ws / f".tampered__{name}").write_text(current, encoding="utf-8")
            target.write_text(pristine, encoding="utf-8")
    return tampered


def run_verify(ws: Path, task_id: str) -> Tuple[bool, str]:
    # A stale __pycache__ can shadow a just-rewritten module when mtimes collide.
    for cache in ws.rglob("__pycache__"):
        shutil.rmtree(cache, ignore_errors=True)
    cmd = TASKS[task_id]["verify_cmd"].replace("python3", PYBIN, 1)
    try:
        proc = subprocess.run(cmd, shell=True, cwd=str(ws), capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return False, "verify timed out after 120s"
    out = ((proc.stdout or "") + (proc.stderr or "")).strip()
    return proc.returncode == 0, out[-1200:]


def workspace_snapshot(ws: Path) -> Dict[str, Any]:
    files: Dict[str, int] = {}
    for p in sorted(ws.rglob("*")):
        if p.is_file() and ".git" not in p.parts:
            try:
                files[str(p.relative_to(ws))] = p.stat().st_size
            except OSError:
                pass
    return {"file_count": len(files), "files": files}


# --------------------------------------------------------------------------
# run driving + metric extraction
# --------------------------------------------------------------------------
def run_tree(root_id: str) -> Dict[str, Dict[str, Any]]:
    seen: Dict[str, Dict[str, Any]] = {}
    queue = [root_id]
    while queue:
        rid = queue.pop(0)
        if rid in seen:
            continue
        run = api(f"/api/gateway/runs/{rid}")
        if not isinstance(run, dict) or run.get("__http_error__") or run.get("__error__"):
            continue
        seen[rid] = run
        kids = api(f"/api/gateway/runs?parent_run_id={rid}&limit=100")
        for k in (kids.get("items") or kids.get("runs") or []) if isinstance(kids, dict) else []:
            # Client-side parent filtering is mandatory: the listing has been observed
            # returning rows outside the queried parent, and we approve tools on these.
            if k.get("run_id") and k.get("parent_run_id") == rid:
                queue.append(k["run_id"])
    return seen


def ledger_of(rid: str) -> List[Dict[str, Any]]:
    res = api(f"/api/gateway/runs/{rid}/ledger", timeout=90)
    if isinstance(res, dict):
        return res.get("items") or res.get("records") or []
    return res if isinstance(res, list) else []


def collect_metrics(root_id: str) -> Dict[str, Any]:
    tree = run_tree(root_id)
    effects: Counter = Counter()
    tools: Counter = Counter()
    tokens = {"input": 0, "output": 0, "total": 0}
    llm_calls = 0
    agent_nodes = 0
    subruns = 0
    errors: List[str] = []
    step_times: List[str] = []
    resolved_models: Counter = Counter()
    resolved_providers: Counter = Counter()
    for rid, run in tree.items():
        if run.get("error"):
            errors.append(f"{rid[:8]}: {str(run['error'])[:220]}")
        for rec in ledger_of(rid):
            eff = rec.get("effect") or {}
            etype = str(eff.get("type") or "")
            status = rec.get("status")
            if status != "completed":
                continue
            effects[etype] += 1
            # `wait_until` is the status-ticker heartbeat, not work: excluding it lets us
            # report when an orchestration actually FINISHED versus when its run object did.
            if etype != "wait_until" and rec.get("ended_at"):
                step_times.append(str(rec["ended_at"]))
            if etype in ("llm_call", "llm"):
                llm_calls += 1
            if etype == "agent":
                agent_nodes += 1
            if etype == "start_subworkflow":
                subruns += 1
            res = rec.get("result")
            blob = json.dumps(res, default=str) if res is not None else ""
            if etype in ("tool_calls", "tool_call"):
                payload = eff.get("payload") or {}
                for call in (payload.get("tool_calls") or payload.get("calls") or []):
                    if isinstance(call, dict):
                        name = call.get("name") or (call.get("function") or {}).get("name")
                        if name:
                            tools[str(name)] += 1
            if etype in ("llm_call", "llm", "agent"):
                # The provider echoes the model it ACTUALLY served back in the result;
                # the gateway can override the requested provider/model, so record the truth.
                for field, sink in (("model", resolved_models), ("provider", resolved_providers)):
                    idx = blob.find(f'"{field}":')
                    if idx >= 0:
                        frag = blob[idx + len(field) + 3: idx + len(field) + 70]
                        val = frag.split('"')[1] if frag.count('"') >= 2 else ""
                        if val:
                            sink[val] += 1
            for key in ("input_tokens", "output_tokens", "total_tokens"):
                # cheap scan: the provider echoes usage inside the llm result payload
                idx = blob.find(f'"{key}"')
                if idx >= 0:
                    frag = blob[idx + len(key) + 3: idx + len(key) + 24]
                    num = "".join(ch for ch in frag if ch.isdigit())
                    if num:
                        tokens[key.split("_")[0] if key != "total_tokens" else "total"] += int(num)
    return {
        "run_count": len(tree),
        "first_step_at": min(step_times) if step_times else None,
        "last_productive_step_at": max(step_times) if step_times else None,
        "effects": dict(effects),
        "llm_calls": llm_calls,
        "agent_effects": agent_nodes,
        "subworkflows": subruns,
        "tool_calls_by_name": dict(tools),
        "tool_calls_total": sum(tools.values()),
        "resolved_models": dict(resolved_models),
        "resolved_providers": dict(resolved_providers),
        "tokens": tokens,
        "run_errors": errors[:10],
        "statuses": Counter(str(r.get("status")) for r in tree.values()),
    }


def drive(root_id: str, deadline_s: int, log) -> Dict[str, Any]:
    """Poll to terminal, auto-approving tool approvals across the whole run tree."""
    t0 = time.time()
    # DEDUP BY KEY -- and that is now correct. Until 2026-08-01 an agent node
    # reused ONE wait_key (`tool_calls:<run_id>:act`) for EVERY approval round,
    # so this driver had to approve by OCCURRENCE and re-approve the same key
    # up to 60 times. The runtime now mints one durable key per approval
    # instance (`tool_approval:{run}:{node}:{effect_identity}`), so answering
    # each key exactly once is both correct and idempotent -- and it keeps this
    # driver a REGRESSION DETECTOR: if keys ever collapse again, the benchmark
    # stalls loudly instead of quietly re-approving its way through.
    approval_rounds: Counter = Counter()
    MAX_ROUNDS_PER_KEY = 1
    approvals = 0
    gate_answers = 0
    answered_gates: set = set()
    unexpected_gates: List[str] = []
    status = ""
    while time.time() - t0 < deadline_s:
        time.sleep(4)
        tree = run_tree(root_id)
        for rid, run in tree.items():
            if run.get("status") != "waiting":
                continue
            w = run.get("waiting") or {}
            if not isinstance(w, dict) or w.get("reason") == "subworkflow":
                continue
            wk = w.get("wait_key")
            if not wk:
                continue
            details = w.get("details") or {}
            is_approval = (str(wk).startswith("tool_approval")
                           or details.get("mode") == "approval_required"
                           or str(wk).startswith("tool_calls:"))
            key = f"{rid}:{wk}"
            if is_approval:
                if approval_rounds[key] >= MAX_ROUNDS_PER_KEY:
                    continue
                approval_rounds[key] += 1
                approvals += 1
                api("/api/gateway/commands", "POST", {
                    "command_id": f"bench-{time.time_ns()}", "run_id": rid, "type": "resume",
                    "payload": {"wait_key": wk, "payload": {"approved": True, "auto_approved": True}}})
                log(f"    auto-approved tool wait #{approval_rounds[key]} {wk} on {rid[:8]}")
            else:
                if key in answered_gates:
                    continue
                answered_gates.add(key)
                prompt = str(w.get("prompt") or details.get("prompt") or "")[:160]
                unexpected_gates.append(f"{rid[:8]}:{wk}: {prompt}")
                gate_answers += 1
                api("/api/gateway/commands", "POST", {
                    "command_id": f"bench-{time.time_ns()}", "run_id": rid, "type": "resume",
                    "payload": {"wait_key": wk, "payload": {"response": "approve"}}})
                log(f"    !! answered unexpected ask_user gate on {rid[:8]}: {prompt}")
        root = tree.get(root_id) or {}
        status = str(root.get("status") or "")
        if status in ("completed", "failed", "cancelled"):
            break
    return {
        "terminal_status": status or "TIMEOUT",
        "wall_s": round(time.time() - t0, 1),
        "tool_approvals": approvals,
        "unexpected_gates": unexpected_gates,
        "gate_answers": gate_answers,
    }


def steer(run_id: str, message: str) -> Any:
    """Mid-run steer. The gateway's /commands door takes `inject_guidance`; the runner
    queues it through Runtime.steer(), which appends to `_runtime.inbox` — the exact var
    react-coding drains each cycle and ralph-coding folds into steering_notes."""
    return api("/api/gateway/commands", "POST", {
        "command_id": f"bench-steer-{time.time_ns()}", "run_id": run_id,
        "type": "inject_guidance", "payload": {"guidance": message}})


# --------------------------------------------------------------------------
# one cell of the matrix
# --------------------------------------------------------------------------
def run_cell(arm_id: str, task_id: str, seed: int, stamp: str, outdir: Path,
             steer_msg: Optional[str] = None, retry: int = 0) -> Dict[str, Any]:
    arm = ARMS[arm_id]
    task = TASKS[task_id]
    log_lines: List[str] = []

    def log(msg: str) -> None:
        line = f"[{time.strftime('%H:%M:%S')}] {msg}"
        print(line, flush=True)
        log_lines.append(line)

    ws = make_workspace(stamp, arm_id, task_id, seed)
    log(f"== {arm_id} / {task_id} / seed {seed} -> {ws}")

    input_data = dict(arm["inputs"](task, ws))
    input_data.update({
        "workspace_root": str(ws),
        "provider": PROVIDER,
        "model": MODEL,
        "_runtime": {"tool_policy": {"auto_approve_tools": [
            "execute_command", "write_file", "edit_file", "read_file", "list_files", "search_files",
            "analyze_code", "skim_files", "skim_folders", "glob_files", "apply_patch", "delete_file",
            "move_file", "make_dir", "fetch_url", "web_search"]}},
    })
    if seed and "seed" not in input_data:
        input_data["seed"] = seed

    started = api("/api/gateway/runs/start", "POST", {
        "bundle_id": arm["bundle_id"], "bundle_version": arm["bundle_version"],
        "flow_id": arm["flow_id"], "input_data": input_data}, timeout=120)
    run_id = started.get("run_id") if isinstance(started, dict) else None
    if not run_id:
        log(f"   START FAILED: {json.dumps(started)[:400]}")
        return {"arm": arm_id, "task": task_id, "seed": seed, "start_failed": True,
                "start_response": started, "log": log_lines}
    log(f"   run {run_id}")

    steered_at = None
    if steer_msg:
        time.sleep(35)
        res = steer(run_id, steer_msg)
        steered_at = 35
        log(f"   steer sent at t+35s -> {json.dumps(res, default=str)[:200]}")

    drove = drive(run_id, int(arm.get("deadline_s") or DEADLINE_S), log)
    log(f"   terminal={drove['terminal_status']} wall={drove['wall_s']}s")

    metrics = collect_metrics(run_id)
    effective_wall = drove["wall_s"]
    try:
        first, last = metrics.get("first_step_at"), metrics.get("last_productive_step_at")
        if first and last:
            fmt = "%Y-%m-%dT%H:%M:%S.%f%z"
            a = datetime.strptime(first.replace("Z", "+0000"), fmt)
            b = datetime.strptime(last.replace("Z", "+0000"), fmt)
            effective_wall = round((b - a).total_seconds(), 1)
    except Exception:  # noqa: BLE001 - timestamp shape drift must not lose a row
        pass
    root = api(f"/api/gateway/runs/{run_id}")
    output = root.get("output") if isinstance(root, dict) else None

    ws_after = workspace_snapshot(ws)
    tampered = restore_protected(ws, task_id)
    if tampered:
        log(f"   !! tampered with protected fixture(s): {tampered}")
    ok, verify_out = run_verify(ws, task_id)
    log(f"   VERIFY {'PASS' if ok else 'FAIL'}: {verify_out.splitlines()[-1] if verify_out else ''}")

    claimed = None
    if isinstance(output, dict):
        for key in ("passed", "success"):
            if key in output:
                claimed = output.get(key)
                break
        if claimed is None:
            blob = json.dumps(output, default=str).lower()
            if '"passed": true' in blob:
                claimed = True

    failure_mode = None
    if not ok:
        if drove["terminal_status"] == "TIMEOUT":
            failure_mode = "budget_exhausted_or_hung"
        elif drove["terminal_status"] == "failed":
            failure_mode = "crashed"
        elif metrics["run_errors"]:
            failure_mode = "crashed_subrun"
        elif claimed:
            failure_mode = "wrong_claimed_done"
        elif tampered:
            failure_mode = "tampered_with_tests"
        else:
            failure_mode = "gave_up_or_incomplete"

    artifacts_present = {name: (ws / name).exists() for name in task["artifacts"]}

    row = {
        "arm": arm_id,
        "arm_topology": arm["topology"],
        "arm_budget": arm["budget"],
        "bundle": f"{arm['bundle_id']}@{arm['bundle_version']}:{arm['flow_id']}",
        "task": task_id,
        "task_label": task["label"],
        "seed": seed,
        "retry_of_failed_attempt": bool(retry),
        "run_id": run_id,
        "workspace": str(ws),
        "provider": PROVIDER,
        "model": MODEL,
        "terminal_status": drove["terminal_status"],
        "wall_s": drove["wall_s"],
        "effective_wall_s": effective_wall,
        "verified_pass": ok,
        "verify_output": verify_out,
        "claimed_success": claimed,
        "honest": (claimed is None) or (bool(claimed) == ok),
        "failure_mode": failure_mode,
        "tampered_protected_files": tampered,
        "artifacts_present": artifacts_present,
        "workspace_after": ws_after,
        "tool_approvals": drove["tool_approvals"],
        "unexpected_gates": drove["unexpected_gates"],
        "steered_at_s": steered_at,
        "steer_message": steer_msg,
        "metrics": metrics,
        "flow_output": output,
        "log": log_lines,
    }
    (outdir / f"{arm_id}__{task_id}__s{seed}.json").write_text(
        json.dumps(row, indent=2, default=str), encoding="utf-8")
    return row


# --------------------------------------------------------------------------
def summarize(paths: List[Path]) -> str:
    """Render the per-run and per-arm markdown tables from result dirs."""
    rows: List[Dict[str, Any]] = []
    for d in paths:
        for f in sorted(d.glob("*.json")):
            if f.name == "results.json":
                continue
            try:
                rows.append(json.loads(f.read_text(encoding="utf-8")))
            except Exception:  # noqa: BLE001
                continue
    out: List[str] = []
    out.append("| arm | task | seed | verified | claimed | work s | LLM calls | tool calls | in tok | out tok | runs | terminal | failure mode |")
    out.append("| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |")
    for r in sorted(rows, key=lambda x: (x.get("task", ""), x.get("arm", ""), x.get("seed", 0))):
        if r.get("start_failed"):
            out.append(f"| {r['arm']} | {r['task']} | {r['seed']} | START FAILED | | | | | | | | | |")
            continue
        m = r["metrics"]
        tk = m["tokens"]
        out.append(
            f"| {r['arm']} | {r['task']} | {r['seed']} | "
            f"{'**PASS**' if r['verified_pass'] else 'FAIL'} | "
            f"{'-' if r['claimed_success'] is None else ('yes' if r['claimed_success'] else 'no')} | "
            f"{r.get('effective_wall_s', r['wall_s'])} | {m['llm_calls']} | {m['tool_calls_total']} | "
            f"{tk['input']} | {tk['output']} | {m['run_count']} | {r['terminal_status']} | "
            f"{r['failure_mode'] or ''} |")
    out.append("")
    per_arm: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        if not r.get("start_failed"):
            per_arm.setdefault(r["arm"], []).append(r)
    out.append("| arm | passed / runs | median work s | median LLM calls | median tool calls | median in tok | dishonest |")
    out.append("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")

    def med(vals: List[float]) -> float:
        vals = sorted(vals)
        if not vals:
            return 0.0
        mid = len(vals) // 2
        return vals[mid] if len(vals) % 2 else round((vals[mid - 1] + vals[mid]) / 2, 1)

    for arm, rs in per_arm.items():
        out.append(
            f"| {arm} | {sum(1 for r in rs if r['verified_pass'])} / {len(rs)} | "
            f"{med([r.get('effective_wall_s', r['wall_s']) for r in rs])} | "
            f"{med([r['metrics']['llm_calls'] for r in rs])} | "
            f"{med([r['metrics']['tool_calls_total'] for r in rs])} | "
            f"{med([r['metrics']['tokens']['input'] for r in rs])} | "
            f"{sum(1 for r in rs if not r['honest'])} |")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--summarize", nargs="*", default=None,
                    help="render markdown tables from one or more result directories and exit")
    ap.add_argument("--arms", default="all")
    ap.add_argument("--tasks", default="all")
    ap.add_argument("--seeds", default="1")
    ap.add_argument("--outdir", default="")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--steer", action="store_true", help="steering probe: send a mid-run steer message")
    ap.add_argument("--steer-message", default="STEER: also create a file named STEERED.md in the workspace root containing the single word ACK.")
    args = ap.parse_args()

    if args.summarize is not None:
        print(summarize([Path(p) for p in args.summarize]))
        return 0

    if args.list:
        print("arms:")
        for k, v in ARMS.items():
            print(f"  {k:14s} {v['bundle_id']}@{v['bundle_version']}:{v['flow_id']}  [{v['budget']}]  {v['topology']}")
        print("tasks:")
        for k, v in TASKS.items():
            print(f"  {k:14s} {v['label']}  (verify: {v['verify_cmd']})")
        return 0

    if not TOKEN:
        print("BENCH_TOKEN is required", file=sys.stderr)
        return 2

    arm_ids = list(ARMS) if args.arms == "all" else [a.strip() for a in args.arms.split(",") if a.strip()]
    task_ids = list(TASKS) if args.tasks == "all" else [t.strip() for t in args.tasks.split(",") if t.strip()]
    seeds = [int(s) for s in args.seeds.split(",") if s.strip()]
    for a in arm_ids:
        if a not in ARMS:
            print(f"unknown arm: {a}", file=sys.stderr)
            return 2
    for t in task_ids:
        if t not in TASKS:
            print(f"unknown task: {t}", file=sys.stderr)
            return 2

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    outdir = Path(args.outdir) if args.outdir else REPO / "untracked" / "benchmarks" / "orchestrations" / stamp
    outdir.mkdir(parents=True, exist_ok=True)
    print(f"results -> {outdir}")

    rows: List[Dict[str, Any]] = []
    for seed in seeds:
        for task_id in task_ids:
            for arm_id in arm_ids:
                row = run_cell(arm_id, task_id, seed, stamp, outdir,
                               steer_msg=args.steer_message if args.steer else None)
                rows.append(row)
                (outdir / "results.json").write_text(
                    json.dumps({"stamp": stamp, "provider": PROVIDER, "model": MODEL,
                                "gateway": GATEWAY, "deadline_s": DEADLINE_S, "rows": rows},
                               indent=2, default=str), encoding="utf-8")

    print("\n=== SUMMARY ===")
    print(f"{'arm':14s} {'task':10s} {'seed':4s} {'pass':5s} {'work_s':>8s} {'llm':>5s} {'tools':>6s} {'runs':>5s}  status")
    for r in rows:
        if r.get("start_failed"):
            print(f"{r['arm']:14s} {r['task']:10s} {r['seed']:<4d} START-FAILED")
            continue
        m = r["metrics"]
        print(f"{r['arm']:14s} {r['task']:10s} {r['seed']:<4d} "
              f"{'PASS' if r['verified_pass'] else 'FAIL':5s} {r['effective_wall_s']:>8.1f} "
              f"{m['llm_calls']:>5d} {m['tool_calls_total']:>6d} {m['run_count']:>5d}  "
              f"{r['terminal_status']}{'' if r['honest'] else '  [DISHONEST]'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
