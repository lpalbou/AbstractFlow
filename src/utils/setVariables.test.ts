// Operator 2026-10-11: set several variables at once, with a name, a type and
// optionally a default value; one Set Variables node instead of a chain.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import type { VisualFlow } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import { useFlowStore } from '../hooks/useFlow';
import { PropertiesPanel } from '../components/PropertiesPanel';
import {
  defaultForVariableType,
  setVariableItemType,
  setVariableRows,
  setVariableValueProblem,
  variableNameProblem,
  withSetVariableRows,
} from './setVariables';
import { flowIoPinPatchForArrayItem } from './pinTypeOptions';

function setVarsNode() {
  const data = createNodeData(getNodeTemplate('set_vars')!);
  data.inputs = [
    ...data.inputs,
    { id: 'history', label: 'history', type: 'array' },
    { id: 'knowledge', label: 'knowledge', ...flowIoPinPatchForArrayItem({ type: 'array' }, 'string') },
    { id: 'review_round', label: 'review_round', type: 'number' },
  ];
  data.pinDefaults = { ...(data.pinDefaults || {}), history: [], knowledge: [], review_round: 0 };
  return { id: 'sv', type: 'custom', position: { x: 0, y: 0 }, data };
}

describe('Set Variables rows', () => {
  beforeEach(() => useFlowStore.getState().clearFlow());

  it('the node has no whole-object updates pin; each type starts with a natural value', () => {
    const fresh = createNodeData(getNodeTemplate('set_vars')!);
    expect([...fresh.inputs, ...fresh.outputs].map((p) => p.id)).toEqual(['exec-in', 'exec-out']);
    expect(setVariableRows(setVarsNode().data.inputs).map((p) => p.id)).toEqual(['history', 'knowledge', 'review_round']);
    expect(['string', 'number', 'boolean', 'array', 'object', 'any'].map((t) => defaultForVariableType(t as any))).toEqual(['', 0, false, [], {}, null]);
  });

  it('refuses names the runtime would refuse or that clash', () => {
    const taken = new Set(['history']);
    expect(variableNameProblem('history', taken)).toMatch(/already/);
    expect(variableNameProblem('_secret', taken)).toMatch(/reserved/);
    expect(variableNameProblem('two words', taken)).toMatch(/spaces/);
    expect(variableNameProblem('updates', taken)).toMatch(/reserved/);
    expect(variableNameProblem('state.flags', taken)).toBeNull();
  });

  it('the properties panel lists one row per variable, with its type and value, and an Add button', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PropertiesPanel, { node: setVarsNode() as any })));
    expect(html).toContain('+ Add variable');
    for (const name of ['history', 'knowledge', 'review_round']) expect(html).toContain(`value="${name}"`);
    expect(html).toContain('aria-label="Value of review_round"');
  });

  it('rows and a wired row survive save and reload', () => {
    const node = setVarsNode();
    useFlowStore.getState().loadFlow({
      id: 'f',
      name: 'f',
      nodes: [
        { id: 'start', type: 'on_flow_start', position: { x: 0, y: 0 }, data: { ...createNodeData(getNodeTemplate('on_flow_start')!), outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'prompt', label: 'prompt', type: 'string' }] } },
        { ...node, type: 'set_vars' },
      ],
      edges: [
        { id: 'e1', source: 'start', sourceHandle: 'exec-out', target: 'sv', targetHandle: 'exec-in' },
      ],
    } as unknown as VisualFlow);
    const saved = useFlowStore.getState().getFlow();
    const sv = saved.nodes.find((n) => n.id === 'sv')!;
    expect(setVariableRows(sv.data.inputs).map((p) => [p.id, p.type])).toEqual([['history', 'array'], ['knowledge', 'array'], ['review_round', 'number']]);
    expect(sv.data.pinDefaults).toMatchObject({ history: [], knowledge: [], review_round: 0 });
  });

  it('an array row says what it holds, and its value must fit', () => {
    const knowledge = setVarsNode().data.inputs.find((p) => p.id === 'knowledge')!;
    expect(setVariableItemType(knowledge)).toBe('string');
    expect(setVariableItemType({ type: 'array' })).toBe('any');
    expect(setVariableValueProblem(knowledge, ['a', 'b'])).toBeNull();
    expect(setVariableValueProblem(knowledge, ['a', 2])).toBe('Item 2 of knowledge is number, not string');
    expect(setVariableValueProblem(knowledge, 'a')).toMatch(/is a list/);
    expect(setVariableValueProblem({ id: 'x', type: 'array' }, [1, 'a', {}])).toBeNull();
    const reviews = { id: 'reviews', label: 'reviews', ...flowIoPinPatchForArrayItem({ type: 'array' }, 'object') };
    expect(setVariableValueProblem(reviews, [{}, []])).toBe('Item 2 of reviews is array, not json');
  });

  it('the panel shows what an array row holds', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PropertiesPanel, { node: setVarsNode() as any })));
    expect(html).toContain('aria-label="What knowledge holds"');
    expect(html).toMatch(/<option value="string" selected="">of string<\/option>/);
  });

  it('an older typed-in updates object becomes rows on load; a wired one stays', () => {
    const legacy = {
      ...createNodeData(getNodeTemplate('set_vars')!),
      inputs: [{ id: 'exec-in', label: '', type: 'execution' as const }, { id: 'updates', label: 'updates', type: 'object' as const }],
      outputs: [{ id: 'exec-out', label: '', type: 'execution' as const }, { id: 'updates', label: 'updates', type: 'object' as const }],
      pinDefaults: { updates: { notes: [], count: 0, title: 'x', done: false, meta: {} } },
    };
    const moved = withSetVariableRows(legacy as any, new Set(), new Set());
    expect(moved.inputs.map((p) => [p.id, p.type])).toEqual([
      ['exec-in', 'execution'], ['notes', 'array'], ['count', 'number'], ['title', 'string'], ['done', 'boolean'], ['meta', 'object'],
    ]);
    expect(moved.outputs.map((p) => p.id)).toEqual(['exec-out']);
    expect(moved.pinDefaults).toEqual({ notes: [], count: 0, title: 'x', done: false, meta: {} });

    const wired = withSetVariableRows(legacy as any, new Set(['updates']), new Set(['updates']));
    expect(wired).toBe(legacy);
    const reserved = withSetVariableRows({ ...legacy, pinDefaults: { updates: { _private: 1 } } } as any, new Set(), new Set());
    expect(reserved.inputs.some((p) => p.id === 'updates')).toBe(true);
  });
});
