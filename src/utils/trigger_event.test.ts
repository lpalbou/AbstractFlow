import { beforeEach, describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, VisualFlow } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import { useFlowStore } from '../hooks/useFlow';
import {
  TRIGGER_EVENT_FIELDS,
  TRIGGER_EVENT_NODE_LABEL,
  TriggerEventError,
  isTriggerableFlow,
  startHasTriggerEvent,
  triggerEventRequirement,
  withTriggerEvent,
} from './triggerEvent';

function node(id: string, type: string, x = 0, y = 0): Node<FlowNodeData> {
  const template = getNodeTemplate(type as never);
  if (!template) throw new Error(`no template ${type}`);
  return { id, type: 'custom', position: { x, y }, data: createNodeData(template) };
}

describe('triggerable flows', () => {
  it('needs the event object output on On Flow Start', () => {
    const start = node('start', 'on_flow_start');
    const flow = { nodes: [{ id: 'start', type: 'on_flow_start', position: { x: 0, y: 0 }, data: start.data }] } as unknown as VisualFlow;
    expect(isTriggerableFlow(flow)).toBe(false);
    const withPin = withTriggerEvent([start], [], { breakNodeId: 'b1', edgeId: 'e1' });
    const triggerable = { nodes: withPin.nodes.map((n) => ({ ...n, type: n.data.nodeType })) } as unknown as VisualFlow;
    expect(isTriggerableFlow(triggerable)).toBe(true);
    // A pin named event of another type does not count.
    expect(startHasTriggerEvent({ outputs: [{ id: 'event', label: 'event', type: 'string' }] })).toBe(false);
  });

  it('is required by connection sources, recommended by event sources, optional for time/manual', () => {
    expect(triggerEventRequirement({ uses_trigger_connection: true, capabilities: { kind: 'event' } })).toBe('required');
    expect(triggerEventRequirement({ uses_trigger_connection: false, capabilities: { kind: 'event' } })).toBe('recommended');
    expect(triggerEventRequirement({ uses_trigger_connection: false, capabilities: { kind: 'time' } })).toBe('optional');
    expect(triggerEventRequirement({ uses_trigger_connection: false, capabilities: { kind: 'manual' } })).toBe('optional');
  });
});

describe('withTriggerEvent', () => {
  it('adds the event output and a wired "Trigger event" Break Object exposing type, subject, time, data, count, events, series', () => {
    const start = node('start', 'on_flow_start', 100, 50);
    const out = withTriggerEvent([start], [], { breakNodeId: 'b1', edgeId: 'e1' });
    const s = out.nodes.find((n) => n.id === 'start')!;
    const pin = s.data.outputs.find((p) => p.id === 'event')!;
    expect(pin.type).toBe('object');
    expect(Object.keys((pin.schema as { properties: Record<string, unknown> }).properties)).toEqual(
      expect.arrayContaining(['id', 'type', 'source', 'subject', 'time', 'data', 'sequence', 'connectionid'])
    );
    const b = out.nodes.find((n) => n.id === 'b1')!;
    expect(b.data.nodeType).toBe('break_object');
    expect(b.data.label).toBe(TRIGGER_EVENT_NODE_LABEL);
    // The runtime's break_object reads `breakConfig.selectedPaths` (dotted paths into the object).
    expect(b.data.breakConfig?.selectedPaths).toEqual(['type', 'subject', 'time', 'data', 'data.count', 'data.events', 'data.series']);
    expect(b.data.outputs.map((p) => `${p.id}:${p.label}:${p.type}`)).toEqual([
      'type:type:string',
      'subject:subject:string',
      'time:time:string',
      'data:data:object',
      'data.count:count:number',
      'data.events:events:array',
      'data.series:series:object',
    ]);
    // A feed item's title is typed for path pickers: data.events[i].data.title.
    const events = b.data.outputs.find((p) => p.id === 'data.events')!;
    const item = (events.schema as { items: { properties: { data: { properties: Record<string, unknown> } } } }).items;
    expect(Object.keys(item.properties.data.properties)).toEqual(['title', 'link', 'published', 'summary', 'body', 'body_text']);
    expect(out.edges).toEqual([{ id: 'e1', source: 'start', sourceHandle: 'event', target: 'b1', targetHandle: 'object' }]);
    expect(out.breakNodeId).toBe('b1');
    expect(TRIGGER_EVENT_FIELDS).toHaveLength(7);
  });

  it('is idempotent once wired, and refuses ambiguous graphs with the reason', () => {
    const start = node('start', 'on_flow_start');
    const once = withTriggerEvent([start], [], { breakNodeId: 'b1', edgeId: 'e1' });
    const twice = withTriggerEvent(once.nodes, once.edges as Edge[], { breakNodeId: 'b2', edgeId: 'e2' });
    expect(twice.breakNodeId).toBeNull();
    expect(twice.nodes).toBe(once.nodes);
    expect(twice.edges).toBe(once.edges);
    expect(() => withTriggerEvent([], [], { breakNodeId: 'b', edgeId: 'e' })).toThrow(TriggerEventError);
    expect(() => withTriggerEvent([start, node('s2', 'on_flow_start')], [], { breakNodeId: 'b', edgeId: 'e' })).toThrow(/several On Flow Start/);
    const clash = { ...start, data: { ...start.data, outputs: [...start.data.outputs, { id: 'event', label: 'event', type: 'string' as const }] } };
    expect(() => withTriggerEvent([clash], [], { breakNodeId: 'b', edgeId: 'e' })).toThrow(/of type string/);
  });
});

describe('store: addTriggerEvent', () => {
  beforeEach(() => {
    useFlowStore.getState().clearFlow();
  });

  it('adds both in one undo step and survives getFlow()', () => {
    const store = useFlowStore.getState();
    store.addNode(getNodeTemplate('on_flow_start')!, { x: 0, y: 0 });
    const breakId = useFlowStore.getState().addTriggerEvent();
    expect(breakId).toBeTruthy();
    const flow = useFlowStore.getState().getFlow();
    expect(isTriggerableFlow(flow)).toBe(true);
    const b = flow.nodes.find((n) => n.id === breakId)!;
    expect(b.type).toBe('break_object');
    expect(flow.edges.some((e) => e.sourceHandle === 'event' && e.target === breakId && e.targetHandle === 'object')).toBe(true);
    useFlowStore.getState().undo();
    expect(isTriggerableFlow(useFlowStore.getState().getFlow())).toBe(false);
    expect(useFlowStore.getState().nodes).toHaveLength(1);
  });
});

describe('email is recommended, not required', () => {
  it('an email trigger also delivers its bodies as the emails input', () => {
    expect(triggerEventRequirement({ uses_trigger_connection: false, capabilities: { kind: 'event' } })).toBe('recommended');
  });
});
