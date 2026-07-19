import { describe, expect, it } from 'vitest';
import type { VisualFlow } from '../types/flow';
import {
  buildFlowFamilyIndex,
  isExecutableFlow,
  normalizeInterfaces,
} from './flowFamilies';
import { buildLibraryRows } from './flowLibraryRows';

// Family derivation + library rows (backlog 0144). Fixtures mirror the real
// library's pathologies: shared helpers, self-references, interface-less
// cycles, dangling refs, a referenced-but-runnable flow.

function flow(
  id: string,
  options: { name?: string; interfaces?: string[]; refs?: string[]; description?: string } = {}
): VisualFlow {
  return {
    id,
    name: options.name ?? id,
    description: options.description,
    interfaces: options.interfaces,
    nodes: (options.refs || []).map((target, index) => ({
      id: `${id}-sub-${index}`,
      type: 'subflow',
      position: { x: 0, y: 0 },
      data: { nodeType: 'subflow', label: 'Subflow', subflowId: target, inputs: [], outputs: [] },
    })) as unknown as VisualFlow['nodes'],
    edges: [],
  };
}

describe('interface normalization + executable classification', () => {
  it('normalizes garbage the gateway accepts ([""], whitespace, dupes)', () => {
    expect(normalizeInterfaces(['', '  ', 'a', 'a', ' b '])).toEqual(['a', 'b']);
    expect(normalizeInterfaces('nope')).toEqual([]);
  });

  it('executable = entrypoint-class declaration; domain tags do not count', () => {
    expect(isExecutableFlow({ interfaces: ['abstractcode.agent.v1'] })).toBe(true);
    expect(isExecutableFlow({ interfaces: ['abstractresearch.deep.v1'] })).toBe(false);
    expect(isExecutableFlow({ interfaces: ['unknown.custom.v1'] })).toBe(false);
    expect(isExecutableFlow({ interfaces: [''] })).toBe(false);
  });
});

describe('family index derivation', () => {
  it('groups the deep-research-shaped family: root first-level, helpers fold under it', () => {
    const flows = [
      flow('deep-research', { interfaces: ['abstractcode.agent.v1'], refs: ['deep-plan', 'deep-render'] }),
      flow('deep-plan'),
      flow('deep-render'),
      flow('standalone'),
    ];
    const index = buildFlowFamilyIndex(flows);
    expect(index.firstLevelIds.has('deep-research')).toBe(true);
    expect(index.firstLevelIds.has('deep-plan')).toBe(false);
    expect(index.firstLevelIds.has('standalone')).toBe(true);
    expect(index.familyRootIds.has('deep-research')).toBe(true);
    expect(index.familyMembers.get('deep-research')).toEqual(expect.arrayContaining(['deep-plan', 'deep-render']));
  });

  it('self-references never count as inbound (a recursive flow stays visible)', () => {
    const flows = [flow('ralph', { interfaces: ['abstractcode.agent.v1'], refs: ['ralph'] })];
    const index = buildFlowFamilyIndex(flows);
    expect(index.firstLevelIds.has('ralph')).toBe(true);
    expect(index.selfReferencingIds.has('ralph')).toBe(true);
    expect(index.inboundBy.get('ralph')).toBeUndefined();
  });

  it('a referenced flow that declares a runnable interface stays first-level too', () => {
    const flows = [
      flow('parent', { refs: ['ralph'] }),
      flow('ralph', { interfaces: ['abstractcode.agent.v1'] }),
    ];
    const index = buildFlowFamilyIndex(flows);
    expect(index.firstLevelIds.has('ralph')).toBe(true);
    expect(index.inboundBy.get('ralph')).toEqual(['parent']);
  });

  it('interface-less cycles with no external parent promote WHOLE (coverage invariant)', () => {
    const flows = [flow('a', { refs: ['b'] }), flow('b', { refs: ['a'] }), flow('solo')];
    const index = buildFlowFamilyIndex(flows);
    // Both cycle members must be reachable at the top level.
    expect(index.firstLevelIds.has('a') || index.firstLevelIds.has('b')).toBe(true);
    const reachable = new Set<string>();
    const stack = [...index.firstLevelIds];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const target of index.refs.get(current) || []) stack.push(target);
    }
    expect(reachable.has('a')).toBe(true);
    expect(reachable.has('b')).toBe(true);
    expect(index.cyclePromotedIds.size).toBeGreaterThan(0);
  });

  it('dangling references are reported per parent, never crash the index', () => {
    const flows = [flow('parent', { refs: ['ghost'] })];
    const index = buildFlowFamilyIndex(flows);
    expect(index.missingRefsBy.get('parent')).toEqual(['ghost']);
    expect(index.familyRootIds.has('parent')).toBe(true);
  });
});

