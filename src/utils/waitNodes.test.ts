// Waits (operator 2026-10-25): Wait Until / Wait for Event / Emit Event are
// renamed and moved under "Waits"; `wait_event` folds into Wait for Event as
// its step form. Node types and the exported flow JSON must not change.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactFlowProvider, type Edge, type Node } from 'reactflow';
import { describe, expect, it } from 'vitest';

import type { FlowNodeData, NodeType, VisualFlow } from '../types/flow';
import { NODE_CATEGORIES, createNodeData, getNodeTemplate } from '../types/nodes';
import { BaseNode } from '../components/nodes/BaseNode';
import { WaitForEventAdvanced } from '../components/WaitForEventAdvanced';
import { buildPaletteSections, filterPaletteSections } from './paletteModel';
import { nodeIconName, nodeTypeBadge } from './nodeIcons';
import { nodeColorSection, nodeSemanticCategory } from './nodeCategoryColors';
import { exportFlowToJson, fromVisualFlow, toVisualFlow } from './serialization';
import { applyFlowAuthoringCommands } from './flowAuthoringCommands';
import { nodeDisplayLabel, nodeDisplayName, switchWaitForEventForm, wiresDroppedBySwitch } from './waitNodes';

const FIXTURE = resolve(__dirname, '__fixtures__/wait_nodes_flow.json');
// Captured with the editor BEFORE the rename (same input, same code path).
const GOLDEN_EXPORT = resolve(__dirname, '__fixtures__/wait_nodes_flow.export.json');
// sha256 of the round-tripped export of every example flow holding one of
// the four node types, captured before the rename.
const EXAMPLE_EXPORT_SHA256: Record<string, string> = {
  '15f19f7f.json': 'a5d8ccca1a3ef08090ca7e0064a3389be12d9ee2f749dfc36d4549d43ef6f0fe',
  '4ed3b340.json': '2c0a65109a00b05a97fc0431542b0844552069ce525976485022c80ca0c02a44',
  'a49d80c3.json': '0d1a7fc82c0ee0ee9a1108b4cb274860f008880f15ae4473dacf91a550b737ae',
  'acagent_ask_demo.json': '8b4e1640a40ab82e3c9e176d9739cde0345d4b1157c10ab2eedc715c4de02060',
  'acagent_message_demo.json': '2f0a345ae855396c32f5615977ad9d234c829d874287f6f94c5a47a59aa75c33',
  'acagent_status_demo.json': '8723841ff498a625e351b53f9c651e43d630a05ea604f490b2fe415be35e5878',
  'acagent_tool_events_demo.json': '3655182fa51bd449ce9d157820508cf4debb034ee1ed5ed331e1e65905fbd821',
  'entity-life.json': '31f377164e2ddb6fc0b66b917feacbcf037e91eb776216cf9656a2c3231e01ec',
  'event-inbox-react-agent.json': '8cf418e7c528ab76a1d669f14d0aa538edb6faeaa1b4f5b6e07a0d0d1607d8a2',
  'tg-agent-main.json': '422706a099b915a9cb0c5603638a2e9f1222ecf0ac5a1bf56eb9a3e7a34ee063',
};

function roundTrip(raw: string): string {
  const flow = JSON.parse(raw) as VisualFlow;
  const { nodes, edges } = fromVisualFlow(flow);
  return exportFlowToJson(toVisualFlow(flow.id, flow.name, nodes, edges));
}

function renderCard(data: FlowNodeData): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  const props = { id: 'n1', data, selected: false, type: 'custom', zIndex: 0, isConnectable: true, xPos: 0, yPos: 0, dragging: false } as any;
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(ReactFlowProvider, null, createElement(BaseNode, props)))
  );
}

const title = (html: string) => /<span class="node-title">([^<]*)<\/span>/.exec(html)?.[1];
const badge = (html: string) => /<span class="node-type-badge">([^<]*)<\/span>/.exec(html)?.[1];
const fresh = (type: NodeType) => createNodeData(getNodeTemplate(type)!);

