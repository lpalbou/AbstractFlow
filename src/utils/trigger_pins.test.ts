// Operator ruling 2026-10-25: a triggered flow is the person's own workflow.
// What arrives is on On Flow Start as typed, named pins per trigger (the
// runtime's occurrence inputs, abstractruntime docs/automations.md); On Flow
// End takes response / notify / success; nothing is pre-built between them.
import { describe, expect, it } from 'vitest';
import { AUTOMATION_END_PINS, automationSaveWarning, triggerPinKind, triggerStartPins, withTriggerPins } from './triggerPins';
import { inputFields } from './automationInputs';
import type { VisualFlow } from '../types/flow';

describe('trigger pins', () => {
  it('per trigger, the runtime\'s names, typed and described', () => {
    const names = (k: Parameters<typeof triggerStartPins>[0]) => triggerStartPins(k).map((p) => `${p.id}:${p.type}`);
    expect(names('email')).toEqual(['messages:array', 'mailbox:string', 'event:object']);
    expect(names('feed')).toEqual(['items:array', 'feed:object', 'event:object']);
    expect(names('webhook')).toEqual(['calls:array', 'event:object']);
    expect(names('schedule')).toEqual(['scheduled_at:string', 'occurrence:number', 'event:object']);
    expect(names('manual')).toEqual(['event:object']);
    for (const k of ['email', 'feed', 'webhook', 'schedule'] as const) {
      for (const pin of triggerStartPins(k)) expect(pin.description, pin.id).toBeTruthy();
    }
    const messages = triggerStartPins('email')[0].schema as { items: { properties: Record<string, unknown> } };
    expect(Object.keys(messages.items.properties)).toEqual(['id', 'from', 'to', 'subject', 'date', 'body_text', 'attachments']);
    expect(AUTOMATION_END_PINS.map((p) => `${p.id}:${p.type}`)).toEqual(['response:string', 'notify:object', 'success:boolean']);
  });

  it('maps triggers to kinds', () => {
    expect(triggerPinKind({ source_id: 'email.received' })).toBe('email');
    expect(triggerPinKind({ source_id: 'feed.item' })).toBe('feed');
    expect(triggerPinKind({ source_id: 'webhook.received' })).toBe('webhook');
    expect(triggerPinKind({ source_id: 'schedule' })).toBe('schedule');
    expect(triggerPinKind({ source_id: 'manual' })).toBe('manual');
  });

  it('adds missing pins only, keeps the person\'s own, and is a no-op the second time', () => {
    const nodes = [
      { id: 's', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'on_flow_start', label: '', inputs: [], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'threshold', label: 'threshold', type: 'number' }] } },
      { id: 'e', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'on_flow_end', label: '', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'response', label: 'response', type: 'string' }], outputs: [] } },
    ] as never;
    const once = withTriggerPins(nodes, 'feed');
    expect(once).not.toBe(nodes);
    expect(once[0].data.outputs.map((p) => p.id)).toEqual(['exec-out', 'threshold', 'items', 'feed', 'event']);
    expect(once[1].data.inputs.map((p) => p.id)).toEqual(['exec-in', 'response', 'notify', 'success']);
    expect(withTriggerPins(once, 'feed')).toBe(once);
  });
});

describe('the Inputs section lists only the flow\'s own inputs', () => {
  it('what the trigger fills is never asked; a prompt pin stays a text field', () => {
    const flow = (outputs: Array<{ id: string; type: string }>) =>
      ({ nodes: [{ id: 's', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'on_flow_start', outputs: outputs.map((o) => ({ ...o, label: o.id })) } }] }) as unknown as VisualFlow;
    const filled = triggerStartPins('email').map((p) => ({ id: p.id, type: p.type }));
    expect(inputFields(flow([{ id: 'exec-out', type: 'execution' }, ...filled]))).toEqual([]);
    expect(inputFields(flow([...filled, { id: 'threshold', type: 'number' }, { id: 'prompt', type: 'string' }])).map((f) => `${f.id}:${f.kind}`)).toEqual([
      'prompt:prompt',
      'threshold:number',
    ]);
  });
});

describe('saving a triggered flow with nothing on response warns (never refuses)', () => {
  const base = (edges: unknown[]) =>
    ({
      automation_defaults: { schema_version: 1, trigger: { source_id: 'manual', source_version: 1, config: {} }, context: { mode: 'independent' }, input_data: {} },
      nodes: [{ id: 'e', data: { nodeType: 'on_flow_end' } }],
      edges,
    }) as unknown as VisualFlow;
  it('says so in words, and is quiet once response is wired or for a chat flow', () => {
    expect(automationSaveWarning(base([]))).toBe('Saved. Nothing is connected to On Flow End’s response yet, so each run will show an empty result.');
    expect(automationSaveWarning(base([{ source: 'x', target: 'e', targetHandle: 'response' }]))).toBeNull();
    expect(automationSaveWarning({ ...base([]), automation_defaults: undefined })).toBeNull();
  });
});
