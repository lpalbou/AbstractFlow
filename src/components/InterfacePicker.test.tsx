// Operator 2026-10-11: the interfaces are a one-line list under the title and
// description; ticking or inspecting one opens a details panel that draws the
// On Flow Start / On Flow End nodes with the pins it adds.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContractDiagram, InterfacePicker } from './InterfacePicker';
import { PIN_COLORS } from '../types/flow';
import { KNOWN_INTERFACES, knownInterface } from '../utils/flowFamilies';

const render = (value: string[]) =>
  renderToStaticMarkup(
    createElement(InterfacePicker, { value, onChange: () => {}, title: 'Interfaces', pinNote: 'PIN NOTE', leading: createElement('div', { id: 'lead' }) })
  );

describe('interface picker', () => {
  it('lists every non-domain interface on one row each, below the leading fields, with no details open when none is declared', () => {
    const html = render([]);
    expect(html.indexOf('id="lead"')).toBeLessThan(html.indexOf('class="iface-list"'));
    const rows = html.match(/<li class="iface-row/g) || [];
    expect(rows).toHaveLength(KNOWN_INTERFACES.filter((i) => i.class !== 'domain').length);
    expect(html).toContain('none selected');
    expect(html).not.toContain('<aside');
  });

  it('marks the declared rows and counts them', () => {
    const html = render(['abstractcode.agent.v1']);
    expect(html.match(/<li class="iface-row is-selected/g)).toHaveLength(1);
    expect(html).toContain('1 selected');
    expect(html).toMatch(/<li class="iface-row is-selected( is-open)?"><input type="checkbox" aria-label="Declare Runnable agent \(v1\)" checked=""/);
  });

  it('draws On Flow Start with the pins hosts send and On Flow End with the pins they read, in the canvas pin colours', () => {
    const agent = knownInterface('abstractcode.agent.v1')!;
    const html = renderToStaticMarkup(createElement(ContractDiagram, { iface: agent }));
    const start = html.slice(html.indexOf('contract-node--out'), html.indexOf('contract-flow'));
    const end = html.slice(html.indexOf('contract-node--in'));
    expect(start).toContain('On Flow Start');
    expect(end).toContain('On Flow End');
    for (const pin of agent.requiredStartPins!) {
      expect(start).toContain(`<span class="contract-pin-label">${pin.label}</span><span class="contract-pin-type">${pin.type}</span>`);
      expect(start).toContain(`color:${PIN_COLORS[pin.type]}`);
    }
    for (const pin of agent.requiredEndPins!) expect(end).toContain(`<span class="contract-pin-label">${pin.label}</span>`);
    expect(start).not.toContain('>response<');
  });

  it('lists a declared interface this editor does not know, so it can be seen and unticked', () => {
    const html = render(['retired.contract.v1']);
    expect(html).toContain('1 selected');
    expect(html).toMatch(/<li class="iface-row is-selected( is-open)?"><input type="checkbox" aria-label="Declare retired.contract.v1" checked=""/);
    expect(html).toContain('Not an interface this editor knows');
  });

  it('opens the details of the first declared interface', () => {
    const html = render(['abstractcode.agent.v1']);
    expect(html).toContain('<aside id="iface-detail" class="iface-detail" aria-label="Runnable agent (v1) details">');
    expect(html).toMatch(/<li class="iface-row is-selected is-open">/);
  });
});
