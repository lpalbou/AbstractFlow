// QA 2026-10-28 (e): Is Empty takes a list (AbstractRuntime backlog 0857).
import { describe, expect, it } from 'vitest';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import { areTypesCompatible } from './validation';
import { withIsEmptyAnyInput } from './isEmptyNode';
import { fromVisualFlow } from './serialization';
import { useFlowStore } from '../hooks/useFlow';
import { nodeHelp } from './nodeHelp';

const older = {
  id: 'e',
  type: 'is_empty_string',
  position: { x: 0, y: 0 },
  data: { nodeType: 'is_empty_string', label: 'Is Empty', inputs: [{ id: 'text', label: 'text', type: 'string' }], outputs: [{ id: 'result', label: 'result', type: 'boolean' }] },
};

describe('Is Empty takes a text or a list', () => {
  it('a new Is Empty accepts a list wire on its runtime pin id `text`', () => {
    const pin = createNodeData(getNodeTemplate('is_empty_string')!).inputs.find((p) => p.id === 'text')!;
    expect(pin.type).toBe('any');
    expect(areTypesCompatible('array', pin.type)).toBe(true);
    expect(areTypesCompatible('string', pin.type)).toBe(true);
  });

  it('an older Is Empty (input typed string) is opened with an any input, both load paths', () => {
    expect(areTypesCompatible('array', 'string')).toBe(false);
    const flow = { id: 'f', name: 'f', nodes: [older], edges: [] } as never;
    const pin = fromVisualFlow(flow).nodes[0].data.inputs[0];
    expect([pin.id, pin.type, pin.label]).toEqual(['text', 'any', 'value']);
    useFlowStore.getState().clearFlow();
    useFlowStore.getState().loadFlow(JSON.parse(JSON.stringify(flow)));
    const saved = useFlowStore.getState().getFlow().nodes[0].data.inputs[0];
    expect([saved.id, saved.type]).toEqual(['text', 'any']);
    useFlowStore.getState().clearFlow();
    // A label the author changed is kept; other nodes untouched.
    const renamed = { ...older.data, inputs: [{ id: 'text', label: 'subjects', type: 'string' }] } as never;
    expect((withIsEmptyAnyInput(renamed) as { inputs: { label: string }[] }).inputs[0].label).toBe('subjects');
    const other = { nodeType: 'trim', inputs: [{ id: 'text', label: 'text', type: 'string' }] } as never;
    expect(withIsEmptyAnyInput(other)).toBe(other);
  });

  it('the help says what is empty', () => {
    const help = nodeHelp(createNodeData(getNodeTemplate('is_empty_string')!));
    expect(help.purpose).toContain('a list has no items');
    expect(help.examples[0]).toContain('Get Variable “triage” → Is Empty');
  });
});