describe('Waits: names, section, badge', () => {
  it('names the four node types for what they do', () => {
    expect(getNodeTemplate('on_schedule')?.label).toBe('Wait Until');
    expect(getNodeTemplate('on_event')?.label).toBe('Wait for Event');
    expect(getNodeTemplate('wait_event')?.label).toBe('Wait for Event');
    expect(getNodeTemplate('emit_event')?.label).toBe('Emit Event');
  });

  it('puts them under Waits, not Events, and Waits after Events and time', () => {
    const waits = NODE_CATEGORIES.waits;
    expect(waits.label).toBe('Waits');
    expect(waits.nodes.map((n) => n.type)).toEqual(['wait_until', 'on_schedule', 'on_event', 'wait_event', 'emit_event']);
    expect(NODE_CATEGORIES.events.nodes.some((n) => ['on_schedule', 'on_event', 'wait_event', 'emit_event'].includes(n.type))).toBe(false);
    const sections = buildPaletteSections();
    const keys = sections.map((s) => s.key);
    expect(keys.indexOf('waits')).toBe(keys.indexOf('events') + 1);
    const section = sections.find((s) => s.key === 'waits')!;
    expect(section.label).toBe('Waits');
    // One Wait for Event in the palette: the step form is not offered on its own.
    expect(section.nodes.map((n) => `${n.type}|${n.label}`)).toEqual(['wait_until|Delay', 'on_schedule|Wait Until', 'on_event|Wait for Event', 'emit_event|Emit Event']);
    expect(sections.flatMap((s) => s.nodes).some((n) => n.type === 'wait_event')).toBe(false);
  });

  it('says each pauses this run and does not start the flow', () => {
    for (const type of ['on_schedule', 'on_event', 'wait_event'] as NodeType[]) {
      const d = getNodeTemplate(type)!.description;
      expect(d, type).toMatch(/^Pauses this run (at this step )?until /);
      expect(d, type).toContain('it does not start the flow (an automation does');
    }
    expect(getNodeTemplate('emit_event')!.description).toContain('it does not start a flow (an automation does)');
  });

  it('finds them by their earlier names in the palette search', () => {
    const hits = (q: string) => filterPaletteSections(buildPaletteSections(), q).flatMap((s) => s.nodes.map((n) => n.label));
    expect(hits('On Schedule')).toContain('Wait Until');
    expect(hits('On Event')).toContain('Wait for Event');
    expect(hits('Wait Event')).toContain('Wait for Event');
    expect(hits('wait for event').filter((l) => l === 'Wait for Event')).toHaveLength(1);
  });

  it('cards carry the Waits badge, colour and icon', () => {
    for (const type of ['on_schedule', 'on_event', 'wait_event', 'emit_event'] as NodeType[]) {
      expect(nodeSemanticCategory(type, 'On Event')).toBe('waits');
      expect(badge(renderCard(fresh(type))), type).toBe(nodeTypeBadge('waits'));
      expect(nodeColorSection(type)).toBe('waits');
    }
    expect(nodeTypeBadge('waits')).toBe('Waits');
    expect(nodeIconName('wait_event')).toBe(nodeIconName('on_event'));
  });
});

