// Operator 2026-10-25: "the list of triggers is absolutely not actionable by a
// human"; creating an automation must start from "+". The picker's choices
// map to automation_defaults.trigger, and a New flow with a trigger opens with
// the trigger event wired in. Operator ruling 2026-10-25: a schedule is a
// property of an automation, set in Observer or the Assistant, never in Flow;
// an older save's schedule is still read and said in words.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  automationFromChoice,
  choiceFromTrigger,
  flowNature,
  legacyScheduleSentence,
  ruleFromScheduleConfig,
  scheduleSentenceWithZone,
  triggerFromChoice,
  triggerSentence,
  type ScheduleRule,
} from './automationChoice';
import { arrivalOptions, choiceFromPicker, emptyPicker, pickerFromTrigger, type PickerData } from './automationPicker';
import { fetchHistoryDefault, fetchMailboxes, parseMailboxes } from './automationGateway';
import { GatewayHttpError } from './gatewayClient';
import { parseTriggerSourcesResponse, type TriggerSourceItem } from './triggerSources';
import { parseTriggerConnectionsResponse } from './triggerConnections';
import { CONNECTIONS_RESPONSE, LIVE_SOURCES_RESPONSE, ME_EMAIL_RESPONSE } from './triggerSources.fixtures';
import { NewFlowDialog, automationStart, newFlowValues } from '../components/NewFlowDialog';
import { TriggerPicker, pickerSupport } from '../components/automation/TriggerPicker';
import { useFlowStore } from '../hooks/useFlow';
import { isTriggerableFlow } from './triggerEvent';

const SOURCES = parseTriggerSourcesResponse(LIVE_SOURCES_RESPONSE);
const MAILBOXES = parseMailboxes(ME_EMAIL_RESPONSE);
const CONNECTIONS = parseTriggerConnectionsResponse(CONNECTIONS_RESPONSE);
const DATA: PickerData = { sources: SOURCES, mailboxes: MAILBOXES, connections: CONNECTIONS };

describe('a schedule from an earlier save is said in words, never offered', () => {
  const cases: Array<[Record<string, unknown>, ScheduleRule, string]> = [
    [{ kind: 'daily', at: '08:00', time_zone: 'Europe/Paris' }, { repeat: 'daily', at: '08:00' }, 'Every day at 08:00 (Paris)'],
    [{ kind: 'weekly', days: ['mon', 'thu'], at: '07:30', time_zone: 'Europe/Paris' }, { repeat: 'weekly', days: ['mon', 'thu'], at: '07:30' }, 'Every Monday and Thursday at 07:30 (Paris)'],
    [{ kind: 'monthly', day: 'last', at: '18:00', time_zone: 'Europe/Paris' }, { repeat: 'monthly', day: 'last', at: '18:00' }, 'Every month on the last day at 18:00 (Paris)'],
    [{ kind: 'every', every: '15m' }, { repeat: 'every', amount: 15, unit: 'm' }, 'Every 15 minutes'],
    [{ kind: 'once', at: '2026-11-02T09:00', time_zone: 'Europe/Paris' }, { repeat: 'once', date: '2026-11-02', at: '09:00' }, 'Once, on 2026-11-02 at 09:00 (Paris)'],
  ];
  it.each(cases)('%j', (config, rule, sentence) => {
    const trigger = { source_id: 'schedule', source_version: 2, config: config as never };
    expect(ruleFromScheduleConfig(trigger.config)?.rule).toEqual(rule);
    expect(scheduleSentenceWithZone(rule, 'Europe/Paris')).toBe(sentence);
    expect(triggerSentence(trigger)).toBe(sentence);
    // The picker does not offer it: nothing is picked, the dialog keeps the saved trigger.
    expect(choiceFromTrigger(trigger, SOURCES)).toBeNull();
    expect(pickerFromTrigger(trigger, DATA)).toEqual(emptyPicker(null));
  });

  it('an old flow’s schedule@1 is said in words and kept the same way', () => {
    const old = { source_id: 'schedule', source_version: 1, config: { every: '5m' } };
    expect(legacyScheduleSentence(old.config)).toBe('Every 5 minutes');
    expect(triggerSentence(old)).toBe('Every 5 minutes');
    expect(pickerFromTrigger(old, DATA)).toEqual(emptyPicker(null));
  });

  it('no schedule choice anywhere in the picker’s words or kinds', async () => {
    const { readFileSync } = await import('node:fs');
    const picker = readFileSync(new URL('../components/automation/TriggerPicker.tsx', import.meta.url), 'utf8');
    expect(picker).not.toContain("kind: 'schedule'");
    expect(picker).not.toMatch(/ScheduleEditor|ZonePicker|TimeOfDay/);
    const choice = readFileSync(new URL('./automationChoice.ts', import.meta.url), 'utf8');
    expect(choice).toMatch(/export type StartKind = 'chat' \| 'arrives' \| 'manual';/);
  });
});