describe('library rows', () => {
  const catalog = [
    flow('deep-research', {
      name: 'deep-research',
      interfaces: ['abstractcode.agent.v1'],
      refs: ['deep-plan', 'shared-helper'],
    }),
    flow('other-root', { name: 'other-root', refs: ['shared-helper'] }),
    flow('deep-plan', { name: 'deep-plan' }),
    flow('shared-helper', { name: 'shared-helper' }),
    flow('standalone', { name: 'standalone', description: 'A lone flow.' }),
  ];
  const index = buildFlowFamilyIndex(catalog);

  it('browse mode: helpers leave the top level; expansion shows them with shared counts', () => {
    const collapsed = buildLibraryRows(catalog, index, {
      query: '',
      viewMode: 'all',
      sortMode: 'name_asc',
      expandedIds: new Set(),
    });
    expect(collapsed.rows.map((row) => row.flow?.id)).toEqual(['deep-research', 'other-root', 'standalone']);

    const expanded = buildLibraryRows(catalog, index, {
      query: '',
      viewMode: 'all',
      sortMode: 'name_asc',
      expandedIds: new Set(['deep-research']),
    });
    const ids = expanded.rows.map((row) => `${row.kind}:${row.flow?.id || row.missingId}`);
    expect(ids).toEqual([
      'top:deep-research',
      'child:deep-plan',
      'child:shared-helper',
      'top:other-root',
      'top:standalone',
    ]);
    const shared = expanded.rows.find((row) => row.flow?.id === 'shared-helper');
    expect(shared?.sharedCount).toBe(2);
  });

  it('executable view keeps only entrypoint-class declarers at the top', () => {
    const result = buildLibraryRows(catalog, index, {
      query: '',
      viewMode: 'executable',
      sortMode: 'name_asc',
      expandedIds: new Set(),
    });
    expect(result.rows.map((row) => row.flow?.id)).toEqual(['deep-research']);
    expect(result.executableCount).toBe(1);
    expect(result.totalCount).toBe(5);
  });

  it('search flattens and matches descriptions, with helper context subtitles', () => {
    const result = buildLibraryRows(catalog, index, {
      query: 'lone',
      viewMode: 'all',
      sortMode: 'name_asc',
      expandedIds: new Set(),
    });
    expect(result.rows.map((row) => row.flow?.id)).toEqual(['standalone']);

    const helperHit = buildLibraryRows(catalog, index, {
      query: 'shared-helper',
      viewMode: 'all',
      sortMode: 'name_asc',
      expandedIds: new Set(),
    });
    const row = helperHit.rows.find((entry) => entry.flow?.id === 'shared-helper');
    expect(row?.contextParents).toEqual(['deep-research', 'other-root']);
  });

  it('cycle guard renders a non-expandable loop-back leaf inside expansions', () => {
    const cyclic = [flow('a', { name: 'a', refs: ['b'] }), flow('b', { name: 'b', refs: ['a'] })];
    const cyclicIndex = buildFlowFamilyIndex(cyclic);
    const someTop = [...cyclicIndex.firstLevelIds][0];
    const expandedRows = buildLibraryRows(cyclic, cyclicIndex, {
      query: '',
      viewMode: 'all',
      sortMode: 'name_asc',
      expandedIds: new Set([someTop, `${someTop}>${someTop === 'a' ? 'b' : 'a'}`]),
    });
    expect(expandedRows.rows.some((row) => row.kind === 'cycle')).toBe(true);
  });

  it('missing references render as error rows inside the expansion — exactly once', () => {
    const withGhost = [flow('parent', { name: 'parent', refs: ['ghost'] })];
    const ghostIndex = buildFlowFamilyIndex(withGhost);
    const rows = buildLibraryRows(withGhost, ghostIndex, {
      query: '',
      viewMode: 'all',
      sortMode: 'name_asc',
      expandedIds: new Set(['parent']),
    });
    // Headless-render iteration caught a double render (child loop + a
    // redundant second pass) — pinned to exactly one row per missing ref.
    const missing = rows.rows.filter((row) => row.kind === 'missing');
    expect(missing.map((row) => row.missingId)).toEqual(['ghost']);
  });

  it('collapsed parents surface their broken references as a missing count', () => {
    // Adversary J5: a collapsed family must not LOOK healthy while hiding a
    // dangling reference behind the chevron.
    const withGhost = [flow('parent', { name: 'parent', refs: ['ghost'] })];
    const ghostIndex = buildFlowFamilyIndex(withGhost);
    const rows = buildLibraryRows(withGhost, ghostIndex, {
      query: '',
      viewMode: 'all',
      sortMode: 'name_asc',
      expandedIds: new Set(),
    });
    expect(rows.rows[0].missingCount).toBe(1);
    expect(rows.rows[0].expandable).toBe(true);
  });
});
