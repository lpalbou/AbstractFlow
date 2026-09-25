import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VisualFlow } from '../types/flow';
import type { Node } from 'reactflow';
import type { FlowNodeData, Pin } from '../types/flow';
import {
  KNOWN_INTERFACES,
  applyInterfacePins,
  buildFlowFamilyIndex,
  interfaceBoundaryPins,
  isExecutableFlow,
  missingInterfacePins,
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

// Declaring an interface must give On Flow Start / On Flow End the pins the
// contract requires, so the author sees what a host sends in and reads back.
function boundaryNode(id: string, nodeType: 'on_flow_start' | 'on_flow_end' | 'code', pins: Pin[] = []): Node<FlowNodeData> {
  const exec: Pin =
    nodeType === 'on_flow_start' ? { id: 'exec-out', label: '', type: 'execution' } : { id: 'exec-in', label: '', type: 'execution' };
  return {
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      nodeType,
      label: id,
      icon: '',
      headerColor: '',
      inputs: nodeType === 'on_flow_start' ? [] : [exec, ...pins],
      outputs: nodeType === 'on_flow_start' ? [exec, ...pins] : [],
    } as FlowNodeData,
  };
}

const AGENT = 'abstractcode.agent.v1';

describe('interface boundary pins', () => {
  it('every known interface pin is fully typed (id, label, type) with unique ids per side', () => {
    for (const iface of KNOWN_INTERFACES) {
      for (const side of [iface.requiredStartPins || [], iface.requiredEndPins || []]) {
        for (const pin of side) {
          expect(pin.id).toMatch(/^[a-z_]+$/);
          expect(pin.label).toBeTruthy();
          expect(pin.type).toBeTruthy();
          expect(pin.type).not.toBe('execution');
        }
        expect(new Set(side.map((pin) => pin.id)).size).toBe(side.length);
      }
    }
  });

  it('pins the typed agent.v1 contract hosts rely on', () => {
    const pins = interfaceBoundaryPins([AGENT]);
    expect(pins.start.map((p) => [p.id, p.type])).toEqual([
      ['provider', 'provider_text'],
      ['model', 'model'],
      ['prompt', 'string'],
    ]);
    expect(pins.end.map((p) => [p.id, p.type])).toEqual([
      ['response', 'string'],
      ['success', 'boolean'],
      ['meta', 'object'],
    ]);
  });

  it('merges several interfaces in declaration order; first declaration of an id wins; unknown ids add nothing', () => {
    const pins = interfaceBoundaryPins(['abstractcode.coding.v1', AGENT, 'unknown.custom.v1', 'abstractresearch.deep.v1']);
    expect(pins.start.map((p) => p.id)).toEqual(['request', 'provider', 'model', 'prompt']);
    expect(pins.end.map((p) => `${p.interfaceId}:${p.id}`)).toEqual([
      'abstractcode.coding.v1:report',
      'abstractcode.coding.v1:passed',
      `${AGENT}:response`,
      `${AGENT}:success`,
      `${AGENT}:meta`,
    ]);
    expect(interfaceBoundaryPins(['abstractresearch.deep.v1', '', 'nope'])).toEqual({ start: [], end: [] });
  });

  it('adds the missing typed pins: outputs on On Flow Start, inputs on On Flow End', () => {
    const nodes = [boundaryNode('start', 'on_flow_start'), boundaryNode('end', 'on_flow_end')];
    const next = applyInterfacePins(nodes, [AGENT]);
    expect(next[0].data.outputs).toEqual([
      { id: 'exec-out', label: '', type: 'execution' },
      expect.objectContaining({ id: 'provider', label: 'provider', type: 'provider_text' }),
      expect.objectContaining({ id: 'model', label: 'model', type: 'model' }),
      expect.objectContaining({ id: 'prompt', label: 'prompt', type: 'string' }),
    ]);
    expect(next[0].data.inputs).toEqual([]);
    expect(next[1].data.inputs.map((p) => [p.id, p.type])).toEqual([
      ['exec-in', 'execution'],
      ['response', 'string'],
      ['success', 'boolean'],
      ['meta', 'object'],
    ]);
    expect(next[1].data.outputs).toEqual([]);
    // Inputs are never mutated.
    expect(nodes[0].data.outputs).toHaveLength(1);
    expect(nodes[1].data.inputs).toHaveLength(1);
  });

  it('keeps existing pins as authored (label, type, order) and never duplicates them', () => {
    const userPrompt: Pin = { id: 'prompt', label: 'Ask me', type: 'any', description: 'mine' };
    const userExtra: Pin = { id: 'workspace_root', label: 'workspace_root', type: 'string' };
    const nodes = [boundaryNode('start', 'on_flow_start', [userExtra, userPrompt])];
    const next = applyInterfacePins(nodes, [AGENT]);
    const outputs = next[0].data.outputs;
    expect(outputs.map((p) => p.id)).toEqual(['exec-out', 'workspace_root', 'prompt', 'provider', 'model']);
    expect(outputs[2]).toBe(userPrompt);
    expect(outputs.filter((p) => p.id === 'prompt')).toHaveLength(1);
  });

  it('returns the SAME array (and node objects) when nothing is missing', () => {
    const once = applyInterfacePins([boundaryNode('start', 'on_flow_start'), boundaryNode('end', 'on_flow_end')], [AGENT]);
    expect(applyInterfacePins(once, [AGENT])).toBe(once);
    const plain = [boundaryNode('code', 'code')];
    expect(applyInterfacePins(plain, [AGENT])).toBe(plain);
    const unrelated = [boundaryNode('start', 'on_flow_start')];
    expect(applyInterfacePins(unrelated, [])).toBe(unrelated);
    expect(applyInterfacePins(unrelated, ['abstractresearch.deep.v1'])).toBe(unrelated);
  });

  it('fills every On Flow End (a flow may end on several branches) and leaves other nodes alone', () => {
    const code = boundaryNode('code', 'code');
    const nodes = [boundaryNode('end_a', 'on_flow_end'), code, boundaryNode('end_b', 'on_flow_end')];
    const next = applyInterfacePins(nodes, ['abstractcode.coding.v1']);
    expect(next[0].data.inputs.map((p) => p.id)).toEqual(['exec-in', 'report', 'passed']);
    expect(next[2].data.inputs.map((p) => p.id)).toEqual(['exec-in', 'report', 'passed']);
    expect(next[1]).toBe(code);
  });

  it('reports what a boundary node is missing', () => {
    const pins = interfaceBoundaryPins([AGENT]);
    const end = boundaryNode('end', 'on_flow_end', [{ id: 'response', label: 'response', type: 'string' }]);
    expect(missingInterfacePins(end.data, pins).map((p) => p.id)).toEqual(['success', 'meta']);
    expect(missingInterfacePins(boundaryNode('code', 'code').data, pins)).toEqual([]);
  });
});