describe('mail, feeds, webhooks and by hand', () => {
  it('lists my mailboxes by address (primary first, a send-only one disabled) and my connections by name', () => {
    const options = arrivalOptions(DATA);
    expect(options.map((o) => [o.text, o.disabled || false])).toEqual([
      ['When mail arrives in test@abstractframework.ai', false],
      ['When mail arrives in work@example.org', false],
      ['When mail arrives in send-only@example.org', true],
      ['When Release notes feed has a new item', false],
      ['When Old blog has a new item', false],
      ['When CI hook is called', false],
    ]);
    expect(options.find((o) => o.key === 'conn:conn_feed2')?.hint).toBe('paused');
    // No source id, version or "self" in what the person reads.
    expect(options.map((o) => o.text).join(' ')).not.toMatch(/email\.received|feed\.item|webhook\.received|\bv1\b|self/);
  });

  it('a mailbox is saved as config.account, never as connection_id', () => {
    const picked = choiceFromPicker({ ...emptyPicker('arrives'), arrival: 'mail:work' }, DATA);
    expect(picked).toEqual({ choice: { kind: 'mail', account: 'work' } });
    const trigger = triggerFromChoice({ kind: 'mail', account: 'work' }, SOURCES);
    expect(trigger).toEqual({ source_id: 'email.received', source_version: 1, config: { account: 'work' } });
    expect(trigger.connection_id).toBeUndefined();
    expect(triggerSentence(trigger, { mailboxes: MAILBOXES })).toBe('When mail arrives in work@example.org');
    expect(choiceFromTrigger({ ...trigger, config: { account: 'self' } }, SOURCES)).toEqual({ kind: 'mail', account: 'default' });
  });

  it('a feed or webhook connection is saved as trigger.connection_id', () => {
    const picked = choiceFromPicker({ ...emptyPicker('arrives'), arrival: 'conn:conn_hook1' }, DATA);
    expect('choice' in picked && triggerFromChoice(picked.choice as never, SOURCES)).toEqual({
      source_id: 'webhook.received',
      source_version: 1,
      config: {},
      connection_id: 'conn_hook1',
    });
    expect(triggerSentence({ source_id: 'webhook.received', source_version: 1, config: {}, connection_id: 'conn_hook1' }, { connections: CONNECTIONS })).toBe(
      'When CI hook is called'
    );
    expect(choiceFromPicker({ ...emptyPicker('arrives'), arrival: 'conn:gone' }, DATA)).toEqual({
      problem: 'That connection is not one of yours on this gateway: choose another.',
    });
  });

  it('by hand is the manual source; the round trip holds for each choice', () => {
    expect(triggerFromChoice({ kind: 'manual' }, SOURCES)).toEqual({ source_id: 'manual', source_version: 1, config: {} });
    for (const state of [
      emptyPicker('manual'),
      { ...emptyPicker('arrives'), arrival: 'mail:default' },
      { ...emptyPicker('arrives'), arrival: 'conn:conn_feed1' },
    ]) {
      const picked = choiceFromPicker(state, DATA);
      if (!('choice' in picked) || picked.choice.kind === 'chat') throw new Error('expected a trigger choice');
      const back = pickerFromTrigger(triggerFromChoice(picked.choice, SOURCES), DATA);
      expect(back).toEqual(state);
    }
  });

  it('the flow’s nature reads as one product: "Automation · …" or "Chat"', () => {
    const automation = automationFromChoice({ kind: 'mail', account: 'default' }, SOURCES);
    expect(flowNature({ automation_defaults: automation }, true, { mailboxes: MAILBOXES }).text).toBe('Automation · When mail arrives in test@abstractframework.ai');
    expect(flowNature({}, true).text).toBe('Chat');
    expect(flowNature({}, false).kind).toBe('none');
  });
});

