/**
 * The gateway facts the Automation dialog and the New flow question read
 * (operator 2026-10-25), each parsed strictly (a broken answer throws):
 *
 * - `GET /api/gateway/me/email` -> `accounts`: the person's mailboxes
 *   (`{account_id, primary, address, configured, can_read, enabled}`);
 * - `GET /api/gateway/automations/defaults` -> `growing_max_tokens`: how much
 *   of its earlier runs a growing automation reads, the ONE central default
 *   (abstractruntime `session_history.HISTORY_REPLAY_MAX_TOKENS`). Flow never
 *   hard-codes it.
 *
 * Each loader takes a fetcher so tests run against mocked answers.
 */
import type { Mailbox } from './automationChoice';
import { GatewayHttpError, gatewayJson } from './gatewayClient';

export const ME_EMAIL_ENDPOINT = 'api/gateway/me/email';
export const AUTOMATION_DEFAULTS_ENDPOINT = 'api/gateway/automations/defaults';

export type GatewayJsonFetcher = (path: string) => Promise<unknown>;
const defaultFetcher: GatewayJsonFetcher = (path) => gatewayJson<unknown>(path);

export class AutomationGatewayContractError extends Error {
  constructor(message: string) {
    super(`Gateway answer breaks the contract: ${message}`);
    this.name = 'AutomationGatewayContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseMailboxes(raw: unknown): Mailbox[] {
  if (!isRecord(raw) || !Array.isArray(raw.accounts)) throw new AutomationGatewayContractError('GET /me/email has no `accounts` list');
  return raw.accounts.map((item, i) => {
    if (!isRecord(item) || typeof item.account_id !== 'string' || !item.account_id) {
      throw new AutomationGatewayContractError(`accounts[${i}].account_id is not a non-empty string`);
    }
    return {
      account_id: item.account_id,
      primary: item.primary === true,
      address: typeof item.address === 'string' && item.address ? item.address : null,
      configured: item.configured === true,
      can_read: item.can_read === true,
      can_send: item.can_send === true,
      enabled: item.enabled !== false,
    };
  });
}

/** The person's mailboxes; `unavailable` when the gateway has no mail routes (404). */
export async function fetchMailboxes(
  fetchJson: GatewayJsonFetcher = defaultFetcher
): Promise<{ status: 'ok'; mailboxes: Mailbox[] } | { status: 'unavailable'; reason: string }> {
  try {
    return { status: 'ok', mailboxes: parseMailboxes(await fetchJson(ME_EMAIL_ENDPOINT)) };
  } catch (error) {
    if (error instanceof GatewayHttpError && error.status === 404) {
      return { status: 'unavailable', reason: 'Mailboxes are not available on this gateway.' };
    }
    throw error;
  }
}

export function parseHistoryDefault(raw: unknown): number {
  const value = isRecord(raw) ? raw.growing_max_tokens : undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new AutomationGatewayContractError('GET /automations/defaults has no positive whole `growing_max_tokens`');
  }
  return value;
}

/** The central default history budget of a growing automation (tokens). */
export async function fetchHistoryDefault(fetchJson: GatewayJsonFetcher = defaultFetcher): Promise<number> {
  return parseHistoryDefault(await fetchJson(AUTOMATION_DEFAULTS_ENDPOINT));
}
