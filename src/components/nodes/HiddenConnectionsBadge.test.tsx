import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { hiddenConnectionsLabel, useFlowStore } from '../../hooks/useFlow';
import { listBundledFlows } from '../../utils/bundledFlows';
import { HiddenConnectionsBadgeView } from './HiddenConnectionsBadge';

// Server rendering reads a zustand store's INITIAL state, so the view is
// rendered with the label the connected badge selects from the live store.
const render = (nodeId: string) =>
  renderToStaticMarkup(
    createElement(HiddenConnectionsBadgeView, { label: hiddenConnectionsLabel(useFlowStore.getState(), nodeId) })
  );

const decode = (html: string) => html.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&#x27;/g, "'");

describe('HiddenConnectionsBadge', () => {
  beforeEach(() => {
    useFlowStore.getState().clearFlow();
    useFlowStore.getState().loadFlow(listBundledFlows().find((f) => f.id === 'entity-chat')!);
  });

  it('marks a node with its kept-but-not-drawn connections and lists them in the tooltip', () => {
    const html = decode(render('visit_guard'));
    expect(html).toContain('>5 hidden<');
    expect(html).toContain('5 hidden connections (kept and saved, not drawn):');
    for (const line of [
      'visit.child_output -> visit_guard.child',
      'visit_guard.value -> end.answer',
      'visit_guard.value -> end.response',
      'visit_guard.died -> degraded_fold.guard_died',
      'visit_guard.error -> degraded_fold.guard_error',
    ]) {
      expect(html).toContain(line);
    }
  });

  it('renders nothing for a node without hidden connections, and follows node deletion', () => {
    expect(render('start')).toBe('');
    useFlowStore.getState().deleteNode('degraded_fold');
    const html = decode(render('visit_guard'));
    expect(html).toContain('>3 hidden<');
  });

  it('is rendered in every node header, and file import shows the same load notices', () => {
    const baseNode = readFileSync(resolve(__dirname, 'BaseNode.tsx'), 'utf8');
    expect(baseNode).toContain('<HiddenConnectionsBadge nodeId={id} />');
    const badge = readFileSync(resolve(__dirname, 'HiddenConnectionsBadge.tsx'), 'utf8');
    expect(badge).toContain('useFlowStore((s) => hiddenConnectionsLabel(s, nodeId))');
    const toolbar = readFileSync(resolve(__dirname, '../Toolbar.tsx'), 'utf8');
    const importBody = toolbar.slice(toolbar.indexOf('const doImport = useCallback'), toolbar.indexOf('// Handle import'));
    expect(importBody).toContain('loadFlow(flow);');
    expect(importBody).toContain('showLoadNotices();');
  });
});
