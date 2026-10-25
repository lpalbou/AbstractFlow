/**
 * A new automation flow that runs as is (UX review 2026-10-25 #20: "the new
 * flow does nothing and says nothing"). After On Flow Start and the wired
 * Trigger event node, this adds:
 *
 *   On Flow Start ──exec──▶ Agent ──exec──▶ On Flow End
 *   prompt ─┐                ▲ prompt          response / success / meta
 *           ├─ String Template "New items" ─┘  (feeds, webhooks, mail)
 *   Trigger event events|data ─┘
 *
 * The Agent receives the task (`prompt`) and, when something arrives, what
 * arrived (a feed's or webhook's `events`, a mail trigger's `data`), written
 * into its prompt by a String Template; provider and model come from On Flow
 * Start (empty = the gateway's default). Pure: nodes and edges in, nodes and
 * edges out.
 */
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types/flow';
import { TRIGGER_EVENT_NODE_LABEL, TRIGGER_EVENT_PIN_ID } from './triggerEvent';

/** Which trigger output carries what arrived, by the kind of trigger. */
export type ArrivalKind = 'items' | 'mail' | 'none';

export function arrivalKindOf(sourceId: string, usesTriggerConnection: boolean): ArrivalKind {
  if (usesTriggerConnection) return 'items';
  if (sourceId.startsWith('email')) return 'mail';
  return 'none';
}

/** The note the canvas shows on a new automation flow. */
export function automationNextNote(kind: ArrivalKind): string {
  return kind === 'none'
    ? 'Next: tell the Agent what to do under Automation → What each run is asked to do.'
    : 'Next: tell the Agent what to do with the new items under Automation → What each run is asked to do.';
}

export const NEW_ITEMS_TEMPLATE = '{{task}}\n\nWhat arrived (one entry per new item):\n{{items | json}}';

type MakeNode = (type: string, position: { x: number; y: number }) => Node<FlowNodeData>;

/**
 * Wire the Agent (and, for arrivals, the "New items" template) between On
 * Flow Start and On Flow End. `makeNode` builds a node of a palette type
 * with a fresh id. Throws when the start or the Trigger event node is missing
 * (the caller adds them first).
 */
export function withAutomationAgent(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  kind: ArrivalKind,
  makeNode: MakeNode
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const start = nodes.find((n) => n.data.nodeType === 'on_flow_start');
  if (!start) throw new Error('The automation flow needs On Flow Start first.');
  const trigger = edges.find((e) => e.source === start.id && e.sourceHandle === TRIGGER_EVENT_PIN_ID);
  const triggerNode = trigger ? nodes.find((n) => n.id === trigger.target && n.data.label === TRIGGER_EVENT_NODE_LABEL) : undefined;
  let end = nodes.find((n) => n.data.nodeType === 'on_flow_end');
  const out: Node<FlowNodeData>[] = [...nodes];
  if (!end) {
    end = makeNode('on_flow_end', { x: start.position.x + 1280, y: start.position.y });
    out.push(end);
  } else {
    end = { ...end, position: { x: start.position.x + 1280, y: start.position.y } };
    out.splice(out.findIndex((n) => n.id === end!.id), 1, end);
  }
  const agent = makeNode('agent', { x: start.position.x + 900, y: start.position.y });
  out.push(agent);
  const next: Edge[] = [...edges];
  const link = (source: Node<FlowNodeData>, sourceHandle: string, target: Node<FlowNodeData>, targetHandle: string) => {
    const hasOut = source.data.outputs.some((p) => p.id === sourceHandle);
    const hasIn = target.data.inputs.some((p) => p.id === targetHandle);
    if (hasOut && hasIn) next.push({ id: `edge-${source.id}-${sourceHandle}-${target.id}-${targetHandle}`, source: source.id, sourceHandle, target: target.id, targetHandle });
  };
  link(start, 'exec-out', agent, 'exec-in');
  link(agent, 'exec-out', end, 'exec-in');
  link(start, 'provider', agent, 'provider');
  link(start, 'model', agent, 'model');
  const itemsHandle = kind === 'items' ? 'data.events' : kind === 'mail' ? 'data' : '';
  if (itemsHandle && triggerNode && triggerNode.data.outputs.some((p) => p.id === itemsHandle)) {
    const template = makeNode('string_template', { x: start.position.x + 620, y: start.position.y + 220 });
    template.data = {
      ...template.data,
      label: 'New items',
      inputs: [
        ...template.data.inputs,
        { id: 'task', label: 'task', type: 'string', description: 'What each run is asked to do.' },
        { id: 'items', label: 'items', type: kind === 'items' ? 'array' : 'object', description: 'What arrived.' },
      ],
      pinDefaults: { ...(template.data.pinDefaults || {}), template: NEW_ITEMS_TEMPLATE },
    } as FlowNodeData;
    out.push(template);
    link(start, 'prompt', template, 'task');
    link(triggerNode, itemsHandle, template, 'items');
    link(template, 'result', agent, 'prompt');
  } else {
    link(start, 'prompt', agent, 'prompt');
  }
  for (const pin of ['response', 'success', 'meta']) link(agent, pin, end, pin);
  return { nodes: out, edges: next };
}
