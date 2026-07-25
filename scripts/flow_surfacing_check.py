#!/usr/bin/env python3
"""Flow surfacing check — structural detection of the 2026-07-25 invisibility class.

The incident: entity-*/multiagent-* flows existed on disk and were "claimed
surfaced", but the editor ships example flows at BUILD time (import.meta.glob
in src/utils/bundledFlows.ts), the served dist/ predated the glob edit, and
the glob itself was a per-file list lagging the family. Each staleness axis
is a named check:

  A  glob coverage    the glob resolves every family file on disk
  B  dist freshness   dist/assets newer than the flows + the glob source
  C  dist content     each resolved flow id actually inlined in the JS
  D  served freshness the running flow server serves THIS dist (best-effort)
  E  registration     gateway registry vs build-script constants, UI pins,
                      and staged .flow files (best-effort)

A/B/C are build truths and FAIL (exit 1). D/E depend on live services and on
deliberate operator acts (registration is a decision, not a build step), so
they WARN. Usage: .venv/bin/python scripts/flow_surfacing_check.py
"""
from __future__ import annotations

import fnmatch
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
FLOWS_DIR = REPO / "examples" / "flows"
BUNDLED_TS = REPO / "src" / "utils" / "bundledFlows.ts"
DIST_ASSETS = REPO / "dist" / "assets"

# Families that ship via WILDCARD glob patterns today. If any file with one of
# these prefixes fails to resolve, someone reverted the glob to a per-file
# list (the exact regression Check A guards) — that is a FAIL, not a warning.
WILDCARD_FAMILIES = ("entity-", "multiagent-", "deep-")
# Families shipped per-file by deliberate curation (e.g. meta-baseline is a
# benchmark harness, not a library flow). Uncovered members are REPORTED so a
# lagging list is visible, but only a human can say whether it is deliberate.
CURATED_FAMILIES = ("meta-", "coding-")

FLOW_URL = os.environ.get("ABSTRACTFLOW_URL", "http://127.0.0.1:3005")
GATEWAY_URL = os.environ.get("ABSTRACTGATEWAY_URL", "http://127.0.0.1:8080")

FAILURES: list[str] = []
WARNINGS: list[str] = []


def report(status: str, check: str, msg: str) -> None:
    print(f"[{status}] {check}: {msg}")
    if status == "FAIL":
        FAILURES.append(f"{check}: {msg}")
    elif status == "WARN":
        WARNINGS.append(f"{check}: {msg}")


def parse_glob_patterns(ts_source: str) -> tuple[list[str], list[str]]:
    """Extract import.meta.glob patterns pointing at examples/flows.

    String-literal scan rather than a TS parse: the glob array is the only
    place path-shaped '../../examples/flows/*.json' literals occur, which
    stays true even if the array is reformatted. '!'-prefixed entries are
    vite negations (subtract from resolution)."""
    include: list[str] = []
    exclude: list[str] = []
    for quoted in re.findall(r"['\"](!?\.\./\.\./examples/flows/[^'\"]+\.json)['\"]", ts_source):
        if quoted.startswith("!"):
            exclude.append(Path(quoted[1:]).name)
        else:
            include.append(Path(quoted).name)
    return include, exclude


def resolve_globs(include: list[str], exclude: list[str], names: list[str]) -> set[str]:
    resolved = {n for n in names if any(fnmatch.fnmatch(n, p) for p in include)}
    return {n for n in resolved if not any(fnmatch.fnmatch(n, p) for p in exclude)}


def family_of(name: str) -> str | None:
    for prefix in WILDCARD_FAMILIES + CURATED_FAMILIES:
        if name.startswith(prefix):
            return prefix
    return None


def check_a() -> tuple[set[str], list[str]]:
    """A: every family file on disk resolves through some glob pattern."""
    ts = BUNDLED_TS.read_text(encoding="utf-8")
    include, exclude = parse_glob_patterns(ts)
    if not include:
        report("FAIL", "A", f"no glob patterns found in {BUNDLED_TS.name} — parser or file broke")
        return set(), []
    disk = sorted(p.name for p in FLOWS_DIR.glob("*.json"))
    resolved = resolve_globs(include, exclude, disk)

    missing_wildcard = [n for n in disk if family_of(n) in WILDCARD_FAMILIES and n not in resolved]
    missing_curated = [n for n in disk if family_of(n) in CURATED_FAMILIES and n not in resolved]
    uncovered_other = [n for n in disk if n not in resolved and family_of(n) is None]

    if missing_wildcard:
        report("FAIL", "A", "wildcard-family files NOT resolved by the glob (per-file list "
                            f"regression?): {', '.join(missing_wildcard)}")
    else:
        fam_counts = {}
        for n in resolved:
            fam = family_of(n) or "singleton"
            fam_counts[fam] = fam_counts.get(fam, 0) + 1
        report("PASS", "A", f"{len(resolved)} flows resolve through {len(include)} patterns "
                            f"({', '.join(f'{k}{v}' for k, v in sorted(fam_counts.items()))})")
    if missing_curated:
        report("INFO", "A", "curated-family files not in the glob (verify deliberate): "
                            f"{', '.join(missing_curated)}")
    if uncovered_other:
        report("INFO", "A", f"{len(uncovered_other)} other examples/flows files are not bundled "
                            "(hash-named/legacy examples; expected)")
    return resolved, disk


