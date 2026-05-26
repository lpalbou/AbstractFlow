# Proposed: Flow Connection Drop Action Menu

## Metadata
- Created: 2026-05-25
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
Users expect Blueprint-style graph authoring: drag from a pin, drop on empty canvas, see compatible
actions/nodes, choose one to create and auto-connect, or click outside to cancel.

## Current code reality
- `web/frontend/src/components/Canvas.tsx` tracks `activeConnection` and receives `onConnectEnd`,
  but currently clears connection state when the drag ends.
- `validateConnection` is the canonical pin compatibility gate and should remain the source of
  truth for filtering candidate actions.
- Node creation already flows through `addNode(template, position)`.

## Problem or opportunity
Dropping an unfinished edge on the canvas currently does nothing. That slows authoring and
encourages users to manually search for compatible nodes.

## Proposed direction
Add a small action menu opened from `onConnectEnd` only when the connection did not end on a
handle. The menu should be positioned at the drop point, list compatible node templates by running
the same validation contract against candidate pins, create the chosen node, and connect the
original pin to the first selected compatible pin.

## Why it might matter
This makes graph construction faster while keeping pin compatibility centralized and visible.

## Promotion criteria
- Core pin state and validation regressions are stable.
- A design pass defines how action results are ranked and how reverse target-pin drags should be
  represented.

## Validation ideas
- Frontend component or browser test: output-pin drop opens menu, choosing a compatible node
  creates node plus edge, outside click cancels.
- Validation test: incompatible templates do not appear.
- Build gate for TypeScript/React changes.

## Non-goals
- Do not bypass `validateConnection`.
- Do not create hidden route overrides or implicit variable aliases.
- Do not mix this with run lifecycle or Code-node execution changes.

## Guidance for future agents
Keep the first implementation narrow: one menu, candidate filtering from templates, create +
connect. Avoid adding a second connection validation path.
