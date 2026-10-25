// Operator ruling 2026-10-25: Run on a flow with an automation trigger runs it
// "as if triggered" on a sample the gateway reads (POST /triggers/sample), not
// on raw "Workflow Parameters". Chat flows keep the plain Run dialog.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TriggeredRunPanel } from '../components/automation/TriggeredRunPanel';
import { GatewayHttpError } from './gatewayClient';
import { TRIGGER_SAMPLE_ENDPOINT, fetchTriggerSample, runAsIfTriggered, sampleErrorWords, testRunSentence } from './triggerSample';
import { parseMailboxes } from './automationGateway';
import { ME_EMAIL_RESPONSE } from './triggerSources.fixtures';
import type { AutomationTriggerDefaults } from '../types/flow';

const MAIL: AutomationTriggerDefaults = { source_id: 'email.received', source_version: 1, config: { account: 'default' } };
const FEED: AutomationTriggerDefaults = { source_id: 'feed.item', source_version: 1, config: {}, connection_id: 'conn_feed1' };
const HOOK: AutomationTriggerDefaults = { source_id: 'webhook.received', source_version: 1, config: {}, connection_id: 'conn_hook1' };
const DAILY: AutomationTriggerDefaults = { source_id: 'schedule', source_version: 2, config: { kind: 'daily', at: '08:00', time_zone: 'Europe/Paris' } };
const MANUAL: AutomationTriggerDefaults = { source_id: 'manual', source_version: 1, config: {} };
const WORDS = { mailboxes: parseMailboxes(ME_EMAIL_RESPONSE) };

const panel = (trigger: AutomationTriggerDefaults) =>
  renderToStaticMarkup(createElement(TriggeredRunPanel, { trigger, words: WORDS, count: 100, onCount: () => {}, busy: false, error: '', onRun: () => {} }));

describe('the Run dialog of a triggered flow, per trigger kind', () => {
  it('mail: "Using: When mail arrives in …" and "Use the last [100] messages"', () => {
    const html = panel(MAIL);
    expect(html).toContain('Run as if triggered');
    expect(html).toContain('Using: When mail arrives in test@abstractframework.ai');
    expect(html).toMatch(/Use the last<\/span><input[^>]*value="100"[^>]*\/?><span>messages<\/span>/);
  });
  it('feed: items; webhook: calls; schedule: as if it fired now; by hand: no control', () => {
    expect(panel(FEED)).toContain('<span>items</span>');
    expect(panel(HOOK)).toContain('<span>calls</span>');
    const daily = panel(DAILY);
    expect(daily).toContain('As if it fired now.');
    expect(daily).not.toContain('Use the last');
    const manual = panel(MANUAL);
    expect(manual).not.toContain('Use the last');
    expect(manual).not.toContain('As if it fired now');
    expect(manual).toContain('>Run<');
  });

  it('the dialog hides the trigger-filled pins under "Advanced: edit the inputs"; chat flows keep the plain dialog', () => {
    const src = readFileSync(new URL('../components/RunFlowModal.tsx', import.meta.url), 'utf8');
    expect(src).toContain('<summary>Advanced: edit the inputs</summary>');
    expect(src).toContain('automationTrigger ? visibleFormInputPins.filter((pin) => !TRIGGER_FILLED_PIN_IDS.has(pin.id)) : visibleFormInputPins');
    expect(src).toContain("{automationTrigger ? 'Your inputs' : 'Workflow Parameters'}");
    expect(src).toContain('onClick={() => void (automationTrigger ? handleTriggeredRun() : handleSubmit())}');
  });
});

describe('sample → run hand-off', () => {
  const sample = { inputs: { messages: [{ id: 'm1', subject: 'Invoice 42' }], mailbox: 'test@abstractframework.ai', event: { type: 'x' } }, truncated: false, summary: '' };

  it('posts {trigger, count}, prefills the advanced fields, starts the run with the inputs, says what ran', async () => {
    const post = vi.fn(async () => sample);
    const prefill = vi.fn();
    const start = vi.fn();
    const out = await runAsIfTriggered({
      trigger: MAIL,
      count: 100,
      edited: false,
      filledPinIds: ['messages', 'mailbox', 'event'],
      words: WORDS,
      sample: (body) => fetchTriggerSample(body, post),
      prefill,
      start,
    });
    expect(post).toHaveBeenCalledWith(TRIGGER_SAMPLE_ENDPOINT, { trigger: MAIL, count: 100 });
    expect(prefill).toHaveBeenCalledWith({ messages: JSON.stringify(sample.inputs.messages, null, 2), mailbox: 'test@abstractframework.ai', event: '{\n  "type": "x"\n}' });
    expect(start).toHaveBeenCalledWith(sample.inputs);
    expect(out).toEqual({ started: true, sentence: 'Running with the last 100 messages of test@abstractframework.ai (test run)' });
  });

  it('a schedule sends no count; the gateway summary wins when given; edited inputs run as they are', async () => {
    const post = vi.fn(async () => ({ inputs: { scheduled_at: '2026-10-25T08:00:00+01:00', occurrence: 1 }, truncated: false, summary: '' }));
    const out = await runAsIfTriggered({ trigger: DAILY, count: 100, edited: false, filledPinIds: ['scheduled_at'], sample: (b) => fetchTriggerSample(b, post), prefill: () => {}, start: () => {} });
    expect(post).toHaveBeenCalledWith(TRIGGER_SAMPLE_ENDPOINT, { trigger: DAILY });
    expect(out).toEqual({ started: true, sentence: 'Running as if the schedule fired now (test run)' });
    expect(testRunSentence(FEED, 20, { inputs: {}, truncated: true, summary: 'the last 7 items of Release notes' })).toBe('Running with the last 7 items of Release notes (test run)');
    const start = vi.fn();
    const sampler = vi.fn();
    const edited = await runAsIfTriggered({ trigger: MAIL, count: 100, edited: true, filledPinIds: [], sample: sampler, prefill: () => {}, start });
    expect(sampler).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith();
    expect(edited).toEqual({ started: true, sentence: 'Running with the inputs you edited (test run)' });
  });

  it('failures are words and nothing starts', async () => {
    const start = vi.fn();
    const refused = await runAsIfTriggered({
      trigger: FEED,
      count: 100,
      edited: false,
      filledPinIds: [],
      sample: async () => {
        throw new GatewayHttpError('HTTP 422', 422, { detail: { reason_code: 'source_unreachable', message: 'The feed answered HTTP 404.' } });
      },
      prefill: () => {},
      start,
    });
    expect(refused).toEqual({ started: false, problem: 'Could not read what would arrive: The feed answered HTTP 404.' });
    expect(start).not.toHaveBeenCalled();
    expect(sampleErrorWords(new GatewayHttpError('HTTP 404', 404, 'Not Found'))).toBe('This gateway cannot do test runs yet: update the gateway.');
    expect(sampleErrorWords(new GatewayHttpError('HTTP 401', 401, null))).toBe('Your gateway session expired: reconnect from the top bar, then try again.');
    await expect(fetchTriggerSample({ trigger: MAIL }, async () => ({}))).rejects.toThrow('without its inputs');
  });
});
