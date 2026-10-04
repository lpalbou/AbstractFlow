// R13.3 canvas node card: kit icon + full title (wrapped, never truncated) +
// type badge in the header; status colours from theme tokens; hover/selected.
// No DOM here: BaseNode renders with react-dom/server inside the providers it
// needs; the stylesheet rules are read directly.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactFlowProvider } from 'reactflow';
import { describe, expect, it } from 'vitest';

import { createNodeData, getNodeTemplate } from '../../types/nodes';
import type { FlowNodeData, NodeType } from '../../types/flow';
import { BaseNode } from './BaseNode';
import { nodeTypeBadge } from '../../utils/nodeIcons';

function renderNode(type: NodeType, patch: Partial<FlowNodeData> = {}, selected = false): string {
  const template = getNodeTemplate(type);
  if (!template) throw new Error(`no template for ${type}`);
  const data = { ...createNodeData(template), ...patch };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  const props = {
    id: `n-${type}`,
    data,
    selected,
    type: 'custom',
    zIndex: 0,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    dragging: false,
  } as any;
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(ReactFlowProvider, null, createElement(BaseNode, props)))
  );
}

const header = (html: string) => {
  const i = html.indexOf('class="node-header"');
  expect(i, 'node header rendered').toBeGreaterThan(-1);
  return html.slice(i, html.indexOf('class="node-body"', i));
};

describe('canvas node card', () => {
  it('header = kit svg icon + full title + type badge (no emoji, no stored icon HTML)', () => {
    const long = 'A deliberately long node title that must wrap onto several lines and never be cut';
    const html = renderNode('llm_call', { label: long });
    const h = header(html);
    expect(h).toMatch(/class="node-icon"[^>]*><svg/);
    expect(h).toContain(`<span class="node-title">${long}</span>`);
    expect(h).toContain(`<span class="node-type-badge">${nodeTypeBadge('core')}</span>`);
    expect(/\p{Extended_Pictographic}/u.test(h.replace(/<[^>]+>/g, ''))).toBe(false);
  });

  it('every palette category renders a badge and an icon', () => {
    for (const [type, badge] of [
      ['on_flow_start', 'Event'],
      ['if', 'Control'],
      ['literal_number', 'Value'],
      ['add', 'Math'],
      ['concat', 'Data'],
      ['read_file', 'File'],
      ['memory_note', 'Memory'],
      ['set_var', 'Variable'],
    ] as [NodeType, string][]) {
      const h = header(renderNode(type));
      expect(h, type).toMatch(/class="node-icon"[^>]*><svg/);
      expect(h, type).toContain(`<span class="node-type-badge">${badge}</span>`);
    }
  });

  it('the title carries no truncation class or inline ellipsis', () => {
    const h = header(renderNode('agent', { label: 'Agent with a title long enough to wrap' }));
    expect(h).not.toMatch(/ellipsis|truncate|nowrap/);
  });

  it('the category colour is a card variable (--node-accent), not a header fill', () => {
    const html = renderNode('if');
    const template = getNodeTemplate('if')!;
    expect(html).toContain(`--node-accent:${template.headerColor}`);
    expect(header(html)).not.toMatch(/background-color/);
  });

  it('selected nodes carry the selected class', () => {
    expect(renderNode('code', {}, true)).toMatch(/class="flow-node[^"]*\bselected\b/);
  });
});

describe('node card stylesheet', () => {
  const css = readFileSync(resolve(__dirname, '../../styles/nodes.css'), 'utf8');
  const rule = (sel: string) => {
    const i = css.indexOf(`\n${sel} {`);
    expect(i, `${sel} rule exists`).toBeGreaterThan(-1);
    return css.slice(i, css.indexOf('}', i));
  };

  it('titles wrap and are never truncated (no ellipsis, no nowrap)', () => {
    const title = rule('.node-title');
    expect(title).toMatch(/white-space:\s*normal/);
    expect(title).toMatch(/overflow-wrap:\s*anywhere/);
    expect(title).not.toMatch(/ellipsis|nowrap|overflow:\s*hidden/);
    expect(css).not.toMatch(/\.node-title[^{]*\{[^}]*text-overflow/);
  });

  it('status colours are theme tokens: running / done / waiting / failed', () => {
    expect(rule('.flow-node.executing')).toMatch(/--node-status:\s*var\(--success\)/);
    expect(rule('.flow-node.recent')).toMatch(/--node-status:\s*var\(--info\)/);
    expect(rule('.flow-node.waiting')).toMatch(/--node-status:\s*var\(--warning\)/);
    expect(rule('.flow-node.failed')).toMatch(/--node-status:\s*var\(--error\)/);
    expect(rule('.flow-node.selected')).toMatch(/var\(--accent\)/);
  });

  it('the header no longer uppercases the title', () => {
    expect(rule('.node-header')).not.toMatch(/text-transform:\s*uppercase/);
  });
});

describe('run status marks', () => {
  it('BaseNode maps the store marks to waiting / failed classes and data-run-status', () => {
    const src = readFileSync(resolve(__dirname, 'BaseNode.tsx'), 'utf8');
    expect(src).toMatch(/isWaitingHere && 'waiting'/);
    expect(src).toMatch(/isFailedHere && 'failed'/);
    expect(src).toMatch(/data-run-status=/);
  });

  it('the run stream marks the waiting node and the failed node', () => {
    const src = readFileSync(resolve(__dirname, '../../hooks/useWebSocket.ts'), 'utf8');
    expect(src).toMatch(/setNodeRunMark\('waiting', info\.nodeId/);
    expect(src).toMatch(/setNodeRunMark\('failed', failedAt/);
  });
});