describe('host interfaces added to the contract', () => {
  it('abstractassistant.agent.v1 carries the pins AbstractAssistant sends and reads', () => {
    const pins = interfaceBoundaryPins(['abstractassistant.agent.v1']);
    expect(pins.start.map((p) => [p.id, p.type])).toEqual([
      ['provider', 'provider_text'],
      ['model', 'model'],
      ['prompt', 'string'],
    ]);
    expect(pins.end.map((p) => [p.id, p.type])).toEqual([
      ['response', 'string'],
      ['success', 'boolean'],
      ['meta', 'object'],
    ]);
    expect(isExecutableFlow({ interfaces: ['abstractassistant.agent.v1'] })).toBe(true);
  });

  it('abstractcode.goal.v1 carries the pins of AbstractCode /goal; goal-agent.json implements it on every end', () => {
    const pins = interfaceBoundaryPins(['abstractcode.goal.v1']);
    expect(pins.start.map((p) => [p.id, p.type])).toEqual([
      ['goal', 'string'],
      ['max_cycles', 'number'],
      ['provider', 'provider_text'],
      ['model', 'model'],
      ['tools', 'array'],
    ]);
    expect(pins.end.map((p) => [p.id, p.type])).toEqual([
      ['result', 'string'],
      ['success', 'boolean'],
      ['cycles_used', 'number'],
      ['stopped_reason', 'string'],
    ]);
    expect(isExecutableFlow({ interfaces: ['abstractcode.goal.v1'] })).toBe(true);

    const goalAgent = JSON.parse(
      readFileSync(resolve(__dirname, '../../examples/flows/goal-agent.json'), 'utf8')
    ) as { interfaces: string[]; nodes: Array<{ data: FlowNodeData }> };
    expect(goalAgent.interfaces).toContain('abstractcode.goal.v1');
    const boundary = goalAgent.nodes.filter((n) => ['on_flow_start', 'on_flow_end'].includes(n.data.nodeType));
    expect(boundary.length).toBe(3);
    for (const node of boundary) {
      const missing = missingInterfacePins(node.data, pins);
      expect(missing).toEqual([]);
      // Same types as the implementation, not just the same ids.
      const side = node.data.nodeType === 'on_flow_start' ? node.data.outputs : node.data.inputs;
      const required = node.data.nodeType === 'on_flow_start' ? pins.start : pins.end;
      for (const spec of required) expect(side.find((p) => p.id === spec.id)?.type).toBe(spec.type);
    }
  });

  it('both are offered by the interface editor (entrypoint class, not a hidden domain marker)', () => {
    const offered = KNOWN_INTERFACES.filter((iface) => iface.class !== 'domain').map((iface) => iface.id);
    expect(offered).toEqual(expect.arrayContaining(['abstractassistant.agent.v1', 'abstractcode.goal.v1']));
  });
});