def check_b(resolved: set[str]) -> None:
    """B: dist must be newer than every bundled input (flows + the glob source).
    A stale dist is exactly the served-Jul-23 half of the incident."""
    if not DIST_ASSETS.is_dir():
        report("FAIL", "B", f"{DIST_ASSETS} missing — rebuild: npm run build")
        return
    js_files = sorted(DIST_ASSETS.glob("*.js"))
    if not js_files:
        report("FAIL", "B", f"no *.js in {DIST_ASSETS} — rebuild: npm run build")
        return
    newest_js = max(js_files, key=lambda p: p.stat().st_mtime)
    dist_mtime = newest_js.stat().st_mtime
    stale = [BUNDLED_TS.name] if BUNDLED_TS.stat().st_mtime > dist_mtime else []
    stale += [n for n in sorted(resolved) if (FLOWS_DIR / n).stat().st_mtime > dist_mtime]
    if stale:
        report("FAIL", "B", f"sources newer than {newest_js.name} — rebuild: npm run build "
                            f"(stale: {', '.join(stale[:8])}{'…' if len(stale) > 8 else ''})")
    else:
        report("PASS", "B", f"dist ({newest_js.name}) is newer than all {len(resolved)} bundled "
                            "flows and bundledFlows.ts")


def check_c(resolved: set[str]) -> None:
    """C: the resolved flows are actually INLINED in the built JS. Guards the
    axis B cannot see: a build that ran but silently dropped modules (glob
    typo, vite config change). Vite ships both the glob key (filename) and
    the JSON content, so we require the filename stem AND the flow id."""
    js_files = sorted(DIST_ASSETS.glob("*.js"))
    if not js_files:
        report("FAIL", "C", "no dist JS to inspect (see B)")
        return
    blob = "".join(p.read_text(encoding="utf-8", errors="replace") for p in js_files)
    missing: list[str] = []
    fam_counts: dict[str, int] = {}
    for name in sorted(resolved):
        stem = name[: -len(".json")]
        try:
            flow_id = str(json.loads((FLOWS_DIR / name).read_text(encoding="utf-8")).get("id") or stem)
        except Exception:
            flow_id = stem
        if stem not in blob or flow_id not in blob:
            missing.append(f"{name} (id={flow_id})")
        else:
            fam = family_of(name) or "singleton"
            fam_counts[fam] = fam_counts.get(fam, 0) + 1
    if missing:
        report("FAIL", "C", f"flows absent from built JS — rebuild: npm run build; missing: "
                            f"{', '.join(missing)}")
    else:
        report("PASS", "C", "all resolved flows present in dist JS "
                            f"({', '.join(f'{k}{v}' for k, v in sorted(fam_counts.items()))})")


def http_get(url: str, headers: dict[str, str] | None = None, timeout: float = 4.0) -> str | None:
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception:
        return None


def check_d() -> None:
    """D: the RUNNING flow server serves this dist. It reads dist per request,
    so a mismatch usually means an open tab needs a hard reload — or the
    server was started from a published npm package with its own dist."""
    html = http_get(FLOW_URL + "/", timeout=3.0)
    if html is None:
        report("SKIP", "D", f"flow server not reachable at {FLOW_URL} — nothing served to compare")
        return
    served = set(re.findall(r"assets/(index-[\w-]+\.js)", html))
    local = {p.name for p in DIST_ASSETS.glob("index-*.js")}
    if not served:
        report("WARN", "D", f"{FLOW_URL} responded but no assets/index-*.js reference found")
    elif served <= local:
        report("PASS", "D", f"served build matches local dist ({', '.join(sorted(served))}); "
                            "open tabs still need a hard reload to run it")
    else:
        report("WARN", "D", f"served {sorted(served)} != local dist {sorted(local)} — the server "
                            "reads dist per request (hard-reload the tab); if started from a "
                            "published package, restart it against this repo")


def read_script_version(script: str) -> str | None:
    m = re.search(r'^BUNDLE_VERSION\s*=\s*["\']([^"\']+)["\']', (REPO / "scripts" / script).read_text(encoding="utf-8"), re.M)
    return m.group(1) if m else None


def gateway_token() -> str:
    tok = os.environ.get("ABSTRACTGATEWAY_AUTH_TOKEN", "").strip()
    if tok:
        return tok
    conn = Path.home() / ".abstractassistant" / "gateway_connection.json"
    try:
        return str(json.loads(conn.read_text(encoding="utf-8")).get("auth_token") or "")
    except Exception:
        return ""


