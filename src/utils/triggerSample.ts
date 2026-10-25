/**
 * "Run as if triggered" (operator ruling 2026-10-25): pressing Run on a flow
 * with an automation trigger runs it on a sample of what the trigger would
 * deliver, read by the gateway:
 *
 *   POST /api/gateway/triggers/sample {trigger, count}
 *     -> {inputs: {<On Flow Start pin>: value, ...}, truncated: bool, summary: string}
 *
 * `inputs` are the trigger-filled On Flow Start inputs (messages/mailbox,
 * items/feed, calls, scheduled_at/occurrence, event: utils/triggerPins.ts);
 * the run starts with them plus the person's own inputs. Failures come back in
 * plain words.
 */
import type { AutomationTriggerDefaults } from '../types/flow';
import { GatewayHttpError, gatewayJson, jsonRequest } from './gatewayClient';
import { triggerPinKind, type TriggerPinKind } from './triggerPins';
import { mailboxName, connectionKind, type AutomationWords } from './automationChoice';

export const TRIGGER_SAMPLE_ENDPOINT = 'api/gateway/triggers/sample';
export const DEFAULT_SAMPLE_COUNT = 100;

export interface TriggerSample {
  inputs: Record<string, unknown>;
  truncated: boolean;
  summary: string;
}

export class TriggerSampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TriggerSampleError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseTriggerSample(raw: unknown): TriggerSample {
  if (!isRecord(raw) || !isRecord(raw.inputs)) throw new TriggerSampleError('The gateway answered the test run without its inputs.');
  return {
    inputs: raw.inputs,
    truncated: raw.truncated === true,
    summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
  };
}

/** What a sample count counts, per trigger ("messages", "items", "calls"); null when there is no count. */
export function sampleNoun(kind: TriggerPinKind): string | null {
  switch (kind) {
    case 'email':
      return 'messages';
    case 'feed':
      return 'items';
    case 'webhook':
      return 'calls';
    default:
      return null;
  }
}

/** A failed sample in words: the route missing, an unreachable mailbox, a feed's answer… */
export function sampleErrorWords(error: unknown): string {
  if (error instanceof TriggerSampleError) return error.message;
  if (error instanceof GatewayHttpError) {
    if (error.status === 401) return 'Your gateway session expired: reconnect from the top bar, then try again.';
    if (error.status === 404 && !isRecord(error.detail)) return 'This gateway cannot do test runs yet: update the gateway.';
    const detail = isRecord(error.detail) ? (isRecord(error.detail.detail) ? error.detail.detail : error.detail) : null;
    const message = detail && typeof detail.message === 'string' ? detail.message : error.message;
    if (error.status === 404 && /not found|no route|unknown/i.test(message) && !detail?.reason_code) {
      return 'This gateway cannot do test runs yet: update the gateway.';
    }
    return `Could not read what would arrive: ${message}`;
  }
  return `Could not read what would arrive: ${error instanceof Error ? error.message : String(error)}`;
}

export async function fetchTriggerSample(
  body: { trigger: AutomationTriggerDefaults; count?: number },
  post: (path: string, body: unknown) => Promise<unknown> = (path, b) => gatewayJson<unknown>(path, jsonRequest(b, { method: 'POST' }))
): Promise<TriggerSample> {
  return parseTriggerSample(await post(TRIGGER_SAMPLE_ENDPOINT, body));
}

/**
 * The sentence shown when the test run starts: the gateway's own summary when
 * it gives one, else built from the trigger ("the last 100 messages of me@…").
 */
export function testRunSentence(trigger: AutomationTriggerDefaults, count: number, sample: TriggerSample | null, words: AutomationWords = {}): string {
  if (sample?.summary) return `Running with ${sample.summary} (test run)`;
  const kind = triggerPinKind(trigger);
  if (kind === 'email') {
    const box = mailboxName(typeof trigger.config.account === 'string' ? trigger.config.account : 'default', words.mailboxes || null);
    return `Running with the last ${count} messages of ${box} (test run)`;
  }
  if (kind === 'feed' || kind === 'webhook') {
    const cid = trigger.connection_id || '';
    const label = words.connections?.find((c) => c.connection_id === cid)?.label || (connectionKind(trigger.source_id) === 'feed' ? 'the feed' : 'the webhook');
    return `Running with the last ${count} ${sampleNoun(kind)} of ${label} (test run)`;
  }
  if (kind === 'schedule') return 'Running as if the schedule fired now (test run)';
  return 'Running (test run)';
}

/**
 * The hand-off from the sample to the run (pure; the Run dialog passes its
 * own functions): sample what the trigger would deliver, prefill the
 * trigger-filled fields with it, start the run with those inputs (they win
 * over the form's), and say what was run. Inputs the person edited are used
 * as they are, without a new sample. Returns the sentence to show, or the
 * problem in words (nothing started).
 */
export async function runAsIfTriggered(args: {
  trigger: AutomationTriggerDefaults;
  count: number;
  edited: boolean;
  filledPinIds: readonly string[];
  words?: AutomationWords;
  sample: (body: { trigger: AutomationTriggerDefaults; count?: number }) => Promise<TriggerSample>;
  prefill: (values: Record<string, string>) => void;
  start: (overrides?: Record<string, unknown>) => void;
}): Promise<{ started: true; sentence: string } | { started: false; problem: string }> {
  if (args.edited) {
    args.start();
    return { started: true, sentence: 'Running with the inputs you edited (test run)' };
  }
  let sample: TriggerSample;
  try {
    const counted = sampleNoun(triggerPinKind(args.trigger)) !== null;
    sample = await args.sample({ trigger: args.trigger, ...(counted ? { count: args.count } : {}) });
  } catch (error) {
    return { started: false, problem: sampleErrorWords(error) };
  }
  const values: Record<string, string> = {};
  for (const id of args.filledPinIds) {
    if (!(id in sample.inputs)) continue;
    const value = sample.inputs[id];
    values[id] = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
  args.prefill(values);
  args.start(sample.inputs);
  return { started: true, sentence: testRunSentence(args.trigger, args.count, sample, args.words) };
}
