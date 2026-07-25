# 0151 — Deterministic camera nodes (tool_invoke effect)

- Status: completed (2026-07-22) — flow half shipped & adversary-clean;
  live proof pending the gateway bounce
- Work id: abstractflow-0151
- Thread anchor: laurent dm#49 (operator order, direct); camera c4149/c4292;
  runtime c4204/c4207/c4332; gateway c4316/c4325
- Owner: flow
- Depends on: AbstractRuntime `tool_invoke` effect (shipped c4207);
  camera `camera_*` tool surface; core `analyze_media` + `capability_tools`

## Problem

Camera capabilities are exposed as `camera_*` tools. An agent DECIDING to
call them is non-deterministic and approval-gated — right for an agent, wrong
for a deterministic workflow that MUST take a photo/video or analyze media on
an event. The operator ordered purpose-built deterministic NODES (dm#49):
capture with no agent deciding and no approval stall.

## Design (settled with runtime, c4204)

Rejected a per-effect "pre-approved" marker on `tool_calls` — a payload field
the handler trusts is payload-claimed authority (the door-stamp forgery class:
a model's discretionary call could stamp it through any field-copying ingest
lane). Adopted instead the **write_chart pattern generalized**: deterministic
fixed-verb nodes compile to their own `tool_invoke` effect. Because effects
are host-constructed from node types and a model cannot author an effect type,
the trust distinction (author = deterministic step, agent = gated discretionary
choice) is carried by the EFFECT CLASS, not a claimable field — structurally
forge-proof, zero cross-package invariants.

## What shipped (flow half)

- `src/types/flow.ts` — five node type strings in the `NodeType` union.
- `src/types/nodes.ts` — five node templates (category `media`): Camera Open,
  Capture Photo, Capture Video, Analyze Media, Camera Close. No tool-name pin
  by design; pin descriptions teach camera's two id spaces (discovery
  `camera_id` at Open, `device_uid` everywhere after).
- `abstractruntime/.../visualflow_compiler/visual/executor.py` (flow-authored,
  runtime-owner-reviewed c4332): `CAMERA_TOOL_INVOKE_VERBS` (node type → fixed
  verb) + `CAMERA_TOOL_INVOKE_ARG_PINS` (per-type arg whitelist);
  `_create_tool_invoke_handler` (`del data, config`; verb from the map;
  omit empty/None args); dispatch + `EFFECT_NODE_TYPES` membership.
- `abstractruntime/.../visualflow_compiler/compiler.py`: pending→effect path
  and the result mapping that carries `results[0].output` to typed
  `path`/`media`/`camera`/`analysis` pins with honest false-success handling;
  camera types correctly ABSENT from the workspace-root injection set (the
  camera package owns path selection).

## Verification

- tsc clean; `nodes.test` 3/3 green; `audit_flow_graph.py` clean on the
  deterministic `Open → Capture Photo → Analyze Media → Close` flow; that flow
  COMPILES OK through the real runtime compiler.
- Runtime owner review (c4332): APPROVED, invariant holds at all three sites,
  89 visualflow tests green, runtime added `test_camera_node_verb_is_baked_never_authored`.
- One fable5 adversary: SHIP-WITH-FIXES. The load-bearing verb-from-node-type
  invariant HOLDS under a maximally hostile document (a node carrying
  `effectConfig.name="execute_command"`, injected `name`/`tool_call`/`type`
  pins, and a rogue `command` arg pin compiled to `name="camera_capture_photo"`,
  `arguments={"camera":"uid-1"}` — no injection landed). Result mapping honest
  across every output shape; media survives capture→analyze; templates match
  the arg whitelist. Zero P0 in flow's code.

## The one fix (not flow's) + live-proof gate

The adversary's only P1 was a GATEWAY-package gap: `bundle_host._flow_uses_tools`
knew only `{tool_calls, agent}`, and the tools-only runtime branch registered
only `TOOL_CALLS` — so a camera-only flow (the operator's exact deterministic
shape, no LLM/agent node) deployed onto a runtime with no `TOOL_INVOKE` handler
and failed at execution. Escalated with a two-edit fix (c4316); gateway
verified + fixed both edges (c4325), lands next bounce. The live
watch-room → photo → analyze proof waits on that bounce AND on `analyze_media`
being served (core shipped it after the running gateway booted; a re-registered
bundle set will carry it).

## Honest limits / recorded decisions

- **Approval override is a recorded operator decision** (camera dm#10 / c4292):
  the deterministic capture nodes bypass camera's ruled approval-by-default
  privacy classification (c3938) BY DESIGN — that IS the dm#49 point. Named
  explicitly to laurent in the ship receipt so the override is on record, not
  a silent side effect.
- `camera_analyze_media`'s `file_path` is not workspace-wall-rewritten
  (correct by design — captures land outside the workspace and must be
  readable; the path is author-wired, not model-authored).

## LIVE PROOF (2026-07-23, post-bounce)

The gateway bounced (discovery 14→50 tools; all 11 camera_* + analyze_media
served; risk fields live). A published 5-node deterministic flow
(On Flow Start → Camera Open → Capture Photo → Analyze Media → Camera Close)
ran to `completed` on the live gateway:

- **ZERO approval waits** across the whole run — the deterministic-no-approval
  requirement (dm#49) proven by construction (tool_invoke effect, not an
  approve-all posture).
- Camera Open → real MacBook camera on, `device_uid` returned; Capture Photo →
  a REAL 52 KB 1920×1080 JPEG written to
  `/Users/albou/Pictures/macbook_pro_camera/capture_20260723_131801...jpg`
  (verified on disk); Camera Close → released cleanly (`connected:false`).
  No agent decided anything — the nodes did.
- Analyze Media failed HONESTLY on a host-config gap, not a node defect: it
  composed the correct `analyze_media` call with the wired `file_path` and
  invoked vision, failing with `success=false` + "no vision model is
  configured for delegated sight (Vision fallback is disabled)". The node's
  result mapping surfaced the error correctly (no crash, no silent pass).
  Completing the analyze leg is an operator `abstractcore --config` vision
  choice (model selection is the maintainer's) — reported to laurent (dm#53)
  with an offer to re-run the full loop once a VLM is named.
- Grant-wall safety confirmed by runtime c4451: a bundled camera flow can only
  capture if the runner granted the camera power (tool_invoke is
  availability-gated at gate-1) — deterministic AND safe, not a bypass.

## Follow-ups

- Re-run the full watch-room→photo→ANALYZE loop once the operator names a
  vision model (the only remaining leg; capture is proven).
- Camera offered a pin-description review against the tool teaching (c4292) —
  descriptions already carry the two-id-space teaching; confirm at receipt.
