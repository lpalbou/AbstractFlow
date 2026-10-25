// Operator 2026-10-25: "the list of triggers is absolutely not actionable by a
// human"; creating an automation must start from "+". The picker's choices
// map to automation_defaults.trigger (schedule@2 only for new schedules), and
// a New flow with a trigger opens with the trigger event wired in.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  automationFromChoice,
  choiceFromTrigger,
  flowNature,
  legacyScheduleSentence,
  ruleFromScheduleConfig,
  scheduleConfig,
  scheduleSentenceWithZone,
  triggerFromChoice,
  triggerSentence,
  type ScheduleRule,
} from './automationChoice';
import { arrivalOptions, choiceFromPicker, emptyPicker, pickerFromTrigger, type PickerData } from './automationPicker';
import { fetchAccountTimeZone, fetchHistoryDefault, fetchMailboxes, parseMailboxes } from './automationGateway';
import { GatewayHttpError } from './gatewayClient';
import { parseTriggerSourcesResponse, type TriggerSourceItem } from './triggerSources';
import { parseTriggerConnectionsResponse } from './triggerConnections';
import { CONNECTIONS_RESPONSE, LIVE_SOURCES_RESPONSE, ME_EMAIL_RESPONSE, TRIGGER_SOURCES_RESPONSE } from './triggerSources.fixtures';
import { NewFlowDialog, automationStart, newFlowValues } from '../components/NewFlowDialog';
import { TriggerPicker, pickerSupport } from '../components/automation/TriggerPicker';
import { useFlowStore } from '../hooks/useFlow';
import { isTriggerableFlow } from './triggerEvent';

const SOURCES = parseTriggerSourcesResponse(LIVE_SOURCES_RESPONSE);
const MAILBOXES = parseMailboxes(ME_EMAIL_RESPONSE);
const CONNECTIONS = parseTriggerConnectionsResponse(CONNECTIONS_RESPONSE);
const DATA: PickerData = { sources: SOURCES, mailboxes: MAILBOXES, connections: CONNECTIONS, timeZone: 'Europe/Paris' };