def check_e() -> None:
    """E: registration drift vs the RUNNING registry (?all_versions=true —
    the default list is latest-only and hides deliberately-pinned older
    versions): 1. build-script BUNDLE_VERSIONs; 2. UI bundledRunTargets pins;
    3. staged .flow files in the served dir — pack_bundle writes INTO the
    auto-load dir, so a packed-but-ungated version silently registers at the
    NEXT reload (any catalog publish triggers one). Drift WARNS with both
    sides named: registration is a deliberate act, possibly gated on other
    repos (entity-life 0.0.16 on the gateway diary-capture bind)."""
    locals_ = {
        "entity-life": read_script_version("build_entity_life_workflow.py"),
        "multiagent-coding": read_script_version("build_multiagent_coding_workflow.py"),
    }
    body = http_get(f"{GATEWAY_URL}/api/gateway/bundles?all_versions=true",
                    headers={"Authorization": f"Bearer {gateway_token()}"})
    if body is None:
        report("SKIP", "E", f"gateway not reachable at {GATEWAY_URL} — registration not compared")
        return
    try:
        data = json.loads(body)
        items = data if isinstance(data, list) else (data.get("bundles") or data.get("items") or [])
        registered: dict[str, set[str]] = {}
        for b in items:
            bid = str(b.get("bundle_id") or b.get("id") or "")
            registered.setdefault(bid, set()).add(str(b.get("version") or b.get("bundle_version") or ""))
    except Exception as e:
        report("WARN", "E", f"gateway bundle list unparseable: {e}")
        return

    for bid, local_ver in locals_.items():
        got = registered.get(bid, set())
        if local_ver is None:
            report("WARN", "E", f"{bid}: BUNDLE_VERSION not found in build script")
        elif local_ver in got:
            report("PASS", "E", f"{bid}: local {local_ver} is registered")
        else:
            report("WARN", "E", f"{bid}: local build script says {local_ver}, gateway registers "
                                f"up to {max(got, key=_semver_key) if got else 'nothing'} — "
                                "registering is deliberate; check the version's gating note in "
                                "CHANGELOG.md before uploading")

    # UI pins: a bundledRunTargets ref the registry does not know fails at Run.
    ts = BUNDLED_TS.read_text(encoding="utf-8")
    pins = sorted(set(re.findall(r"bundleRef:\s*['\"]([^'\"@]+)@([^'\"]+)['\"]", ts)))
    dead = [f"{b}@{v}" for b, v in pins if v not in registered.get(b, ())]
    if dead:
        report("WARN", "E", f"UI bundledRunTargets pins not in the gateway registry: "
                            f"{', '.join(dead)} — Run on these bundled flows will fail; bump the "
                            "pin or register the version")
    else:
        report("PASS", "E", f"all {len(pins)} UI bundledRunTargets pins are registered on the gateway")

    # Staged-vs-registered: read-only scan of the served bundles dir (the
    # exact dir pack_bundle targets). Disk-not-registered = activates on next
    # reload (the entity-life@0.0.16 loaded-gun find, 2026-07-25);
    # registered-not-on-disk = dies at next reload (archived versions).
    bundles_dir = REPO.parent / "abstractgateway" / "flows" / "bundles"
    if not bundles_dir.is_dir():
        report("SKIP", "E", f"served bundles dir not found at {bundles_dir} — staged scan skipped")
        return
    staged: dict[str, set[str]] = {}
    for p in bundles_dir.glob("*.flow"):
        m = re.fullmatch(r"(.+)@(\d[\w.\-]*)\.flow", p.name)  # non-draft bundle@semver only
        if m:
            staged.setdefault(m.group(1), set()).add(m.group(2))
    loaded_guns = sorted(f"{b}@{v}" for b, vs in staged.items() for v in vs
                         if v not in registered.get(b, ()))
    ghosts = sorted(f"{b}@{v}" for b, vs in registered.items() for v in vs
                    if not _is_draftish(v) and v not in staged.get(b, ()))
    if loaded_guns:
        report("WARN", "E", f"staged in the served dir but NOT registered (will self-activate at "
                            f"the next gateway reload): {', '.join(loaded_guns)} — if registration "
                            "is gated, the artifact must not sit in the auto-load dir")
    else:
        report("PASS", "E", "no unregistered .flow staged in the served bundles dir")
    if ghosts:
        report("INFO", "E", f"registered in-memory but file absent from the served dir (drops at "
                            f"next reload): {', '.join(ghosts[:12])}{'…' if len(ghosts) > 12 else ''}")


def _semver_key(v: str) -> tuple:
    return tuple(int(x) if x.isdigit() else 0 for x in re.split(r"[.\-+]", v)[:4])


def _is_draftish(v: str) -> bool:
    return v.startswith("draft") or v == "dev" or "draft." in v


def main() -> int:
    print(f"flow_surfacing_check — repo {REPO}")
    resolved, _disk = check_a()
    check_b(resolved)
    check_c(resolved)
    check_d()
    check_e()
    print()
    if FAILURES:
        print(f"RESULT: FAIL ({len(FAILURES)} failing, {len(WARNINGS)} warnings)")
        return 1
    print(f"RESULT: OK ({len(WARNINGS)} warnings)" if WARNINGS else "RESULT: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
