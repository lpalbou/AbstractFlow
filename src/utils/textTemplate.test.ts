// Operator 2026-10-11: "can't we handle the string template ourselves? something where a person
// could build its dynamic sentence and just add variables in it by selecting them".
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import { mentionChoices, TemplateTextEditor } from '../components/TemplateText';
import {
  parseTemplate,
  serializeTemplate,
  slotKind,
  slotName,
  templateInputNameProblem,
  templateInputPins,
  withoutRedundantTemplateVars,
} from './textTemplate';

describe('text with variable chips', () => {
  it('parses text and placeholders and writes them back unchanged', () => {
    const text = 'Global Task: {{prompt}}\nKnowledge: {{ knowledge | json }}\nOwner: {{user.name}}';
    const segments = parseTemplate(text);
    expect(segments.filter((s) => s.kind === 'slot').map((s) => (s as any).name)).toEqual(['prompt', 'knowledge', 'user.name']);
    expect(serializeTemplate(segments)).toBe('Global Task: {{prompt}}\nKnowledge: {{knowledge | json}}\nOwner: {{user.name}}');
    expect(slotName('items[0].title | upper')).toBe('items[0].title');
  });

  it('a chip is an input of the node first, then a run variable, else unknown', () => {
    const inputs = new Set(['task']);
    const vars = new Set(['task', 'history']);
    expect([slotKind('task', inputs, vars), slotKind('history', inputs, vars), slotKind('nope', inputs, vars)]).toEqual(['input', 'variable', 'unknown']);
    // A dotted variable (Set Variables allows `state.flags`) or a path into one keeps its colour.
    expect([slotKind('state.flags', inputs, new Set(['state.flags'])), slotKind('history.0', inputs, vars)]).toEqual(['variable', 'variable']);
  });

  it('typing @ lists inputs, then variables, as typed; an unknown name offers a new input', () => {
    const inputs = ['task'];
    const vars = ['history', 'knowledge', 'prompt', 'task'];
    expect(mentionChoices('', inputs, vars).map((c) => `${c.kind}:${c.name}`)).toEqual(['input:task', 'variable:history', 'variable:knowledge', 'variable:prompt']);
    expect(mentionChoices('kn', inputs, vars).map((c) => c.name)).toEqual(['knowledge']);
    expect(mentionChoices('round', inputs, vars)).toEqual([{ kind: 'new', name: 'round' }]);
    expect(mentionChoices('two words', inputs, vars)).toEqual([]);
  });

  it('the editor is one text box, with no separate insert button', () => {
    const html = renderToStaticMarkup(
      createElement(TemplateTextEditor, { value: 'Hi {{prompt}}', onChange: () => {}, inputs: [], variables: ['prompt'], onAddInput: () => true, inline: true })
    );
    expect(html).toContain('contenteditable="true"');
    expect(html).toContain('nodrag nowheel');
    expect(html).not.toContain('Insert variable');
  });

  it('a new String Template has only its text input; extra inputs are the wired values', () => {
    const data = createNodeData(getNodeTemplate('string_template')!);
    expect(data.inputs.map((p) => p.id)).toEqual(['template']);
    expect(templateInputPins([...data.inputs, { id: 'task', label: 'task', type: 'any' }, { id: 'vars', label: 'vars', type: 'object' }]).map((p) => p.id)).toEqual(['task']);
    expect(templateInputNameProblem('task', new Set(['task']))).toMatch(/already/);
    expect(templateInputNameProblem('two words', new Set())).toMatch(/one word/);
    expect(templateInputNameProblem('vars', new Set())).toMatch(/reserved/);
    expect(templateInputNameProblem('round', new Set())).toBeNull();
  });

  it('an older `vars` input that only passed all run variables goes on load; a real one stays', () => {
    const old = {
      ...createNodeData(getNodeTemplate('string_template')!),
      inputs: [{ id: 'template', label: 'template', type: 'string' as const }, { id: 'vars', label: 'vars', type: 'object' as const }],
      pinDefaults: { template: '{{history}}' },
      pinExpressions: { vars: 'vars' },
    };
    const moved = withoutRedundantTemplateVars(old as any, new Set());
    expect(moved.inputs.map((p) => p.id)).toEqual(['template']);
    expect(moved.pinExpressions).toBeUndefined();
    expect(withoutRedundantTemplateVars(old as any, new Set(['vars']))).toBe(old);
    const custom = { ...old, pinExpressions: { vars: "{'a': 1}" } };
    expect(withoutRedundantTemplateVars(custom as any, new Set())).toBe(custom);
    const seeded = { ...old, pinExpressions: undefined, pinDefaults: { template: 'x', vars: { who: 'Ada' } } };
    expect(withoutRedundantTemplateVars(seeded as any, new Set())).toBe(seeded);
  });
});

describe('String Template folds', () => {
  it('is foldable, and folded it is a small circle with its icon', async () => {
    const { isCollapsibleOperator } = await import('./operatorNodes');
    expect(isCollapsibleOperator('string_template')).toBe(true);
    const { ReactFlowProvider } = await import('reactflow');
    const { nodeTypes } = await import('../components/nodes/index');
    const data = { ...createNodeData(getNodeTemplate('string_template')!), collapsed: true, pinDefaults: { template: 'Global Task: {{prompt}}\nDo {{task}}' } };
    data.inputs = [...data.inputs, { id: 'task', label: 'task', type: 'any' }];
    const html = renderToStaticMarkup(
      createElement(ReactFlowProvider, null, createElement(nodeTypes.custom as any, { id: 't1', data, selected: false, type: 'custom', xPos: 0, yPos: 0, zIndex: 0, isConnectable: true, dragging: false }))
    );
    expect(html).toContain('collapsed-template-icon');
    expect(html).not.toContain('{{');
    // The dynamic import of the node components takes ~4 s cold; the full suite's load pushed it past 5 s.
  }, 30000);
});
