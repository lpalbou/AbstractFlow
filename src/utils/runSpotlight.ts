/**
 * Run spotlight (operator 2026-10-11, optional): while a run executes, every
 * node and wire except the running node (or the one waiting on a person) and
 * its own wires fades, in the full graph and in the execution view. The trail
 * that led there stays visible too: the last three nodes that ran before it,
 * each fainter and less vivid the further back it is, with the wires between
 * them. A canvas control turns it off; the choice is remembered in this
 * browser. Removing the feature = this file, its control in CanvasControls,
 * the store's `executionTrail` and its CSS block.
 */
import type { Edge, Node } from 'reactflow';

const STORAGE_KEY = 'abstractflow_run_spotlight';

export function loadRunSpotlight(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveRunSpotlight(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* private window / blocked storage: the choice lasts this session only */
  }
}

const SPOTLIT = 'is-spotlit';

/** How many nodes of the trail stay visible behind the spotlit node. */
export const TRAIL_LENGTH = 3;

/**
 * The nodes that ran just before the spotlit one, most recent first, from the
 * run's recent nodes (most recent first, the current one included).
 */
export function spotlightTrail(recent: readonly string[], spotlitId: string | null): string[] {
  if (!spotlitId) return [];
  return recent.filter((id) => id !== spotlitId).slice(0, TRAIL_LENGTH);
}

/** Record a node that starts running: most recent first, no repeats, just long enough for the trail. */
export function withTrailStep(recent: readonly string[], nodeId: string): string[] {
  return [nodeId, ...recent.filter((id) => id !== nodeId)].slice(0, TRAIL_LENGTH + 1);
}

function withClasses(className: string | undefined, added: string): string {
  return className ? `${className} ${added}` : added;
}

/**
 * The node in the spotlight gets `is-spotlit`, the trail `is-trail is-trail-1`
 * (just before) to `is-trail-3`; the others are left as they are (CSS fades them).
 */
export function spotlightNodes<N extends Node>(nodes: N[], spotlitId: string | null, trail: readonly string[] = []): N[] {
  if (!spotlitId) return nodes;
  return nodes.map((node) => {
    if (node.id === spotlitId) return { ...node, className: withClasses(node.className, SPOTLIT) };
    const step = trail.indexOf(node.id);
    return step >= 0 ? { ...node, className: withClasses(node.className, `is-trail is-trail-${step + 1}`) } : node;
  });
}

/**
 * The wires into and out of the spotlit node stay lit; a wire from one trail
 * node to the next (towards the spotlit node) takes that step's trail class.
 */
export function spotlightEdges<E extends Edge>(edges: E[], spotlitId: string | null, trail: readonly string[] = []): E[] {
  if (!spotlitId) return edges;
  const path = [spotlitId, ...trail];
  return edges.map((edge) => {
    if (edge.source === spotlitId || edge.target === spotlitId) return { ...edge, className: withClasses(edge.className, SPOTLIT) };
    for (let step = 1; step < path.length; step += 1) {
      if (edge.source === path[step] && edge.target === path[step - 1]) {
        return { ...edge, className: withClasses(edge.className, `is-trail is-trail-${step}`) };
      }
    }
    return edge;
  });
}
