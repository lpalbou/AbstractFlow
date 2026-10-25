import { BREAK_EMAIL_HINT, BREAK_EMAIL_LABEL, EMAIL_SCHEMA } from './emailType';
/**
 * Relays (operator 2026-10-11): a dot on the canvas that lets one output feed
 * several inputs along a tidy path. Visual only: the runtime rewires every
 * chain source -> target before compiling (abstractruntime
 * visual/reroute_lowering.py). Data wires only.
 *
 * A relay's pins take the type of the output that feeds it (through other
 * relays if chained), so the editor's usual type checks apply to whatever the
 * relay feeds; an unfed relay is `any`.
 */
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, NodeType, Pin, PinType } from '../types/flow';

export const RELAY_TYPE = 'reroute';

export function isRelay(node: { data?: Pick<FlowNodeData, 'nodeType'> } | undefined | null): boolean {
  return node?.data?.nodeType === RELAY_TYPE;
}

/** The type a relay carries: its source's output type, followed through chained relays. */
function relaySourceType(relayId: string, nodesById: Map<string, Node<FlowNodeData>>, edges: Edge[]): PinType {
  const seen = new Set<string>();
  let current = relayId;
  for (;;) {
    if (seen.has(current)) return 'any';
    seen.add(current);
    const feed = edges.find((e) => e.target === current && e.targetHandle === 'in');
    if (!feed) return 'any';
    const source = nodesById.get(feed.source);
    if (!source) return 'any';
    if (!isRelay(source)) {
      const pin = source.data.outputs.find((p) => p.id === feed.sourceHandle);
      return pin && pin.type !== 'execution' ? pin.type : 'any';
    }
    current = source.id;
  }
}

function retyped(pins: Pin[], type: PinType): Pin[] {
  return pins.map((p) => (p.type === type ? p : { ...p, type }));
}

/** The same nodes, with each relay's pins typed by what feeds it (unchanged nodes keep their identity). */
export function withRelayTypes(nodes: Node<FlowNodeData>[], edges: Edge[]): Node<FlowNodeData>[] {
  if (!nodes.some(isRelay)) return nodes;
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  let changed = false;
  const next = nodes.map((node) => {
    if (!isRelay(node)) return node;
    const type = relaySourceType(node.id, nodesById, edges);
    if (node.data.inputs.every((p) => p.type === type) && node.data.outputs.every((p) => p.type === type)) return node;
    changed = true;
    return { ...node, data: { ...node.data, inputs: retyped(node.data.inputs, type), outputs: retyped(node.data.outputs, type) } };
  });
  return changed ? next : nodes;
}

export type DropChoice = 'if' | 'relay' | 'break_object' | 'break_email' | 'foreach';

/**
 * The typed lists ForEach takes as its `items` (an array of something): a plain
 * array, a list of emails, of files, of KG assertions, of tool names.
 */
export const LIST_PIN_TYPES: ReadonlySet<PinType> = new Set<PinType>([
  'array',
  'emails',
  'artifacts',
  'artifacts_image',
  'artifacts_audio',
  'artifacts_text',
  'artifacts_video',
  'assertions',
  'tools',
]);

/**
 * What the wire-drop menu offers for a pin a drag started from and released on
 * empty canvas: from a boolean output, an If/Else on that condition first (the
 * usual next step, operator 2026-10-17); from an Email output, Break Email
 * (every field, typed, operator 2026-10-25); from a list output, ForEach over
 * it (the only loop a list feeds directly: For counts numbers, While tests a
 * condition, Loop Limit caps a repeating path); a relay for any data pin; from
 * an object (or any) output, a Break Object too. Execution pins get nothing
 * (relays carry data only).
 */
export function dropChoicesFor(pinType: PinType | undefined, side: 'source' | 'target'): DropChoice[] {
  if (!pinType || pinType === 'execution') return [];
  if (side !== 'source') return ['relay'];
  if (pinType === 'boolean') return ['if', 'relay'];
  if (pinType === 'email') return ['break_email', 'relay'];
  if (LIST_PIN_TYPES.has(pinType)) return ['foreach', 'relay'];
  return pinType === 'object' || pinType === 'any' ? ['relay', 'break_object'] : ['relay'];
}