describe('gateway facts are read, never guessed', () => {
  it('mailboxes and the central history budget', async () => {
    await expect(fetchMailboxes(async () => ME_EMAIL_RESPONSE)).resolves.toMatchObject({ status: 'ok' });
    await expect(fetchMailboxes(async () => ({}))).rejects.toThrow(/no `accounts` list/);
    await expect(
      fetchMailboxes(async () => {
        throw new GatewayHttpError('nf', 404, null);
      })
    ).resolves.toEqual({ status: 'unavailable', reason: 'Mailboxes are not available on this gateway.' });
    const history = vi.fn(async () => ({ growing_max_tokens: 50000 }));
    await expect(fetchHistoryDefault(history)).resolves.toBe(50000);
    expect(history).toHaveBeenCalledTimes(1);
    await expect(fetchHistoryDefault(async () => ({}))).rejects.toThrow(/growing_max_tokens/);
  });
});

describe('New flow: "What starts it?"', () => {
  const support = pickerSupport({
    sources: { state: 'ok', value: { status: 'ok', endpoint: 'x', items: SOURCES as TriggerSourceItem[] } },
    mailboxes: { state: 'ok', value: { status: 'ok', mailboxes: MAILBOXES } },
    connections: { state: 'ok', value: { status: 'ok', connections: CONNECTIONS } },
  });

  it('asks first, with three human choices (no schedule: set in Observer or the Assistant); chat is the default', () => {
    const html = renderToStaticMarkup(createElement(NewFlowDialog, { unsavedChanges: false, onCreate: () => {}, onCancel: () => {} }));
    expect(html).toContain('What starts it?');
    for (const text of ['A person, in a chat', 'When something arrives', 'By hand (Run now only)']) expect(html).toContain(text);
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html).not.toMatch(/>On a schedule</);
    expect(html).toContain('On a schedule? Schedules are set in Observer or the Assistant.');
    expect(html).toMatch(/aria-checked="true"[^>]*>.*A person, in a chat/);
    expect(html).toContain('A flow for chat.');
  });

  it('the picker shows the arrivals by name; no schedule editor, no time zone', () => {
    const arrives = renderToStaticMarkup(
      createElement(TriggerPicker, { value: { ...emptyPicker('arrives'), arrival: 'mail:default' }, onChange: () => {}, data: support.data, includeChat: false, gatewayUrl: 'http://gw/' })
    );
    expect(arrives).not.toMatch(/Time zone|aria-label="Hour"|How often/);
    expect(arrives).toContain('When mail arrives in test@abstractframework.ai');
    expect(arrives).toContain('href="http://gw/console#triggers"');
    expect(arrives).toContain('Add a feed or webhook…');
    for (const title of ['Your mailboxes', 'Your feeds', 'Your webhooks']) expect(arrives).toContain(title);
    expect(arrives).toContain('href="http://gw/console#users"');
    expect(arrives).toContain('Runs every time a new message lands in that mailbox; the flow receives the messages.');
    expect(arrives).not.toContain('A person, in a chat');
  });

  it('a trigger choice creates the automation defaults; chat creates none', () => {
    const start = automationStart({ ...emptyPicker('arrives'), arrival: 'mail:work' }, support);
    expect(start.automation?.trigger).toEqual({ source_id: 'email.received', source_version: 1, config: { account: 'work' } });
    expect(newFlowValues('Mail triage', '', ['abstractcode.agent.v1'], start)).toMatchObject({ automation: start.automation });
    expect(newFlowValues('Chatty', '', [], automationStart(emptyPicker('chat'), support))).toEqual({ name: 'Chatty', description: '', interfaces: [] });
    expect(newFlowValues('X', '', [], automationStart(emptyPicker('arrives'), support))).toEqual({ error: 'Choose what it listens to.' });
  });

  it('Create with a trigger: ONLY On Flow Start (what arrives, typed) and On Flow End (response, success, note: no notify pin, ADR-0041), nothing between', () => {
    const automation = automationFromChoice({ kind: 'mail', account: 'default' }, SOURCES);
    useFlowStore.getState().createFlow({ name: 'Mail judge', description: '', interfaces: [], automation });
    const st = useFlowStore.getState();
    const flow = st.getFlow();
    expect(flow.nodes.map((n) => n.data.nodeType).sort()).toEqual(['on_flow_end', 'on_flow_start']);
    expect(flow.edges).toEqual([]);
    expect(isTriggerableFlow(flow)).toBe(true);
    const start = flow.nodes.find((n) => n.data.nodeType === 'on_flow_start')!;
    const end = flow.nodes.find((n) => n.data.nodeType === 'on_flow_end')!;
    expect(start.data.outputs.map((p) => `${p.id}:${p.type}`)).toEqual(['exec-out:execution', 'messages:emails', 'mailbox:string', 'event:object']);
    expect(start.data.outputs.every((p) => p.type === 'execution' || Boolean(p.description))).toBe(true);
    expect(end.data.inputs.map((p) => p.id)).toEqual(['exec-in', 'response', 'success', 'note']);
    expect(flow.nodes.some((n) => n.data.nodeType === 'agent' || n.data.label === 'Trigger event')).toBe(false);
    expect(flow.automation_defaults).toEqual(automation);
    expect(st.canvasNote).toBe('What arrives is on On Flow Start. On Flow End records the outcome: response, success and a note; it reaches nobody. Add Notify me to reach yourself.');
    // Chat: no trigger node, no defaults.
    useFlowStore.getState().createFlow({ name: 'Chat', description: '', interfaces: ['abstractcode.agent.v1'] });
    expect(useFlowStore.getState().getFlow().automation_defaults).toBeUndefined();
    expect(isTriggerableFlow(useFlowStore.getState().getFlow())).toBe(false);
  });
});

