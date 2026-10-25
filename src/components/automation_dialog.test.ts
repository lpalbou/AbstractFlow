// Operator 2026-10-25, the Automation dialog's verbatim defects:
// (1) a mailbox is not a trigger connection: email is picked from my mailboxes
//     and saved as trigger.config.account;
// (2) never ask the person to "Add trigger event": Save adds and wires it;
// (3) a settings schema with string arrays / a nested `filter` renders as
//     fields ("Only mail that…"), unknown keywords degrade per property.
import { describe, expect, it } from 'vitest';
import { automationDraft, issueText } from './AutomationDefaultsModal';
import { configFormFields, configFromFormValues, formValuesFromConfig } from '../utils/triggerBindings';
import { triggerSettingsCopy } from '../utils/triggerCopy';
import { emptyPicker, type PickerData, type PickerState } from '../utils/automationPicker';
import { parseMailboxes } from '../utils/automationGateway';
import { parseTriggerSourcesResponse, type AvailableTriggerSource } from '../utils/triggerSources';
import { parseTriggerConnectionsResponse } from '../utils/triggerConnections';
import { CONNECTIONS_RESPONSE, LIVE_SOURCES_RESPONSE, ME_EMAIL_RESPONSE } from '../utils/triggerSources.fixtures';
import { isTriggerableFlow, withTriggerEvent } from '../utils/triggerEvent';
import type { VisualFlow } from '../types/flow';

const SOURCES = parseTriggerSourcesResponse(LIVE_SOURCES_RESPONSE);
const source = (id: string, version = 1) => SOURCES.find((s): s is AvailableTriggerSource => s.available && s.id === id && s.version === version)!;
const DATA: PickerData = {
  sources: SOURCES,
  mailboxes: parseMailboxes(ME_EMAIL_RESPONSE),
  connections: parseTriggerConnectionsResponse(CONNECTIONS_RESPONSE),
  timeZone: 'Europe/Paris',
};
const EMAIL = source('email.received');
const EMAIL_OPTIONS = { labels: triggerSettingsCopy('email.received').labels, omit: triggerSettingsCopy('email.received').omit };

function flow(withEvent: boolean): VisualFlow {
  const start = {
    id: 'node-1',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { nodeType: 'on_flow_start', label: 'On Flow Start', inputs: [], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'prompt', label: 'prompt', type: 'string' }] },
  };
  const base = { id: 'f1', name: 'Mail triage', nodes: [start], edges: [] } as unknown as VisualFlow;
  if (!withEvent) return base;
  const next = withTriggerEvent(base.nodes as never, [], { breakNodeId: 'node-2', edgeId: 'e1' });
  return { ...base, nodes: next.nodes as never, edges: next.edges as never };
}

function draft(picker: PickerState, extra: Partial<Parameters<typeof automationDraft>[0]> = {}) {
  return automationDraft({
    flow: flow(false),
    existing: null,
    picker,
    keepsSaved: false,
    data: DATA,
    formSource: null,
    formOptions: { labels: {}, omit: [] },
    values: {},
    mode: 'independent',
    title: '',
    inputData: {},
    ...extra,
  });
}

describe('the email settings form (defect 3)', () => {
  it('renders the filter as "Only mail that…" with string lists; the mailbox is the picker’s', () => {
    const fields = configFormFields(EMAIL.config_schema, EMAIL_OPTIONS);
    expect(fields.map((f) => `${f.key}:${f.kind}`)).toEqual([
      'folder:string',
      'uses_model:boolean',
      'every:duration',
      'max_batch:integer',
      'start_at:datetime',
      'auto_submitted:enum',
      'filter:group',
    ]);
    const filter = fields.find((f) => f.key === 'filter')!;
    expect(filter.label).toBe('Only mail that…');
    expect(filter.children?.map((c) => `${c.label}:${c.kind}`)).toEqual([
      'Comes from:list',
      'Comes from the domain:list',
      'Is sent to:list',
      'Has in its subject:string',
      'Has an attachment:boolean',
    ]);
  });

  it('list and group values round-trip, and bad addresses are named in words', () => {
    const config = { folder: 'Receipts', filter: { from_in: ['a@example.org', 'b@example.org'], has_attachment: true } };
    const values = formValuesFromConfig(EMAIL.config_schema, config, EMAIL_OPTIONS);
    expect(values['filter.from_in']).toBe('a@example.org\nb@example.org');
    expect(configFromFormValues(EMAIL.config_schema, values, {}, EMAIL_OPTIONS)).toEqual({ config, issues: [] });
    const bad = configFromFormValues(EMAIL.config_schema, { 'filter.from_in': 'not-an-address' }, {}, EMAIL_OPTIONS);
    const fields = configFormFields(EMAIL.config_schema, EMAIL_OPTIONS);
    expect(bad.issues.map((i) => issueText(i, fields))).toEqual(['Comes from: "not-an-address" is not an email address']);
  });
});

