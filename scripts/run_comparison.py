#!/usr/bin/env python3
"""Detached SEQUENTIAL orchestrator for the 3-way R-Type comparison.

Runs each arm driver (arm_run.mjs) to terminal one at a time so the gateway's
serialized effect executor is never contended by parallel heavy builds (the
parallel attempt thrashed + piled up hung browser probes). Fresh workspace per
arm; drivers run in the foreground of THIS process (which is itself launched
detached via start_new_session), so they never die from a sandbox-shell
return. The Chrome reaper runs separately and protects every arm.

Launch (detached):
  python3 -c "import subprocess,os;
    subprocess.Popen(['python3','scripts/run_comparison.py'],
    env={**os.environ,'DRIVE_TOKEN':TOKEN}, start_new_session=True)"
"""
import os
import pathlib
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROMPT = pathlib.Path("/tmp/rtype_prompt.txt").read_text()
ARMS = ["multiagent", "coder", "basic"]  # order: most→least scaffolded
PER_ARM_MIN = os.environ.get("CMP_PER_ARM_MIN", "35")


def main() -> int:
    base = dict(os.environ)
    base.update({
        "ARM_PROMPT": PROMPT,
        "ARM_PROVIDER": os.environ.get("ARM_PROVIDER", "endpoint:ovh-provider"),
        "ARM_MODEL": os.environ.get("ARM_MODEL", "gpt-oss-120b"),
        "ARM_MINUTES": PER_ARM_MIN,
    })
    combined = open("/tmp/rtype_comparison.log", "a")
    combined.write(f"\n==== comparison run {time.strftime('%Y-%m-%d %H:%M:%S')} ====\n")
    combined.flush()
    for arm in ARMS:
        env = dict(base)
        env["ARM"] = arm
        env["ARM_TAG"] = arm
        env.pop("ARM_ATTACH", None)  # fresh run
        combined.write(f"\n---- ARM {arm} start {time.strftime('%H:%M:%S')} ----\n")
        combined.flush()
        # foreground within this detached process: waits for terminal
        p = subprocess.run(["node", "scripts/arm_run.mjs"], env=env, cwd=str(ROOT),
                           stdout=combined, stderr=combined)
        combined.write(f"---- ARM {arm} exit {p.returncode} {time.strftime('%H:%M:%S')} ----\n")
        combined.flush()
    combined.write(f"\n==== comparison DONE {time.strftime('%H:%M:%S')} ====\n")
    combined.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
