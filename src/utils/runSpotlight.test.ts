import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import { spotlightEdges, spotlightNodes, spotlightTrail, withTrailStep } from './runSpotlight';
import { useFlowStore } from '../hooks/useFlow';

describe('run spotlight', () => {
  const nodes = [{ id: 'a', className: 'x' }, { id: 'b' }, { id: 'c' }] as Node[];
  const edges = [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'bc', source: 'b', target: 'c', className: 'route' },
    { id: 'ac', source: 'a', target: 'c' },
  ] as Edge[];

  it('lights the running node and its own wires only', () => {
    expect(spotlightNodes(nodes, 'b').map((n) => n.className)).toEqual(['x', 'is-spotlit', undefined]);
    expect(spotlightEdges(edges, 'b').map((e) => e.className)).toEqual(['is-spotlit', 'route is-spotlit', undefined]);
  });

  it('changes nothing when no node is running (or the spotlight is off)', () => {
    expect(spotlightNodes(nodes, null)).toBe(nodes);
    expect(spotlightEdges(edges, null)).toBe(edges);
  });

  // Operator 2026-10-11: the trail that led to the running node stays visible,
  // the last 3 nodes before it, fainter the further back.
  it('keeps the last three nodes before the running one, most recent first', () => {
    let recent: string[] = [];
    for (const id of ['start', 'plan', 'loop', 'show', 'exec']) recent = withTrailStep(recent, id);
    expect(recent).toEqual(['exec', 'show', 'loop', 'plan']);
    expect(spotlightTrail(recent, 'exec')).toEqual(['show', 'loop', 'plan']);
    // A node that runs again moves to the front instead of repeating.
    expect(withTrailStep(recent, 'show')).toEqual(['show', 'exec', 'loop', 'plan']);
    // Waiting on a node that is not the latest: the others form its trail.
    expect(spotlightTrail(recent, 'show')).toEqual(['exec', 'loop', 'plan']);
    expect(spotlightTrail(recent, null)).toEqual([]);
  });

  it('marks the trail nodes by distance and the wires between them', () => {
    const chain = [{ id: 'p' }, { id: 'q' }, { id: 'r' }, { id: 's' }, { id: 'far' }] as Node[];
    const wires = [
      { id: 'sr', source: 's', target: 'r' },
      { id: 'rq', source: 'r', target: 'q' },
      { id: 'qp', source: 'q', target: 'p' },
      { id: 'pfar', source: 'p', target: 'far' },
      { id: 'sq', source: 's', target: 'q' },
    ] as Edge[];
    const trail = ['q', 'r', 's'];
    expect(spotlightNodes(chain, 'p', trail).map((n) => n.className)).toEqual([
      'is-spotlit',
      'is-trail is-trail-1',
      'is-trail is-trail-2',
      'is-trail is-trail-3',
      undefined,
    ]);
    expect(spotlightEdges(wires, 'p', trail).map((e) => e.className)).toEqual([
      'is-trail is-trail-3', // s -> r
      'is-trail is-trail-2', // r -> q
      'is-spotlit', // q -> p, into the running node
      'is-spotlit', // p -> far, out of it
      undefined, // s -> q skips a step of the trail
    ]);
  });

  it('the store records each node that starts running, and a new run starts a new trail', () => {
    const store = useFlowStore.getState();
    store.resetExecutionDecorations();
    for (const id of ['a', 'b', 'b', 'c']) useFlowStore.getState().setExecutingNodeId(id);
    useFlowStore.getState().setExecutingNodeId(null);
    expect(useFlowStore.getState().executionTrail).toEqual(['c', 'b', 'a']);
    useFlowStore.getState().resetExecutionDecorations();
    expect(useFlowStore.getState().executionTrail).toEqual([]);
  });
});
