// Operator 2026-10-25: "The default input_data JSON: I do not know what you are
// asking". The inputs are a form generated from On Flow Start's outputs.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { inputDataFromForm, inputFields, inputFormFromData } from './automationInputs';
import { InputsForm } from '../components/AutomationDefaultsModal';
import type { VisualFlow } from '../types/flow';

const FLOW = {
  nodes: [
    {
      id: 'node-1',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'on_flow_start',
        outputs: [
          { id: 'exec-out', label: '', type: 'execution' },
          { id: 'provider', label: 'provider', type: 'provider_text', description: 'LLM provider (empty = gateway default).' },
          { id: 'prompt', label: 'prompt', type: 'string' },
          { id: 'max_cycles', label: 'max_cycles', type: 'number' },
          { id: 'dry_run', label: 'Dry run', type: 'boolean' },
          { id: 'options', label: 'options', type: 'object' },
          { id: 'event', label: 'event', type: 'object' },
        ],
      },
    },
  ],
} as unknown as VisualFlow;

describe('inputs form ↔ input_data', () => {
  const fields = inputFields(FLOW);

  it('one field per On Flow Start input; prompt in words; the event is never asked', () => {
    expect(fields.map((f) => `${f.id}:${f.kind}:${f.label}`)).toEqual([
      'provider:text:Provider',
      'prompt:prompt:What each run is asked to do',
      'max_cycles:number:Max cycles',
      'dry_run:boolean:Dry run',
      'options:json:Options',
    ]);
    expect(fields.find((f) => f.id === 'prompt')?.help).toBe('The trigger’s details are added automatically.');
  });

  it('round-trips: fields for the pins, the rest in the raw JSON', () => {
    const data = { prompt: 'Summarise the new mail.', max_cycles: 3, dry_run: false, options: { tone: 'short' }, _runtime: { thinking: 'low' } };
    const form = inputFormFromData(fields, data);
    expect(form.values).toEqual({ prompt: 'Summarise the new mail.', max_cycles: '3', dry_run: 'false', options: '{\n  "tone": "short"\n}' });
    expect(JSON.parse(form.raw)).toEqual({ _runtime: { thinking: 'low' } });
    expect(inputDataFromForm(fields, form.values, form.raw)).toEqual({ input_data: data });
    expect(inputDataFromForm(fields, {}, '')).toEqual({ input_data: {} });
  });

  it('problems are plain words', () => {
    expect(inputDataFromForm(fields, { max_cycles: 'many', options: '{x' }, '[1]')).toEqual({
      problems: [
        'Advanced: the raw JSON must be an object, like {"key": "value"}.',
        'Max cycles: enter a number.',
        expect.stringMatching(/^Options: not valid JSON/),
      ],
    });
    expect(inputDataFromForm(fields, { prompt: 'a' }, '{"prompt": "b", "event": {}}')).toEqual({
      problems: ['Advanced: "event" is filled by the trigger on every run; remove it.', 'Advanced: "prompt" has its own field (What each run is asked to do); set it there.'],
    });
  });

  it('renders labels and help, never "input_data", with the raw JSON tucked under Advanced', () => {
    const html = renderToStaticMarkup(createElement(InputsForm, { fields, values: {}, onValues: () => {}, raw: '', onRaw: () => {} }));
    expect(html).toContain('What each run is asked to do');
    expect(html).toContain('The trigger’s details are added automatically.');
    expect(html).toContain('<summary>Advanced: raw JSON</summary>');
    expect(html).not.toContain('input_data');
    expect(html).not.toMatch(/>event</);
  });
});
