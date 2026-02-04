# VisualFlow (portable JSON workflow format)

`VisualFlow` is the portable workflow document produced by the visual editor in `web/frontend/` and persisted by the backend in `web/backend/`.

The schema lives in `abstractflow/visual/models.py` (Pydantic models). Any host can:
- load/validate the JSON into `VisualFlow`
- execute it using `abstractflow.visual` helpers

See also: `docs/getting-started.md`, `docs/faq.md`, `docs/web-editor.md`, `docs/architecture.md`.

## Minimal schema (what to expect)

- `VisualFlow`
  - `id: str`
  - `name: str`, `description: str`
  - `interfaces: list[str]` (optional host contracts)
  - `nodes: list[VisualNode]`, `edges: list[VisualEdge]`
  - `entryNode: str | null` (optional, Blueprint-style execution root)
- `VisualNode`
  - `id: str`, `type: NodeType`, `position: {x,y}`
  - `data: dict` (node config + pin metadata)
- `VisualEdge`
  - `source`, `sourceHandle`, `target`, `targetHandle`

Evidence: `abstractflow/visual/models.py`.

## Node types and pins

- The full list of node types is `NodeType` in `abstractflow/visual/models.py`.
- Pin types are `PinType` in `abstractflow/visual/models.py` (and mirrored for UI concerns in `web/frontend/src/types/flow.ts`).

Two edge “kinds” are used by convention:
- **Execution edges**: connect to the target handle `exec-in` (Blueprint-style control flow).
- **Data edges**: connect non-exec handles and carry values between pins.

Evidence:
- VisualFlow runner wiring uses execution-graph reachability (`targetHandle == "exec-in"`) in `abstractflow/visual/executor.py`.
- UI colors data edges by pin type in `web/frontend/src/components/Canvas.tsx`.

Note on pins in saved JSON:
- The editor persists pin definitions under `node.data.inputs` / `node.data.outputs`.
- The top-level `node.inputs` / `node.outputs` fields may be present but empty.

Evidence: `abstractflow/visual/interfaces.py` (`_pin_types` reads `node.data.*`) and sample flows in `web/flows/*.json`.

## Subflows

Subflows are regular VisualFlows referenced by id from a node of type `subflow`.

Convention:
- `node.type == "subflow"`
- `node.data["subflowId"]` holds the referenced flow id (legacy key `flowId` is tolerated).

Evidence:
- Runner wiring resolves subflows in `abstractflow/visual/executor.py` (`subflowId` / legacy `flowId`)
- Bundle packing is delegated to AbstractRuntime via `abstractflow/workflow_bundle.py` (see `tests/test_workflow_bundle_pack.py`).
- Tests: `tests/test_visual_subflow_*.py`, `tests/test_workflow_bundle_pack.py`

## Interfaces (optional host contracts)

`VisualFlow.interfaces` is a list of interface markers a host can interpret as “this workflow supports a known IO contract”.

AbstractFlow ships:
- `abstractcode.agent.v1` (`ABSTRACTCODE_AGENT_V1`) with validators and scaffolding helpers

Evidence: `abstractflow/visual/interfaces.py`.
