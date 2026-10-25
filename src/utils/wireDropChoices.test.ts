import type { Edge, Node } from 'reactflow';
import { beforeEach, describe, expect, it } from 'vitest';
import { useFlowStore } from '../hooks/useFlow';
import { PIN_COLORS, type FlowNodeData, type PinType } from '../types/flow';
import { areTypesCompatible } from './validation';
import { createNodeData, getAllNodeTemplates, getNodeTemplate, type NodeTemplate } from '../types/nodes';
import { EMAIL_FIELDS, hasEmailFields, withEmailFields } from './emailType';
import { buildPaletteSections } from './paletteModel';
import { LIST_PIN_TYPES, dropChoiceCopy, dropChoiceNode, dropChoicesFor, wiredSourceType, type DropChoice } from './relays';

/** A source node whose `out` output has the given type (a Code node's pins, retyped). */
function source(id: string, type: PinType): Node<FlowNodeData> {
  const data = createNodeData(getNodeTemplate('code')!);
  return { id, type: 'custom', position: { x: 0, y: 0 }, data: { ...data, outputs: [...data.outputs, { id: 'out', label: 'out', type }] } };
}

/** What the canvas does for a menu choice (components/Canvas.tsx wireDropMenu). */
function drop(choice: DropChoice, from: { nodeId: string; handleId: string }): string | null {
  const made = dropChoiceNode(choice, 'source');
  const template = (made.label
    ? getAllNodeTemplates().find((t) => t.type === made.type && t.label === made.label)
    : getNodeTemplate(made.type)) as NodeTemplate;
  expect(template).toBeTruthy();
  return useFlowStore.getState().addNodeAndConnect(template, { x: 300, y: 0 }, { from: { ...from, side: 'source' }, newPin: made.pin });
}

beforeEach(() => useFlowStore.getState().clearFlow());

describe('Break Email from a dropped Email wire', () => {
  it('the menu offers Break Email first (and a relay), with its hint; an Email input only a relay', () => {
    expect(dropChoicesFor('email', 'source')).toEqual(['break_email', 'relay']);
    expect(dropChoicesFor('email', 'target')).toEqual(['relay']);
    expect(dropChoiceCopy('break_email')).toEqual({ label: 'Break Email', hint: 'Expose this email’s fields: from, subject, date, body, …' });
    // Break Object for plain objects is as it was.
    expect(dropChoicesFor('object', 'source')).toEqual(['relay', 'break_object']);
    expect(dropChoiceCopy('break_object').label).toBe('Break Object');
  });

  it('creates a Break Object with every Email field as a typed output, wired from the email pin', () => {
    useFlowStore.getState().setNodes([source('src', 'email')]);
    const id = drop('break_email', { nodeId: 'src', handleId: 'out' });
    const s = useFlowStore.getState();
    const made = s.nodes.find((n) => n.id === id)!;
    expect(made.data.nodeType).toBe('break_object');
    expect(made.data.label).toBe('Break Email');
    expect(made.data.breakConfig?.selectedPaths).toEqual([...EMAIL_FIELDS]);
    const types = Object.fromEntries(made.data.outputs.map((p) => [p.id, p.type]));
    expect(types).toMatchObject({ id: 'string', from: 'string', subject: 'string', date: 'string', body_text: 'string', to: 'array', cc: 'array', attachments: 'array', labels: 'array', seen: 'boolean', flagged: 'boolean' });
    expect(made.data.outputs.map((p) => p.id)).toEqual([...EMAIL_FIELDS]);
    expect(made.data.inputs.find((p) => p.id === 'object')?.type).toBe('email');
    expect(s.edges.map((e) => [e.source, e.sourceHandle, e.target, e.targetHandle])).toEqual([['src', 'out', id, 'object']]);
    // One undo step.
    s.undo();
    expect(useFlowStore.getState().nodes.map((n) => n.id)).toEqual(['src']);
  });

  it('the item of a ForEach over an Email list is an Email: its drop offers Break Email', () => {
    const search = { id: 'm', type: 'custom', position: { x: 0, y: 0 }, data: createNodeData(getNodeTemplate('mail_search')!) } as Node<FlowNodeData>;
    useFlowStore.getState().setNodes([search]);
    const loopId = drop('foreach', { nodeId: 'm', handleId: 'emails' })!;
    const item = useFlowStore.getState().nodes.find((n) => n.id === loopId)!.data.outputs.find((p) => p.id === 'item')!;
    expect(item.type).toBe('email');
    expect(dropChoicesFor(item.type, 'source')[0]).toBe('break_email');
    expect(drop('break_email', { nodeId: loopId, handleId: 'item' })).toBeTruthy();
  });

  it('the palette has Break Email right after Break Object', () => {
    const data = buildPaletteSections().find((s) => s.key === 'data')!.nodes.map((n) => n.label);
    expect(data[data.indexOf('Break Object') + 1]).toBe('Break Email');
    // Break Object stays the canonical template of its type (loading, the assistant).
    expect(getNodeTemplate('break_object')?.label).toBe('Break Object');
    expect(createNodeData(getNodeTemplate('break_object')!).breakConfig?.selectedPaths).toEqual([]);
  });
});

