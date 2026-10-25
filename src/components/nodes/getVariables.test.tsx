// Operator 2026-10-12: "in the same way we created set variables, i think we need a get variables
// that enable us to get as many variables as we want / need to. this node should also be collapsible".
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactFlowProvider } from 'reactflow';
import { describe, expect, it } from 'vitest';
import { createNodeData, getNodeTemplate } from '../../types/nodes';
import { nodeTypes } from './index';
import { PropertiesPanel } from '../PropertiesPanel';
import { isCollapsibleOperator } from '../../utils/operatorNodes';
import { collectDeclaredVarNames } from '../../utils/preflight';

function getVarsNode(collapsed = false) {
  const data = createNodeData(getNodeTemplate('get_vars' as any)!);
  data.outputs = [
    { id: 'history', label: 'history', type: 'array' },
    { id: 'reviews', label: 'reviews', type: 'array' },
  ];
  if (collapsed) (data as any).collapsed = true;
  return { id: 'gv', type: 'custom', position: { x: 0, y: 0 }, data };
}

describe('Get Variables', () => {
  it('starts with no rows and can fold', () => {
    const t = getNodeTemplate('get_vars' as any)!;
    expect(t.category).toBe('variables');
    expect([t.inputs.length, t.outputs.length]).toEqual([0, 0]);
    expect(isCollapsibleOperator('get_vars')).toBe(true);
  });

  it('the properties panel lists one row per variable, with an Add button', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PropertiesPanel, { node: getVarsNode() as any })));
    expect(html).toContain('get-variable-row');
    expect(html).toContain('value="history"');
    expect(html).toContain('value="reviews"');
    expect(html).toContain('+ Add variable');
  });

  // Folded, it shows the names of its wired variables beside their pins
  // (collapsedPins.test.tsx); with none wired (2026-10-25), just its sign, and
  // every variable keeps its handle.
  it('folded with no wire, it shows its sign and keeps a handle per variable', () => {
    const n = getVarsNode(true);
    const html = renderToStaticMarkup(
      createElement(ReactFlowProvider, null, createElement(nodeTypes.custom as any, { id: 'gv', data: n.data, selected: false, type: 'custom', xPos: 0, yPos: 0, zIndex: 0, isConnectable: true, dragging: false }))
    );
    expect(html).not.toContain('collapsed-getvars-names');
    expect(html).toContain('(x)');
    expect(html).toContain('data-handleid="history"');
    expect(html).toContain('data-handleid="reviews"');
  });

  it('the variables it reads are known to the run checks', () => {
    expect([...collectDeclaredVarNames([getVarsNode() as any])].sort()).toEqual(['history', 'reviews']);
  });
});
