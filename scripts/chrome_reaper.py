#!/usr/bin/env python3
"""RETIRED 2026-07-25 (c5326/c5328) — DO NOT RUN.

This was the 2026-07-23 stopgap for backlog 0152 (a hung headless Chrome
starving the gateway's serialized effect executor). That wedge is CURED
end-to-end (gateway command-lane isolation + runtime/core execute_command
child-process-TREE reaping on timeout + LLM no-progress timeouts), so this
reaper has no remaining justification — and it was WRONG in two ways worth
remembering: (1) a NAME-BASED, BOX-WIDE kill hits every seat's automation
Chrome (it killed the entity seat's capture probes at 40s for two hours,
chased as phantom renderer deaths — c5326); (2) it ran ppid-1 DETACHED,
outliving its session, violating the no-machine-persistence rule. Residual
worry about a specific spawned browser belongs in execute_command's own
timeout+reap (runtime's lane, already live), never a detached sweeper.

The process (pid 93683) was terminated 2026-07-25 ~04:55. Kept as history
only; the guard below refuses to run.

Usage (historical): chrome_reaper.py [thresh_seconds] [poll_seconds]
"""
raise SystemExit(
    "chrome_reaper is RETIRED (2026-07-25, c5326/c5328): the 0152 wedge is "
    "cured end-to-end; box-wide name-based kills + detached persistence are "
    "forbidden. See the module docstring."
)
import os
import signal
import subprocess
import sys
import time

THRESH = float(sys.argv[1]) if len(sys.argv) > 1 else 120.0
POLL = float(sys.argv[2]) if len(sys.argv) > 2 else 15.0

AUTOMATION_MARKERS = (
    "--headless", "--remote-debugging", "--enable-automation",
    "for testing", "--user-data-dir=/tmp", "--user-data-dir=/var/folders",
)
CHROME_MARKERS = ("google chrome", "chromium", "/chrome")

first_seen: dict[int, float] = {}


def automation_chrome() -> list[tuple[int, str]]:
    out = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True).stdout
    hits = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) != 2:
            continue
        pid_s, cmd = parts
        low = cmd.lower()
        if not any(m in low for m in CHROME_MARKERS):
            continue
        if not any(m in low for m in AUTOMATION_MARKERS):
            continue  # interactive Chrome: never touch
        try:
            hits.append((int(pid_s), cmd))
        except ValueError:
            continue
    return hits


def kill_tree(pid: int) -> None:
    try:
        kids = subprocess.run(["pgrep", "-P", str(pid)], capture_output=True, text=True).stdout.split()
        for k in kids:
            try:
                os.kill(int(k), signal.SIGKILL)
            except (ValueError, ProcessLookupError):
                pass
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def main() -> int:
    print(f"[reaper] guarding gateway: kill automation Chrome older than {THRESH:.0f}s, poll {POLL:.0f}s", flush=True)
    while True:
        now = time.time()
        live = automation_chrome()
        live_pids = {p for p, _ in live}
        for pid, cmd in live:
            first_seen.setdefault(pid, now)
            age = now - first_seen[pid]
            if age > THRESH:
                print(f"[reaper] {time.strftime('%H:%M:%S')} killing hung automation Chrome pid={pid} age={age:.0f}s", flush=True)
                kill_tree(pid)
                first_seen.pop(pid, None)
        # forget pids that are gone
        for pid in list(first_seen):
            if pid not in live_pids:
                first_seen.pop(pid, None)
        time.sleep(POLL)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        pass