/** A drop choice's name and plain-words hint in the menu (the hint can name what the pin carries). */
export function dropChoiceCopy(choice: DropChoice, pinType?: PinType): { label: string; hint: string } {
  switch (choice) {
    case 'if':
      return { label: 'If/Else', hint: 'Branch on this condition: wire its true and false outputs to the next steps' };
    case 'relay':
      return { label: 'Relay', hint: 'A dot to route this wire; connect it to as many inputs as needed' };
    case 'break_object':
      return { label: 'Break Object', hint: 'Expose fields of this object as separate outputs' };
    case 'break_email':
      return { label: BREAK_EMAIL_LABEL, hint: BREAK_EMAIL_HINT };
    case 'foreach': {
      const each = pinType === 'emails' ? 'email' : 'item';
      return { label: 'ForEach', hint: `Run the next steps once for each ${each}: wire them to loop, and what comes after the last ${each} to done` };
    }
  }
}

/** The node a drop choice creates (by type, and label for a preset) and its pin the dragged wire connects to. */
export function dropChoiceNode(choice: DropChoice, side: 'source' | 'target'): { type: NodeType; label?: string; pin: string } {
  switch (choice) {
    case 'relay':
      return { type: RELAY_TYPE as NodeType, pin: side === 'source' ? 'in' : 'out' };
    case 'if':
      return { type: 'if', pin: 'condition' };
    case 'break_object':
      return { type: 'break_object', pin: 'object' };
    case 'break_email':
      return { type: 'break_object', label: BREAK_EMAIL_LABEL, pin: 'object' };
    case 'foreach':
      return { type: 'loop', pin: 'items' };
  }
}

/**
 * The type a wired input receives: the output feeding it, followed through
 * relays (an unwired input, or an unfed relay, gives undefined).
 */
export function wiredSourceType(nodes: Node<FlowNodeData>[], edges: Edge[], nodeId: string, pinId: string): PinType | undefined {
  const wire = edges.find((e) => e.target === nodeId && e.targetHandle === pinId);
  if (!wire) return undefined;
  const source = nodes.find((n) => n.id === wire.source);
  if (!source) return undefined;
  if (isRelay(source)) {
    const type = relaySourceType(source.id, new Map(nodes.map((n) => [n.id, n])), edges);
    return type === 'any' && !edges.some((e) => e.target === source.id) ? undefined : type;
  }
  const pin = source.data.outputs.find((p) => p.id === wire.sourceHandle);
  return pin && pin.type !== 'execution' ? pin.type : undefined;
}

/**
 * ForEach's `item` takes the type of what it iterates when that is a typed
 * list (operator wave 2026-10-25): over an `emails` list each item is an
 * `email`, so Email fields and the Mail nodes take it as it is. Any other
 * list gives `any` (as before). Returns the same array when nothing changed.
 */
export function withLoopItemTypes(nodes: Node<FlowNodeData>[], edges: Edge[]): Node<FlowNodeData>[] {
  if (!nodes.some((n) => n.data?.nodeType === 'loop')) return nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let changed = false;
  const next = nodes.map((node) => {
    if (node.data?.nodeType !== 'loop') return node;
    const wire = edges.find((e) => e.target === node.id && e.targetHandle === 'items');
    const sourcePin = wire ? byId.get(wire.source)?.data.outputs.find((p) => p.id === wire.sourceHandle) : undefined;
    const itemType: PinType = sourcePin?.type === 'emails' ? 'email' : 'any';
    const item = node.data.outputs.find((p) => p.id === 'item');
    if (!item || item.type === itemType) return node;
    changed = true;
    const outputs = node.data.outputs.map((p) =>
      p.id === 'item'
        ? itemType === 'email'
          ? { ...p, type: itemType, schema: EMAIL_SCHEMA, description: 'The current email.' }
          : { id: p.id, label: p.label, type: itemType }
        : p
    );
    return { ...node, data: { ...node.data, outputs } };
  });
  return changed ? next : nodes;
}
