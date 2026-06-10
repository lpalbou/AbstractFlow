/**
 * Execution view ("condensed" canvas mode) helpers.
 *
 * The execution view shows only the control-flow skeleton of a graph: nodes
 * linked by execution edges, and those edges. Everything here is pure logic so
 * it can be unit-tested independently of React Flow rendering:
 *
 * - exec edge detection (by pin types, with exec-in/exec-out id fallback)
 * - exec subgraph extraction (which nodes stay visible)
 * - node family classification (events, control flow, interaction, generative,
 *   media, tools/files, memory, subflow, logic) used for per-family
 *   iconography, shape, and color in the compact rendering.
 */

import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, Pin } from '../types/flow';

export type ExecNodeFamily =
  | 'event'
  | 'control'
  | 'interaction'
  | 'generative'
  | 'media'
  | 'io'
  | 'memory'
  | 'subflow'
  | 'logic';

export const EXEC_FAMILY_LABELS: Record<ExecNodeFamily, string> = {
  event: 'Event',
  control: 'Control flow',
  interaction: 'User interaction',
  generative: 'Generative AI',
  media: 'Generated media',
  io: 'Tools & files',
  memory: 'Memory',
  subflow: 'Subflow',
  logic: 'Logic & state',
};

const CONTROL_TYPES = new Set(['if', 'switch', 'sequence', 'parallel', 'loop', 'while', 'for']);
const INTERACTION_TYPES = new Set(['ask_user', 'answer_user', 'listen_voice']);
const GENERATIVE_TYPES = new Set(['llm_call', 'agent']);
const MEDIA_TYPES = new Set([
  'generate_image',
  'edit_image',
  'image_to_image',
  'upscale_image',
  'generate_video',
  'text_to_video',
  'image_to_video',
  'generate_voice',
  'generate_music',
  'transcribe_audio',
]);
const IO_TYPES = new Set([
  'tool_calls',
  'call_tool',
  'function',
  'read_file',
  'write_file',
  'read_pdf',
  'write_pdf',
  'model_residency',
]);
// Event-ish types that do not match the on_*/wait_*/emit_* prefixes.
const EVENT_TYPES = new Set(['delay']);

/**
 * Classify a node type into a visual family for the execution view.
 *
 * Prefix rules (on_*, wait_*, emit_*, memory_*) keep the classification
 * robust for future node types; explicit sets cover the rest.
 */
export function execNodeFamily(nodeType: string | null | undefined): ExecNodeFamily {
  const t = String(nodeType || '').trim();
  if (!t) return 'logic';
  if (t === 'subflow') return 'subflow';
  if (t.startsWith('on_') || t.startsWith('wait_') || t.startsWith('emit_') || EVENT_TYPES.has(t)) return 'event';
  if (CONTROL_TYPES.has(t)) return 'control';
  if (INTERACTION_TYPES.has(t)) return 'interaction';
  if (GENERATIVE_TYPES.has(t)) return 'generative';
  if (MEDIA_TYPES.has(t)) return 'media';
  if (IO_TYPES.has(t)) return 'io';
  if (t.startsWith('memory_') || t === 'memact_compose') return 'memory';
  return 'logic';
}

function pinType(pins: readonly Pin[] | undefined, handleId: string): string {
  if (!handleId) return '';
  for (const pin of pins || []) {
    if (pin.id === handleId) return String(pin.type || '');
  }
  // Convention fallback: exec handles use these ids even when a node's pin
  // list is missing/stale (mirrors Canvas connection-start behavior).
  if (handleId === 'exec-in' || handleId === 'exec-out') return 'execution';
  return '';
}

/** True when the edge connects execution pins (control flow), not data pins. */
export function isExecEdge(nodesById: Map<string, Node<FlowNodeData>>, edge: Edge): boolean {
  const source = nodesById.get(edge.source);
  const target = nodesById.get(edge.target);
  const sourceType = pinType(source?.data?.outputs, String(edge.sourceHandle || ''));
  const targetType = pinType(target?.data?.inputs, String(edge.targetHandle || ''));
  return sourceType === 'execution' || targetType === 'execution';
}

export interface ExecSubgraph {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

/**
 * Execution subgraph: every node incident to at least one execution edge plus
 * those edges. Nodes only wired through data edges are excluded.
 */
export function computeExecSubgraph(nodes: Node<FlowNodeData>[], edges: Edge[]): ExecSubgraph {
  const byId = new Map<string, Node<FlowNodeData>>();
  for (const node of nodes) byId.set(node.id, node);
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (!isExecEdge(byId, edge)) continue;
    edgeIds.add(edge.id);
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  return { nodeIds, edgeIds };
}

/** Node ids that participate in the execution flow. */
export function computeExecNodeIds(nodes: Node<FlowNodeData>[], edges: Edge[]): Set<string> {
  return computeExecSubgraph(nodes, edges).nodeIds;
}

/** Execution pins of a node, split by direction (order preserved). */
export function execPins(data: FlowNodeData): { inputs: Pin[]; outputs: Pin[] } {
  const inputs = (data.inputs || []).filter((p) => p.type === 'execution');
  const outputs = (data.outputs || []).filter((p) => p.type === 'execution');
  return { inputs, outputs };
}
