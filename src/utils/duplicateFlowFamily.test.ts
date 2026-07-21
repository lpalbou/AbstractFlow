import { describe, expect, it } from 'vitest';
import type { VisualFlow, VisualNode } from '../types/flow';
import { bundledFamilyClosure, duplicateFlowFamily, remapSubflowRefs } from './duplicateFlowFamily';

// Operator ruling 2026-07-20 (laurent DM seq 31): selecting a bundled
// workflow must allow Rename and Duplicate. A standalone copy of a bundled
// family root would reference subflow ids the gateway cannot resolve, so
// duplication copies the readonly closure and remaps references — these
// tests pin the closure rule (stored refs stay shared), the two-phase
// remap (parent->child, self-reference, mutual cycle), and name suffixing.

function flowWithRefs(id: string, refs: string[], name = id): VisualFlow {
  return {
    id,
    name,
    nodes: refs.map(
      (target, index) =>
        ({
          id: `${id}-sub-${index}`,
          type: 'subflow',
          position: { x: 0, y: 0 },
          data: { nodeType: 'subflow', label: 'Subflow', subflowId: target, inputs: [], outputs: [] },
        }) as unknown as VisualNode
    ),
    edges: [],
  } as unknown as VisualFlow;
}

function fakeIO() {
  let counter = 0;
  const created: VisualFlow[] = [];
  const updates: Array<{ id: string; nodes: VisualNode[] }> = [];
  return {
    created,
    updates,
    io: {
      createFlow: async (flow: { name: string; nodes: VisualNode[]; edges: VisualFlow['edges'] }) => {
        counter += 1;
        const copy = { ...flow, id: `new-${counter}` } as unknown as VisualFlow;
        created.push(copy);
        return copy;
      },
      updateFlowNodes: async (flowId: string, flow: VisualFlow, nodes: VisualNode[]) => {
        updates.push({ id: flowId, nodes });
        return { ...flow, nodes } as VisualFlow;
      },
    },
  };
}

function refTargets(flow: VisualFlow): string[] {
  return flow.nodes
    .map((n) => (n.data as { subflowId?: string } | undefined)?.subflowId)
    .filter((v): v is string => typeof v === 'string');
}

describe('bundledFamilyClosure', () => {
  it('includes the root and transitively referenced readonly flows only', () => {
    const flows = [
      flowWithRefs('root', ['helper', 'stored-shared']),
      flowWithRefs('helper', ['leaf']),
      flowWithRefs('leaf', []),
      flowWithRefs('stored-shared', []),
    ];
    const byId = new Map(flows.map((f) => [f.id, f] as const));
    const readonly = new Set(['root', 'helper', 'leaf']);
    const closure = bundledFamilyClosure('root', byId, readonly).map((f) => f.id);
    expect(closure.sort()).toEqual(['helper', 'leaf', 'root']);
  });

  it('survives mutual cycles', () => {
    const flows = [flowWithRefs('a', ['b']), flowWithRefs('b', ['a'])];
    const byId = new Map(flows.map((f) => [f.id, f] as const));
    const closure = bundledFamilyClosure('a', byId, new Set(['a', 'b'])).map((f) => f.id);
    expect(closure.sort()).toEqual(['a', 'b']);
  });
});

describe('remapSubflowRefs', () => {
  it('remaps subflowId and legacy ref keys; returns null when untouched', () => {
    const nodes = [
      {
        id: 'n1',
        type: 'subflow',
        position: { x: 0, y: 0 },
        data: { nodeType: 'subflow', subflowId: 'old-a', flowId: 'old-a', inputs: [], outputs: [] },
      },
      {
        id: 'n2',
        type: 'code',
        position: { x: 0, y: 0 },
        data: { nodeType: 'code', inputs: [], outputs: [] },
      },
    ] as unknown as VisualNode[];
    const remapped = remapSubflowRefs(nodes, new Map([['old-a', 'new-a']]));
    expect(remapped).not.toBeNull();
    const data = remapped![0].data as { subflowId?: string; flowId?: string };
    expect(data.subflowId).toBe('new-a');
    expect(data.flowId).toBe('new-a');
    expect(remapSubflowRefs(nodes, new Map([['unrelated', 'x']]))).toBeNull();
  });
});

