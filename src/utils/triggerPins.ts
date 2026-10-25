/**
 * A triggered flow is the person's own deterministic workflow (operator
 * ruling 2026-10-25): Flow never pre-builds an Agent or centres the flow on a
 * prompt. What arrives is on On Flow Start as TYPED, NAMED outputs, one set
 * per kind of trigger, beside `event` (the raw CloudEvents envelope):
 *
 *   email    -> messages [{id, from, to, subject, date, body_text, attachments}], mailbox (address)
 *   feed     -> items [{id, title, link, published, summary, author}], feed {title, url}
 *   webhook  -> calls [{id, received_at, headers, body}]
 *   schedule -> scheduled_at, occurrence
 *   by hand  -> nothing extra
 *
 * The runtime fills them from the occurrence's `input_data[<name>]` (the same
 * mechanism as `event`). On Flow End of an automation flow takes `response`
 * (what the person sees), `notify` ({title, body}: an attention alert) and
 * `success`. Pure: nodes in, nodes out.
 */
import type { Edge, Node } from 'reactflow';
import type { AutomationTriggerDefaults, FlowNodeData, Pin, VisualFlow } from '../types/flow';
import { TRIGGER_EVENT_PIN_ID, triggerEventPin } from './triggerEvent';
import { emailsPin } from './emailType';

export type TriggerPinKind = 'email' | 'feed' | 'webhook' | 'schedule' | 'manual';

export function triggerPinKind(trigger: Pick<AutomationTriggerDefaults, 'source_id'> & { connection_id?: string }): TriggerPinKind {
  const id = trigger.source_id;
  if (id.startsWith('email')) return 'email';
  if (id.startsWith('feed')) return 'feed';
  if (id.startsWith('webhook')) return 'webhook';
  if (id === 'schedule') return 'schedule';
  return 'manual';
}

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    link: { type: 'string', format: 'uri' },
    published: { type: 'string', format: 'date-time' },
    summary: { type: 'string' },
    author: { type: 'string' },
  },
};

const CALL_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    received_at: { type: 'string', format: 'date-time' },
    headers: { type: 'object', description: 'The request headers, in lower case (sign-in and cookie headers removed).' },
    body: { description: 'What was sent (JSON when the call sent JSON, else text).' },
  },
};

const PINS: Record<TriggerPinKind, Pin[]> = {
  email: [
    // An Email list (utils/emailType.ts): ForEach gives each Email, the Mail nodes take them as they are.
    emailsPin('messages', 'messages', 'The new mail of this run (Email list): from, to, subject, date, body_text, attachments…'),
    { id: 'mailbox', label: 'mailbox', type: 'string', description: 'The address of the mailbox it arrived in (its id when it has no address).' },
  ],
  feed: [
    { id: 'items', label: 'items', type: 'array', description: 'The new items of this run: title, link, published, summary, author.', schema: { type: 'array', items: ITEM_SCHEMA } },
    { id: 'feed', label: 'feed', type: 'object', description: 'The feed they came from: title and address.', schema: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string', format: 'uri' } } } },
  ],
  webhook: [
    { id: 'calls', label: 'calls', type: 'array', description: 'The calls received for this run: when, headers and body.', schema: { type: 'array', items: CALL_SCHEMA } },
  ],
  schedule: [
    { id: 'scheduled_at', label: 'scheduled_at', type: 'string', description: 'When this run was due (an ISO date and time).' },
    { id: 'occurrence', label: 'occurrence', type: 'number', description: 'The run number: 1 for the first run, 2 for the second, …' },
  ],
  manual: [],
};

const EVENT_PIN: Pin = { ...triggerEventPin(), description: 'Everything about what started the run, as one object (the raw event).' };

/** The On Flow Start outputs a trigger fills (its named pins, then `event`). */
export function triggerStartPins(kind: TriggerPinKind): Pin[] {
  return [...PINS[kind], EVENT_PIN];
}

/** Every pin name some trigger fills (never asked as an automation input). */
export const TRIGGER_FILLED_PIN_IDS: ReadonlySet<string> = new Set([TRIGGER_EVENT_PIN_ID, ...Object.values(PINS).flat().map((p) => p.id)]);

/** On Flow End of an automation flow: what the person sees, the alert, success. */
export const AUTOMATION_END_PINS: Pin[] = [
  { id: 'response', label: 'response', type: 'string', description: 'What the person sees as the run’s result.' },
  {
    id: 'notify',
    label: 'notify',
    type: 'object',
    description: 'Optional {title, body} (or true): raises an alert on the watch, the tray and the Assistant.',
    schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } } },
  },
  { id: 'success', label: 'success', type: 'boolean', description: 'False marks the run failed: it is retried, then an alert says so.' },
];

function addPins(list: Pin[], pins: Pin[]): Pin[] {
  const missing = pins.filter((p) => !list.some((x) => x.id === p.id));
  return missing.length ? [...list, ...missing] : list;
}

/**
 * On Flow Start gets the trigger's pins (and `event`), On Flow End the
 * automation's (`response`, `notify`, `success`); pins already there are
 * kept, nothing is wired. Returns the same array when nothing changed.
 */
export function withTriggerPins(nodes: Node<FlowNodeData>[], kind: TriggerPinKind): Node<FlowNodeData>[] {
  let changed = false;
  const next = nodes.map((n) => {
    if (n.data?.nodeType === 'on_flow_start') {
      const outputs = addPins(n.data.outputs, triggerStartPins(kind));
      if (outputs === n.data.outputs) return n;
      changed = true;
      return { ...n, data: { ...n.data, outputs } };
    }
    if (n.data?.nodeType === 'on_flow_end') {
      const inputs = addPins(n.data.inputs, AUTOMATION_END_PINS);
      if (inputs === n.data.inputs) return n;
      changed = true;
      return { ...n, data: { ...n.data, inputs } };
    }
    return n;
  });
  return changed ? next : nodes;
}

/** Does the flow already carry the trigger's pins (and the automation's end pins)? */
export function hasTriggerPins(flow: Pick<VisualFlow, 'nodes'>, kind: TriggerPinKind): boolean {
  return withTriggerPins(flow.nodes as unknown as Node<FlowNodeData>[], kind) === (flow.nodes as unknown as Node<FlowNodeData>[]);
}

/** The note a new automation flow opens with (dismissible). */
export const AUTOMATION_CANVAS_NOTE =
  'What arrives is on On Flow Start; put what the person should see on On Flow End’s response (and notify for an alert).';

/**
 * Saving a triggered flow whose result is empty: a warning in words (the save
 * still happens), or null. `response` counts as set when a wire reaches it.
 */
export function automationSaveWarning(flow: Pick<VisualFlow, 'nodes' | 'edges' | 'automation_defaults'>): string | null {
  if (!flow.automation_defaults) return null;
  const ends = flow.nodes.filter((n) => n.data?.nodeType === 'on_flow_end');
  if (!ends.length) return 'Saved. This automation has no On Flow End yet: add one and connect its response, so each run shows what it did.';
  const wired = (flow.edges as Edge[]).some((e) => ends.some((n) => n.id === e.target) && e.targetHandle === 'response');
  return wired ? null : 'Saved. Nothing is connected to On Flow End’s response yet, so each run will show an empty result.';
}
