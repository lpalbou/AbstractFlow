/**
 * Waits (operator 2026-10-25): the nodes that pause a run that is already
 * running, until a time or a named event. Their node types never changed
 * (`on_schedule`, `on_event`, `wait_event`, `emit_event` compile to the
 * runtime's WAIT_UNTIL / WAIT_EVENT / EMIT_EVENT exactly as before); only the
 * names the editor shows did:
 *
 * - `on_schedule` "On Schedule" → "Wait Until" (recurrent: "Wait Until · every 15s")
 * - `on_event`    "On Event"    → "Wait for Event" (name + scope; its own branch)
 * - `wait_event`  "Wait Event"  → "Wait for Event" (the step form: event key,
 *   question, choices, deadline). Not in the palette: a Wait for Event node
 *   switches to it under Advanced.
 *
 * A saved node keeps its saved label (so its file never changes on load and
 * save); the card shows the current name when the saved label is the default
 * an earlier version gave it. A label the author typed is shown as typed.
 */
import type { FlowNodeData, Pin } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';

/** The current name of each wait node type. */
export const WAIT_NODE_LABELS = Object.freeze({
  on_schedule: 'Wait Until',
  on_event: 'Wait for Event',
  wait_event: 'Wait for Event',
  emit_event: 'Emit Event',
} as const);

/** Default labels earlier versions gave these node types (shown under the current name). */
export const LEGACY_WAIT_LABELS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  on_schedule: ['On Schedule'],
  on_event: ['On Event'],
  wait_event: ['Wait Event'],
});

const INTERVAL_RE = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)\s*$/i;

function currentName(nodeType: string): string | null {
  return (WAIT_NODE_LABELS as Record<string, string>)[nodeType] ?? null;
}

/** Whether a node still carries its type's default name (current or earlier). */
export function hasDefaultWaitLabel(nodeType: string, label: string | undefined): boolean {
  const current = currentName(nodeType);
  if (!current) return false;
  const text = String(label ?? '').trim();
  if (!text) return true;
  return text === current || (LEGACY_WAIT_LABELS[nodeType] ?? []).includes(text);
}

/** The node's name without the schedule suffix (the Properties Label field). */
export function nodeDisplayName(data: Pick<FlowNodeData, 'nodeType' | 'label'>): string {
  const label = data.label ?? '';
  const nodeType = String(data.nodeType);
  return hasDefaultWaitLabel(nodeType, label) ? currentName(nodeType) ?? label : label;
}

/**
 * The name a node's card shows. Wait nodes with a default label
 * (current or earlier) read as the current name; a recurrent Wait Until on an
 * interval adds " · every 15s". Every other node: its saved label.
 */
export function nodeDisplayLabel(
  data: Pick<FlowNodeData, 'nodeType' | 'label' | 'eventConfig'>,
  options: { connectedInputs?: ReadonlySet<string> } = {}
): string {
  const nodeType = String(data.nodeType);
  const name = nodeDisplayName(data);
  if (nodeType !== 'on_schedule' || !hasDefaultWaitLabel(nodeType, data.label)) return name;
  const connected = options.connectedInputs;
  if (connected?.has('schedule') || connected?.has('recurrent')) return name;
  const recurrent = data.eventConfig?.recurrent ?? true;
  const schedule = String(data.eventConfig?.schedule ?? '').trim();
  if (!recurrent || !INTERVAL_RE.test(schedule)) return name;
  return `${name} · every ${schedule.replace(/\s+/g, '')}`;
}

/** The two forms of Wait for Event. */
export type WaitForEventForm = 'on_event' | 'wait_event';

export function isWaitForEventType(nodeType: string): nodeType is WaitForEventForm {
  return nodeType === 'on_event' || nodeType === 'wait_event';
}

/**
 * The node-data patch that switches a Wait for Event node to the other form
 * (one `updateNodeData` call: one undo step; the store drops the wires of pins
 * the other form does not have). Settings of the form left behind are cleared
 * (a name + scope cannot become an event key: the runtime derives the key from
 * the run's session), a label the author typed is kept.
 */
export function switchWaitForEventForm(data: FlowNodeData, to: WaitForEventForm): Partial<FlowNodeData> {
  const template = getNodeTemplate(to);
  if (!template) throw new Error(`No node template for '${to}'`);
  const fresh = createNodeData(template);
  const inputIds = new Set(fresh.inputs.map((p) => p.id));
  const keptDefaults = Object.fromEntries(
    Object.entries(data.pinDefaults ?? {}).filter(([id]) => inputIds.has(id))
  );
  return {
    nodeType: to,
    label: hasDefaultWaitLabel(String(data.nodeType), data.label) ? fresh.label : data.label,
    icon: fresh.icon,
    headerColor: fresh.headerColor,
    inputs: fresh.inputs,
    outputs: fresh.outputs,
    eventConfig: fresh.eventConfig,
    pinDefaults: Object.keys(keptDefaults).length > 0 ? keptDefaults : undefined,
  };
}

/** How many wires a form switch would drop (pins the other form does not have). */
export function wiresDroppedBySwitch(
  nodeId: string,
  to: WaitForEventForm,
  edges: ReadonlyArray<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>
): number {
  const template = getNodeTemplate(to);
  if (!template) return 0;
  const keepIn = new Set(template.inputs.map((p: Pin) => p.id));
  const keepOut = new Set(template.outputs.map((p: Pin) => p.id));
  return edges.filter(
    (e) =>
      (e.target === nodeId && !keepIn.has(e.targetHandle || '')) ||
      (e.source === nodeId && !keepOut.has(e.sourceHandle || ''))
  ).length;
}
