/**
 * "Turn it on" (UX review 2026-10-25 #1): from the Automation dialog, make
 * the flow available (publish it) and create the automation from its saved
 * defaults, through the gateway's own routes:
 *
 *   POST /api/gateway/visualflows/{flow_id}/publish  -> {bundle_ref}
 *   POST /api/gateway/automations {request_id, title, target: {bundle_ref,
 *        flow_id, input_data}, trigger, context}       -> {automation_id}
 *
 * The published bundle's entrypoint is the flow's own id (the gateway packs
 * the root flow under it). The trigger is sent as saved (`connection_id` at
 * the top: the gateway folds it into the binding). Failures come back in
 * plain words, never as reason codes.
 */
import type { AutomationDefaults } from '../types/flow';
import { GatewayHttpError } from './gatewayClient';

export const AUTOMATIONS_ENDPOINT = 'api/gateway/automations';

export interface CreateAutomationBody {
  request_id: string;
  title: string;
  target: { bundle_ref: string; flow_id: string; input_data: AutomationDefaults['input_data'] };
  trigger: AutomationDefaults['trigger'];
  context: AutomationDefaults['context'];
}

export function createAutomationBody(input: {
  defaults: AutomationDefaults;
  flowId: string;
  flowName: string;
  bundleRef: string;
  requestId: string;
}): CreateAutomationBody {
  const { defaults } = input;
  return {
    request_id: input.requestId,
    title: (defaults.title || input.flowName || 'Automation').trim(),
    target: { bundle_ref: input.bundleRef, flow_id: input.flowId, input_data: { ...defaults.input_data } },
    trigger: defaults.trigger,
    context: defaults.context,
  };
}

export type TurnOnStep = 'save' | 'publish' | 'create';

export class TurnOnError extends Error {
  readonly step: TurnOnStep;
  constructor(step: TurnOnStep, message: string) {
    super(message);
    this.name = 'TurnOnError';
    this.step = step;
  }
}

function reasonOf(error: unknown): { status: number | null; code: string; message: string } {
  if (error instanceof GatewayHttpError) {
    const detail = error.detail as Record<string, unknown> | null;
    const inner = (detail && typeof detail === 'object' && detail.detail && typeof detail.detail === 'object' ? detail.detail : detail) as
      | Record<string, unknown>
      | null;
    const code = inner && typeof inner.reason_code === 'string' ? inner.reason_code : '';
    const message = inner && typeof inner.message === 'string' ? inner.message : error.message;
    return { status: error.status, code, message };
  }
  return { status: null, code: '', message: error instanceof Error ? error.message : String(error) };
}

/** A failure of one step, in words a person can act on. */
export function turnOnErrorWords(step: TurnOnStep, error: unknown): string {
  const { status, code, message } = reasonOf(error);
  if (status === 401) return 'Your gateway session expired: reconnect from the top bar, then try again.';
  if (step === 'save') return `The flow could not be saved, so it was not turned on: ${message}`;
  if (step === 'publish') {
    if (status === 403) return 'You may not make flows available on this gateway: ask its administrator.';
    return `The flow could not be made available: ${message}`;
  }
  switch (code) {
    case 'connection_not_found':
    case 'connection_not_yours':
      return 'That feed or webhook is not one of yours on this gateway any more: choose another under What starts it?, then try again.';
    case 'email_account_not_found':
      return 'That mailbox is not connected any more: choose another under What starts it?, or add it again (My email).';
    case 'email_account_cannot_read':
      return 'That mailbox has no incoming server, so it cannot be watched: connect it again with its incoming server.';
    case 'workflow_refused':
    case 'forbidden':
      return 'You may not run this flow on this gateway: ask its administrator.';
    case 'unknown_trigger_source':
    case 'unsupported_feature':
      return `This gateway cannot run that trigger: ${message}`;
    default:
      return `It could not be turned on: ${message}`;
  }
}

/** Where people see their automations (Observer's Automations page, served by the gateway). */
export function observerAutomationsUrl(gatewayUrl: string): string | null {
  const base = String(gatewayUrl || '').trim().replace(/\/+$/, '');
  return base ? `${base}/apps/observer/#automations` : null;
}

/** The success sentence ("Release digest is on. See it in Observer or the Assistant."). */
export function turnedOnSentence(title: string): string {
  return `${title} is on. See it in Observer or the Assistant.`;
}

/**
 * Publish, then create. `publish` and `create` are the gateway calls (injected
 * for tests); each failure is a TurnOnError carrying the step's words.
 */
export async function turnOnAutomation(input: {
  defaults: AutomationDefaults;
  flowId: string;
  flowName: string;
  requestId: string;
  publish: (flowId: string) => Promise<{ bundle_ref: string }>;
  create: (body: CreateAutomationBody) => Promise<{ automation_id: string }>;
}): Promise<{ automationId: string; title: string; bundleRef: string }> {
  let bundleRef: string;
  try {
    const published = await input.publish(input.flowId);
    bundleRef = published.bundle_ref;
    if (!bundleRef) throw new Error('the gateway answered without the published version');
  } catch (error) {
    throw new TurnOnError('publish', turnOnErrorWords('publish', error));
  }
  const body = createAutomationBody({ defaults: input.defaults, flowId: input.flowId, flowName: input.flowName, bundleRef, requestId: input.requestId });
  try {
    const created = await input.create(body);
    if (!created || typeof created.automation_id !== 'string' || !created.automation_id) throw new Error('the gateway answered without an automation');
    return { automationId: created.automation_id, title: body.title, bundleRef };
  } catch (error) {
    throw new TurnOnError('create', turnOnErrorWords('create', error));
  }
}
