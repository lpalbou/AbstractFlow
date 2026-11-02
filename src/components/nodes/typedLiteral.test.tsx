// The type tag beside a typed box (root ADR 0049): the card says what a value typed on an
// unwired `any` input is, and says it on the card when the value is not of that type.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactFlowProvider, type Edge, type Node } from 'reactflow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNodeData, getNodeTemplate } from '../../types/nodes';
import type { FlowNodeData, NodeType } from '../../types/flow';

// react-dom/server reads a zustand store through its server snapshot (the INITIAL state): the
// card reads the live store instead, as collapsedPins.test.tsx does.
vi.mock('../../hooks/useFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useFlow')>();
  const live = ((selector?: (s: unknown) => unknown) => (selector ? selector(actual.useFlowStore.getState()) : actual.useFlowStore.getState())) as unknown as typeof actual.useFlowStore;
  Object.assign(live, actual.useFlowStore);
  return { ...actual, useFlowStore: live };
});
const { useFlowStore } = await import('../../hooks/useFlow');
const { BaseNode } = await import('./BaseNode');

function node(id: string, type: NodeType, patch: Partial<FlowNodeData> = {}): Node<FlowNodeData> {
  const template = getNodeTemplate(type)!;
  return { id, type: 'custom', position: { x: 0, y: 0 }, data: { ...createNodeData(template), ...patch } };
}

function renderCard(nodes: Node<FlowNodeData>[], edges: Edge[], id: string): string {
  useFlowStore.setState({ nodes, edges });
  const n = useFlowStore.getState().nodes.find((x) => x.id === id)!;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  const props = { id, data: n.data, selected: false, type: 'custom', zIndex: 0, isConnectable: true, xPos: 0, yPos: 0, dragging: false } as any;
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(ReactFlowProvider, null, createElement(BaseNode, props)))
  );
}

const row = (html: string, pinId: string) => {
  const i = html.indexOf(`data-pin-id="${pinId}"`);
  expect(i, `row ${pinId}`).toBeGreaterThan(-1);
  return html.slice(i, html.indexOf('data-pin-id=', i + 12) > 0 ? html.indexOf('data-pin-id=', i + 12) : undefined);
};

describe('typed value tag on the node card', () => {
  afterEach(() => useFlowStore.getState().clearFlow());
  const five = () => node('five', 'literal_number', { literalValue: 5 });
  const a = { id: 'e1', source: 'five', sourceHandle: 'value', target: 'cmp', targetHandle: 'a' };

  it('Compare b next to a wired number: the box shows 5 and the tag says number', () => {
    const html = renderCard([five(), node('cmp', 'compare', { pinDefaults: { b: '5' } })], [a], 'cmp');
    const b = row(html, 'b');
    expect(b).toMatch(/<input[^>]*value="5"/);
    expect(b).toMatch(/class="af-pin-type-tag" data-kind="number"[^>]*>number</);
    expect(html).not.toContain('pin-literal-problem');
  });

  it('nothing wired: the tag says text', () => {
    const html = renderCard([node('cmp', 'compare', { pinDefaults: { b: '5' } })], [], 'cmp');
    expect(row(html, 'b')).toMatch(/data-kind="string"[^>]*>text</);
  });

  it('a value that is not of the wired type is flagged under its row', () => {
    const html = renderCard([five(), node('cmp', 'compare', { pinDefaults: { b: 'abc' } })], [a], 'cmp');
    expect(row(html, 'b')).toContain('af-pin-input--invalid');
    expect(row(html, 'b')).toContain('af-pin-type-tag--invalid');
    expect(html).toContain('<div class="pin-literal-problem" data-pin-id="b">b: “abc” is not a number</div>');
  });
});