describe('saved nodes keep rendering, under the new names', () => {
  it('shows the current name for an earlier default label, the typed label otherwise', () => {
    expect(title(renderCard({ ...fresh('on_event'), label: 'On Event' }))).toBe('Wait for Event');
    expect(title(renderCard({ ...fresh('wait_event'), label: 'Wait Event' }))).toBe('Wait for Event');
    expect(title(renderCard({ ...fresh('on_schedule'), label: 'On Schedule', eventConfig: { schedule: '5m', recurrent: false } }))).toBe('Wait Until');
    expect(title(renderCard({ ...fresh('wait_event'), label: 'SLEEP UNTIL EVENT' }))).toBe('SLEEP UNTIL EVENT');
    expect(title(renderCard({ ...fresh('on_event'), label: 'On Telegram Message' }))).toBe('On Telegram Message');
    expect(nodeDisplayName({ nodeType: 'on_schedule', label: 'On Schedule' })).toBe('Wait Until');
    expect(nodeDisplayName({ nodeType: 'agent', label: 'On Event' })).toBe('On Event');
  });

  it('a recurrent Wait Until on an interval reads "Wait Until · every 15s"', () => {
    expect(title(renderCard(fresh('on_schedule')))).toBe('Wait Until · every 15s');
    expect(title(renderCard({ ...fresh('on_schedule'), label: 'On Schedule' }))).toBe('Wait Until · every 15s');
    const data = { nodeType: 'on_schedule', label: 'Wait Until' } as const;
    expect(nodeDisplayLabel({ ...data, eventConfig: { schedule: '2h', recurrent: true } })).toBe('Wait Until · every 2h');
    expect(nodeDisplayLabel({ ...data, eventConfig: { schedule: '2h' } })).toBe('Wait Until · every 2h');
    expect(nodeDisplayLabel({ ...data, eventConfig: { schedule: '2h', recurrent: false } })).toBe('Wait Until');
    expect(nodeDisplayLabel({ ...data, eventConfig: { schedule: '2026-11-01T08:00:00Z', recurrent: true } })).toBe('Wait Until');
    expect(nodeDisplayLabel({ ...data, eventConfig: { schedule: '2h', recurrent: true } }, { connectedInputs: new Set(['schedule']) })).toBe('Wait Until');
    expect(nodeDisplayLabel({ nodeType: 'on_schedule', label: 'Heartbeat', eventConfig: { schedule: '2h' } })).toBe('Heartbeat');
  });

  it('loads and exports a saved flow of each type byte for byte as before', () => {
    expect(roundTrip(readFileSync(FIXTURE, 'utf8'))).toBe(readFileSync(GOLDEN_EXPORT, 'utf8'));
    const types = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as VisualFlow).nodes.map((n) => n.type);
    for (const type of ['on_schedule', 'on_event', 'wait_event', 'emit_event']) expect(types).toContain(type);
  });

  it('every example flow with a wait node exports exactly as before', () => {
    for (const [file, sha] of Object.entries(EXAMPLE_EXPORT_SHA256)) {
      const raw = readFileSync(resolve(__dirname, '../../examples/flows', file), 'utf8');
      expect(createHash('sha256').update(roundTrip(raw)).digest('hex'), file).toBe(sha);
    }
  });

  it('the authoring assistant cannot add the step form on its own; Wait for Event it can', () => {
    const base = { flowName: 'x', flowInterfaces: [], nodes: [] as Node<FlowNodeData>[], edges: [] as Edge[] };
    const refused = applyFlowAuthoringCommands({ ...base, commands: [{ action: 'add_node', id: 'w', nodeType: 'wait_event' }] });
    expect(refused.nodes).toEqual([]);
    expect(refused.errors.some((e) => e.includes('hidden or deprecated'))).toBe(true);
    const added = applyFlowAuthoringCommands({ ...base, commands: [{ action: 'add_node', id: 'w', nodeType: 'on_event' }] });
    expect(added.nodes.map((n) => n.data.label)).toEqual(['Wait for Event']);
  });
});

describe('Wait for Event > Advanced: its two forms', () => {
  it('switches the node type and pins, keeps a typed label, drops settings of the other form', () => {
    const listener = { ...fresh('on_event'), label: 'On Event', pinDefaults: { scope: 'run' } };
    const step = switchWaitForEventForm(listener, 'wait_event');
    expect(step.nodeType).toBe('wait_event');
    expect(step.label).toBe('Wait for Event');
    expect(step.inputs?.map((p) => p.id)).toEqual(getNodeTemplate('wait_event')!.inputs.map((p) => p.id));
    expect(step.eventConfig).toBeUndefined();
    expect(step.pinDefaults).toBeUndefined();
    const back = switchWaitForEventForm({ ...fresh('wait_event'), label: 'Park', pinDefaults: { event_key: 'k' } }, 'on_event');
    expect(back).toMatchObject({ nodeType: 'on_event', label: 'Park', eventConfig: { name: 'my_event', scope: 'session' } });
    expect(back.pinDefaults).toBeUndefined();
  });

  it('counts the wires a switch drops and says so', () => {
    const edges = [
      { id: 'a', source: 'x', target: 'n1', sourceHandle: 'exec-out', targetHandle: 'exec-in' },
      { id: 'b', source: 'n1', target: 'y', sourceHandle: 'exec-out', targetHandle: 'exec-in' },
      { id: 'c', source: 'n1', target: 'z', sourceHandle: 'event_data', targetHandle: 'value' },
    ] as Edge[];
    expect(wiresDroppedBySwitch('n1', 'on_event', edges)).toBe(2);
    const html = renderToStaticMarkup(
      createElement(WaitForEventAdvanced, { nodeId: 'n1', data: fresh('wait_event'), edges, updateNodeData: () => {} })
    );
    expect(html).toContain('<summary>Advanced</summary>');
    expect(html).toContain('For a named event, on its own branch');
    expect(html).toContain('At this step, for an event key');
    expect(html).toMatch(/value="wait_event" checked=""|checked="" value="wait_event"/);
    expect(html).toContain('Switching removes 2 wires');
  });
});
