/**
 * The trigger event a flow receives (root backlog 1039/1047).
 *
 * A run started by a trigger (an automation occurrence: a schedule tick, a
 * feed item, an email, a webhook call) carries the event as
 * `input_data.event`, a CloudEvents 1.0 envelope:
 *
 *   { id, type, source, subject, time, datacontenttype, data,
 *     bindingid, connectionid, correlationid, dedupekey, sequence, abstracttrust }
 *
 * `data` is the source's payload. Connection sources (feeds, webhooks) deliver a
 * BATCH: `data = {count, events: [<CloudEvents item>...], event_ids, first_seq,
 * last_seq, content_trust, connection_id}` — a feed item is
 * `events[i].data.{title, link, published, summary}`, a webhook call
 * `events[i].data.body` (or `body_text`). `email.received@1` delivers
 * `data = {count, messages: [{from, subject, date, ...}], ...}` (bodies ride
 * `input_data.emails`). Schedules add
 * `data.series {rule, occurrence, scheduled_at, next_at, coalesced}`.
 *
 * The flow's entry is On Flow Start (every host keys on it; its other inputs
 * still take the automation's `input_data`). A flow is TRIGGERABLE when On
 * Flow Start declares the `event` output (type object): the runtime maps
 * `input_data.event` onto it like any start input. "Add trigger event" adds
 * that output (with the envelope's JSON Schema, so path pickers know its
 * fields) and a Break Object named "Trigger event" wired to it, exposing
 * `type`, `subject`, `time`, `data`, `count` (`data.count`), `events`
 * (`data.events`) and `series` (`data.series`) as outputs.
 * Both are existing node types: nothing new to compile on the runtime.
 */
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, Pin, VisualFlow } from '../types/flow';

export const TRIGGER_EVENT_PIN_ID = 'event';
export const TRIGGER_EVENT_NODE_LABEL = 'Trigger event';
/** The Break Object paths "Add trigger event" selects (`data.series` shows as `series`). */
export const TRIGGER_EVENT_FIELDS = ['type', 'subject', 'time', 'data', 'data.count', 'data.events', 'data.series'] as const;

const SERIES_SCHEMA = {
  type: 'object',
  description: 'Schedules only: which run of the schedule this is (run #1, #2, …).',
  properties: {
    rule: { type: 'string', description: 'The schedule rule (e.g. every 1d at 08:00 Europe/Paris).' },
    occurrence: { type: 'integer', description: 'The run number: 1 for run #1, 2 for run #2, …' },
    scheduled_at: { type: 'string', format: 'date-time', description: 'When this run was due.' },
    next_at: { type: ['string', 'null'], format: 'date-time', description: 'When the next run is due, or null when the schedule ends.' },
    coalesced: { type: 'integer', description: 'Missed ticks folded into this run (0 when none).' },
  },
};

/** One item of a connection batch (`data.events[i]`): a CloudEvents event of its own. */
const BATCH_ITEM_SCHEMA = {
  type: 'object',
  description: 'One received item (CloudEvents): a feed item, a webhook call...',
  properties: {
    id: { type: 'string' },
    type: { type: 'string' },
    subject: { type: 'string', description: 'The item title / id, the webhook subject.' },
    time: { type: 'string', format: 'date-time' },
    data: {
      type: 'object',
      description: 'Feed item: title, link, published, summary. Webhook call: body (JSON) or body_text.',
      properties: {
        title: { type: 'string' },
        link: { type: 'string' },
        published: { type: 'string' },
        summary: { type: 'string' },
        body: { description: 'A webhook call\'s JSON body.' },
        body_text: { type: 'string' },
      },
    },
  },
};

/** The CloudEvents envelope a triggered run receives as `input_data.event`. */
export const TRIGGER_EVENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  title: 'Trigger event',
  description: 'The event that started this run (CloudEvents 1.0). Empty when the run was started by hand.',
  properties: {
    id: { type: 'string', description: 'Unique id of the event.' },
    type: { type: 'string', description: 'What happened, e.g. abstractframework.feed.item.' },
    source: { type: 'string', description: 'Where it came from (the trigger source / connection).' },
    subject: { type: 'string', description: 'What it is about (an email subject, a feed item title, a webhook subject).' },
    time: { type: 'string', format: 'date-time', description: 'When it happened.' },
    datacontenttype: { type: 'string' },
    data: {
      type: 'object',
      description: "The event's content. Connection sources (feeds, webhooks): a batch {count, events}; email: {count, messages}; schedules: the tick and its series.",
      properties: {
        count: { type: 'integer', description: 'How many items this run received (connection sources, email).' },
        events: { type: 'array', description: 'The received items, oldest first (connection sources).', items: BATCH_ITEM_SCHEMA },
        messages: { type: 'array', description: 'email.received: the messages (from, subject, date...); bodies ride input_data.emails.' },
        series: SERIES_SCHEMA,
      },
    },
    bindingid: { type: 'string' },
    connectionid: { type: 'string', description: 'The trigger connection that received it.' },
    correlationid: { type: 'string' },
    dedupekey: { type: 'string' },
    sequence: { type: 'integer', description: "Position in the connection's event stream." },
    abstracttrust: { type: 'string', description: 'How far the content can be trusted (e.g. external).' },
  },
};

