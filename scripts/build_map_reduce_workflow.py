#!/usr/bin/env python3
"""map-reduce workflow: fan a list out over a per-item LLM transform, then
reduce the results with a synthesis LLM.

The reusable batch primitive. The MAP step applies a caller-supplied
instruction to each item (ForEach + per-item LLM, accumulated in a run var);
the REDUCE step synthesizes all per-item results with a caller-supplied
reduce instruction. (The per-item operation is a configurable LLM prompt
rather than an arbitrary subflow because subflow references are static in
VisualFlow; swap in a subflow node for a fixed heavier per-item pipeline.)
"""
from __future__ import annotations

import wf_common as W

RESET_CODE = "return []".strip()

MAP_PROMPT_CODE = """
instr = str(item_instruction or "Process the item.").strip()
item_text = item if isinstance(item, str) else str(item)
parts = [instr, "", "## Item (index " + str(int(index or 0)) + ")", str(item_text)]
return "\\n".join(parts)
""".strip()

APPEND_CODE = """
acc = list(results_so_far or [])
acc.append({"index": int(index or 0), "result": str(item_result or "")})
return acc
""".strip()

REDUCE_PROMPT_CODE = """
instr = str(reduce_instruction or "Synthesize the results into one coherent summary.").strip()
items = results or []
parts = [instr, "", "## Per-item results (" + str(len(items)) + ")"]
for r in items:
    if isinstance(r, dict):
        parts.append("- [" + str(r.get("index")) + "] " + str(r.get("result", ""))[:1200])
    else:
        parts.append("- " + str(r)[:1200])
return "\\n".join(parts)
""".strip()

FINAL_CODE = """
items = results or []
return {"results": items, "count": len(items)}
""".strip()