describe('"Use the Email fields" on a Break Object fed by an Email', () => {
  const brk = (): Node<FlowNodeData> => ({ id: 'b', type: 'custom', position: { x: 0, y: 0 }, data: createNodeData(getNodeTemplate('break_object')!) });

  it('knows the Break Object is fed by an Email, through a relay too', () => {
    const relay = { id: 'r', type: 'custom', position: { x: 0, y: 0 }, data: createNodeData(getNodeTemplate('reroute')!) } as Node<FlowNodeData>;
    const direct: Edge[] = [{ id: '1', source: 'src', sourceHandle: 'out', target: 'b', targetHandle: 'object' }];
    expect(wiredSourceType([source('src', 'email'), brk()], direct, 'b', 'object')).toBe('email');
    const viaRelay: Edge[] = [
      { id: '1', source: 'src', sourceHandle: 'out', target: 'r', targetHandle: 'in' },
      { id: '2', source: 'r', sourceHandle: 'out', target: 'b', targetHandle: 'object' },
    ];
    expect(wiredSourceType([source('src', 'email'), relay, brk()], viaRelay, 'b', 'object')).toBe('email');
    expect(wiredSourceType([source('src', 'object'), brk()], direct, 'b', 'object')).toBe('object');
    expect(wiredSourceType([brk()], [], 'b', 'object')).toBeUndefined();
  });

  it('sets every Email field with its type and keeps a field the author added', () => {
    const data = { ...brk().data, outputs: [{ id: 'from', label: 'from', type: 'any' as const }, { id: 'extra', label: 'extra', type: 'string' as const }] };
    expect(hasEmailFields(data.outputs)).toBe(false);
    const patch = withEmailFields(data);
    expect(hasEmailFields(patch.outputs)).toBe(true);
    expect(patch.outputs.map((p) => p.id)).toEqual([...EMAIL_FIELDS, 'extra']);
    expect(patch.outputs.find((p) => p.id === 'from')?.type).toBe('string');
    expect(patch.breakConfig?.selectedPaths).toEqual([...EMAIL_FIELDS, 'extra']);
    expect(patch.inputs.find((p) => p.id === 'object')?.type).toBe('email');
  });
});

describe('Loops from a dropped list wire', () => {
  it('every typed list offers ForEach first, then a relay; For / While / Loop Limit are not offered', () => {
    for (const type of LIST_PIN_TYPES) {
      expect(dropChoicesFor(type, 'source')).toEqual(['foreach', 'relay']);
    }
    expect(dropChoicesFor('array', 'target')).toEqual(['relay']);
    expect(dropChoiceCopy('foreach', 'array')).toEqual({
      label: 'ForEach',
      hint: 'Run the next steps once for each item: wire them to loop, and what comes after the last item to done',
    });
    expect(dropChoiceCopy('foreach', 'emails').hint).toBe('Run the next steps once for each email: wire them to loop, and what comes after the last email to done');
  });

  it('the list pins are every pin type that wires into a list input (ForEach items)', () => {
    // A guard: a new list type must join LIST_PIN_TYPES, or the drop menu misses it.
    const intoList = (Object.keys(PIN_COLORS) as PinType[]).filter((t) => t !== 'any' && areTypesCompatible(t, 'array'));
    expect([...LIST_PIN_TYPES].sort()).toEqual(intoList.sort());
  });

  it('ForEach arrives with the list on its items, for each list type', () => {
    for (const type of LIST_PIN_TYPES) {
      useFlowStore.getState().clearFlow();
      useFlowStore.getState().setNodes([source('src', type)]);
      const id = drop('foreach', { nodeId: 'src', handleId: 'out' });
      expect(id, type).toBeTruthy();
      const s = useFlowStore.getState();
      expect(s.nodes.find((n) => n.id === id)?.data.nodeType).toBe('loop');
      expect(s.edges.map((e) => [e.source, e.sourceHandle, e.target, e.targetHandle])).toEqual([['src', 'out', id, 'items']]);
    }
  });
});
