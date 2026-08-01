import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, JsonValue } from '../types/flow';

/**
 * Render-fold of single-consumer Get Variable nodes (0156 Stage 1).
 *
 * The DOCUMENT is untouched: the getter node and its edge stay in the flow
 * JSON, and the fold is a pure function of the graph — a getter folds when
 * exactly one wire leaves it. There is one persisted fact, so nothing can
 * drift; what changes is only what the canvas draws: the read appears as a
 * pill ON the consumer's pin row (the point of consumption) instead of a
 * separate node card.
 *
 * PREDICATE — a `get_var` node folds when ALL of:
 *   1. `pinDefaults.name` is a non-empty string (a configured read);
 *   2. it has NO incoming edges (a wired `name`/`default` pin means the read
 *      is computed — that is graph structure, keep it drawn);
 *   3. EXACTLY ONE edge leaves it, from the `value` pin (2+ consumers is a
 *      shared read — the node is the subject, keep it drawn);
 *   4. the target node exists.
 *
 * This predicate is duplicated in Python (`scripts/wf_common.py`,
 * `folded_getter_ids`) for layout and audit. The two implementations are held
 * together by tests asserting the same fold count on the same shipped flow —
 * change one, change both.
 *
 * Selection is deliberately NOT part of the predicate: a selected folded
 * getter is revealed by the CANVAS (so jump-to-counterpart works and marquee
 * selection never operates on invisible nodes) without changing what counts
 * as folded for layout or metrics.
 */

export interface FoldedRead {
  getterId: string;
  edgeId: string;
  consumerId: string;
  /** Input pin id on the consumer that receives the read. */
  pinId: string;
  /** Variable path being read (dotted paths supported by the runtime). */
  varName: string;
  defaultValue: JsonValue | undefined;
}

export interface FoldedGetters {
  /** Folded getter node id -> its read. */
  byGetter: Map<string, FoldedRead>;
  /** Consumer node id -> (input pin id -> read). */
  byConsumerPin: Map<string, Map<string, FoldedRead>>;
  /** Edge ids hidden by the fold. */
  edgeIds: Set<string>;
}

const EMPTY: FoldedGetters = {
  byGetter: new Map(),
  byConsumerPin: new Map(),
  edgeIds: new Set(),
};

export function computeFoldedGetters(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  enabled: boolean
): FoldedGetters {
  if (!enabled) return EMPTY;

  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, Edge[]>();
  const hasIncoming = new Set<string>();
  for (const e of edges) {
    const list = outgoing.get(e.source);
    if (list) list.push(e);
    else outgoing.set(e.source, [e]);
    hasIncoming.add(e.target);
  }

  const byGetter = new Map<string, FoldedRead>();
  const byConsumerPin = new Map<string, Map<string, FoldedRead>>();
  const edgeIds = new Set<string>();

  for (const node of nodes) {
    if (node.data?.nodeType !== 'get_var') continue;
    const rawName = node.data.pinDefaults?.name;
    const varName = typeof rawName === 'string' ? rawName.trim() : '';
    if (!varName) continue;
    if (hasIncoming.has(node.id)) continue;
    const outs = outgoing.get(node.id) || [];
    if (outs.length !== 1) continue;
    const edge = outs[0];
    if ((edge.sourceHandle || 'value') !== 'value') continue;
    const consumer = nodesById.get(edge.target);
    if (!consumer || !edge.targetHandle) continue;

    const read: FoldedRead = {
      getterId: node.id,
      edgeId: edge.id,
      consumerId: consumer.id,
      pinId: edge.targetHandle,
      varName,
      defaultValue: node.data.pinDefaults?.default as JsonValue | undefined,
    };
    byGetter.set(node.id, read);
    edgeIds.add(edge.id);
    let pins = byConsumerPin.get(consumer.id);
    if (!pins) {
      pins = new Map();
      byConsumerPin.set(consumer.id, pins);
    }
    pins.set(read.pinId, read);
  }

  return { byGetter, byConsumerPin, edgeIds };
}

/**
 * Run-time glow parity (0156 §5): execution decorations are NODE-keyed
 * (`executingNodeId`, `recentNodeIds`), so a folded getter would silently lose
 * its execution trace — the read still resolves at run time, but the card that
 * would have glowed is not drawn. The consumer's pin row carries the glow
 * instead, on the SAME ids, so a read is never less visible executing than a
 * drawn getter.
 */
export function isFoldedReadActive(
  read: FoldedRead | undefined,
  executingNodeId: string | null | undefined,
  recentNodeIds: Record<string, true> | null | undefined
): boolean {
  if (!read) return false;
  if (executingNodeId === read.getterId) return true;
  return Boolean(recentNodeIds && recentNodeIds[read.getterId]);
}
