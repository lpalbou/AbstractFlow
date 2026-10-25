/**
 * One automation per flow (UX re-review #3: "Turn it on keeps creating
 * automations"). Flow finds the automation this flow already has and offers
 * to update it or turn it off/on instead of creating another:
 *
 *   - the automation id is remembered per flow in this browser (the flow's
 *     `automation_defaults` takes no ids: the gateway refuses unknown keys);
 *   - it is checked with `GET /api/gateway/automations/{id}` (its definition's
 *     `target.flow_id` must be this flow), and when nothing is remembered the
 *     person's automations (`GET /api/gateway/automations?limit=200`) whose
 *     title matches are checked the same way;
 *   - update = `PATCH /api/gateway/automations/{id}` {command_id,
 *     expected_revision, changes: {title, trigger, context, target}};
 *     off / on = `POST /api/gateway/automations/{id}/commands`
 *     {command_id, type: automation.pause | automation.resume}.
 */
import type { AutomationDefaults } from '../types/flow';
import { GatewayHttpError, gatewayJson, jsonRequest } from './gatewayClient';
import { AUTOMATIONS_ENDPOINT, createAutomationBody } from './automationTurnOn';

export type LinkedStatus = 'active' | 'paused' | 'completed' | 'failed' | 'archived' | string;

export interface LinkedAutomation {
  automation_id: string;
  status: LinkedStatus;
  revision: number;
  title: string;
}

export interface AutomationLinkDeps {
  getJson: (path: string) => Promise<unknown>;
  send: (path: string, method: 'POST' | 'PATCH', body: unknown) => Promise<unknown>;
  remember: { get: (flowId: string) => string | null; set: (flowId: string, automationId: string | null) => void };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}


/** This browser's memory of which automation a flow turned on. */
export const browserMemory: AutomationLinkDeps['remember'] = {
  get: (flowId) => {
    try {
      return window.localStorage.getItem(`abstractflow_automation_${flowId}`);
    } catch {
      return null;
    }
  },
  set: (flowId, automationId) => {
    try {
      if (automationId) window.localStorage.setItem(`abstractflow_automation_${flowId}`, automationId);
      else window.localStorage.removeItem(`abstractflow_automation_${flowId}`);
    } catch {
      // Private mode / blocked storage: the title scan still finds it.
    }
  },
};

export const gatewayDeps: AutomationLinkDeps = {
  getJson: (path) => gatewayJson<unknown>(path),
  send: (path, method, body) => gatewayJson<unknown>(path, jsonRequest(body, { method })),
  remember: browserMemory,
};

async function linkedIfThisFlow(id: string, flowId: string, deps: AutomationLinkDeps): Promise<LinkedAutomation | null> {
  let raw: unknown;
  try {
    raw = await deps.getJson(`${AUTOMATIONS_ENDPOINT}/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof GatewayHttpError && error.status === 404) return null;
    throw error;
  }
  if (!isRecord(raw) || !isRecord(raw.definition) || !isRecord(raw.summary)) return null;
  const target = isRecord(raw.definition.target) ? raw.definition.target : {};
  if (target.flow_id !== flowId) return null;
  const status = String(raw.summary.status || '');
  if (status === 'archived') return null;
  return {
    automation_id: id,
    status,
    revision: typeof raw.summary.revision === 'number' ? raw.summary.revision : Number(raw.definition.revision) || 1,
    title: String(raw.summary.title || raw.definition.title || ''),
  };
}

/** The automation this flow already has (null: none yet). */
export async function findFlowAutomation(
  flowId: string,
  titles: readonly string[],
  deps: AutomationLinkDeps = gatewayDeps
): Promise<LinkedAutomation | null> {
  const remembered = deps.remember.get(flowId);
  if (remembered) {
    const linked = await linkedIfThisFlow(remembered, flowId, deps);
    if (linked) return linked;
    deps.remember.set(flowId, null);
  }
  const list = await deps.getJson(`${AUTOMATIONS_ENDPOINT}?limit=200`);
  const items = isRecord(list) && Array.isArray(list.items) ? list.items : [];
  const wanted = new Set(titles.map((t) => t.trim()).filter(Boolean));
  for (const row of items) {
    if (!isRecord(row) || typeof row.automation_id !== 'string') continue;
    if (wanted.size && !wanted.has(String(row.title || '').trim())) continue;
    const linked = await linkedIfThisFlow(row.automation_id, flowId, deps);
    if (linked) {
      deps.remember.set(flowId, linked.automation_id);
      return linked;
    }
  }
  return null;
}

/** Revise the automation to the flow's saved defaults and its newly published version. */
export async function updateFlowAutomation(
  linked: LinkedAutomation,
  input: { defaults: AutomationDefaults; flowId: string; flowName: string; bundleRef: string },
  deps: AutomationLinkDeps = gatewayDeps
): Promise<void> {
  const body = createAutomationBody({ ...input, requestId: 'unused' });
  await deps.send(`${AUTOMATIONS_ENDPOINT}/${encodeURIComponent(linked.automation_id)}`, 'PATCH', {
    command_id: `flow-update-${linked.automation_id}-${Date.now()}`,
    expected_revision: linked.revision,
    changes: { title: body.title, trigger: body.trigger, context: body.context, target: body.target },
  });
}

/** Pause (turn off) or resume (turn back on) the automation. */
export async function setFlowAutomationOn(linked: LinkedAutomation, on: boolean, deps: AutomationLinkDeps = gatewayDeps): Promise<void> {
  await deps.send(`${AUTOMATIONS_ENDPOINT}/${encodeURIComponent(linked.automation_id)}/commands`, 'POST', {
    command_id: `flow-${on ? 'resume' : 'pause'}-${linked.automation_id}-${Date.now()}`,
    type: on ? 'automation.resume' : 'automation.pause',
    payload: {},
  });
}

/** How the dialog and the badge say it ("On", "Off", …). */
export function linkedStatusWords(linked: LinkedAutomation | null): string {
  if (!linked) return '';
  if (linked.status === 'active') return 'On';
  if (linked.status === 'paused') return 'Off (paused)';
  if (linked.status === 'completed') return 'Finished';
  if (linked.status === 'failed') return 'Stopped after a failure';
  return linked.status;
}
