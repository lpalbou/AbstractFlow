// On/off settings are kit switches labelled by the feature (state-toggles
// rule, 2026-09-30): the switch position IS the state, highlighted when on,
// never a verb label ("Enabled"/"Disabled", "Pause"/"Resume" swaps) and never
// a bare checkbox for a saved node setting or a dialog option.
//
// The package ships no DOM for tests, so the components render with
// react-dom/server and the assertions read the markup.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { findVerbToggleLabels } from '@abstractframework/ui-kit';
import { describe, expect, it } from 'vitest';
import type { Node } from 'reactflow';

import { createNodeData, getNodeTemplate } from '../types/nodes';
import type { FlowNodeData, NodeType } from '../types/flow';
import { PropertiesPanel } from './PropertiesPanel';
import { PublishFlowModal } from './PublishFlowModal';

const SRC = resolve(__dirname, '..');

function nodeOf(type: NodeType, patch: Partial<FlowNodeData> = {}): Node<FlowNodeData> {
  const template = getNodeTemplate(type);
  if (!template) throw new Error(`no template for ${type}`);
  return { id: `n-${type}`, type: 'custom', position: { x: 0, y: 0 }, data: { ...createNodeData(template), ...patch } };
}

function renderPanel(node: Node<FlowNodeData>): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PropertiesPanel, { node })));
}

/** The <button role="switch"> whose data-action is `action` (its full opening tag and text). */
function switchMarkup(html: string, action: string): string {
  const start = html.indexOf(`data-action="${action}"`);
  expect(start, `switch ${action} is rendered`).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<button', start);
  const end = html.indexOf('</button>', start);
  const tag = html.slice(open, end);
  expect(tag).toContain('role="switch"');
  expect(tag).toContain('class="af-switch');
  return tag;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe('state toggles: node settings are switches', () => {
  it('On Schedule: "Recurrent" is a switch showing its state, no Enabled/Disabled label', () => {
    const on = switchMarkup(renderPanel(nodeOf('on_schedule')), 'recurrent');
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('>Recurrent<');
    const off = switchMarkup(renderPanel(nodeOf('on_schedule', { eventConfig: { schedule: '15s', recurrent: false } })), 'recurrent');
    expect(off).toContain('aria-checked="false"');
    expect(off).not.toMatch(/Enabled|Disabled/);
  });

  it('Ask User: "Free text answers" is a switch', () => {
    const html = renderPanel(nodeOf('ask_user', { effectConfig: { allowFreeText: false } }));
    const tag = switchMarkup(html, 'allow-free-text');
    expect(tag).toContain('aria-checked="false"');
    expect(tag).toContain('>Free text answers<');
  });

  it('Agent: "Structured output" is a switch', () => {
    const tag = switchMarkup(renderPanel(nodeOf('agent')), 'structured-output');
    expect(tag).toContain('>Structured output<');
    expect(tag).toMatch(/aria-checked="(true|false)"/);
  });
});

describe('state toggles: dialog options are switches', () => {
  it('Publish: "Reload gateway bundles" is a switch, on by default', () => {
    const html = renderToStaticMarkup(
      createElement(PublishFlowModal, { isOpen: true, flowId: 'f1', flowName: 'demo', onClose: () => {} })
    );
    const tag = switchMarkup(html, 'reload-gateway');
    expect(tag).toContain('aria-checked="true"');
    expect(tag).toContain('>Reload gateway bundles<');
    expect(html).not.toContain('type="checkbox"');
  });
});

describe('state toggles: run window and model residency (source)', () => {
  // These two need a live gateway contract to render; their switches are
  // pinned by source: each option is a kit AfSwitch with its action, and the
  // old checkbox is gone.
  const cases: Array<[string, string[], string[]]> = [
    ['components/RunFlowModal.tsx', ['workspace-random', 'event-durable'], ['Random (default)', '>durable<']],
    ['components/ModelResidencyPanel.tsx', ['lock-after-load', 'show-non-resident'], ['Show cached/non-resident</span>']],
  ];
  for (const [file, actions, gone] of cases) {
    it(`${file}: ${actions.join(', ')} are AfSwitch controls`, () => {
      const src = readFileSync(join(SRC, file), 'utf8');
      for (const action of actions) {
        expect(src).toMatch(new RegExp(`<AfSwitch[^>]*?action="${action}"`, 's'));
      }
      for (const text of gone) expect(src).not.toContain(text);
    });
  }
});

describe('state toggles: source guard', () => {
  it('no verb-swap toggle labels anywhere in src (kit findVerbToggleLabels)', () => {
    const hits = walk(SRC).flatMap((file) =>
      findVerbToggleLabels(readFileSync(file, 'utf8')).map((h) => `${relative(SRC, file)}:${h.line} ${h.labels.join(' / ')}`)
    );
    expect(hits).toEqual([]);
  });

  it('the guard itself flags a verb swap (it is not decoration)', () => {
    expect(findVerbToggleLabels(`const l = on ? 'Disable' : 'Enable';`)).toHaveLength(1);
  });
});
