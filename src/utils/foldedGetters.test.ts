import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, VisualFlow } from '../types/flow';
import { computeFoldedGetters, isFoldedReadActive } from './foldedGetters';

function getter(id: string, name: string, dflt?: unknown): Node<FlowNodeData> {
  return {
    id,
    type: 'get_var',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'get_var',
      label: `Get ${name}`,
      icon: '',
      headerColor: '',
      inputs: [
        { id: 'name', label: 'name', type: 'string' },
        { id: 'default', label: 'default', type: 'any' },
      ],
      outputs: [{ id: 'value', label: 'value', type: 'any' }],
      pinDefaults: dflt === undefined ? { name } : { name, default: dflt as never },
    },
  } as Node<FlowNodeData>;
}

function consumer(id: string): Node<FlowNodeData> {
  return {
    id,
    type: 'code',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'code',
      label: id,
      icon: '',
      headerColor: '',
      inputs: [
        { id: 'exec-in', label: '', type: 'execution' },
        { id: 'a', label: 'a', type: 'any' },
        { id: 'b', label: 'b', type: 'any' },
      ],
      outputs: [{ id: 'exec-out', label: '', type: 'execution' }],
    },
  } as Node<FlowNodeData>;
}

function edge(id: string, source: string, target: string, targetHandle: string, sourceHandle = 'value'): Edge {
  return { id, source, sourceHandle, target, targetHandle };
}

describe('computeFoldedGetters', () => {
  it('folds a configured single-consumer getter onto the consumer pin', () => {
    const nodes = [getter('g1', 'fix_cycles', 0), consumer('c1')];
    const edges = [edge('e1', 'g1', 'c1', 'a')];
    const folded = computeFoldedGetters(nodes, edges, true);
    expect(folded.byGetter.get('g1')).toMatchObject({
      consumerId: 'c1',
      pinId: 'a',
      varName: 'fix_cycles',
      defaultValue: 0,
    });
    expect(folded.byConsumerPin.get('c1')?.get('a')?.getterId).toBe('g1');
    expect(folded.edgeIds.has('e1')).toBe(true);
  });

  it('never folds a shared getter (2+ consumers) — the node is the subject', () => {
    const nodes = [getter('g1', 'provider'), consumer('c1'), consumer('c2')];
    const edges = [edge('e1', 'g1', 'c1', 'a'), edge('e2', 'g1', 'c2', 'a')];
    expect(computeFoldedGetters(nodes, edges, true).byGetter.size).toBe(0);
  });

  it('never folds an unconfigured getter (no name)', () => {
    const g = getter('g1', '');
    const nodes = [g, consumer('c1')];
    expect(computeFoldedGetters(nodes, [edge('e1', 'g1', 'c1', 'a')], true).byGetter.size).toBe(0);
  });

  it('never folds a getter whose name/default pin is WIRED — a computed read is graph structure', () => {
    const nodes = [getter('g1', 'x'), getter('g2', 'name_source'), consumer('c1')];
    const edges = [
      edge('e0', 'g2', 'g1', 'name'),
      edge('e1', 'g1', 'c1', 'a'),
    ];
    const folded = computeFoldedGetters(nodes, edges, true);
    expect(folded.byGetter.has('g1')).toBe(false);
    // g2 feeds g1.name — g1 is its single consumer, so g2 itself folds onto g1.
    expect(folded.byGetter.has('g2')).toBe(true);
  });

  it('never folds a dangling getter (0 consumers) — it must stay visible to be found', () => {
    const nodes = [getter('g1', 'x'), consumer('c1')];
    expect(computeFoldedGetters(nodes, [], true).byGetter.size).toBe(0);
  });

  it('returns empty when disabled', () => {
    const nodes = [getter('g1', 'x'), consumer('c1')];
    const edges = [edge('e1', 'g1', 'c1', 'a')];
    expect(computeFoldedGetters(nodes, edges, false).byGetter.size).toBe(0);
  });

  it('two getters can fold onto two pins of one consumer', () => {
    const nodes = [getter('g1', 'x'), getter('g2', 'y'), consumer('c1')];
    const edges = [edge('e1', 'g1', 'c1', 'a'), edge('e2', 'g2', 'c1', 'b')];
    const folded = computeFoldedGetters(nodes, edges, true);
    expect(folded.byConsumerPin.get('c1')?.size).toBe(2);
  });

  it('folds the great majority of the shipped multiagent-coding flow’s getters', () => {
    const flow = loadFlow('multiagent-coding');
    const getters = flow.nodes.filter((n) => n.data?.nodeType === 'get_var');
    const folded = computeFoldedGetters(reactFlowNodes(flow), flow.edges as unknown as Edge[], true);
    expect(getters.length).toBeGreaterThanOrEqual(80);
    const shared = getters.length - folded.byGetter.size;
    // The unfolded remainder is the shared cluster chips (provider/model) —
    // small and stable. Guard the shape, not a magic number that churns.
    expect(folded.byGetter.size).toBeGreaterThanOrEqual(getters.length - 10);
    expect(shared).toBeLessThanOrEqual(10);
  });
});

