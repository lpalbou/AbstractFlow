# 0159 — One fold for getters: drop the automatic read pill, keep the fold you control

- Status: PROPOSED 2026-10-11 (to discuss with the operator; nothing built).
- Owner: flow
- Related: 0156 (the read pill, Stage 1, shipped), root backlog 1008 (Add to List Variable node).

## Why

Operator, 2026-10-11, on a Get Variable drawn as the teal read pill on its consumer's pin row:
"for a get variable name, i don't like that you automatically collapse it and on mouse over it
expands... (a) i don't like things changing shape like that without my control (b) it creates several
folding mechanisms." Asked how to do the removal (with the layout knock-on below): "skip it... seems
complicated; create a backlog proposed item to discuss it".

Getters now have two folds:

1. **Automatic read pill** (0156 Stage 1): a `get_var` with a set `name`, no incoming wire and exactly
   one outgoing wire is not drawn; its read shows as a pill on the consumer's pin row; clicking the pill
   reveals and selects the node. Toolbar toggle "Toggle folded reads", on by default.
2. **User fold** (2026-10-11, unreleased): the node header's fold button, double-click, or tap folds
   a getter into a rounded block showing the variable name (`data.collapsed`, the same mechanism as
   the operator circles). Getters feeding a folded operator are kept drawn
   (`Canvas.tsx` `foldedOperatorIds`).

## Current code reality (2026-10-11)

- Editor: `src/utils/foldedGetters.ts` (`computeFoldedGetters`, `isFoldedReadActive`),
  `src/hooks/foldedGettersContext.ts`, `src/components/Canvas.tsx` (~332–354 fold, reveal on
  selection, hidden nodes/edges ~993–1135), `src/components/nodes/BaseNode.tsx` (pill ~4370–4396),
  `src/hooks/useFlow.ts` (`foldReads` state, default `true` ~657; fold-aware logic ~597–601),
  `src/utils/validation.ts:294`, `src/components/Toolbar.tsx` toggle ~2097–2108, CSS
  `.folded-read-pill*` in `src/styles/nodes.css`, test `src/utils/foldedGetters.test.ts`.
- Python twin: `scripts/wf_common.py` `folded_getter_ids` (:941), used by `apply_flow_layout`
  (folded getters get no column cell; they are docked in the consumer's left gutter) and
  `layout_overlap_findings`; `scripts/audit_flow_graph.py` (`rendered_nodes`);
  `scripts/dump_folded.py` (parity check against the TS predicate).
- **Layout knock-on, measured 2026-10-11** over `examples/flows/*.json`: 36 flows carry 366
  auto-folded getters (multiagent-coding 87, ralph-coding 68, co-scientist 56, react-coding 45, ...).
  Drawn at their docked positions, 344 of 366 overlap another node as full cards and 278 of 366 as
  user-folded blocks (~110×62): the docked spots sit 26 px apart on the consumer's pin rows. Turning
  the toolbar toggle off today shows exactly this.

## Options to discuss

- **A. Remove the pill and relayout.** Delete the pill, its toggle, the context and the Python twin;
  `apply_flow_layout` gives getters a column cell again (with the 0156 box-size and per-consumer
  placement fixes kept); re-run the layout over the 36 example flows and gate on the zero-overlap
  audit; rebuild the shipped gateway bundles built from them (needs a release go). Medium size,
  two repos.
- **B. Remove the pill only.** Editor change only; the example flows overlap until a later relayout.
- **C. Keep the pill, default it off.** Smallest; still two mechanisms, which is objection (b).

And, after A: should the example flows store their getters **folded** (`collapsed: true`, compact
like today, the operator unfolds any one) or as **full cards** (larger canvases, the operator folds
what they want)?

## Promotion criteria

An operator choice among A/B/C and on the stored getter look.
