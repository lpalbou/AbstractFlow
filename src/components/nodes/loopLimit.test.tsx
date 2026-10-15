// Operator 2026-10-11: "a counter in a circle ... to define how many times at most we can take that
// recursive loop", and "no code" in the workflow: Loop Limit and Add to List Variable nodes.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactFlowProvider } from 'reactflow';
import { describe, expect, it } from 'vitest';
import { createNodeData, getNodeTemplate } from '../../types/nodes';
import { nodeTypes } from './index';
import { PropertiesPanel } from '../PropertiesPanel';

const node = (type: string) => ({ id: 'n1', type: 'custom', position: { x: 0, y: 0 }, data: createNodeData(getNodeTemplate(type as any)!) });

describe('Loop Limit', () => {
  it('starts with 3 passes and draws as a circle showing ↺3 with again / limit reached / count', () => {
    const n = node('loop_limit');
    expect(n.data.pinDefaults).toEqual({ max: 3 });
    expect(n.data.outputs.map((p) => p.id)).toEqual(['again', 'limit_reached', 'count']);
    const Comp = nodeTypes.custom as any;
    const html = renderToStaticMarkup(
      createElement(ReactFlowProvider, null, createElement(Comp, { id: 'n1', data: n.data, selected: false, type: 'custom', xPos: 0, yPos: 0, zIndex: 0, isConnectable: true, dragging: false }))
    );
    expect(html).toContain('loop-limit-node');
    expect(html).toContain('↺3');
    expect(html).toContain('limit reached');
  });

  it('the Properties panel edits the number of passes', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PropertiesPanel, { node: node('loop_limit') as any })));
    expect(html).toContain('Passes allowed');
    expect(html).toMatch(/type="number"[^>]*value="3"/);
  });
});

describe('Add to List Variable', () => {
  it('is a Variables node with name, item and items, and returns the new list', () => {
    const t = getNodeTemplate('add_to_list' as any)!;
    expect(t.category).toBe('variables');
    expect(t.inputs.map((p) => p.id)).toEqual(['exec-in', 'name', 'item', 'items']);
    expect(t.outputs.map((p) => p.id)).toEqual(['exec-out', 'list']);
  });
});
