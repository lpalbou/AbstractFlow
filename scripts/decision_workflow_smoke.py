#!/usr/bin/env python3
"""Run `examples/flows/decision-triage.json` headlessly through AbstractRuntime with a stub
decision model, and check that every typed pin reaches the flow outputs.

The stub answers each Decision node from the question it receives (choice -> the option the
ticket names, noul -> 0.73, score -> 1.29 over the levels), so the check covers the whole
path: editor JSON -> compiler -> `decide` node -> LLM_CALL(decision) -> typed output pins ->
Break Object -> On Flow End. Requires AbstractRuntime >= 0.16.0 (the `decide` node).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

from abstractruntime import Runtime, RunStatus
from abstractruntime.core.models import EffectType
from abstractruntime.core.runtime import EffectOutcome
from abstractruntime.storage.in_memory import InMemoryLedgerStore, InMemoryRunStore
from abstractruntime.visualflow_compiler import compile_visualflow

FLOW_PATH = Path(__file__).resolve().parents[1] / "examples" / "flows" / "decision-triage.json"


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        raise SystemExit(f"check failed: {name}: {detail}")


def stub_answer(question: Dict[str, Any]) -> Dict[str, Any]:
    kind = question["type"]
    if kind == "choice":
        names = list(question["criteria"])
        probabilities = {name: (0.5 if name == "returns" else 0.5 / max(1, len(names) - 1)) for name in names}
        return {"type": "choice", "choice": "returns", "confidence": 0.25, "probabilities": probabilities}
    if kind == "noul":
        return {"type": "noul", "noul": 0.73}
    levels = list(question["criteria"])
    legend = {str(i): level for i, level in enumerate(levels)}
    probabilities = {"0": 0.04, "1": 0.63, "2": 0.33}
    return {"type": "score", "score": 1.29, "confidence": 0.44, "legend": legend, "probabilities": probabilities}


def main() -> None:
    raw = json.loads(FLOW_PATH.read_text(encoding="utf-8"))
    spec = compile_visualflow(raw)
    calls: List[Dict[str, Any]] = []

    def decide(run: Any, effect: Any, default_next_node: Any) -> Any:
        payload = dict(effect.payload or {})
        output = dict(payload.get("output") or {})
        calls.append({"prompt": payload.get("prompt"), "output": output})
        assert output.get("modality") == "decision", output
        answers = {name: stub_answer(q) for name, q in dict(output.get("questions") or {}).items()}
        model = str(output.get("model") or "mlx/jaredpalmer/kev-4b")
        body = {"model": model, "answers": answers, "usage": {"input_tokens": 101, "output_tokens": 0}, "latency_ms": 40.0}
        return EffectOutcome.completed({
            "content": json.dumps(answers), "decision": body, "answers": answers,
            "provider": model.split("/", 1)[0], "model": model.split("/", 1)[1],
            "outputs": {}, "resources": {}, "warnings": [], "errors": [], "metadata": {"decision": body},
        })

    runtime = Runtime(run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore(),
                      effect_handlers={EffectType.LLM_CALL: decide})
    inputs = {"ticket": "Wrong size, two charges, nobody answers.", "model": "huggingface/ggml-org/Kev-4B-GGUF:Q4_K_M", "truncate": True}
    run_id = runtime.start(workflow=spec, vars=dict(inputs))  # On Flow Start pins read the run vars
    state = runtime.tick(workflow=spec, run_id=run_id)
    check("run completed", state.status == RunStatus.COMPLETED, str(state.error))
    out = state.output or {}

    check("three decision calls", len(calls) == 3, str(len(calls)))
    kinds = [list(c["output"]["questions"].values())[0]["type"] for c in calls]
    check("one question per node, typed choice/noul/score", kinds == ["choice", "noul", "score"], str(kinds))
    check("state is the ticket", all(c["prompt"] == inputs["ticket"] for c in calls))
    check("model handle travels whole", all(c["output"].get("model") == inputs["model"] for c in calls))
    check("truncate reaches the spec", all(c["output"].get("truncate") is True for c in calls))
    criteria = calls[0]["output"]["questions"]["answer"]["criteria"]
    check("choice options carry descriptions", criteria.get("billing") == "Charges, invoices, payment problems", str(criteria))
    check("score levels ordered", calls[2]["output"]["questions"]["answer"]["criteria"] == ["Calm", "Frustrated", "Very angry"])

    check("department via Break Object", out.get("department") == "returns", str(out))
    check("department confidence via Break Object", out.get("department_confidence") == 0.25, str(out))
    check("escalate verdict (noul >= 0.5)", out.get("escalate") is True, str(out))
    check("escalate probability", out.get("escalate_probability") == 0.73, str(out))
    check("frustration level from the legend", out.get("frustration") == "Frustrated", str(out))
    check("frustration score", out.get("frustration_score") == 1.29, str(out))
    check("model that answered", out.get("answered_by") == "ggml-org/Kev-4B-GGUF:Q4_K_M", str(out))
    print("decision-triage smoke: all checks passed")


if __name__ == "__main__":
    main()