describe('duplicateFlowFamily', () => {
  it('copies the readonly closure, remaps refs, keeps stored refs shared', async () => {
    const flows = [
      flowWithRefs('root', ['helper', 'stored-shared'], 'deep-research'),
      flowWithRefs('helper', [], 'deep-investigate'),
      flowWithRefs('stored-shared', [], 'my-helper'),
    ];
    const { io, created } = fakeIO();
    const result = await duplicateFlowFamily({
      rootId: 'root',
      rootName: 'deep-research (copy)',
      flows,
      readonlyIds: new Set(['root', 'helper']),
      io,
    });
    expect(created.map((f) => f.name).sort()).toEqual(['deep-investigate (copy)', 'deep-research (copy)']);
    const rootRefs = refTargets(result.root);
    // helper ref remapped to its new id; stored ref untouched (shared).
    expect(rootRefs).toContain(result.idMap.get('helper'));
    expect(rootRefs).toContain('stored-shared');
    expect(rootRefs).not.toContain('helper');
  });

  it('remaps self-references onto the new id', async () => {
    const flows = [flowWithRefs('ralph', ['ralph'], 'ralph-recursive')];
    const { io } = fakeIO();
    const result = await duplicateFlowFamily({
      rootId: 'ralph',
      rootName: 'ralph (copy)',
      flows,
      readonlyIds: new Set(['ralph']),
      io,
    });
    expect(refTargets(result.root)).toEqual([result.root.id]);
  });

  it('remaps mutual cycles on both sides', async () => {
    const flows = [flowWithRefs('a', ['b']), flowWithRefs('b', ['a'])];
    const { io } = fakeIO();
    const result = await duplicateFlowFamily({
      rootId: 'a',
      rootName: 'a (copy)',
      flows,
      readonlyIds: new Set(['a', 'b']),
      io,
    });
    const newA = result.idMap.get('a') as string;
    const newB = result.idMap.get('b') as string;
    const copyA = result.copies.find((f) => f.id === newA) as VisualFlow;
    const copyB = result.copies.find((f) => f.id === newB) as VisualFlow;
    expect(refTargets(copyA)).toEqual([newB]);
    expect(refTargets(copyB)).toEqual([newA]);
  });

  it('throws for an unknown root', async () => {
    const { io } = fakeIO();
    await expect(
      duplicateFlowFamily({ rootId: 'nope', rootName: 'x', flows: [], readonlyIds: new Set(), io })
    ).rejects.toThrow('not found');
  });

  it('rolls back created copies when a later create fails (no orphan half-family)', async () => {
    const flows = [flowWithRefs('root', ['helper']), flowWithRefs('helper', [])];
    const deleted: string[] = [];
    let calls = 0;
    const io = {
      createFlow: async (flow: { name: string; nodes: VisualNode[]; edges: VisualFlow['edges'] }) => {
        calls += 1;
        if (calls === 2) throw new Error('gateway 500');
        return { ...flow, id: `new-${calls}` } as unknown as VisualFlow;
      },
      updateFlowNodes: async (_flowId: string, flow: VisualFlow, nodes: VisualNode[]) =>
        ({ ...flow, nodes }) as VisualFlow,
      deleteFlow: async (flowId: string) => {
        deleted.push(flowId);
      },
    };
    await expect(
      duplicateFlowFamily({
        rootId: 'root',
        rootName: 'root (copy)',
        flows,
        readonlyIds: new Set(['root', 'helper']),
        io,
      })
    ).rejects.toThrow('gateway 500');
    expect(deleted).toEqual(['new-1']);
  });
});