def build_flow():
    flow = W.base_flow(
        "map-reduce", "map-reduce",
        "Reusable batch primitive: map a per-item LLM instruction over an input array (ForEach), accumulate the per-item results, then reduce them with a synthesis LLM instruction. Returns the per-item results and the synthesized output.",
        ["abstractbatch.mapreduce.v1"],
    )
    fields = [
        W.pin("items", "items", "array"),
        W.pin("item_instruction", "item_instruction", "string"),
        W.pin("reduce_instruction", "reduce_instruction", "string"),
        W.pin("provider", "provider", "provider_text"),
        W.pin("model", "model", "model"),
    ]
    # Layout grid (2026-07-20 clean-layout pass): the main exec lane runs
    # left-to-right at y=0 (start -> init var -> foreach -> reduce -> end);
    # the LOOP BODY is a raised lane at y=-400 (map_llm -> set_acc) with its
    # pure helpers stacked above their consumers (map_prompt over map_llm;
    # get_acc -> append column over set_acc); the reduce/assemble pure
    # helpers sit in a row at y=380 under their consumers. Box model ~300
    # wide, 90+26*pins tall; every gap >= 60px.
    flow["nodes"] = [
        W.start_node("Items + instructions", fields, -1100, 0, pin_defaults={
            "item_instruction": "Process this item.",
            "reduce_instruction": "Synthesize the per-item results into one coherent answer.",
        }),
        # reset the accumulator var before the loop
        W.code_node("reset", "Reset accumulator", RESET_CODE, -700, 380, [], output_type="array"),
        W.set_var("init_acc", "Init results var", "mr.results", -700, 0),
        W.foreach_node("each", "Map over items", -300, 0),
        # body (raised loop lane)
        W.code_node("map_prompt", "Compose item prompt", MAP_PROMPT_CODE, 100, -660,
                    [W.pin("item", "item", "any"),
                     W.pin("index", "index", "number"),
                     W.pin("item_instruction", "item_instruction", "string")],
                    output_type="string"),
        W.llm_node("map_llm", "Per-item LLM", 100, -400, pin_defaults={
            "system": "You process one item at a time following the given instruction. Answer concisely.",
            "temperature": 0.2,
        }),
        W.get_var("get_acc", "mr.results", [], 500, -890),
        W.code_node("append", "Append result", APPEND_CODE, 500, -660,
                    [W.pin("results_so_far", "results_so_far", "array"),
                     W.pin("item_result", "item_result", "string"),
                     W.pin("index", "index", "number")],
                    output_type="array"),
        W.set_var("set_acc", "Persist results", "mr.results", 500, -400),
        # reduce (after loop, back on the main lane)
        W.get_var("get_all", "mr.results", [], -300, 380),
        W.code_node("reduce_prompt", "Compose reduce prompt", REDUCE_PROMPT_CODE, 100, 380,
                    [W.pin("results", "results", "array"),
                     W.pin("reduce_instruction", "reduce_instruction", "string")],
                    output_type="string"),
        W.llm_node("reduce_llm", "Reduce / synthesize LLM", 100, 0, pin_defaults={
            "system": "You synthesize many per-item results into one coherent, well-structured output.",
            "temperature": 0.3,
        }),
        W.get_var("get_final", "mr.results", [], 500, 380),
        W.code_node("final", "Assemble", FINAL_CODE, 900, 380,
                    [W.pin("results", "results", "array")]),
        W.get_node("get_results", "results", [], 1300, 380),
        W.get_node("get_count", "count", 0, 1300, 610),
        W.end_node("Map-reduce result", [
            W.pin("results", "results", "array"),
            W.pin("count", "count", "number"),
            W.pin("synthesis", "synthesis", "string"),
        ], 1300, 0),
    ]
    flow["edges"] = [
        # exec spine: init var -> foreach; loop body; done -> reduce -> end
        W.edge("start", "exec-out", "init_acc", "exec-in", animated=True),
        W.edge("init_acc", "exec-out", "each", "exec-in", animated=True),
        W.edge("each", "loop", "map_llm", "exec-in", animated=True),
        W.edge("map_llm", "exec-out", "set_acc", "exec-in", animated=True),
        W.edge("each", "done", "reduce_llm", "exec-in", animated=True),
        W.edge("reduce_llm", "exec-out", "end", "exec-in", animated=True),
        # init accumulator value from reset (pure)
        W.edge("reset", "output", "init_acc", "value"),
        W.edge("start", "items", "each", "items"),
        # per-item prompt
        W.edge("each", "item", "map_prompt", "item"),
        W.edge("each", "index", "map_prompt", "index"),
        W.edge("start", "item_instruction", "map_prompt", "item_instruction"),
        W.edge("map_prompt", "output", "map_llm", "prompt"),
        W.edge("start", "provider", "map_llm", "provider"),
        W.edge("start", "model", "map_llm", "model"),
        # append per-item result (append pure, pulled by set_acc.value)
        W.edge("get_acc", "value", "append", "results_so_far"),
        W.edge("map_llm", "response", "append", "item_result"),
        W.edge("each", "index", "append", "index"),
        W.edge("append", "output", "set_acc", "value"),
        # reduce prompt
        W.edge("get_all", "value", "reduce_prompt", "results"),
        W.edge("start", "reduce_instruction", "reduce_prompt", "reduce_instruction"),
        W.edge("reduce_prompt", "output", "reduce_llm", "prompt"),
        W.edge("start", "provider", "reduce_llm", "provider"),
        W.edge("start", "model", "reduce_llm", "model"),
        # final
        W.edge("get_final", "value", "final", "results"),
        W.edge("final", "output", "get_results", "object"),
        W.edge("final", "output", "get_count", "object"),
        W.edge("get_results", "value", "end", "results"),
        W.edge("get_count", "value", "end", "count"),
        W.edge("reduce_llm", "response", "end", "synthesis"),
    ]
    return flow


def main():
    flow = build_flow()
    # Fail LOUDLY on edge problems (the old build printed them and returned 0,
    # so a broken graph could ship green through automation).
    problems = W.validate_edges(flow)
    if problems:
        for p in problems:
            print(f"EDGE ERROR [map-reduce]: {p}")
        return 1
    W.write_json(W.FLOWS_DIR / "map-reduce.json", flow)
    print(f"wrote map-reduce.json ({len(flow['nodes'])} nodes, {len(flow['edges'])} edges)")
    W.compile_check("map-reduce", ["map-reduce"])
    print("compiled ok")
    # Repack the shipped bundle so the gateway serves the same graph as the
    # example JSON (bundle_version bumps are the release process's job).
    out = W.pack_bundle(
        root_flow_id="map-reduce",
        bundle_id="map-reduce",
        bundle_version="0.1.1",
        entrypoints=["map-reduce"],
        metadata={"family": "map-reduce", "purpose": "map-reduce"},
    )
    print(f"packed {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