describe('isFoldedReadActive (run-glow parity)', () => {
  const nodes = [getter('g1', 'fix_cycles', 0), consumer('c1')];
  const read = computeFoldedGetters(nodes, [edge('e1', 'g1', 'c1', 'a')], true).byGetter.get('g1');

  it('lights the consumer pin row while the HIDDEN getter is the executing node', () => {
    expect(isFoldedReadActive(read, 'g1', null)).toBe(true);
  });

  it('keeps the afterglow from the recent-trajectory set', () => {
    expect(isFoldedReadActive(read, null, { g1: true })).toBe(true);
  });

  it('never lights on the consumer’s own id — that is the card glow, not the read', () => {
    expect(isFoldedReadActive(read, 'c1', { c1: true })).toBe(false);
  });

  it('is inert for a pin with no folded read', () => {
    expect(isFoldedReadActive(undefined, 'g1', { g1: true })).toBe(false);
  });
});

const FLOWS_DIR = join(__dirname, '../../examples/flows');

function loadFlow(name: string): VisualFlow {
  return JSON.parse(readFileSync(join(FLOWS_DIR, `${name}.json`), 'utf-8')) as VisualFlow;
}

function reactFlowNodes(flow: VisualFlow): Node<FlowNodeData>[] {
  return flow.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data,
  })) as Node<FlowNodeData>[];
}

/**
 * PARITY GATE with `scripts/wf_common.py::folded_getter_ids`.
 *
 * The fold predicate exists twice: in TypeScript (what the canvas draws) and
 * in Python (what the layout docks out of the column stacks and what the audit
 * reports as `rendered_nodes`). Divergence is silent and expensive — a getter
 * the layout gave no column cell to but the canvas still draws lands on top of
 * its neighbour, and every 0156 success metric is then measured against a
 * graph nobody sees.
 *
 * So it is compared, not commented: `scripts/dump_folded.py` prints the Python
 * verdict for every bundled flow and this test asserts the TypeScript verdict
 * is byte-identical — full fold MAP (getter → consumer + pin), all 176 flows,
 * no checked-in fixture to go stale. Change the predicate in one language and
 * this fails until the other language agrees.
 */
describe('fold predicate parity: TypeScript vs Python', () => {
  it('agrees with scripts/dump_folded.py on every bundled flow', () => {
    const repoRoot = join(__dirname, '../..');
    const raw = execFileSync('python3', [join(repoRoot, 'scripts/dump_folded.py')], {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const python = JSON.parse(raw) as Record<string, Record<string, [string, string]>>;

    const flowNames = readdirSync(FLOWS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .sort();
    expect(flowNames.length).toBeGreaterThan(100);
    expect(Object.keys(python).sort()).toEqual(flowNames);

    const mismatches: string[] = [];
    let totalFolded = 0;
    for (const name of flowNames) {
      const flow = loadFlow(name);
      const folded = computeFoldedGetters(
        reactFlowNodes(flow),
        (flow.edges || []) as unknown as Edge[],
        true
      );
      totalFolded += folded.byGetter.size;
      const ts = Object.fromEntries(
        [...folded.byGetter.values()]
          .map((r) => [r.getterId, [r.consumerId, r.pinId]] as const)
          .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      );
      const py = python[name] || {};
      if (JSON.stringify(ts) !== JSON.stringify(py)) {
        mismatches.push(
          `${name}: ts=${JSON.stringify(ts)} python=${JSON.stringify(py)}`
        );
      }
    }
    expect(mismatches).toEqual([]);
    // A predicate that folds nothing would "agree" vacuously.
    expect(totalFolded).toBeGreaterThan(100);
  });
});
