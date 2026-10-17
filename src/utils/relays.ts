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
import type { FlowNodeData, Pin, PinType } from '../types/flow';

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

export type DropChoice = 'if' | 'relay' | 'break_object';

/**
 * What the wire-drop menu offers for a pin a drag started from and released on
 * empty canvas: from a boolean output, an If/Else on that condition first (the
 * usual next step, operator 2026-10-17); a relay for any data pin; from an
 * object (or any) output, a Break Object too. Execution pins get nothing
 * (relays carry data only).
 */
export function dropChoicesFor(pinType: PinType | undefined, side: 'source' | 'target'): DropChoice[] {
  if (!pinType || pinType === 'execution') return [];
  const choices: DropChoice[] = side === 'source' && pinType === 'boolean' ? ['if', 'relay'] : ['relay'];
  if (side === 'source' && (pinType === 'object' || pinType === 'any')) choices.push('break_object');
  return choices;
}