export function triggerEventPin(): Pin {
  return {
    id: TRIGGER_EVENT_PIN_ID,
    label: 'event',
    type: 'object',
    description: 'The trigger event that started this run (CloudEvents: type, subject, time, data...). Empty when started by hand.',
    schema: TRIGGER_EVENT_SCHEMA,
  };
}

function nodeTypeOf(node: { type?: string; data?: { nodeType?: string } }): string {
  return String(node.data?.nodeType || node.type || '');
}

/** On Flow Start declares the `event` object output. */
export function startHasTriggerEvent(data: Pick<FlowNodeData, 'outputs'> | null | undefined): boolean {
  return Boolean(data?.outputs?.some((p) => p.id === TRIGGER_EVENT_PIN_ID && p.type === 'object'));
}

/** A flow that can receive a trigger event: its On Flow Start declares `event` (object). */
export function isTriggerableFlow(flow: Pick<VisualFlow, 'nodes'>): boolean {
  const start = (flow.nodes || []).find((n) => nodeTypeOf(n as never) === 'on_flow_start');
  return startHasTriggerEvent(start?.data as FlowNodeData | undefined);
}

/**
 * How much a trigger source depends on the event input:
 * - `required`: it reads from a trigger connection (feed, webhook): the
 *   event IS the work, so a flow without the `event` input cannot be bound;
 * - `recommended`: other event sources, email included (the content arrives
 *   as the event; an email's bodies also arrive as the `emails` input);
 * - `optional`: time and manual sources (the event only says which tick).
 */
export function triggerEventRequirement(source: { uses_trigger_connection: boolean; capabilities: { kind: string } }): 'required' | 'recommended' | 'optional' {
  if (source.uses_trigger_connection) return 'required';
  if (source.capabilities.kind === 'event') return 'recommended';
  return 'optional';
}

function schemaAt(schema: Record<string, unknown>, path: string): Record<string, unknown> {
  let node: Record<string, unknown> = schema;
  for (const part of path.split('.')) {
    const props = node.properties as Record<string, Record<string, unknown>> | undefined;
    const next = props?.[part];
    if (!next) throw new TriggerEventError(`The trigger event schema has no ${path}`);
    node = next;
  }
  return node;
}

export class TriggerEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TriggerEventError';
  }
}

/**
 * Add the trigger event to a graph: the `event` output on On Flow Start (kept
 * if already there) and a "Trigger event" Break Object wired to it (unless one
 * is already wired). Pure: returns the new nodes/edges and the Break Object id
 * (null when nothing was added).
 */
export function withTriggerEvent(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  ids: { breakNodeId: string; edgeId: string }
): { nodes: Node<FlowNodeData>[]; edges: Edge[]; breakNodeId: string | null } {
  const starts = nodes.filter((n) => n.data?.nodeType === 'on_flow_start');
  if (starts.length !== 1) {
    throw new TriggerEventError(starts.length ? 'The flow has several On Flow Start nodes: keep one, then add the trigger event.' : 'The flow has no On Flow Start node: add one first.');
  }
  const start = starts[0];
  const clash = start.data.outputs.find((p) => p.id === TRIGGER_EVENT_PIN_ID && p.type !== 'object');
  if (clash) {
    throw new TriggerEventError(`On Flow Start already has an input named "${TRIGGER_EVENT_PIN_ID}" of type ${clash.type}: rename it, then add the trigger event.`);
  }
  let nextNodes = nodes;
  if (!startHasTriggerEvent(start.data)) {
    nextNodes = nodes.map((n) => (n.id === start.id ? { ...n, data: { ...n.data, outputs: [...n.data.outputs, triggerEventPin()] } } : n));
  }
  const wired = edges.some((e) => e.source === start.id && e.sourceHandle === TRIGGER_EVENT_PIN_ID);
  if (wired) return { nodes: nextNodes, edges, breakNodeId: null };
  const outputs: Pin[] = TRIGGER_EVENT_FIELDS.map((path) => {
    const leaf = schemaAt(TRIGGER_EVENT_SCHEMA, path);
    return {
      id: path,
      label: path.split('.').slice(-1)[0],
      type: leaf.type === 'object' ? 'object' : leaf.type === 'array' ? 'array' : leaf.type === 'integer' ? 'number' : 'string',
      ...(typeof leaf.description === 'string' ? { description: leaf.description } : {}),
      schema: leaf,
    } as Pin;
  });
  const breakNode: Node<FlowNodeData> = {
    id: ids.breakNodeId,
    type: 'custom',
    position: { x: start.position.x + 320, y: start.position.y + 160 },
    data: {
      nodeType: 'break_object',
      label: TRIGGER_EVENT_NODE_LABEL,
      icon: '&#x1F9E9;',
      headerColor: '#3498DB',
      inputs: [{ id: 'object', label: 'object', type: 'object', description: 'Input object to decompose into selected output fields.' }],
      outputs,
      breakConfig: { selectedPaths: [...TRIGGER_EVENT_FIELDS] },
    } as FlowNodeData,
  };
  const edge: Edge = { id: ids.edgeId, source: start.id, sourceHandle: TRIGGER_EVENT_PIN_ID, target: ids.breakNodeId, targetHandle: 'object' };
  return { nodes: [...nextNodes, breakNode], edges: [...edges, edge], breakNodeId: ids.breakNodeId };
}