describe('UX review #25, #26, #6, #27', () => {
  it('a weekly schedule with no day (an older save) never reads "Every at"', async () => {
    const { scheduleSentence } = await import('./automationChoice');
    expect(scheduleSentence({ repeat: 'weekly', days: [], at: '08:00' })).toBe('Every week: pick at least one day');
  });

  it('a broken or paused feed is listed with its state, in its group', async () => {
    const { parseTriggerConnectionsResponse: parse } = await import('./triggerConnections');
    const conns = parse({ connections: [{ ...CONNECTIONS_RESPONSE.connections[0], last_error: { code: 'http_404', cause: 'The feed answered HTTP 404.', fix: 'Check the feed address.' } }] });
    const options = arrivalOptions({ ...DATA, connections: conns });
    const feed = options.find((o) => o.key === 'conn:conn_feed1')!;
    expect(feed.group).toBe('feeds');
    expect(feed.warn).toBe(true);
    expect(feed.hint).toBe('not working: The feed answered HTTP 404. Check the feed address.');
  });

  it('copy: never "occurrence"; 50,000 tokens', async () => {
    const { choiceHelp, formatTokens } = await import('./automationChoice');
    expect(choiceHelp({ kind: 'manual' })).toBe('Runs only when someone presses Run now in Observer or the Assistant.');
    expect(formatTokens(50000)).toBe('50,000');
    const { readFileSync } = await import('node:fs');
    for (const f of ['./automationChoice.ts', '../components/automation/TriggerPicker.tsx', '../components/AutomationDefaultsModal.tsx']) {
      const text = readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
      expect(text, f).not.toMatch(/occurrence/i);
    }
  });

  it('library rows tell same-named flows apart by size, never by id', async () => {
    const { graphSize } = await import('./flowLibraryRows');
    expect(graphSize({ nodes: [1, 2, 3], edges: [1] })).toBe('3 nodes · 1 edge');
    const { readFileSync } = await import('node:fs');
    const list = readFileSync(new URL('../components/FlowLibraryList.tsx', import.meta.url), 'utf8');
    expect(list).not.toMatch(/flow\.id\.slice|this one is \$\{flow\.id\}/);
    const modal = readFileSync(new URL('../components/FlowLibraryModal.tsx', import.meta.url), 'utf8');
    expect(modal).not.toContain('flow-library-preview-id');
  });
});
