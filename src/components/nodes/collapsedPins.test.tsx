// Operator 2026-10-25: a folded Break Email with 16 outputs was a pill as tall as the open card.
// Folded, a node shows only the pins that carry a wire (plus execution pins), one row each; the
// other pins keep invisible handles at the edge middle so React Flow still finds every handle.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactFlowProvider } from 'reactflow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeData, getAllNodeTemplates, getNodeTemplate } from '../../types/nodes';
import type { FlowNodeData } from '../../types/flow';
import { COLLAPSED_MIN_SIZE, COLLAPSED_PIN_GAP, collapsedPinLayout } from '../../utils/operatorNodes';

// Server rendering reads a zustand store's initial state; read the live one so the edges count.
vi.mock('../../hooks/useFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useFlow')>();
  const live = ((selector?: (s: unknown) => unknown) => (selector ? selector(actual.useFlowStore.getState()) : actual.useFlowStore.getState())) as unknown as typeof actual.useFlowStore;
  Object.assign(live, actual.useFlowStore);
  return { ...actual, useFlowStore: live };
});
const { useFlowStore } = await import('../../hooks/useFlow');
const { nodeTypes } = await import('./index');

const emailFields = () => ({ ...createNodeData(getAllNodeTemplates().find((t) => t.label === 'Email fields')!), collapsed: true }) as FlowNodeData;
const edge = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string) => ({ id, source, sourceHandle, target, targetHandle });

function render(id: string, data: FlowNodeData, edges: ReturnType<typeof edge>[]) {
  useFlowStore.setState({ nodes: [{ id, type: 'custom', position: { x: 0, y: 0 }, data }] as never, edges: edges as never });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ReactFlowProvider, null, createElement(nodeTypes.custom as never, { id, data, selected: false, type: 'custom', xPos: 0, yPos: 0, zIndex: 0, isConnectable: true, dragging: false }))
    )
  );
}
const count = (html: string, re: RegExp) => (html.match(re) || []).length;
const heightOf = (html: string) => Number(/class="collapsed-operator[^"]*"[^>]*style="height:(\d+)px/.exec(html)?.[1]);

afterEach(() => useFlowStore.setState({ nodes: [], edges: [] }));

describe('folded nodes show only their wired pins', () => {
  it('collapsedPinLayout: wired and execution pins shown, the rest kept hidden; height follows the shown rows', () => {
    const data = {
      inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'a', label: 'a', type: 'string' }, { id: 'b', label: 'b', type: 'string' }],
      outputs: Array.from({ length: 16 }, (_, i) => ({ id: `o${i}`, label: `o${i}`, type: 'string' })),
    } as unknown as FlowNodeData;
    const wired = new Set(['in:b', 'out:o3', 'out:o9']);
    const layout = collapsedPinLayout(data, (pin, isInput) => wired.has(`${isInput ? 'in' : 'out'}:${pin}`));
    expect(layout.inputs.map((p) => p.id)).toEqual(['exec-in', 'b']);
    expect(layout.hiddenInputs.map((p) => p.id)).toEqual(['a']);
    expect(layout.outputs.map((p) => p.id)).toEqual(['o3', 'o9']);
    expect(layout.hiddenOutputs).toHaveLength(14);
    expect(layout.height).toBe(COLLAPSED_MIN_SIZE);
    const none = collapsedPinLayout(data, () => false);
    expect([none.inputs.map((p) => p.id), none.outputs, none.height]).toEqual([['exec-in'], [], COLLAPSED_MIN_SIZE]);
    const all = collapsedPinLayout(data, () => true);
    expect(all.height).toBe(16 * COLLAPSED_PIN_GAP + 20);
  });

  it('a folded Break Email draws its wired pins only and stays a compact circle; every pin keeps its handle', () => {
    const data = emailFields();
    expect(data.outputs.length).toBeGreaterThanOrEqual(16);
    const html = render('em', data, [edge('e1', 'src', 'out', 'em', 'object'), edge('e2', 'em', 'from', 'r1', 'in'), edge('e3', 'em', 'subject', 'r2', 'in')]);
    expect(count(html, /collapsed-operator-pin collapsed-operator-pin--(in|out)"/g)).toBe(3);
    expect(count(html, /collapsed-operator-pin--hidden/g)).toBe(data.inputs.length + data.outputs.length - 3);
    // One handle per pin, under the card's ids, so no wire is dropped.
    expect(count(html, /data-handleid=/g)).toBe(data.inputs.length + data.outputs.length);
    for (const pin of [...data.inputs, ...data.outputs]) expect(html).toContain(`data-handleid="${pin.id}"`);
    expect(heightOf(html)).toBe(COLLAPSED_MIN_SIZE);
    // The hidden ones take no new wire and sit at the edge middle.
    const handleClass = (pin: string) => new RegExp(`data-handleid="${pin}"[^>]*class="([^"]*)"`).exec(html)?.[1].split(' ') || [];
    expect(html).toMatch(/collapsed-operator-pin--hidden" style="top:28px"[^>]*><div[^>]*data-handleid="id"/);
    expect(handleClass('id')).toContain('react-flow__handle');
    expect(handleClass('id')).not.toContain('connectable');
    expect(handleClass('from')).toContain('connectable');
    expect(handleClass('object')).toContain('connectable');
  });

  it('nothing wired: just the sign, no drawn pin; unfolding restores the full card with every pin', () => {
    const data = { ...createNodeData(getNodeTemplate('concat')!), collapsed: true } as FlowNodeData;
    const folded = render('c', data, []);
    expect(folded).toContain('collapsed-operator-sign');
    expect(count(folded, /collapsed-operator-pin collapsed-operator-pin--(in|out)"/g)).toBe(0);
    expect(count(folded, /data-handleid=/g)).toBe(data.inputs.length + data.outputs.length);
    const open = render('c', { ...data, collapsed: false }, []);
    expect(open).not.toContain('collapsed-operator');
    for (const pin of [...data.inputs, ...data.outputs]) expect(open).toContain(`data-handleid="${pin.id}"`);
  });

  it('many wired pins: one row each', () => {
    const data = emailFields();
    const edges = data.outputs.slice(0, 6).map((p, i) => edge(`e${i}`, 'em', p.id, `t${i}`, 'in'));
    expect(heightOf(render('em', data, edges))).toBe(6 * COLLAPSED_PIN_GAP + 20);
  });

  it('Get Variables folded: the names of its wired variables beside their pins; none wired, its sign', () => {
    const data = { ...createNodeData(getNodeTemplate('get_vars' as never)!), collapsed: true } as FlowNodeData;
    data.outputs = ['history', 'reviews', 'goal'].map((id) => ({ id, label: id, type: 'array' as const }));
    const html = render('gv', data, [edge('e1', 'gv', 'goal', 'x', 'in')]);
    expect(html).toMatch(/collapsed-getvars-name[^>]*>goal</);
    expect(html).not.toMatch(/collapsed-getvars-name[^>]*>history</);
    const bare = render('gv', data, []);
    expect(bare).not.toContain('collapsed-getvars-names');
    expect(bare).toContain('(x)');
  });
});