describe('Save (defects 1 and 2)', () => {
  it('a mailbox is saved as config.account with the settings; the Trigger event node is added, never asked for', () => {
    const out = draft(
      { ...emptyPicker('arrives'), arrival: 'mail:work' },
      { formSource: EMAIL, formOptions: EMAIL_OPTIONS, values: { 'filter.subject_contains': 'invoice' } }
    );
    if (!('next' in out)) throw new Error(out.problems.join('; '));
    expect(out.next.trigger).toEqual({ source_id: 'email.received', source_version: 1, config: { account: 'work', filter: { subject_contains: 'invoice' } } });
    expect(out.graph && isTriggerableFlow({ nodes: out.graph.nodes })).toBe(true);
    expect(out.graph?.nodes.find((n) => n.data.label === 'Trigger event')?.id).toBe('node-2');
    // A flow that already receives the event keeps its graph.
    const again = draft({ ...emptyPicker('arrives'), arrival: 'mail:work' }, { flow: flow(true) });
    expect('next' in again && again.graph).toBeUndefined();
  });

  it('a feed connection validates against the live binding schema (connection_id folded in, as the gateway does)', () => {
    const out = draft({ ...emptyPicker('arrives'), arrival: 'conn:conn_feed1' });
    if (!('next' in out)) throw new Error(out.problems.join('; '));
    expect(out.next.trigger).toEqual({ source_id: 'feed.item', source_version: 1, config: {}, connection_id: 'conn_feed1' });
  });

  it('a weekly schedule validates against schedule@2 (string arrays, oneOf left to the gateway)', () => {
    const out = draft({ ...emptyPicker('schedule'), rule: { repeat: 'weekly', days: ['tue'], at: '06:45' } });
    if (!('next' in out)) throw new Error(out.problems.join('; '));
    expect(out.next.trigger).toEqual({ source_id: 'schedule', source_version: 2, config: { kind: 'weekly', days: ['tue'], at: '06:45', time_zone: 'Europe/Paris' } });
  });

  it('an old schedule@1 is kept as it is until the schedule is changed', () => {
    const old = { source_id: 'schedule', source_version: 1, config: { every: '2m' } };
    const out = draft({ ...emptyPicker('schedule'), legacy: { trigger: old, sentence: 'Every 2 minutes' } });
    expect('next' in out && out.next.trigger).toEqual(old);
  });

  it('nothing chosen is said in words; a flow with two starts says why the event cannot be added', () => {
    expect(draft(emptyPicker(null))).toEqual({ problems: ['Choose what starts it.'] });
    const two = flow(false);
    two.nodes = [...two.nodes, { ...two.nodes[0], id: 'node-9' }];
    const out = draft(emptyPicker('manual'), { flow: two });
    expect('problems' in out && out.problems[0]).toMatch(/several On Flow Start nodes/);
  });
});

describe('the library save of an OPEN flow adds the Trigger event to its canvas too', () => {
  it('putAutomationDefaults with addTriggerEvent patches the open document and keeps a clean editor clean', async () => {
    const { useFlowStore } = await import('../hooks/useFlow');
    const { putAutomationDefaults } = await import('../hooks/openFlowMetadata');
    const store = useFlowStore.getState();
    store.clearFlow();
    store.loadFlow({ ...flow(false), interfaces: [] } as VisualFlow);
    const next = { schema_version: 1 as const, trigger: { source_id: 'manual', source_version: 1, config: {} }, context: { mode: 'independent' as const }, input_data: {} };
    const out = await putAutomationDefaults({
      id: 'f1',
      next,
      hasUnsavedChanges: false,
      addTriggerEvent: true,
      put: async () => ({ ...flow(true), automation_defaults: next }) as VisualFlow,
    });
    expect(out.applied).toBe(true);
    expect(isTriggerableFlow(useFlowStore.getState().getFlow())).toBe(true);
    expect(useFlowStore.getState().getFlow().automation_defaults).toEqual(next);
    expect(out.baseline && isTriggerableFlow(out.baseline)).toBe(true);
  });
});
