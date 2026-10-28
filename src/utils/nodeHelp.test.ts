// QA 2026-10-28: real node and pin help in a dialog (purpose, inputs, outputs,
// examples), never one-line tooltips or prose on the canvas.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createNodeData, getAllNodeTemplates, getNodeTemplate } from '../types/nodes';
import { hasWrittenHelp, nodeHelp } from './nodeHelp';
import { NodeHelpBody } from '../components/NodeHelpModal';

describe('node help', () => {
  it('every node has a purpose and words for each of its data pins', () => {
    for (const template of getAllNodeTemplates()) {
      const help = nodeHelp(createNodeData(template));
      expect(help.purpose.length, template.type).toBeGreaterThan(10);
      for (const pin of [...help.inputs, ...help.outputs]) expect(pin.text.length, `${template.type}.${pin.id}`).toBeGreaterThan(3);
      expect([...help.inputs, ...help.outputs].some((p) => p.type === 'execution')).toBe(false);
    }
  });

  it('Notify me (a Publish to channel preset) gets its own help, not the generic publish one', () => {
    const notify = getAllNodeTemplates().find((t) => t.label === 'Notify me')!;
    const data = createNodeData(notify);
    expect(hasWrittenHelp(data)).toBe(true);
    const help = nodeHelp(data);
    expect(help.title).toBe('Notify me');
    expect(help.details.join(' ')).toContain('an empty title fails the step');
    expect(nodeHelp(createNodeData(getNodeTemplate('publish_event')!)).title).toBe('Publish to channel');
  });

  it('Compare says its default operator and lists != among its operators', () => {
    const help = nodeHelp(createNodeData(getNodeTemplate('compare')!));
    expect(help.details.join(' ')).toContain('!= not equal to');
    expect(help.inputs.find((p) => p.id === 'op')?.text).toBe('The operator. Not set: ==.');
    expect(help.examples[0]).toContain('op >, b 0');
    // Is Empty on a list waits for an AbstractRuntime release: the help must not send people there yet.
    expect(JSON.stringify(help)).not.toContain('Is Empty');
  });

  it('the dialog body lists purpose, inputs, outputs and examples', () => {
    const html = renderToStaticMarkup(createElement(NodeHelpBody, { data: createNodeData(getNodeTemplate('add_to_list')!) }));
    expect(html).toContain('node-help-purpose');
    expect(html).toContain('data-help-section="inputs"');
    expect(html).toContain('data-help-section="outputs"');
    expect(html).toContain('data-help-section="examples"');
    expect(html).toContain('data-help-pin="items"');
  });
});