describe('schedule rules map to schedule@2 (never schedule@1 for a new automation)', () => {
  const cases: Array<[ScheduleRule, Record<string, unknown>, string]> = [
    [{ repeat: 'daily', at: '08:00' }, { kind: 'daily', at: '08:00', time_zone: 'Europe/Paris' }, 'Every day at 08:00 (Paris)'],
    [
      { repeat: 'weekly', days: ['thu', 'mon'], at: '07:30' },
      { kind: 'weekly', days: ['mon', 'thu'], at: '07:30', time_zone: 'Europe/Paris' },
      'Every Monday and Thursday at 07:30 (Paris)',
    ],
    [{ repeat: 'monthly', day: 'last', at: '18:00' }, { kind: 'monthly', day: 'last', at: '18:00', time_zone: 'Europe/Paris' }, 'Every month on the last day at 18:00 (Paris)'],
    [{ repeat: 'every', amount: 15, unit: 'm' }, { kind: 'every', every: '15m' }, 'Every 15 minutes'],
    [{ repeat: 'once', date: '2026-11-02', at: '09:00' }, { kind: 'once', at: '2026-11-02T09:00', time_zone: 'Europe/Paris' }, 'Once, on 2026-11-02 at 09:00 (Paris)'],
  ];
  it.each(cases)('%j', (rule, config, sentence) => {
    const trigger = triggerFromChoice({ kind: 'schedule', rule, timeZone: 'Europe/Paris' }, SOURCES);
    expect(trigger).toEqual({ source_id: 'schedule', source_version: 2, config });
    expect(ruleFromScheduleConfig(trigger.config)?.rule).toEqual(rule.repeat === 'weekly' ? { ...rule, days: ['mon', 'thu'] } : rule);
    expect(scheduleSentenceWithZone(rule, 'Europe/Paris')).toBe(sentence);
    expect(triggerSentence(trigger)).toBe(sentence);
  });

  it('refuses an incomplete rule in plain words, and a gateway without schedule@2 loudly', () => {
    expect(() => scheduleConfig({ repeat: 'weekly', days: [], at: '08:00' }, 'Europe/Paris')).toThrow('Choose at least one day of the week.');
    expect(() => scheduleConfig({ repeat: 'daily', at: '' }, 'UTC')).toThrow('Choose a time of day.');
    const v1Only = parseTriggerSourcesResponse(TRIGGER_SOURCES_RESPONSE);
    expect(() => triggerFromChoice({ kind: 'schedule', rule: { repeat: 'daily', at: '08:00' }, timeZone: 'UTC' }, v1Only)).toThrow(/cannot run calendar schedules/);
  });

  it('reads an old flow’s schedule@1 and keeps it until the schedule is edited', () => {
    const old = { source_id: 'schedule', source_version: 1, config: { every: '5m' } };
    expect(legacyScheduleSentence(old.config)).toBe('Every 5 minutes');
    expect(triggerSentence(old)).toBe('Every 5 minutes');
    const picker = pickerFromTrigger(old, DATA);
    expect(picker.start).toBe('schedule');
    expect(picker.legacy?.trigger).toEqual(old);
    expect(picker.rule).toEqual({ repeat: 'every', amount: 5, unit: 'm' });
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
    expect(choiceFromTrigger({ ...trigger, config: { account: 'self' } }, SOURCES, 'UTC')).toEqual({ kind: 'mail', account: 'default' });
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
      { ...emptyPicker('schedule'), rule: { repeat: 'weekly' as const, days: ['mon' as const, 'fri' as const], at: '09:15' } },
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
  it('mailboxes, the account time zone and the central history budget', async () => {
    await expect(fetchMailboxes(async () => ME_EMAIL_RESPONSE)).resolves.toMatchObject({ status: 'ok' });
    await expect(fetchMailboxes(async () => ({}))).rejects.toThrow(/no `accounts` list/);
    await expect(
      fetchMailboxes(async () => {
        throw new GatewayHttpError('nf', 404, null);
      })
    ).resolves.toEqual({ status: 'unavailable', reason: 'Mailboxes are not available on this gateway.' });
    const prefs = vi.fn(async () => ({ time_zone: { value: null, gateway_default: 'Europe/Paris', effective: 'Europe/Paris' } }));
    await expect(fetchAccountTimeZone(prefs)).resolves.toBe('Europe/Paris');
    expect(prefs).toHaveBeenCalledWith('api/gateway/accounts/me/preferences');
    await expect(fetchHistoryDefault(async () => ({ growing_max_tokens: 50000 }))).resolves.toBe(50000);
    await expect(fetchHistoryDefault(async () => ({}))).rejects.toThrow(/growing_max_tokens/);
  });
});

describe('New flow: "What starts it?"', () => {
  const support = pickerSupport({
    sources: { state: 'ok', value: { status: 'ok', endpoint: 'x', items: SOURCES as TriggerSourceItem[] } },
    mailboxes: { state: 'ok', value: { status: 'ok', mailboxes: MAILBOXES } },
    connections: { state: 'ok', value: { status: 'ok', connections: CONNECTIONS } },
    timeZone: { zone: 'Europe/Paris', origin: 'account', choices: [] },
  });

  it('asks first, with four human choices; chat is the default', () => {
    const html = renderToStaticMarkup(createElement(NewFlowDialog, { unsavedChanges: false, onCreate: () => {}, onCancel: () => {} }));
    expect(html).toContain('What starts it?');
    for (const text of ['A person, in a chat', 'On a schedule', 'When something arrives', 'By hand (Run now only)']) expect(html).toContain(text);
    expect(html).toMatch(/aria-checked="true"[^>]*>.*A person, in a chat/);
    expect(html).toContain('A flow for chat.');
  });

  it('the picker shows the schedule editor with the time zone, and the arrivals by name', () => {
    const schedule = renderToStaticMarkup(
      createElement(TriggerPicker, { value: emptyPicker('schedule'), onChange: () => {}, data: support.data, includeChat: true, timeZoneOrigin: 'account', gatewayUrl: 'http://gw' })
    );
    expect(schedule).toContain('Every day at 08:00 (Paris)');
    expect(schedule).toContain('Time zone');
    expect(schedule).toContain('your account’s');
    expect(schedule).toContain('aria-label="Hour"');
    expect(schedule).not.toContain('type="time"');
    expect(schedule).not.toMatch(/schedule v|v2|UTC intervals/);
    const arrives = renderToStaticMarkup(
      createElement(TriggerPicker, { value: { ...emptyPicker('arrives'), arrival: 'mail:default' }, onChange: () => {}, data: support.data, includeChat: false, timeZoneOrigin: 'account', gatewayUrl: 'http://gw/' })
    );
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

  it('Create with a trigger: ONLY On Flow Start (what arrives, typed) and On Flow End (response, notify, success), nothing between', () => {
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
    expect(end.data.inputs.map((p) => p.id)).toEqual(['exec-in', 'response', 'notify', 'success']);
    expect(flow.nodes.some((n) => n.data.nodeType === 'agent' || n.data.label === 'Trigger event')).toBe(false);
    expect(flow.automation_defaults).toEqual(automation);
    expect(st.canvasNote).toBe('What arrives is on On Flow Start; put what the person should see on On Flow End’s response (and notify for an alert).');
    // Chat: no trigger node, no defaults.
    useFlowStore.getState().createFlow({ name: 'Chat', description: '', interfaces: ['abstractcode.agent.v1'] });
    expect(useFlowStore.getState().getFlow().automation_defaults).toBeUndefined();
    expect(isTriggerableFlow(useFlowStore.getState().getFlow())).toBe(false);
  });
});

describe('UX review #25, #26, #6, #27', () => {
  it('weekly waits for a day; the sentence never reads "Every at"', async () => {
    const { scheduleSentence } = await import('./automationChoice');
    expect(scheduleSentence({ repeat: 'weekly', days: [], at: '08:00' })).toBe('Every week: pick at least one day');
    expect(choiceFromPicker({ ...emptyPicker('schedule'), rule: { repeat: 'weekly', days: [], at: '08:00' } }, DATA)).toEqual({ problem: 'Choose at least one day of the week.' });
  });

  it('a time zone picked for the schedule is the one saved and read back', () => {
    const state = { ...emptyPicker('schedule'), timeZone: 'America/New_York' };
    const picked = choiceFromPicker(state, DATA);
    if (!('choice' in picked) || picked.choice.kind === 'chat') throw new Error('expected a schedule');
    const trigger = triggerFromChoice(picked.choice, SOURCES);
    expect(trigger.config.time_zone).toBe('America/New_York');
    expect(pickerFromTrigger(trigger, DATA).timeZone).toBe('America/New_York');
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
    expect(choiceHelp({ kind: 'schedule' })).toBe('Runs on this clock, even when nobody is around.');
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
